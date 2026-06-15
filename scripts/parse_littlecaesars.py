"""One-off script: parse scripts/lc_table.txt (pdftotext -table output of Little
Caesars' US nutrition guide) into scripts/littlecaesars.csv, ready for
import-qdoba.cjs (generic CSV -> food_items importer).

The source PDF lists whole-item totals (no serving weight in grams). Per
user decision: pizza items are divided by 8 and labeled "(1 slice)";
non-pizza items (sides/wings/dips) are kept as listed with a descriptive
servingUnit. servingSizeG is set to 1 as a placeholder quantity (the real
serving info lives in servingUnit/name, as is already the convention for
several non-gram entries in this DB).
"""
import re
import csv
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "scripts", "lc_table.txt")
OUT = os.path.join(ROOT, "scripts", "littlecaesars.csv")

NUM_RE = re.compile(r"^-?\d+(\.\d+)?$")

# Column order in this brochure (11 numeric columns, no serving size)
COLS = [
    "calories", "caloriesFromFat", "fatG", "saturatedFatG", "transFatG",
    "cholesterolMg", "sodiumMg", "carbsG", "fiberG", "sugarG", "proteinG",
]

# (header text, section type, label/servingUnit) — checked longest-first so
# "...PIZZAS SPECIALTY" is matched before "...PIZZAS"
SECTIONS = [
    ("LARGE EXTRAMOSTBESTEST PIZZAS", "pizza8", "ExtraMostBestest"),
    ("DETROIT-STYLE DEEP DISH PIZZAS SPECIALTY", "pizza8", "Detroit-Style Deep Dish Specialty"),
    ("DETROIT-STYLE DEEP DISH PIZZAS", "pizza8", "Detroit-Style Deep Dish"),
    ("LARGE SPECIALTY PIZZAS", "pizza8", "Specialty"),
    ("LARGE CLASSIC PIZZAS", "pizza8", "Classic"),
    ("THIN CRUST PIZZAS", "pizza8", "Thin Crust"),
    ("CAESAR DIPS (serving size: 1 container)", "asis", "1 container"),
    ("CAESAR WINGS", "asis", "1 order"),
    ("SIDES", "asis", "1 order"),
    ("MAKE IT STUFFED CRUST", "skip", None),
    ("CUSTOM ROUND PIZZAS (1-2 TOPPINGS). ADD CALORIES TO BASE PIZZA", "skip", None),
    ("CUSTOM DETROIT-STYLE DEEP DISH (1-3 TOPPINGS). ADD CALORIES TO BASE PIZZA", "skip", None),
    ("MEALS & LUNCH COMBOS", "skip", None),
    ("LUNCH COMBO", "skip", None),
    ("EXTRAS", "skip", None),
    ("TOPPINGS", "skip", None),
]
# longest header text first, so prefixes don't shadow more-specific headers
SECTIONS.sort(key=lambda s: -len(s[0]))


def normalize(line: str) -> str:
    line = line.replace("\xae", "").replace("™", "")
    line = re.sub(r"\s{2,}", " ", line).strip()
    return line


def num(v):
    return round(float(v), 2)


def main():
    rows_out = []
    skipped = []
    section_type = None
    label = None

    with open(SRC, "r", encoding="latin-1") as f:
        for raw in f:
            line = raw.rstrip("\n").rstrip("\r")
            stripped = line.strip()
            if not stripped:
                continue
            norm = normalize(stripped)

            matched_section = False
            for header, stype, slabel in SECTIONS:
                if norm == header or norm.startswith(header):
                    section_type, label = stype, slabel
                    matched_section = True
                    break
            if matched_section:
                continue

            if norm.startswith("MENU OPTIONS") or norm.startswith("PRODUCT ALLERGEN INFORMATION") \
               or norm.startswith("The most common allergens"):
                continue

            if section_type in (None, "skip"):
                continue

            tokens = norm.split()
            # strip trailing single-letter allergen markers ("a")
            while tokens and tokens[-1].lower() == "a":
                tokens.pop()

            if len(tokens) < len(COLS):
                skipped.append(("too_short", norm))
                continue

            last = tokens[-len(COLS):]
            if not all(NUM_RE.match(t) for t in last):
                skipped.append(("not_data", norm))
                continue

            name_tokens = tokens[:-len(COLS)]
            name = " ".join(name_tokens).strip()
            if not name:
                skipped.append(("no_name", norm))
                continue

            data = dict(zip(COLS, (num(v) for v in last)))

            if section_type == "pizza8":
                for k in COLS:
                    data[k] = round(data[k] / 8, 2)
                full_name = f"{name} ({label}, 1 slice)"
                serving_unit = "1 slice"
            else:
                full_name = name
                serving_unit = label

            rows_out.append({
                "name": full_name,
                "brand": "Little Caesars",
                "servingSizeG": 1,
                "servingUnit": serving_unit,
                "calories": data["calories"],
                "proteinG": data["proteinG"],
                "carbsG": data["carbsG"],
                "fatG": data["fatG"],
                "fiberG": data["fiberG"],
                "sodiumMg": data["sodiumMg"],
                "sugarG": data["sugarG"],
                "saturatedFatG": data["saturatedFatG"],
                "transFatG": data["transFatG"],
                "cholesterolMg": data["cholesterolMg"],
                "potassiumMg": "",
                "source": "littlecaesars",
            })

    print(f"Parsed {len(rows_out)} rows, skipped {len(skipped)} lines")
    print("\n--- SKIPPED (review) ---")
    for reason, text in skipped:
        print(f"  [{reason}] {text}")

    print("\n--- PARSED ROWS ---")
    for r in rows_out:
        print(f"{r['name']:<55} | serv={r['servingSizeG']}{r['servingUnit']:<12} "
              f"cal={r['calories']:>7} fat={r['fatG']:>6} sat={r['saturatedFatG']:>5} trans={r['transFatG']:>4} "
              f"chol={r['cholesterolMg']:>6} carb={r['carbsG']:>6} fib={r['fiberG']:>5} sug={r['sugarG']:>5} "
              f"pro={r['proteinG']:>6} sod={r['sodiumMg']:>7}")

    field_order = ["name", "brand", "servingSizeG", "servingUnit", "calories", "proteinG", "carbsG", "fatG",
                    "fiberG", "sodiumMg", "sugarG", "saturatedFatG", "transFatG", "cholesterolMg", "potassiumMg", "source"]
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=field_order, extrasaction="ignore")
        w.writeheader()
        for r in rows_out:
            w.writerow(r)
    print(f"\nWrote {len(rows_out)} rows to {OUT}")


if __name__ == "__main__":
    main()

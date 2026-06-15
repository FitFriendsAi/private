"""One-off script: parse scripts/qdoba_old_table.txt (pdftotext -table output of the
older 2020 Qdoba nutrition brochure) into scripts/qdoba_2020.csv, in the same shape
as qdoba.csv, ready for import-qdoba.cjs.

Column order in this brochure differs from the 2026 one: sodium/potassium come
BEFORE carbs/fiber/sugar/protein.
"""
import re
import csv
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "scripts", "qdoba_old_table.txt")
OUT = os.path.join(ROOT, "scripts", "qdoba_2020.csv")

NUM_RE = re.compile(r"^-?\d+(\.\d+)?$|^-$|^--$|^<1$")
ALLERGEN_RE = re.compile(r"^(-|[SEFMPCTWG]{1,8}\*?)$")

BEVERAGE_SECTION_PREFIXES = ("Fountain Beverages", "Bottled Beverages")
FOOD_SECTIONS = {
    "Ingredients for Entrees", "Signature Eats", "Small Bites",
    "Ingredients for Kids Items", "Kid's Meals", "Others",
}
SKIP_SECTIONS = {"Menu Board Entree Calorie Ranges**", "Allergen Key"}

# Old-brochure column order (after the allergen token)
COLS = [
    "servingSizeG", "calories", "caloriesFromFat", "fatG", "saturatedFatG",
    "transFatG", "cholesterolMg", "sodiumMg", "potassiumMg", "carbsG",
    "fiberG", "sugarG", "proteinG",
]


def clean_name(name: str) -> str:
    name = name.replace("\xae", "")  # strip (R) trademark glyph
    name = re.sub(r"\s{2,}", " ", name).strip()
    name = re.sub(r"\s+", " ", name)
    return name


def num(v):
    if v in ("-", "--", "", "*"):
        return ""
    if v == "<1":
        return "0.5"
    return v


def main():
    rows_out = []
    skipped = []
    section = None
    serving_unit = "g"

    with open(SRC, "r", encoding="latin-1") as f:
        for raw in f:
            line = raw.rstrip("\n").rstrip("\r")
            stripped = line.strip()
            if not stripped:
                continue
            # strip trailing page-footer markers like "1of7"
            stripped = re.sub(r"\s*\d+of7\s*$", "", stripped).strip()
            norm = clean_name(stripped)

            if norm.startswith("Nutrition Facts") or "Calories per Serving" in norm:
                continue
            if norm.startswith("(v)= Vegan Product"):
                continue

            section_key = norm.replace("é", "e").replace("\xe9", "e")
            if any(section_key.startswith(p) for p in BEVERAGE_SECTION_PREFIXES):
                section = "Beverages"
                serving_unit = "fl oz"
                continue
            if section_key in FOOD_SECTIONS:
                section = section_key
                serving_unit = "g"
                continue
            if section_key in SKIP_SECTIONS:
                section = section_key
                continue

            if section in SKIP_SECTIONS or section is None:
                skipped.append(("skipped_section", norm))
                continue

            tokens = norm.split()
            if len(tokens) < 13:
                skipped.append(("too_short", norm))
                continue

            last13 = tokens[-13:]
            if not all(NUM_RE.match(t) for t in last13):
                skipped.append(("not_data", norm))
                continue

            if len(tokens) >= 14 and ALLERGEN_RE.match(tokens[-14]):
                allergen = tokens[-14]
                name_tokens = tokens[:-14]
            else:
                allergen = "-"
                name_tokens = tokens[:-13]

            name = " ".join(name_tokens).strip()
            if not name:
                skipped.append(("no_name", " ".join(tokens)))
                continue
            if all(num(v) == "" for v in last13):
                skipped.append(("all_empty", name))
                continue

            data = dict(zip(COLS, (num(v) for v in last13)))
            rows_out.append({
                "name": name,
                "brand": "Qdoba",
                "servingSizeG": data["servingSizeG"],
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
                "potassiumMg": data["potassiumMg"],
                "source": "qdoba",
                "_section": section,
                "_allergen": allergen,
                "_calFromFat": data["caloriesFromFat"],
            })

    print(f"Parsed {len(rows_out)} rows, skipped {len(skipped)} lines")
    print("\n--- SKIPPED (review) ---")
    for reason, text in skipped:
        print(f"  [{reason}] {text}")

    print("\n--- PARSED ROWS ---")
    for r in rows_out:
        print(f"{r['_section']:>24} | {r['name']:<55} | serv={r['servingSizeG']:>5}{r['servingUnit']:<5} "
              f"cal={r['calories']:>5} fat={r['fatG']:>5} sat={r['saturatedFatG']:>4} trans={r['transFatG']:>3} "
              f"chol={r['cholesterolMg']:>4} carb={r['carbsG']:>4} fib={r['fiberG']:>3} sug={r['sugarG']:>4} "
              f"pro={r['proteinG']:>4} sod={r['sodiumMg']:>5} pot={r['potassiumMg']:>5} | allergen={r['_allergen']}")

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

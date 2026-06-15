"""One-off script: parse scripts/qdoba_table.txt (pdftotext -table output of the
Qdoba nutrition brochure) into scripts/qdoba.csv, in the same shape as menustat.csv,
ready for an import script into food_items.
"""
import re
import csv
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "scripts", "qdoba_table.txt")
OUT = os.path.join(ROOT, "scripts", "qdoba.csv")

NUM_RE = re.compile(r"^-?\d+(\.\d+)?$|^-$")
ALLERGEN_RE = re.compile(r"^(-|[SEFMPCTWG]{1,6}\*?)$")

BEVERAGE_SECTIONS = {"Fountain Beverages (fl. oz)", "Bottled Beverages (fl.oz)"}
FOOD_SECTIONS = {
    "Ingredients for Entrees", "Signature Eats", "Limited Time Offerings",
    "Ingredients for Kids Items", "Dessert",
}
SKIP_SECTIONS = {"Small Bites", "Create Your Own QDOBA Kit Ranges**", "Menu Board Entree Calorie Ranges**"}

NO_DATA_NAME_PREFIXES = (
    "Mini Bowl (refer to",
    "Taco (Flour or Taco shell)",
)

COLS = [
    "servingSizeG", "calories", "caloriesFromFat", "fatG", "saturatedFatG",
    "transFatG", "cholesterolMg", "carbsG", "fiberG", "sugarG", "proteinG",
    "sodiumMg", "potassiumMg",
]


def clean_name(name: str) -> str:
    name = name.replace("\xae", "")  # strip (R) trademark glyph
    name = re.sub(r"\s{2,}", " ", name).strip()
    name = re.sub(r"\s+", " ", name)
    return name


def num(v):
    if v in ("-", "", "*"):
        return ""
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
            # strip trailing page-footer markers like "1of5"
            stripped = re.sub(r"\s*\d+of5\s*$", "", stripped).strip()
            norm = clean_name(stripped)

            if norm in ("Nutrition Facts 2026", "Nutrition Facts", "Allergens") or \
               ("Calories per Serving" in norm) or norm == "(g )" or norm.startswith("Fl. oz"):
                continue

            section_key = norm.replace("é", "e").replace("\xae", "")
            if any(section_key.startswith(s) for s in BEVERAGE_SECTIONS):
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

            tokens = norm.split()
            if len(tokens) < 13:
                skipped.append(("too_short", norm))
                continue

            last13 = tokens[-13:]
            if not all(NUM_RE.match(t) for t in last13):
                skipped.append(("not_data", norm))
                continue

            if section in SKIP_SECTIONS or section is None:
                skipped.append(("no_section", norm))
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
            if any(name.startswith(p) for p in NO_DATA_NAME_PREFIXES):
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
        print(f"{r['_section']:>22} | {r['name']:<55} | serv={r['servingSizeG']:>5}{r['servingUnit']:<5} "
              f"cal={r['calories']:>5} fat={r['fatG']:>4} sat={r['saturatedFatG']:>4} trans={r['transFatG']:>3} "
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

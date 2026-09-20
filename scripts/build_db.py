#!/usr/bin/env python3
"""
Build rdr2.db from the Notion 'RDR2 Databases' CSV export.

Usage:
    python3 build_db.py <export_dir> [-o data/rdr2.db]

<export_dir> is the folder holding the five exported CSVs (Animals,
Animal Materials, Misc Materials, Craftable Items, Recipe Ingredients).
The '_all.csv' variants are ignored.

Requires: pandas.  Everything else is the standard library.
"""

import argparse
import glob
import os
import re
import sqlite3
import sys

import pandas as pd

# --------------------------------------------------------------------------
# reference constants
# --------------------------------------------------------------------------

# where materials are stored
LOCATIONS = ["Satchel", "Trapper", "Pearson"]

# crafting station -> (kind, card colour, stock it draws from)
STATIONS = {
    "Trapper": ("merchant", "blue",   "Trapper"),
    "Pearson": ("merchant", "yellow", "Pearson"),
    "Fence":   ("merchant", "pink",   "Satchel"),
}

# ordinal warmth scale, derived from the description text at build time
WARMTH = {
    "lightweight":     0,
    "slightly warm":   1,
    "reasonably warm": 2,
    "warm":            3,
    "very warm":       4,
}

# typos in the source data, corrected on import
TEXT_FIXES = {
    "Increases Stamina XP bounus by 10%": "Increases Stamina XP bonus by 10%",
    "Increases Heath XP by 10%":          "Increases Health XP by 10%",
}

SCHEMA = """
PRAGMA foreign_keys = ON;

-- Every id is a prefixed slug derived from the row's name: stable across
-- rebuilds, self-describing wherever it turns up loose (URLs, the personal
-- layer's ledger, logs).

CREATE TABLE weapons (
    id    TEXT PRIMARY KEY,          -- weapon-sniper-rifle
    name  TEXT NOT NULL UNIQUE
);

CREATE TABLE animals (
    id         TEXT PRIMARY KEY,     -- animal-bear
    name       TEXT NOT NULL UNIQUE,
    weapon_id  TEXT REFERENCES weapons(id)
);

-- where materials are stored
CREATE TABLE locations (
    id    TEXT PRIMARY KEY,          -- loc-satchel
    name  TEXT NOT NULL UNIQUE
);

-- where crafting happens; each station draws from one stock
CREATE TABLE stations (
    id           TEXT PRIMARY KEY,   -- station-trapper
    name         TEXT NOT NULL UNIQUE,
    kind         TEXT NOT NULL,
    color        TEXT,
    location_id  TEXT NOT NULL REFERENCES locations(id)
);

CREATE TABLE sets (
    id        TEXT PRIMARY KEY,      -- set-the-desperado
    name      TEXT NOT NULL UNIQUE,
    set_type  TEXT NOT NULL CHECK (set_type IN ('merchant','outfit','camp_area'))
);

-- things you collect
CREATE TABLE ingredients (
    id           TEXT PRIMARY KEY,   -- ing-perfect-beaver-pelt
    name         TEXT NOT NULL UNIQUE,
    source_type  TEXT NOT NULL CHECK (source_type IN ('animal','misc')),
    quality      TEXT CHECK (quality IN ('Perfect','Legendary')),
    body_part    TEXT,
    animal_id    TEXT REFERENCES animals(id)
);

-- things you craft
CREATE TABLE recipes (
    id           TEXT PRIMARY KEY,   -- recipe-billy-vest
    name         TEXT NOT NULL UNIQUE,
    category     TEXT,
    station_id   TEXT REFERENCES stations(id),
    set_id       TEXT REFERENCES sets(id),
    price_cents  INTEGER NOT NULL DEFAULT 0,
    description  TEXT,
    warmth_rank  INTEGER             -- derived from description at build time
);

CREATE TABLE recipe_ingredients (
    recipe_id      TEXT NOT NULL REFERENCES recipes(id),
    ingredient_id  TEXT NOT NULL REFERENCES ingredients(id),
    qty            INTEGER NOT NULL CHECK (qty > 0),
    PRIMARY KEY (recipe_id, ingredient_id)
);

CREATE INDEX idx_ingredients_source ON ingredients(source_type);
CREATE INDEX idx_ingredients_animal ON ingredients(animal_id);
CREATE INDEX idx_recipes_category   ON recipes(category);
CREATE INDEX idx_recipes_station    ON recipes(station_id);
CREATE INDEX idx_ri_ingredient      ON recipe_ingredients(ingredient_id);
"""

# --------------------------------------------------------------------------
# parsing helpers
# --------------------------------------------------------------------------

# Notion exports relations as:  Name (https://app.notion.com/p/Slug-hex?pvs=21)
RELATION_RE = re.compile(r"([^,][^(]*?)\s*\(https?://[^)]+\)")


def parse_relation(cell):
    """Return the linked page names in a Notion relation cell."""
    if pd.isna(cell):
        return []
    return [m.strip() for m in RELATION_RE.findall(str(cell))]


def clean(text):
    """Normalise curly apostrophes so 'Trapper's' matches everywhere."""
    if pd.isna(text):
        return None
    return str(text).replace("\u2019", "'").strip()


def parse_price(cell):
    """'$40.00' -> 4000 ; blank or '$0.00' -> 0"""
    if pd.isna(cell):
        return 0
    digits = re.sub(r"[^0-9.]", "", str(cell))
    return int(round(float(digits) * 100)) if digits else 0


def parse_description(buff):
    """
    Keep the Notion 'Buff' text verbatim, and derive an ordinal warmth rank
    where one applies.  The text stays the single source of truth; the rank
    is recomputed on every build.
    """
    if pd.isna(buff) or not str(buff).strip():
        return None, None
    text = str(buff).strip()
    text = TEXT_FIXES.get(text, text)
    return text, WARMTH.get(text.lower())


def mkid(prefix, name):
    """('ing', 'Perfect Beaver Pelt') -> 'ing-perfect-beaver-pelt'.

    Derived from the name rather than a counter, so ids survive rows being
    added, removed or reordered in the source CSVs.  The personal layer
    lives in a different database file and cannot use foreign keys against
    these rows, so it stores these strings."""
    slug = re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", name.lower())).strip("-")
    return f"{prefix}-{slug}"


def classify_set(name, categories):
    """merchant collection / wearable outfit / camp area"""
    if name.endswith("Collection"):
        return "merchant"
    if categories == {"Camp"}:
        return "camp_area"
    return "outfit"


def load(export_dir, stem):
    """Load one exported CSV by filename stem, skipping the _all variant."""
    hits = [p for p in glob.glob(os.path.join(export_dir, stem + "*.csv"))
            if not p.endswith("_all.csv")]
    if not hits:
        sys.exit(f"error: no CSV matching {stem!r} in {export_dir}")
    return pd.read_csv(hits[0])


# --------------------------------------------------------------------------
# build
# --------------------------------------------------------------------------

def build(export_dir, out_path):
    animals_df  = load(export_dir, "Animals")
    animal_mat  = load(export_dir, "Animal Materials")
    misc_mat    = load(export_dir, "Misc Materials")
    craftable   = load(export_dir, "Craftable Items")
    ing_rows    = load(export_dir, "Recipe Ingredients")

    if os.path.dirname(out_path):
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
    if os.path.exists(out_path):
        os.remove(out_path)

    db = sqlite3.connect(out_path)
    db.executescript(SCHEMA)
    warnings = []

    # ---- weapons ------------------------------------------------------
    db.executemany("INSERT INTO weapons(id, name) VALUES (?,?)",
                   [(mkid("weapon", w), w)
                    for w in sorted({w.strip()
                                     for w in animals_df["Weapon"].dropna()})])
    weapon_id = dict(db.execute("SELECT name, id FROM weapons"))

    # ---- animals ------------------------------------------------------
    db.executemany(
        "INSERT INTO animals(id, name, weapon_id) VALUES (?,?,?)",
        [(mkid("animal", clean(r["Animal Name"])), clean(r["Animal Name"]),
          weapon_id.get(str(r["Weapon"]).strip()))
         for _, r in animals_df.iterrows()])
    animal_id = dict(db.execute("SELECT name, id FROM animals"))

    # ---- locations and stations ---------------------------------------
    db.executemany("INSERT INTO locations(id, name) VALUES (?,?)",
                   [(mkid("loc", n), n) for n in LOCATIONS])
    location_id = dict(db.execute("SELECT name, id FROM locations"))
    db.executemany(
        "INSERT INTO stations(id, name, kind, color, location_id) "
        "VALUES (?,?,?,?,?)",
        [(mkid("station", n), n, k, c, location_id[loc])
         for n, (k, c, loc) in STATIONS.items()])
    station_id = dict(db.execute("SELECT name, id FROM stations"))

    # ---- sets ----------------------------------------------------------
    craftable["_set"] = craftable["Set"].map(clean)
    for name, cats in craftable.groupby("_set")["Category"].apply(set).items():
        db.execute("INSERT INTO sets(id, name, set_type) VALUES (?,?,?)",
                   (mkid("set", name), name, classify_set(name, cats)))
    set_id = dict(db.execute("SELECT name, id FROM sets"))

    # ---- ingredients: animal materials ---------------------------------
    for _, r in animal_mat.iterrows():
        name = clean(r["Material Name"])
        sources = parse_relation(r.get("Animals"))
        aid = None
        if sources:
            aid = animal_id.get(clean(sources[0]))
            if aid is None:
                warnings.append(f"{name!r}: unknown animal {sources[0]!r}")
            if len(sources) > 1:
                warnings.append(f"{name!r}: {len(sources)} source animals, "
                                f"kept {sources[0]!r}")
        quality = r.get("Quality")
        db.execute(
            "INSERT INTO ingredients(id, name, source_type, quality, "
            "body_part, animal_id) VALUES (?,?,'animal',?,?,?)",
            (mkid("ing", name), name,
             quality if quality in ("Perfect", "Legendary") else None,
             clean(r.get("Body Part")), aid))

    # ---- ingredients: misc ----------------------------------------------
    db.executemany(
        "INSERT INTO ingredients(id, name, source_type) VALUES (?,?,'misc')",
        [(mkid("ing", clean(r["Item Name"])), clean(r["Item Name"]))
         for _, r in misc_mat.iterrows()])
    ingredient_id = dict(db.execute("SELECT name, id FROM ingredients"))

    # ---- recipes ---------------------------------------------------------
    price_col = next(c for c in craftable.columns if c.strip() == "Price")
    for _, r in craftable.iterrows():
        description, warmth = parse_description(r.get("Buff"))
        db.execute(
            "INSERT INTO recipes(id, name, category, station_id, set_id, "
            "price_cents, description, warmth_rank) VALUES (?,?,?,?,?,?,?,?)",
            (mkid("recipe", clean(r["Item Name"])),
             clean(r["Item Name"]), clean(r.get("Category")),
             station_id.get(clean(r.get("Merchant"))),
             set_id.get(clean(r.get("Set"))),
             parse_price(r[price_col]), description, warmth))
    recipe_id = dict(db.execute("SELECT name, id FROM recipes"))

    # ---- recipe_ingredients ----------------------------------------------
    pairs = {}
    for _, r in ing_rows.iterrows():
        recipe = clean(r["Recipe Name"])
        rid = recipe_id.get(recipe)
        if rid is None:
            warnings.append(f"ingredient row: unknown recipe {recipe!r}")
            continue
        names = (parse_relation(r.get("Animal Materials"))
                 + parse_relation(r.get("Misc. Materials")))
        if not names:
            warnings.append(f"{recipe!r}: ingredient row names no material")
            continue
        qty = 1 if pd.isna(r["Amount Needed"]) else int(r["Amount Needed"])
        for n in names:
            iid = ingredient_id.get(clean(n))
            if iid is None:
                warnings.append(f"{recipe!r}: unknown ingredient {n!r}")
                continue
            pairs[(rid, iid)] = pairs.get((rid, iid), 0) + qty

    db.executemany(
        "INSERT INTO recipe_ingredients(recipe_id, ingredient_id, qty) "
        "VALUES (?,?,?)",
        [(rid, iid, q) for (rid, iid), q in pairs.items()])

    db.commit()
    return db, warnings


def report(db, warnings, out_path):
    tables = ("weapons", "animals", "locations", "stations", "sets",
              "ingredients", "recipes", "recipe_ingredients")
    counts = [(t, db.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0])
              for t in tables]
    width = max(len(t) for t, _ in counts)
    print(f"wrote {out_path}\n")
    for table, n in counts:
        print(f"  {table:<{width}}  {n:>5}")

    unused = db.execute("""
        SELECT name FROM ingredients
        WHERE id NOT IN (SELECT ingredient_id FROM recipe_ingredients)
    """).fetchall()
    if unused:
        print(f"\n  ingredients used by no recipe: {len(unused)}")
        for (n,) in unused[:10]:
            print(f"    - {n}")

    print(f"\n  warnings: {len(warnings)}")
    for w in warnings[:20]:
        print(f"    ! {w}")


def main():
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("export_dir", help="folder holding the five exported CSVs")
    ap.add_argument("-o", "--output", default="data/rdr2.db")
    args = ap.parse_args()

    db, warnings = build(args.export_dir, args.output)
    report(db, warnings, args.output)
    db.close()


if __name__ == "__main__":
    main()

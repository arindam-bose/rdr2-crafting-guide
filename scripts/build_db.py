#!/usr/bin/env python3
"""
Build rdr2.db from the crafting workbook, data/raw/rdr2_crafting.xlsx.

Usage:
    python3 build_db.py [workbook.xlsx] [-o data/rdr2.db]
                        [--check-ids data/rdr2.db]

The workbook is the database, a sheet to a table: each sheet has the
table's name and its columns, and every row goes in as it stands, ids
included.  Corrections are made there, never in rdr2.db, which every
build replaces.  Three sheets are not tables of their own: 'ammo',
'alcohols' and 'collectables' are the wiki links for the ingredients of
those kinds, and fill ingredients.link.

Anything the database would refuse -- an id used twice, a reference to
a row that is not there, a value outside its column's CHECK -- is an
error, reported with its sheet and row, and the build fails.  What it
would take but is probably a slip -- a warmth rank its description does
not bear out, a fish with no bait, a plant picked for nothing -- is a
warning, and the build goes ahead.

--check-ids names an earlier build.  Every ingredient, recipe and
location id in it must still be produced, because the personal layer
stores those strings and has no other way to find its rows again.  It
is read before anything is written, so it may be the output file.

Requires: pandas, openpyxl.  Everything else is the standard library.
"""

import argparse
import datetime
import os
import sqlite3
import sys

import pandas as pd

# --------------------------------------------------------------------------
# reference constants
# --------------------------------------------------------------------------

# Bumped when the shape of the generated database changes.
SCHEMA_VERSION = "5"

# ordinal warmth scale, which a clothing description states in words.
# Keyed on the phrase itself rather than the full sentence around it, so
# the boilerplate that follows -- "pair with other warm items...", which
# has changed wording before -- can keep changing; see warmth_of below.
WARMTH = {
    "lightweight":     0,
    "slightly warm":   1,
    "reasonably warm": 2,
    "warm":            3,
    "very warm":       4,
}

SCHEMA = """
-- Stamped at build time so the app can say which reference data it
-- is showing, and an export can record which build it came from.
CREATE TABLE meta (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);

-- Every id is a prefixed slug, stable across rebuilds and
-- self-describing wherever it turns up loose (URLs, the personal
-- layer's ledger, logs).  Most are the row's name; one kept when the
-- name was later corrected is not (animal-bear is the Grizzly Bear).

CREATE TABLE weapons (
    id    TEXT PRIMARY KEY,          -- weapon-sniper-rifle
    name  TEXT NOT NULL UNIQUE,
    link  TEXT                       -- the weapon's wiki page
);

-- An animal is hunted with a weapon, or -- a fish -- caught with a bait
-- or lure; bait is free text ("River lures, Worm, Cricket").
CREATE TABLE animals (
    id         TEXT PRIMARY KEY,     -- animal-bear
    name       TEXT NOT NULL UNIQUE,
    type       TEXT NOT NULL CHECK (type IN ('animal','bird','fish')),
    weapon_id  TEXT REFERENCES weapons(id),
    bait       TEXT,
    link       TEXT                  -- the animal's wiki page
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

-- things you collect.  link is the wiki page of ammo, a liquor or a
-- collectable; an animal material or a plant links through its
-- animals or plants instead.
CREATE TABLE ingredients (
    id           TEXT PRIMARY KEY,   -- ing-perfect-beaver-pelt
    name         TEXT NOT NULL UNIQUE,
    source_type  TEXT NOT NULL
                 CHECK (source_type IN ('animal','collectable','plant','ammo','alcohol')),
    quality      TEXT CHECK (quality IN ('Perfect','Legendary')),
    body_part    TEXT,
    link         TEXT
);

-- which animals a material comes from: one for a pelt, a dozen for fat
CREATE TABLE ingredient_animals (
    ingredient_id  TEXT NOT NULL REFERENCES ingredients(id),
    animal_id      TEXT NOT NULL REFERENCES animals(id),
    PRIMARY KEY (ingredient_id, animal_id)
);

-- A plant, each with its own wiki page.  The satchel files some under a
-- general name -- Desert, Hummingbird and Red Sage all go in as Sage --
-- so the ingredient is the general name and these are where it comes
-- from, as an animal is for a meat.  Every other plant ingredient is
-- the one plant of the same name.
CREATE TABLE plants (
    id    TEXT PRIMARY KEY,          -- plant-desert-sage
    name  TEXT NOT NULL UNIQUE,
    link  TEXT                       -- the plant's wiki page
);

CREATE TABLE ingredient_plants (
    ingredient_id  TEXT NOT NULL REFERENCES ingredients(id),
    plant_id       TEXT NOT NULL REFERENCES plants(id),
    PRIMARY KEY (ingredient_id, plant_id)
);

-- things you craft.  A one-time recipe is made once at a merchant and
-- tracked; a repeatable one is made at your own campfire as often as
-- you like, and is only ever shown -- never crafted, never ticked off.
-- For those, price_cents is the one-time cost of buying the recipe.
CREATE TABLE recipes (
    id           TEXT PRIMARY KEY,   -- recipe-billy-vest
    name         TEXT NOT NULL UNIQUE,
    category     TEXT,
    station_id   TEXT REFERENCES stations(id),
    set_id       TEXT REFERENCES sets(id),
    price_cents  INTEGER NOT NULL DEFAULT 0,
    description  TEXT,
    warmth_rank  INTEGER,            -- what the description says, as a number
    repeatable   INTEGER NOT NULL DEFAULT 0 CHECK (repeatable IN (0,1))
);

-- A recipe asks for its ingredients in slots.  Rows sharing a slot are
-- interchangeable -- any one sage will do -- and carry the slot's qty,
-- which must be taken all of one kind.  A slot with one row is a plain
-- ingredient, which is every slot of every one-time recipe.
CREATE TABLE recipe_ingredients (
    recipe_id      TEXT NOT NULL REFERENCES recipes(id),
    slot           INTEGER NOT NULL CHECK (slot > 0),
    ingredient_id  TEXT NOT NULL REFERENCES ingredients(id),
    qty            INTEGER NOT NULL CHECK (qty > 0),
    PRIMARY KEY (recipe_id, ingredient_id)
);

CREATE INDEX idx_ingredients_source ON ingredients(source_type);
CREATE INDEX idx_ia_animal          ON ingredient_animals(animal_id);
CREATE INDEX idx_ip_plant           ON ingredient_plants(plant_id);
CREATE INDEX idx_recipes_category   ON recipes(category);
CREATE INDEX idx_recipes_station    ON recipes(station_id);
CREATE INDEX idx_ri_slot            ON recipe_ingredients(recipe_id, slot);
CREATE INDEX idx_ri_ingredient      ON recipe_ingredients(ingredient_id);
"""

# The tables the workbook fills, in the order they are loaded: each
# before any that refers to it.  table -> (id prefix, integer columns).
# The columns themselves are the table's own, read from SCHEMA.
TABLES = {
    "locations":          ("loc-",     ()),
    "stations":           ("station-", ()),
    "weapons":            ("weapon-",  ()),
    "animals":            ("animal-",  ()),
    "sets":               ("set-",     ()),
    "ingredients":        ("ing-",     ()),
    "ingredient_animals": (None,       ()),
    "plants":             ("plant-",   ()),
    "ingredient_plants":  (None,       ()),
    "recipes":            ("recipe-",  ("price_cents", "warmth_rank", "repeatable")),
    "recipe_ingredients": (None,       ("slot", "qty")),
}

# sheets of ingredient links: sheet -> the source_type its rows must have
LINK_SHEETS = {
    "ammo":         "ammo",
    "alcohols":     "alcohol",
    "collectables": "collectable",
}

# --------------------------------------------------------------------------
# reading the workbook
# --------------------------------------------------------------------------


def cell(value):
    """
    A spreadsheet cell as a value: None for empty, trimmed text otherwise.
    Curly apostrophes are straightened so 'Trapper's' matches everywhere,
    and a non-breaking space -- which a name pasted from the web brings
    with it, and which makes two names look alike that do not match --
    becomes a plain one.
    """
    if value is None or pd.isna(value):
        return None
    text = str(value).replace("’", "'").replace(" ", " ").strip()
    return text or None


def whole(value):
    """Empty, or a whole number however the spreadsheet wrote it."""
    try:
        return value is None or float(value).is_integer()
    except ValueError:
        return False


def integer(value):
    """'4000' or '4000.0' -> 4000 ; None stays None.  See whole()."""
    return None if value is None else int(float(value))


def columns_of(db, table):
    return [c[1] for c in db.execute(f"PRAGMA table_info({table})")]


def read_sheet(book, sheet, columns, errors, warnings):
    """
    The sheet's rows as dicts of the given columns, each with the
    spreadsheet row it came from under '_row'.  A missing sheet or
    column is an error; a column the table does not have is a warning,
    since what is in it goes nowhere.  Rows with nothing in them are
    skipped.
    """
    if sheet not in book:
        errors.append(f"no {sheet!r} sheet")
        return []
    df = book[sheet]
    missing = [c for c in columns if c not in df.columns]
    if missing:
        errors.append(f"{sheet}: no column {', '.join(map(repr, missing))}")
        return []
    extra = [c for c in df.columns if c not in columns and df[c].notna().any()]
    if extra:
        warnings.append(f"{sheet}: column {', '.join(map(repr, extra))} "
                        "is not in the database, left out")
    rows = []
    for i, r in df.iterrows():
        row = {c: cell(r[c]) for c in columns}
        if any(v is not None for v in row.values()):
            row["_row"] = i + 2                   # 1-based, after the header
            rows.append(row)
    return rows


def where(sheet, row):
    return f"{sheet} row {row['_row']}"


def warmth_of(text):
    """The WARMTH phrase this text contains, longest first so "slightly
    warm" wins over the bare "warm" inside it -- sorted here rather than
    trusted to WARMTH's own order, which is free to change."""
    lowered = text.lower()
    for phrase in sorted(WARMTH, key=len, reverse=True):
        if phrase in lowered:
            return WARMTH[phrase]
    return None


# --------------------------------------------------------------------------
# build
# --------------------------------------------------------------------------

def build(workbook, out_path):
    book = pd.read_excel(workbook, sheet_name=None, dtype=str)

    if os.path.dirname(out_path):
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
    if os.path.exists(out_path):
        os.remove(out_path)

    db = sqlite3.connect(out_path)
    db.executescript(SCHEMA)
    errors, warnings = [], []

    db.executemany("INSERT INTO meta(key, value) VALUES (?,?)", [
        ("schema_version", SCHEMA_VERSION),
        ("built_at", datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%d")),
        ("source", os.path.basename(workbook)),
    ])

    # ---- the tables, a sheet each ---------------------------------------
    # Loaded with foreign keys off and checked all at once afterwards, so
    # every dangling reference is reported, with its row, rather than
    # the first one stopping the build.
    for table, (prefix, integers) in TABLES.items():
        columns = columns_of(db, table)
        if table == "ingredients":
            columns.remove("link")                  # filled from LINK_SHEETS
        for row in read_sheet(book, table, columns, errors, warnings):
            here = where(table, row)
            # SQLite lets a TEXT primary key be NULL, so a blank id
            # would go in, and nothing could ever refer to the row.
            if prefix and not row["id"]:
                errors.append(f"{here}: no id")
                continue
            if prefix and not row["id"].startswith(prefix):
                errors.append(f"{here}: id {row['id']!r} does not start "
                              f"with {prefix!r}")
                continue
            bad = [c for c in integers if not whole(row[c])]
            if bad:
                errors.append(f"{here}: {', '.join(f'{c} {row[c]!r}' for c in bad)}"
                              " is not a whole number")
                continue
            values = [integer(row[c]) if c in integers else row[c]
                      for c in columns]
            try:
                db.execute(f"INSERT INTO {table}({', '.join(columns)}) "
                           f"VALUES ({', '.join('?' * len(columns))})", values)
            except sqlite3.IntegrityError as e:
                errors.append(f"{here}: {e}")

    for table, rowid, parent, fk in db.execute(
            "PRAGMA foreign_key_check").fetchall():
        # The rowid is the order the row went in, not its spreadsheet
        # row, so name the row by its key instead.
        column = next(f[3] for f in db.execute(f"PRAGMA foreign_key_list({table})")
                      if f[0] == fk)
        row = dict(zip(columns_of(db, table), db.execute(
            f"SELECT * FROM {table} WHERE rowid = ?", (rowid,)).fetchone()))
        key = row.get("id") or row.get("recipe_id") or row["ingredient_id"]
        errors.append(f"{table} {key}: {column} {row[column]!r} is not in "
                      f"{parent}")

    # ---- ingredient links -----------------------------------------------
    kinds = dict(db.execute("SELECT id, source_type FROM ingredients"))
    names = dict(db.execute("SELECT id, name FROM ingredients"))
    linked = set()
    for sheet, source_type in LINK_SHEETS.items():
        for row in read_sheet(book, sheet, ["id", "name", "link"], errors,
                              warnings):
            here, iid = where(sheet, row), row["id"]
            if iid not in kinds:
                errors.append(f"{here}: no ingredient {iid!r}")
                continue
            if kinds[iid] != source_type:
                errors.append(f"{here}: {iid} is a {kinds[iid]} ingredient, "
                              f"not {source_type}")
                continue
            if iid in linked:
                errors.append(f"{here}: {iid} is linked twice")
                continue
            if row["name"] != names[iid]:
                warnings.append(f"{here}: {iid} is {names[iid]!r} in "
                                f"ingredients, {row['name']!r} here")
            linked.add(iid)
            db.execute("UPDATE ingredients SET link = ? WHERE id = ?",
                       (row["link"], iid))
    for sheet, source_type in LINK_SHEETS.items():
        for iid in sorted(i for i, k in kinds.items()
                          if k == source_type and i not in linked):
            warnings.append(f"{iid} is not in {sheet}: no link")

    for sheet in sorted(set(book) - set(TABLES) - set(LINK_SHEETS)):
        warnings.append(f"sheet {sheet!r} is not part of the database, "
                        "left out")

    check(db, warnings)
    db.commit()
    return db, errors, warnings


def check(db, warnings):
    """What the database takes but is probably a slip in the workbook."""
    q = lambda sql: db.execute(sql).fetchall()

    # ---- animals ---------------------------------------------------------
    for name, kind, weapon, bait in q(
            "SELECT name, type, weapon_id, bait FROM animals ORDER BY id"):
        if kind == "fish" and not bait:
            warnings.append(f"{name!r}: a fish with no bait")
        if kind != "fish" and not weapon:
            warnings.append(f"{name!r}: a {kind} with no weapon")
    for (name,) in q("""SELECT name FROM ingredients WHERE source_type = 'animal'
                        AND id NOT IN (SELECT ingredient_id FROM ingredient_animals)"""):
        warnings.append(f"{name!r}: an animal material from no animal")

    # ---- plants ----------------------------------------------------------
    for (pid,) in q("""SELECT id FROM plants
                       WHERE id NOT IN (SELECT plant_id FROM ingredient_plants)"""):
        warnings.append(f"plant {pid} is picked for no ingredient")
    for (iid,) in q("""SELECT id FROM ingredients WHERE source_type = 'plant'
                       AND id NOT IN (SELECT ingredient_id FROM ingredient_plants)"""):
        warnings.append(f"plant ingredient {iid} has no plant: no link")
    for iid, kind in q("""SELECT ip.ingredient_id, i.source_type
                          FROM ingredient_plants ip JOIN ingredients i
                          ON i.id = ip.ingredient_id
                          WHERE i.source_type != 'plant'"""):
        warnings.append(f"{iid} is picked from a plant, but is {kind}")

    # ---- recipes ---------------------------------------------------------
    for rid, description, rank in q(
            "SELECT id, description, warmth_rank FROM recipes ORDER BY id"):
        said = warmth_of(description) if description else None
        if rank != said:
            warnings.append(f"{rid}: warmth_rank {rank}, but its "
                            f"description says {said}")
    for (rid,) in q("""SELECT id FROM recipes
                       WHERE id NOT IN (SELECT recipe_id FROM recipe_ingredients)"""):
        warnings.append(f"{rid}: no ingredients")
    for rid, campfire, repeatable in q("""
            SELECT id, station_id = 'station-campfire', repeatable FROM recipes
            WHERE (station_id = 'station-campfire') != repeatable"""):
        warnings.append(f"{rid}: {'made' if campfire else 'not made'} at the "
                        f"campfire, but {'' if repeatable else 'not '}repeatable")

    # Rows sharing a slot are one choice, and must ask for the same qty;
    # slots run 1, 2, 3 with none skipped.
    for rid, slot in q("""SELECT recipe_id, slot FROM recipe_ingredients
                          GROUP BY recipe_id, slot HAVING COUNT(DISTINCT qty) > 1"""):
        warnings.append(f"{rid}: slot {slot}'s alternatives ask for "
                        "different quantities")
    for rid, top, count in q("""SELECT recipe_id, MAX(slot), COUNT(DISTINCT slot)
                                FROM recipe_ingredients GROUP BY recipe_id"""):
        if top != count:
            warnings.append(f"{rid}: its slots skip a number")


def baseline_ids(path):
    """The ids an earlier build handed out, which this one must keep."""
    if not path:
        return None
    # connect() would create an empty file at a mistyped path.
    if not os.path.exists(path):
        sys.exit(f"error: --check-ids: no database at {path}")
    old = sqlite3.connect(path)
    ids = {t: {i for (i,) in old.execute(f"SELECT id FROM {t}")}
           for t in ("ingredients", "recipes", "locations")}
    old.close()
    return ids


def lost_ids(db, baseline):
    """Every baseline id this build no longer produces."""
    return [(t, i) for t, ids in baseline.items()
            for i in sorted(ids - {i for (i,) in db.execute(f"SELECT id FROM {t}")})]


def report(db, errors, warnings, lost, out_path):
    tables = ("weapons", "animals", "locations", "stations", "sets",
              "ingredients", "ingredient_animals", "plants",
              "ingredient_plants", "recipes",
              "recipe_ingredients", "meta")
    counts = [(t, db.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0])
              for t in tables]
    width = max(len(t) for t, _ in counts)
    print(f"{'failed to build' if errors else 'built'} {out_path}\n")
    for table, n in counts:
        print(f"  {table:<{width}}  {n:>5}")
    for repeatable, n in db.execute("SELECT repeatable, COUNT(*) FROM recipes "
                                    "GROUP BY repeatable"):
        print(f"    {'repeatable' if repeatable else 'one-time':<{width - 2}}  {n:>5}")

    unused = db.execute("""
        SELECT name FROM ingredients
        WHERE id NOT IN (SELECT ingredient_id FROM recipe_ingredients)
    """).fetchall()
    if unused:
        print(f"\n  ingredients used by no recipe: {len(unused)}")
        for (n,) in unused[:10]:
            print(f"    - {n}")

    if lost is not None:
        print(f"\n  ids lost against the baseline: {len(lost)}")
        for t, i in lost[:20]:
            print(f"    ! {t}: {i}")

    print(f"\n  warnings: {len(warnings)}")
    for w in warnings[:40]:
        print(f"    ! {w}")

    if errors:
        print(f"\n  errors: {len(errors)}")
        for e in errors[:40]:
            print(f"    x {e}")


def main():
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("workbook", nargs="?", default="data/raw/rdr2_crafting.xlsx",
                    help="the crafting workbook")
    ap.add_argument("-o", "--output", default="data/rdr2.db")
    ap.add_argument("--check-ids", metavar="DB",
                    help="an earlier build whose ids must all survive")
    args = ap.parse_args()

    if not os.path.exists(args.workbook):
        sys.exit(f"error: no workbook at {args.workbook}")
    # pandas only reaches for openpyxl once it opens the workbook; say so
    # up front instead.
    try:
        import openpyxl  # noqa: F401
    except ImportError:
        sys.exit("error: reading the workbook needs openpyxl "
                 "(pip install openpyxl)")

    # Built beside the output and swapped in only once it has succeeded
    # and kept every id, so a failed build leaves the old database as it
    # was.  The swap is a rename, so the app never sees half a file.
    baseline = baseline_ids(args.check_ids)
    staging = args.output + ".building"
    try:
        db, errors, warnings = build(args.workbook, staging)
        lost = lost_ids(db, baseline) if baseline else None
        report(db, errors, warnings, lost, args.output)
        db.close()
    except BaseException:
        if os.path.exists(staging):
            os.remove(staging)
        raise

    if errors or lost:
        os.remove(staging)
        why = (f"{len(errors)} errors in {args.workbook}" if errors
               else f"{len(lost)} ids from {args.check_ids} are gone")
        sys.exit(f"error: {why}; {args.output} left as it was")
    os.replace(staging, args.output)


if __name__ == "__main__":
    main()

# rdr2-crafting-guide

What to craft in Red Dead Redemption 2, what it needs, and what you already have.

A static site with no build step: plain ES modules, [sql.js] in the browser, and
a service worker so it keeps working out of signal range. Nothing is uploaded —
the reference data is a read-only SQLite file that ships with the app, and your
own inventory lives in your browser.

[sql.js]: https://sql.js.org

## Two layers

**Reference** — `data/rdr2.db`, built from a Notion export by
`scripts/build_db.py`. Recipes, ingredients, animals, the weapon that leaves
each pelt unspoiled, and which station crafts what. Read-only, rebuilt from
source rather than edited.

**Personal** — `database/personal_schema.sql`, created at runtime in the same
sql.js connection so the two can be joined without an `ATTACH`. It is an
append-only `ledger`: current stock is `SUM(delta)`, an undo is a `DELETE`, and
a mis-entry is fixed with a correcting row. IndexedDB holds those rows between
visits and replays them on startup.

Demand is per **station**, stock is per **location** — the Fence sells from its
own counter but draws on your Satchel.

## Running it

Any static server, from the repository root:

    python3 -m http.server 8000

then open <http://localhost:8000>. It needs to be served over HTTP rather than
opened as a file, because the modules and the database are fetched.

## Rebuilding the database

    python3 scripts/build_db.py <export_dir> -o data/rdr2.db

`<export_dir>` holds the five CSVs from the Notion export: Animals, Animal
Materials, Misc Materials, Craftable Items, Recipe Ingredients. Ids are slugs
derived from names (`ing-perfect-beaver-pelt`), so they survive rows being
added, removed or reordered — which matters, because the personal layer stores
those strings.

After a rebuild, bump `CACHE` in `sw.js`. The database and the wasm runtime are
cached hard — they are big and only ever replaced wholesale — while app code is
served network-first, so edits show up on reload without a cache bump.

## Layout

    index.html            shell: top bar, tabs, toast
    app.css               one layout for phone and desktop
    data/rdr2.db          reference data, read-only
    database/
      personal_schema.sql the personal layer's DDL, and the four queries
    js/
      db.js               open sql.js, create the personal tables
      store.js            ledger writes, IndexedDB, export/import, crafting
      queries.js          the four queries as functions
      render.js           card templates
      views/materials.js  "Where to go if you have these items"
      views/inventory.js  entry: pick a location, search, tap +/-
      views/recipes.js    the catalogue, and where you craft
      toast.js            the undo toast
      main.js             boot and hash routing
    vendor/               sql.js, vendored so nothing is fetched from a CDN
    sw.js                 offline cache

## State

Materials, Recipes and Inventory work end to end. Settings is a stub that says so.

Crafting spends a recipe's ingredients from its station's own stock and marks it
done, as one commit — the same path Inventory saves through, so undo works the
same way. A recipe can also be skipped, which retires it without spending
anything: nothing is written to the ledger, only the target's state.

The Craft button is always present and disabled when it cannot be used, so its
absence never has to be interpreted; its tooltip says why — what is still
missing, or that the recipe is already made or skipped. Recipes you have made or
skipped sort to the bottom of the list.

A recipe that is done or skipped stops asking for its materials, so it drops out
of the Materials screen. Demand is per station, so that only removes the demand
at *that* station: a material two recipes want still shows for the other one.

Inventory stages rather than writes. Steppers adjust a pending batch; Save
commits the lot as one SQLite transaction and one IndexedDB transaction, one
ledger row per material and location however many taps went into it. Undo works
at the level of the commit. Staged edits survive a tab switch — a dot appears on
the Inventory tab — and the browser warns before you close the page with any
outstanding.

A plus is recorded as the thing that most likely caused it (`kill` for an animal
material, `loot` otherwise); a minus as a `correction`, since that is nearly
always what it is.

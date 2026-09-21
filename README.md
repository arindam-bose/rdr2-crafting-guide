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

The build stamps a `meta` table with the date and schema version, which the
Settings page reports and every export records.

`<export_dir>` holds the five CSVs from the Notion export: Animals, Animal
Materials, Misc Materials, Craftable Items, Recipe Ingredients. Ids are slugs
derived from names (`ing-perfect-beaver-pelt`), so they survive rows being
added, removed or reordered — which matters, because the personal layer stores
those strings.

After a rebuild, bump `CACHE` in `sw.js`. The database and the wasm runtime are
cached hard — they are big and only ever replaced wholesale — while app code is
served network-first, so edits show up on reload without a cache bump.

## Layout

    index.html            shell: masthead, tabs, toast, footer
    app.css               one layout for phone and desktop, and the theme
    data/rdr2.db          reference data, read-only
    fonts/
      chinese_rocks/      Chinese Rocks, the display face, with its licence
      fb_remington/       FB Remington, the body face
    images/               the logo, and the favicons cut from it
    database/
      personal_schema.sql the personal layer's DDL, and the four queries
    js/
      db.js               open sql.js, create the personal tables
      store.js            ledger writes, IndexedDB, export/import, crafting
      queries.js          the four queries as functions
      render.js           card templates and the pieces they share
      prefs.js            localStorage, guarded: theme, location, last export
      views/materials.js  "Where to go if you have these items"
      views/inventory.js  entry: pick a location, search, tap +/-
      views/recipes.js    the catalogue, and where you craft
      views/settings.js   export, import, reset, and what is stored
      views/ledger.js     the history, as its own page
      views/toolbar.js    search, chips, sort and pager, shared by the two
                          galleries
      toast.js            the undo toast
      theme.js            parchment or leather, remembered per device
      main.js             boot and hash routing
    vendor/               sql.js, vendored so nothing is fetched from a CDN
    sw.js                 offline cache

## Look

### The colours

The palette is the five colours of the game's key art —
[#bd081a, #feac01, #b90303, #020002, #fffeff][palette] — declared verbatim at
the top of `app.css` as `--rdr-*`. Everything either theme paints is derived
from them.

There are two themes off that one palette. **Parchment** is the default: the
palette's white aged into paper, its black used as ink. **Leather** is the same
five colours after dark — that black warmed towards hide, that white warmed
towards parchment. Neither theme uses the raw pair, because pure `#020002`
under pure `#fffeff` is a glare to read a long list on.

Only the tokens at the top of `app.css` change between them. Nothing further
down the file knows which theme is on, which is the point of the split.

Then two signals, kept apart in both themes: **amber** is the one colour that
asks for a press — buttons, the lit tab, anything staged — and **red** only
ever means trouble, a material you are short of or data about to be thrown
away.

The line that keeps this working is that **red and amber are never decoration**.
Everything else warm on the page — `--ink-name` for the name of a material or a
recipe, `--ink-label` for the USED IN / STILL NEEDED / PICKED UP captions, the
station stripes, the hover edge — is chrome, and chrome never carries status. A
name is a name whether or not you own the thing. Spend red on a heading and the
red `✗` on the card below it stops meaning *you are short of this*.

Each signal is two tokens, because a colour that fills a shape and a colour
that draws a word are not the same colour:

| | fills | draws |
|---|---|---|
| parchment | `--accent` `#feac01` | `--accent-text` `#8a5600` |
| leather | `--accent` `#feac01` | `--accent-text` `#feac01` |
| parchment | `--danger` `#bd081a` | `--danger-text` `#b90303` |
| leather | `--danger` `#bd081a` | `--danger-text` `#ec6a5a` |

Amber on paper is 1.4:1 and unreadable, so parchment draws with an ochre and
keeps the amber for button fills, where near-black sits on it at 8.9:1. The red
runs the other way: the raw palette red reads fine on paper and is 2.9:1 on
leather, so only leather needs a lit variant. Every colour that sets text
clears 4.5:1 against the surface it sits on, in both themes.

The station stripes are the one place colour is asked to identify rather than
to signal, and three warm hues at 3px are harder to tell apart than the blue,
yellow and pink they replaced. They are picked to separate in lightness as well
as hue — no two are closer than 1.26:1 — and, more to the point, the station is
always named in words beside its stripe. The colour reinforces the label; it is
never the only thing carrying it.

The theme is a preference rather than data, so it lives in `localStorage` and
is per device — the same person reads this on a bright phone outdoors and a
dark screen at night. `index.html` applies it inline before the first paint,
after the stylesheet has loaded, so the choice never flashes and the script can
read the theme's own `--bg` back out of the CSS instead of keeping a second
copy of it.

### The lettering

Two faces, and they divide the page between them. [Chinese Rocks] by Ray
Larabie sets the names — headings, tabs, buttons, labels. It is a caps-only
display face, so it never sets prose. [FB Remington] by Fred Brutus sets
everything else, which on these screens is mostly numbers: `3/3`, `2x Oregano`,
`$14.95`. It is monospaced, so those columns line up on their own. Both are
free, and both are vendored under `fonts/`.

FB Remington ships one weight and no italic, so the browser synthesises both.
That is the right trade here rather than a compromise: a real Remington had one
weight too, and emphasis was struck twice over the same spot.

Its character set is a typewriter's, which is to say 152 codepoints. It has no
`×`, `✓`, `·`, `−`, `—` or `•`. A browser fills a gap like that from the next
font in the stack, which puts a second typeface inside `2× Oregano` at a
different width and weight — so nothing here asks for one. The app types what
the machine could type:

| was | is | where |
|---|---|---|
| `·` | `-` | separators: `Campfire - Provisions`, ledger dates |
| `×` | `x` | quantities: `2x Oregano` |
| `−` | `-` | the stepper, a negative delta |
| `—` | `--` | prose |

That costs nothing — the one `·` left is in `document.title`, which the browser
draws in its own font — and the page reads as one face throughout.

The marks are the exception, and deliberately so. A tick and a cross are icons
rather than type: each sits alone in a `.mark` span, `aria-hidden`, with the
colour beside it already carrying the meaning. A gap there is contained in a
way a gap mid-word is not, so `.mark` gets its own stack and keeps the real
characters — ✓ for made, ✗ for still wanted, `–` for retired, `·` outside
personal mode.

The stack is explicit rather than left to the browser, because ✓ is in far more
fonts than ✗: allowed to fall back on its own, each glyph lands in a different
font and the pair arrives at two different weights. Naming
`"Noto Sans Symbols 2", "DejaVu Sans"` ahead of `sans-serif` keeps them in one
family. They are still not the same weight — `BALLOT X` is simply drawn heavier
than `CHECK MARK` — which suits a mark that means *you are short of this*.

The last `•` was not the app's to type: seven saddles carried their five stat
lines as a Notion bulleted list, bullet characters and all, inside a single
`description`. That was a list pretending to be a paragraph. `build_db.py` now
strips the markers and stores one item per line, and the Recipes card renders a
multi-line description as a real `<ul>` whose marker is a CSS hyphen. The
reference data is ASCII throughout apart from two non-breaking spaces, which
the font has.

The rule that assigns the two faces is the last thing in `app.css` on purpose:
every control in the file sets `font: inherit` to match the page rather than
the operating system, and that shorthand resets the family, so anything
assigned earlier loses.

[palette]: https://www.color-hex.com/color-palette/72703
[Chinese Rocks]: https://www.dafont.com/chinese-rocks.font
[FB Remington]: https://www.dafont.com/fb-remington.font

## State

All four screens work end to end.

The ledger has its own page, reached from the entry count in Settings — it is
the one thing here that grows without limit, and a page that is mostly history
buries the controls underneath it. It lists what changed, where, when and why,
newest first and paged, with the recipe named on a crafting row. An entry naming
a material this build does not know is shown with its raw slug and flagged,
rather than quietly disappearing. It is read-only: the ledger is append-only by
design, so a mis-entry is corrected with another row or undone from the toast at
the time, not edited afterwards.

Settings is also where the personal layer can be moved. Export writes the whole
ledger as a JSON file — the balances are derived from it, so exporting only the
balances would lose the history behind "8 gathered · 1 crafted". A
copy-to-clipboard button sits beside it, because `<a download>` is unreliable on
iOS, and a paste box sits beside the file picker for the same reason.

Import **replaces** rather than merges, and says so before it writes: a ledger
id counts up per device, so two devices' rows cannot be told apart and merging
would double anything imported twice. One device is the source of truth. A file
is inspected first — a `reason` the schema's CHECK would refuse is caught before
the transaction rather than halfway through it, and rows naming materials this
build does not know are reported rather than swallowed, since the ledger stores
slugs with no foreign key.

Material cards list the recipes each material goes into, ticked off as you make
them, under a *Used in* caption. Six are shown, and the five materials that go
into more than six end the list with a link that opens the rest — a card whose
last line is "and 6 more" with no way to read them is the card failing at its
one job. Opening one leaves the others alone and does not reset the page, and
the open cards are remembered across a rerender, so ticking something off
elsewhere does not close them. The gallery stretches cards to a common height,
so an opened card grows its whole row. The caption earns its place on the misc
materials: all nine feed exactly one talisman each, and a single uncaptioned
line under the demand rows reads as another demand row rather than as a list.
The tabs are Animal Materials and Misc. Items — one is a hunting
trip, the other a detour. Each tab carries the count matching the
current filters, so a search that landed on the other tab is visible rather than
lost. Both galleries show 20 cards at a time, with Show more adding another 20 and
Show less returning to the first 20. Changing a filter, a tab or the sort starts
the list over at 20; a store change — crafting something — does not, so you keep
your place.

Sorting is a field and a direction rather than a list of every combination:
Materials by what is still needed, quality or name; Recipes by name or by how
many items they swallow, with made and skipped ones still sinking to the bottom.
The direction button says what it does — "Most first", "Legendary first", "A-Z"
— and each field starts in the direction you nearly always want it in. The **Still needed** and **Done** filters divide them by
whether anything is still outstanding; a material whose recipes are all made or
skipped moves to Done and says nothing wants it any more, rather than vanishing.

Inventory lists what you are holding at the selected location first, then what
you logged recently, so it reads as a stock list rather than only a search box.
Each row also reports how many have passed through your hands there and how many
went into crafting, read from `inventory_totals` — the same ledger as
`inventory`, without the balance's habit of dropping rows that netted to zero.
`qty <= gathered` holds by construction, since one sums every delta and the
other only the positive ones.

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

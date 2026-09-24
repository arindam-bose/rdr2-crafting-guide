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
      queries.js          every read, as functions
      render.js           card and material-detail templates, and the
                          pieces they share (quality and station tags)
      dialog.js           the detail dialog every card opens: close
                          button, Esc, backdrop, repaint on a store change
      nav.js              the address: which page, and which card is open
      prefs.js            localStorage, guarded: theme, location, last export
      views/materials.js  "Where to go if you have these items"
      views/inventory.js  entry: pick a location, search, tap +/-
      views/recipes.js    the catalogue, and the recipe dialog you craft in
      views/settings.js   export, import, reset, and what is stored
      views/ledger.js     the history, as a dialog opened from Settings
      views/toolbar.js    search, chips, sort and pager, shared by the two
                          galleries
      toast.js            the undo toast, which follows an open dialog
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
recipe, `--ink-label` for the USED IN / LOCATIONS / INGREDIENTS captions, the
station stripes and tags, the hover edge — is chrome, and chrome never carries
status. A
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
never the only thing carrying it. The same three colours draw the station tags
on recipe cards — Pearson, Trapper, Fence — which share the outlined-chip shape
of the Legendary and Perfect tags, so a tag reads as a tag whatever it names.

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
| `·` | `-` | separators: `Pearson - Sep 22, 12:49 AM` in the ledger |
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
personal mode. The `×` on a dialog's close button is the same kind of thing, an
icon with an `aria-label`, and takes the same stack.

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
multi-line description as a real `<ul>` whose marker is a CSS hyphen. The recipe
dialog goes one step further and splits each line at its colon, so the stat and
its value sit in two columns: `Stamina Drain Rate … -50%`. The
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

### Cards and dialogs

Both galleries are for scanning; the detail lives in a dialog. Clicking a card
anywhere — or its name, which is a real button, so the keyboard gets there too
— opens a native modal `<dialog>` with a close button, closed also by Esc or a
click on the backdrop. A click that ends a text selection does not open it:
that is someone copying a name. The dialog is shared (`js/dialog.js`) and
repaints whenever the store changes, keeping focus on the button just pressed,
so it never shows stale numbers. Its buttons act one at a time: a write
repaints the dialog only once it has reached IndexedDB, so until then a second
tap is ignored rather than crafting twice or taking stock below zero. The undo
toast moves inside an open dialog —
a modal sits in the top layer and makes the rest of the page inert, so a toast
left outside could be neither seen nor pressed.

### Cross-links

Every recipe named on the Materials page, and every material named on the
Recipes page, is a link to the other one: tapping **Bear Batwing Chaps** on a
pelt's card lands on Recipes with that recipe already open, and tapping
**Perfect Bear Pelt** inside it comes straight back. They are real anchors
with real `href`s, so they can be middle-clicked, copied and tabbed to, and
drawn as the text around them with the underline turned most of the way down:
a card can carry a dozen, and a dozen loud links would be a page of blue.

What makes that work is that an open dialog is part of the address.
`#/recipes/<id>` is a page and a card, and every dialog in the app opens by
going there — including one opened by tapping a card on the page you are
already on, so there is one way in rather than two that can drift apart. The
address is also the way out: closing a dialog drops the card from it (without
adding to history, since shutting something is not somewhere you went), so
Back closes an open dialog, and a link to one can be bookmarked or shared and
opens cold. An id nothing answers to — a stale bookmark, a recipe dropped from
the reference data — leaves the page up and quietly takes itself back out of
the address.

### Materials

A material card is two captioned lists. **Used in** names the recipes it goes
into, ticked off as you make them, with the quantity spelled out when a recipe
takes more than one — `2x for Legendary Alligator Gambler's Hat`. Six are
shown; the five materials that go into more ask for the rest with a link, and
an opened list survives a rerender. **Locations** has a row per station that
still wants it — `Pearson: 0/2` — with the station's colour down the left edge
and a progress bar on the right.

The dialog adds what the card leaves out: the animal, quality, type and the
weapon that leaves it unspoiled; every recipe with a Done / Not done / Skipped
tag; each station's demand against what you hold where it draws from — the
Fence names your Satchel — and the verdict, *You need to go hunting!* and its
siblings. Each station row has `-` and `+ Add to Trapper` buttons. These write
at once, one ledger row per tap with an undo toast, rather than staging a
batch as Inventory does: here you are logging one thing and looking straight
at the result. In personal mode a station with nothing left to make still
shows, as *needs no more*, since you may be holding some there to sell.

The tabs are Animal Materials and Misc. Items — one is a hunting trip, the
other a detour — each carrying the count that matches the current filters, so
a search that landed on the other tab is visible rather than lost. The
category filter lists the animal parts (Pelt, Hide, Skin, Feather, …) and a
**Misc. items** entry of its own, since misc items have no part; picking a
category also switches to the tab its materials are on.

### Recipes

A recipe card has its name, a tag for its station, its price, its buff and an
**Ingredients** list with have/need tallies. A made or skipped recipe is
dimmed, carries a dashed *Made* or *Skipped* tag, and sorts to the bottom. The
card has no buttons.

The dialog lays out the type, vendor, set and price, the buffs as a two-column
table, the ingredients, and the two things you can do:

- **Craft** spends the ingredients from the station's own stock and marks the
  recipe done, as one commit with undo. It is always present and disabled when
  it cannot be used, with the reason written beside it — what is still
  missing, or that the recipe is made or skipped — rather than in a tooltip a
  phone cannot show.
- **The switch** in the corner reads *Skip / Want it* while a recipe is not
  made, and *Put back / Crafted* once it is. Skipping retires a recipe without
  spending anything — only the target's state is written. Putting back refunds
  the ingredients and wants the recipe again.

Once a recipe is crafted its ingredient list drops the crosses and tallies:
the ingredients were spent making it, and a row of red under something
already made reads as a shortfall.

A recipe that is done or skipped stops asking for its materials, so it drops out
of the Materials screen. Demand is per station, so that only removes the demand
at *that* station: a material two recipes want still shows for the other one.

### Filtering and sorting

Both galleries share one toolbar: the search box on a row of its own, then a
category dropdown, the stations in the order Pearson, Trapper, Fence, the
personal filters, and the sort, all left-aligned, with the count on the right.
In personal mode Materials filters to **Still needed** or **Done** — a
material whose recipes are all made or skipped moves to Done rather than
vanishing — and Recipes to **Ready to craft** or **Made**.

Sorting is a field and a direction rather than a list of every combination:
Materials by what is still needed, quality or name; Recipes by name or by how
many items they swallow. The direction button says what it does — "Most
first", "Legendary first", "A-Z" — each field starts in the direction you
nearly always want, and the choice is remembered per screen.

Both galleries show 20 cards at a time, with Show more adding another 20 and
Show less returning to the first 20. Changing a filter, a tab or the sort starts
the list over at 20; a store change — crafting something — does not, so you keep
your place.

### Inventory

Inventory lists what you are holding at the selected location first — *In the
Satchel*, *With Trapper*, *With Pearson*, each with a count of the rows under
it — then what you logged recently, so it reads as a stock list rather than
only a search box. Each row also reports how many have passed through your
hands there and how many went into crafting, read from `inventory_totals` — the
same ledger as `inventory`, without the balance's habit of dropping rows that
netted to zero. `qty <= gathered` holds by construction, since one sums every
delta and the other only the positive ones.

Inventory stages rather than writes. Steppers adjust a pending batch; Save
commits the lot as one SQLite transaction and one IndexedDB transaction, one
ledger row per material and location however many taps went into it. Undo works
at the level of the commit. Staged edits survive a tab switch — a dot appears on
the Inventory tab — and the browser warns before you close the page with any
outstanding.

A plus is recorded as the thing that most likely caused it (`kill` for an animal
material, `loot` otherwise); a minus as a `correction`, since that is nearly
always what it is. The same rule (`store.reasonFor`) holds for the buttons in a
material's dialog, and every screen names a location the same way: *in the
Satchel*, *with Pearson*.

### Settings and the ledger

The ledger opens as a dialog from the *Ledger entries* count in Settings — it is
the one thing here that grows without limit, and a page that is mostly history
buries the controls underneath it. It lists what changed, where, when and why,
newest first and paged, with the recipe named on a crafting row. An entry naming
a material this build does not know is shown with its raw slug and flagged,
rather than quietly disappearing. It is read-only: the ledger is append-only by
design, so a mis-entry is corrected with another row or undone from the toast at
the time, not edited afterwards.

Settings is also where the personal layer can be moved. Export writes the whole
ledger as a JSON file — the balances are derived from it, so exporting only the
balances would lose the history behind "8 gathered - 1 crafted". A
copy-to-clipboard button sits beside it, because `<a download>` is unreliable on
iOS, and a paste box sits beside the file picker for the same reason.

Import **replaces** rather than merges, and says so before it writes: a ledger
id counts up per device, so two devices' rows cannot be told apart and merging
would double anything imported twice. One device is the source of truth. A file
is inspected first — a `reason` the schema's CHECK would refuse is caught before
the transaction rather than halfway through it, and rows naming materials this
build does not know are reported rather than swallowed, since the ledger stores
slugs with no foreign key.

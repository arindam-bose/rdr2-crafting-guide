// ============================================================
// Materials — "Where to go if you have these items".
//
// One card per material: the recipes it goes into, and a row for
// every station that still wants it.  A card opens a dialog with
// the rest, where stock can be logged a tap at a time.  Three
// tabs, because the three are collected in completely different
// ways: animal materials are a hunting trip, plants a walk, and
// supplies -- ammunition, liquor, the odd trinket -- a shop or a
// detour.  Each tab carries the count that matches the current
// filters, so what is on the others is never a surprise.
//
// A material used only at the campfire is never needed and never
// done: nothing asks for a set amount of it.  It shows under All,
// with what you hold in the Satchel, and nowhere else.
//
// A view exports mount(root) and gets back { update, destroy }.
// The chrome is built once; a store change refills the groups
// alone, so the search box keeps its text and its focus.
// ============================================================

import * as queries from '../queries.js';
import * as store from '../store.js';
import { materialCard, materialDetail, empty, esc, placeName, plural, pager,
         PAGE } from '../render.js';
import { toast } from '../toast.js';
import { detailDialog, opensCard } from '../dialog.js';
import * as nav from '../nav.js';
import * as toolbar from './toolbar.js';

// The category filter's entries that are not body parts: the kinds
// of supply, which have none.  Values no body part can collide with,
// since the rest come from the data.
const KINDS = [
  { value: ':ammo',    type: 'ammo',    label: 'Ammo & throwables' },
  { value: ':alcohol', type: 'alcohol', label: 'Liquor' },
  { value: ':misc',    type: 'misc',    label: 'Misc. items' },
];

const GROUPS = [
  { id: 'animal',   title: 'Animal Materials', types: ['animal'] },
  { id: 'plant',    title: 'Plants',           types: ['plant'] },
  { id: 'supplies', title: 'Supplies',         types: ['ammo', 'alcohol', 'misc'] },
];
const groupOf = (card) =>
  GROUPS.find((g) => g.types.includes(card.source_type))?.id;

// Legendary first: it is the rarest and the most annoying to go get.
const QUALITY_RANK = { Legendary: 0, Perfect: 1 };
const rank = (c) => QUALITY_RANK[c.quality] ?? 2;

const byName = (a, b) => a.material.localeCompare(b.material);
const shortfall = (c) => c.demands.reduce(
  (total, d) => total + Math.max(0, d.needed - d.have), 0);

// Each field is written ascending once; the direction toggle
// negates it.  `ways` names what each direction actually does.
const SORTS = {
  needed:  {
    label: 'Still needed',
    fn: (a, b) => shortfall(a) - shortfall(b) || byName(a, b),
    ways: { asc: 'Least first', desc: 'Most first' },
    start: 'desc',
  },
  quality: {
    label: 'Quality',
    fn: (a, b) => rank(a) - rank(b) || shortfall(b) - shortfall(a) || byName(a, b),
    ways: { asc: 'Legendary first', desc: 'Legendary last' },
    start: 'asc',
  },
  name: {
    label: 'Name',
    fn: byName,
    ways: { asc: 'A\u2013Z', desc: 'Z\u2013A' },
    start: 'asc',
  },
};

export function mount(root) {
  // `expanded` holds the ingredient ids whose "used in" list is open.
  // It lives here rather than in the DOM because every store change --
  // crafting something, saving inventory -- rerenders the gallery, and
  // a list that closed itself when you ticked something off would be
  // worse than not opening at all.
  const state = { search: '', station: null, part: '', show: 'all',
                  group: GROUPS[0].id, shown: PAGE, expanded: new Set(),
                  ...toolbar.restoreSort('materials', SORTS,
                                         { sort: 'name', dir: 'asc' }) };

  const stations = queries.stations();
  const parts = queries.bodyParts();

  // Reference data, fixed for the life of the page: read once, not on
  // every tap of a stepper.
  const animals = queries.materialAnimals();

  root.innerHTML = `
    <div class="toolbar">
      ${toolbar.searchBox('m-search', 'Search a material or animal…')}
      <select class="select" id="m-part" aria-label="Category">
        <option value="">Every category</option>
        ${parts.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}
        ${KINDS.map((k) => `<option value="${k.value}">${esc(k.label)}</option>`).join('')}
      </select>
      ${toolbar.chipRow('m-stations', 'station', [
        { value: '', label: 'All', pressed: true },
        ...stations.map((s) => ({ value: s.id, label: s.name })),
      ])}
      ${toolbar.chipRow('m-show', 'show', [
        { value: 'short', label: 'Still needed' },
        { value: 'done', label: 'Done' },
      ])}
      ${toolbar.sortControl('m', SORTS, 'Sort materials by', state.sort)}
      <span class="count" id="m-count"></span>
    </div>
    ${toolbar.tabRow('m-groups', 'group', GROUPS)}
    <div class="gallery" id="m-gallery"></div>
    <div id="m-pager"></div>`;

  const showChips = root.querySelector('#m-show');
  const count = root.querySelector('#m-count');
  const pagerBox = root.querySelector('#m-pager');
  const gallery = root.querySelector('#m-gallery');
  const groupTabs = root.querySelector('#m-groups');
  const dirButton = root.querySelector('#m-dir');

  // Anything that changes what is in the list starts it over at the
  // first page; a store change — crafting something — does not, so
  // you keep your place.
  function refilter() {
    state.shown = PAGE;
    update();
  }

  toolbar.wirePager(pagerBox, state, update);
  toolbar.wireSearch(root.querySelector('#m-search'), state, refilter);
  toolbar.wireSort(root, 'm', SORTS, state, refilter, 'materials');
  toolbar.wirePicker(root.querySelector('#m-stations'), 'station', state, refilter);
  toolbar.wireToggles(showChips, 'show', state, refilter);

  // A category belongs to one tab, so choosing one takes you to the
  // tab its materials are on rather than leaving you on an empty one.
  root.querySelector('#m-part').addEventListener('change', (event) => {
    state.part = event.target.value;
    if (state.part) {
      toolbar.selectTab(groupTabs, 'group', state,
        KINDS.some((k) => k.value === state.part) ? 'supplies' : 'animal');
    }
    refilter();
  });

  // Opening one card's list does not touch the others, and does not
  // start the page over: this is reading, not filtering.  Anywhere
  // else on a card opens it.
  gallery.addEventListener('click', (event) => {
    const id = event.target.closest('.card')?.dataset.ingredient;
    if (!id) return;

    if (event.target.closest('[data-expand]')) {
      if (state.expanded.has(id)) state.expanded.delete(id);
      else state.expanded.add(id);
      update();
      return;
    }

    // Through the address, not straight to the dialog: a material
    // opened by tapping its card and one opened by a link from a
    // recipe are then the same thing, and Back shuts either.
    if (opensCard(event)) nav.open('materials', id);
  });

  let lastCards = [];

  // Looked up afresh from the whole list, not the visible page: a
  // material you just finished with may have filtered itself out of
  // the gallery, and the dialog should stay put while you look at it.
  const detail = detailDialog({
    route: 'materials',

    render(id) {
      const card = lastCards.find((m) => m.ingredient_id === id);
      return card ? materialDetail(card, { personal: store.isPersonal() }) : null;
    },

    // One tap, one ledger row, straight away: the stepper on Inventory
    // stages a batch, but here you are logging one thing and looking
    // right at the result, so a save step would only be in the way.
    async onClick(event, id) {
      const button = event.target.closest('[data-delta]');
      const card = lastCards.find((m) => m.ingredient_id === id);
      const d = card?.demands.find(
        (x) => x.location_id === button?.closest('[data-location]').dataset.location);
      if (!button || !d) return;

      const delta = Number(button.dataset.delta);
      const written = await store.record({
        ingredient_id: id,
        location_id: d.location_id,
        delta,
        reason: store.reasonFor(card.source_type, delta),
      });

      const place = placeName(d.location_id, d.location);
      toast(delta > 0 ? `Added one ${card.material} to ${place}`
                      : `Took one ${card.material} from ${place}`,
            { label: 'Undo', run: () => store.undo(written.id) });
    },
  });

  toolbar.wireTabs(groupTabs, 'group', state, refilter);

  function update() {
    const personal = store.isPersonal();
    showChips.hidden = !personal;

    lastCards = group(queries.materials({ personal }), queries.materialUsage(),
                      animals);
    const matched = lastCards.filter((m) => matches(m, state, personal));

    const counts = toolbar.countTabs(groupTabs, 'group', GROUPS, matched, groupOf);

    const cards = matched.filter((m) => groupOf(m) === state.group);
    cards.sort(toolbar.comparator(SORTS, state));
    toolbar.paintDir(dirButton, SORTS, state);

    // The empty message goes where the cards would have been, as on
    // Recipes, so the pager always sits under the gallery.
    gallery.innerHTML = cards.length
      ? cards.slice(0, state.shown).map((m) => materialCard(m, {
          personal, expanded: state.expanded.has(m.ingredient_id),
        })).join('')
      : empty(emptyMessage(state, personal, counts));
    pagerBox.innerHTML = pager(state.shown, cards.length);

    count.textContent = plural(cards.length, 'material');

    detail.refresh();
  }

  update();
  return { update, focus: detail.focus, destroy: detail.destroy };
}

function emptyMessage(state, personal, counts) {
  const elsewhere = toolbar.elsewhere(GROUPS, state.group, counts);
  if (elsewhere) return elsewhere;
  if (state.show === 'done' && personal) return 'Nothing is finished with yet.';
  if (state.search || state.station || state.part || state.show !== 'all') {
    return 'Nothing matches those filters.';
  }
  return 'Every recipe is done. Go buy a hat.';
}

// ------------------------------------------------------------
// The demand query returns one row per (material, station), the
// usage query one row per (material, recipe), and the animals query
// one per (material, animal).  Cards are per material, so fold all
// three in.
// ------------------------------------------------------------
function group(rows, usage, animals) {
  const byIngredient = new Map();

  for (const row of rows) {
    let card = byIngredient.get(row.ingredient_id);
    if (!card) {
      card = {
        ingredient_id: row.ingredient_id,
        material: row.material,
        quality: row.quality,
        source_type: row.source_type,
        body_part: row.body_part,
        animals: [],
        demands: [],
        usage: [],
      };
      byIngredient.set(row.ingredient_id, card);
    }
    card.demands.push({
      station_id: row.station_id,
      station: row.station,
      color: row.color,
      campfire: Boolean(row.campfire),
      location_id: row.location_id,
      location: row.location,
      needed: row.needed,
      have: row.have,
    });
  }

  for (const u of usage) {
    byIngredient.get(u.ingredient_id)?.usage.push(u);
  }
  for (const a of animals) {
    byIngredient.get(a.ingredient_id)?.animals.push(a);
  }

  return [...byIngredient.values()];
}

// Outstanding: some station still wants more than you are holding.
const outstanding = (card) =>
  card.demands.some((d) => d.needed > 0 && d.have < d.needed);

// Wanted at all: some recipe that is neither made nor skipped needs it.
const live = (card) => card.demands.some((d) => d.needed > 0);

// Worked towards at all: some vendor recipe uses it, wanted or not.
const tracked = (card) => card.demands.some((d) => !d.campfire);

// Used at your own fire, which never runs out of wanting it.
const atCampfire = (card) => card.demands.some((d) => d.campfire);

/** Whether `term` begins `name` or any word in it: "bear" in "Black Bear". */
function startsWord(name, term) {
  const n = name.toLowerCase();
  return n.startsWith(term) || n.includes(` ${term}`);
}

function matches(card, state, personal) {
  if (state.station && !card.demands.some(
        (d) => d.station_id === state.station && (d.needed > 0 || !personal))) {
    return false;
  }

  const kind = KINDS.find((k) => k.value === state.part);
  if (kind ? card.source_type !== kind.type
      : state.part && card.body_part !== state.part) return false;

  if (personal) {
    // Done: you have enough of it, or nothing is asking for it any
    // more.  Everything else hides what you are finished with --
    // unless the campfire still uses it, which it always will.
    if (state.show === 'done' && (outstanding(card) || !tracked(card))) return false;
    if (state.show === 'short' && !outstanding(card)) return false;
    if (state.show === 'all' && !live(card) && !atCampfire(card)) return false;
  }

  // The material's own name, and the animals it comes from -- nothing
  // about recipes.  Typing "talisman" here used to pull up every pelt
  // that feeds one, which is the question Recipes answers; on this page
  // you are looking for a material, or for what an animal you have in
  // your sights is good for.  A pelt's name already carries its animal,
  // but Big Game Meat does not say Wolf, and Flaky Fish Meat does not
  // say Perch.  Animals match from the start of a word, as they do on
  // Inventory, so "ox" is the Ox and not the Fox a dozen meats share.
  if (state.search && !card.material.toLowerCase().includes(state.search)
      && !card.animals.some((a) => startsWord(a.name, state.search))) {
    return false;
  }
  return true;
}

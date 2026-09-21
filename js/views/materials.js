// ============================================================
// Materials — "Where to go if you have these items".
//
// One card per material, carrying a row for every station that
// still wants it, and the list of recipes it goes into.  Two
// tabs, because the 100 animal materials and the 9 things you
// pick up off the ground are collected in completely different
// ways: one is a hunting trip, the other is a detour.  Each tab
// carries the count that matches the current filters, so what is
// on the other one is never a surprise.
//
// A view exports mount(root) and gets back { update, destroy }.
// The chrome is built once; a store change refills the groups
// alone, so the search box keeps its text and its focus.
// ============================================================

import * as queries from '../queries.js';
import * as store from '../store.js';
import { materialCard, empty, esc, plural, pager, PAGE } from '../render.js';
import * as toolbar from './toolbar.js';

const GROUPS = [
  { id: 'animal', title: 'Animal Materials' },
  { id: 'misc',   title: 'Misc. Items' },
];

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
  const state = { search: '', station: null, show: 'all',
                  group: GROUPS[0].id, shown: PAGE, expanded: new Set(),
                  ...toolbar.restoreSort('materials', SORTS,
                                         { sort: 'needed', dir: 'desc' }) };

  const stations = queries.stations();

  root.innerHTML = `
    <div class="toolbar">
      ${toolbar.searchBox('m-search', 'Search a material, animal or station…')}
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
    <div class="segmented" role="tablist" id="m-groups">
      ${GROUPS.map((g, i) => `
        <button role="tab" data-group="${g.id}" aria-selected="${i === 0}">
          ${esc(g.title)}<span class="tab-count"></span></button>`).join('')}
    </div>
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

  // Opening one card's list does not touch the others, and does not
  // start the page over: this is reading, not filtering.
  gallery.addEventListener('click', (event) => {
    const button = event.target.closest('[data-expand]');
    if (!button) return;

    const id = button.closest('.card')?.dataset.ingredient;
    if (!id) return;

    if (state.expanded.has(id)) state.expanded.delete(id);
    else state.expanded.add(id);
    update();
  });

  groupTabs.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-group]');
    if (!tab) return;
    state.group = tab.dataset.group;
    for (const t of groupTabs.children) {
      t.setAttribute('aria-selected', String(t === tab));
    }
    refilter();
  });

  function update() {
    const personal = store.isPersonal();
    showChips.hidden = !personal;

    const matched = group(queries.materials({ personal }), queries.materialUsage())
      .filter((m) => matches(m, state, personal));

    // Every tab shows how many of the current matches it holds, so
    // a search that landed on the other tab is visible, not lost.
    const counts = {};
    for (const g of GROUPS) {
      counts[g.id] = matched.filter((m) => m.source_type === g.id).length;
      groupTabs.querySelector(`[data-group="${g.id}"] .tab-count`).textContent =
        counts[g.id];
    }

    const cards = matched.filter((m) => m.source_type === state.group);
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
  }

  update();
  return { update, destroy() {} };
}

function emptyMessage(state, personal, counts) {
  const other = GROUPS.find((g) => g.id !== state.group);
  if (counts[other.id]) {
    return `Nothing here -- ${counts[other.id]} under ${other.title}.`;
  }
  if (state.show === 'done' && personal) return 'Nothing is finished with yet.';
  if (state.search || state.station || state.show !== 'all') {
    return 'Nothing matches those filters.';
  }
  return 'Every recipe is done. Go buy a hat.';
}

// ------------------------------------------------------------
// The demand query returns one row per (material, station), and
// the usage query one row per (material, recipe).  Cards are per
// material, so fold both in.
// ------------------------------------------------------------
function group(rows, usage) {
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
        animal: row.animal,
        weapon: row.weapon,
        demands: [],
        usage: [],
      };
      byIngredient.set(row.ingredient_id, card);
    }
    card.demands.push({
      station_id: row.station_id,
      station: row.station,
      color: row.color,
      needed: row.needed,
      have: row.have,
    });
  }

  for (const u of usage) {
    byIngredient.get(u.ingredient_id)?.usage.push(u);
  }

  return [...byIngredient.values()];
}

// Outstanding: some station still wants more than you are holding.
const outstanding = (card) =>
  card.demands.some((d) => d.needed > 0 && d.have < d.needed);

// Wanted at all: some recipe that is neither made nor skipped needs it.
const live = (card) => card.demands.some((d) => d.needed > 0);

function matches(card, state, personal) {
  if (state.station && !card.demands.some(
        (d) => d.station_id === state.station && (d.needed > 0 || !personal))) {
    return false;
  }

  if (personal) {
    // Done: you have enough of it, or nothing is asking for it any
    // more.  Everything else hides what you are finished with.
    if (state.show === 'done' && outstanding(card)) return false;
    if (state.show === 'short' && !outstanding(card)) return false;
    if (state.show === 'all' && !live(card)) return false;
  }

  if (state.search) {
    const haystack = [card.material, card.animal, card.weapon, card.body_part,
                      ...card.demands.map((d) => d.station),
                      ...card.usage.map((u) => u.recipe)]
      .filter(Boolean).join(' ').toLowerCase();
    if (!haystack.includes(state.search)) return false;
  }
  return true;
}

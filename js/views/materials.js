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
import { materialCard, empty, esc } from '../render.js';

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
const demanded = (c) => c.demands.reduce((total, d) => total + d.needed, 0);

const SORTS = {
  short:   { label: 'Most still needed',
             fn: (a, b) => shortfall(b) - shortfall(a) || byName(a, b) },
  needed:  { label: 'Amount needed',
             fn: (a, b) => demanded(b) - demanded(a) || byName(a, b) },
  quality: { label: 'Quality',
             fn: (a, b) => rank(a) - rank(b)
                        || shortfall(b) - shortfall(a) || byName(a, b) },
  name:    { label: 'Name (A\u2013Z)', fn: byName },
};

export function mount(root) {
  const state = { search: '', station: null, show: 'all',
                  group: GROUPS[0].id, sort: 'short' };

  const stations = queries.stations();

  root.innerHTML = `
    <div class="toolbar">
      <input type="search" class="search" id="m-search"
             placeholder="Search a material, animal or station…"
             autocomplete="off" spellcheck="false">
      <div class="chips" id="m-stations">
        <button class="chip" data-station="" aria-pressed="true">All</button>
        ${stations.map((s) => `
          <button class="chip" data-station="${esc(s.id)}"
                  aria-pressed="false">${esc(s.name)}</button>`).join('')}
      </div>
      <div class="chips" id="m-show">
        <button class="chip" data-show="short" aria-pressed="false">Still needed</button>
        <button class="chip" data-show="done" aria-pressed="false">Done</button>
      </div>
      <label class="sort">Sort
        <select class="select" id="m-sort" aria-label="Sort materials">
          ${Object.entries(SORTS).map(([id, s]) => `
            <option value="${id}">${esc(s.label)}</option>`).join('')}
        </select>
      </label>
      <span class="count" id="m-count"></span>
    </div>
    <div class="segmented" role="tablist" id="m-groups">
      ${GROUPS.map((g, i) => `
        <button role="tab" data-group="${g.id}" aria-selected="${i === 0}">
          ${esc(g.title)}<span class="tab-count"></span></button>`).join('')}
    </div>
    <div class="gallery" id="m-gallery"></div>
    <div id="m-empty"></div>`;

  const searchBox = root.querySelector('#m-search');
  const showChips = root.querySelector('#m-show');
  const count = root.querySelector('#m-count');
  const emptyBox = root.querySelector('#m-empty');
  const gallery = root.querySelector('#m-gallery');
  const groupTabs = root.querySelector('#m-groups');

  groupTabs.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-group]');
    if (!tab) return;
    state.group = tab.dataset.group;
    for (const t of groupTabs.children) {
      t.setAttribute('aria-selected', String(t === tab));
    }
    update();
  });

  root.querySelector('#m-sort').addEventListener('change', (event) => {
    state.sort = event.target.value;
    update();
  });

  searchBox.addEventListener('input', () => {
    state.search = searchBox.value.trim().toLowerCase();
    update();
  });

  root.querySelector('#m-stations').addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    state.station = chip.dataset.station || null;
    for (const c of event.currentTarget.children) {
      c.setAttribute('aria-pressed', String(c === chip));
    }
    update();
  });

  // One choice, and tapping the pressed chip goes back to everything.
  showChips.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    state.show = state.show === chip.dataset.show ? 'all' : chip.dataset.show;
    for (const c of showChips.children) {
      c.setAttribute('aria-pressed', String(c.dataset.show === state.show));
    }
    update();
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
    cards.sort(SORTS[state.sort].fn);

    gallery.innerHTML = cards.map((m) => materialCard(m, { personal })).join('');
    emptyBox.innerHTML = cards.length
      ? ''
      : empty(emptyMessage(state, personal, counts));

    count.textContent = `${cards.length} material${cards.length === 1 ? '' : 's'}`;
  }

  update();
  return { update, destroy() {} };
}

function emptyMessage(state, personal, counts) {
  const other = GROUPS.find((g) => g.id !== state.group);
  if (counts[other.id]) {
    return `Nothing here — ${counts[other.id]} under ${other.title}.`;
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
      needed_total: row.needed_total,
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

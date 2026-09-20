// ============================================================
// Inventory — entry, not reporting.
//
// Three locations with a stepper each is too much width on a
// phone, so the location is a segmented control at the top and
// each row carries one stepper that writes to it.  You are
// almost always entering a batch for one place at a time,
// because you just walked out of the Trapper.
//
// There is no save button.  Every tap is a ledger row the
// moment you make it, with an undo toast — which is what the
// append-only design buys: a mis-tap costs one tap to fix.
// ============================================================

import * as queries from '../queries.js';
import * as store from '../store.js';
import { esc, empty } from '../render.js';
import { toast } from '../toast.js';

// A manual bump is recorded as the thing that most likely caused
// it, so the ledger still reads as a history rather than a pile
// of corrections.  Taking one away is the exception: that is
// nearly always fixing a mis-entry.
const REASON = { animal: 'kill', misc: 'loot' };

export function mount(root) {
  const locations = queries.locations();
  const state = {
    location: localStorage.getItem('rdr2:location') ?? locations[0].id,
    search: '',
  };
  if (!locations.some((l) => l.id === state.location)) {
    state.location = locations[0].id;
  }

  root.innerHTML = `
    <div class="segmented" role="tablist" id="i-locations">
      ${locations.map((l) => `
        <button role="tab" data-location="${esc(l.id)}"
                aria-selected="${l.id === state.location}">${esc(l.name)}</button>`)
        .join('')}
    </div>
    <div class="toolbar">
      <input type="search" class="search" id="i-search"
             placeholder="Search a material…" autocomplete="off" spellcheck="false">
    </div>
    <p class="list-label" id="i-label"></p>
    <div class="rows" id="i-rows"></div>`;

  const segmented = root.querySelector('#i-locations');
  const searchBox = root.querySelector('#i-search');
  const label = root.querySelector('#i-label');
  const rows = root.querySelector('#i-rows');

  segmented.addEventListener('click', (event) => {
    const button = event.target.closest('[data-location]');
    if (!button) return;
    state.location = button.dataset.location;
    localStorage.setItem('rdr2:location', state.location);
    for (const b of segmented.children) {
      b.setAttribute('aria-selected', String(b === button));
    }
    update();
  });

  searchBox.addEventListener('input', () => {
    state.search = searchBox.value.trim();
    update();
  });

  // One listener for every stepper: the rows are replaced on
  // each write, so per-row listeners would not survive anyway.
  rows.addEventListener('click', (event) => {
    const button = event.target.closest('[data-delta]');
    if (!button) return;
    bump(button.closest('.row').dataset, Number(button.dataset.delta));
  });

  // The row carries what the ledger needs, so a tap costs no query.
  async function bump({ ingredient, name, source }, delta) {
    const entry = await store.record({
      ingredient_id: ingredient,
      location_id: state.location,
      delta,
      reason: delta > 0 ? REASON[source] ?? 'loot' : 'correction',
    });

    const place = locations.find((l) => l.id === state.location).name;
    toast(`${name} ${delta > 0 ? '+' : '−'}${Math.abs(delta)} · ${place}`,
          { label: 'Undo', run: () => store.undo(entry.id) });
  }

  function update() {
    const searching = state.search.length > 0;
    const list = searching
      ? queries.searchMaterials(state.search, state.location)
      : queries.recentMaterials(state.location);

    label.textContent = searching
      ? `${list.length} match${list.length === 1 ? '' : 'es'}`
      : 'Recently touched';
    label.hidden = searching && list.length === 0;

    rows.innerHTML = list.length
      ? list.map(row).join('')
      : empty(searching
          ? 'No material by that name.'
          : 'Nothing logged yet. Search for what you just picked up.');
  }

  update();
  return { update, destroy() {} };
}

function row(m) {
  const badge = m.quality
    ? `<span class="badge${m.quality === 'Legendary' ? ' legendary' : ''}">${esc(m.quality)}</span>`
    : '';

  return `
    <div class="row" data-ingredient="${esc(m.ingredient_id)}"
         data-name="${esc(m.name)}" data-source="${esc(m.source_type)}">
      <span class="name">${esc(m.name)}${badge}</span>
      <span class="stepper">
        <button type="button" data-delta="-1" ${m.qty <= 0 ? 'disabled' : ''}
                aria-label="One fewer ${esc(m.name)}">&minus;</button>
        <output class="${m.qty > 0 ? 'held' : ''}">${m.qty}</output>
        <button type="button" data-delta="1"
                aria-label="One more ${esc(m.name)}">+</button>
      </span>
    </div>`;
}

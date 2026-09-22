// ============================================================
// Inventory — entry, not reporting.
//
// Three locations with a stepper each is too much width on a
// phone, so the location is a segmented control under the search
// box and each row carries one stepper that writes to it.  You are
// almost always entering a batch for one place at a time,
// because you just walked out of the Trapper.
//
// Steppers stage, they do not write.  You enter the batch, look
// at it, and commit it — one SQLite transaction and one
// IndexedDB transaction however many rows, with undo at the
// level of the whole commit.  Staged edits outlive a tab switch
// (a dot appears on the Inventory tab) and are only lost if you
// discard them or close the page, which the browser warns about.
// ============================================================

import * as queries from '../queries.js';
import * as store from '../store.js';
import { esc, empty, heldAt, plural, qualityBadge } from '../render.js';
import * as prefs from '../prefs.js';
import { toast } from '../toast.js';

const LOCATION_KEY = 'rdr2:location';

// Staged, uncommitted edits, keyed by location and material.
// Module-level, so leaving the screen does not throw them away.
const staged = new Map();
const key = (location, ingredient) => `${location}\u0000${ingredient}`;

window.addEventListener('beforeunload', (event) => {
  if (staged.size) event.preventDefault();
});

export function mount(root) {
  const locations = queries.locations();
  const state = {
    location: prefs.get(LOCATION_KEY) ?? locations[0].id,
    search: '',
  };
  if (!locations.some((l) => l.id === state.location)) {
    state.location = locations[0].id;
  }

  root.innerHTML = `
    <div class="toolbar">
      <input type="search" class="search" id="i-search"
             placeholder="Search a material…" autocomplete="off" spellcheck="false">
    </div>
    <div class="segmented" role="tablist" id="i-locations">
      ${locations.map((l) => `
        <button role="tab" data-location="${esc(l.id)}"
                aria-selected="${l.id === state.location}">${esc(l.name)}</button>`)
        .join('')}
    </div>
    <div id="i-sections"></div>
    <div class="savebar" id="i-savebar" hidden>
      <span class="pending-count" id="i-pending"></span>
      <button type="button" class="discard" id="i-discard">Discard</button>
      <button type="button" class="save" id="i-save">Save</button>
    </div>`;

  const segmented = root.querySelector('#i-locations');
  const searchBox = root.querySelector('#i-search');
  const sections = root.querySelector('#i-sections');
  const savebar = root.querySelector('#i-savebar');
  const pending = root.querySelector('#i-pending');

  segmented.addEventListener('click', (event) => {
    const button = event.target.closest('[data-location]');
    if (!button) return;
    state.location = button.dataset.location;
    prefs.set(LOCATION_KEY, state.location);
    for (const b of segmented.children) {
      b.setAttribute('aria-selected', String(b === button));
    }
    update();
  });

  searchBox.addEventListener('input', () => {
    state.search = searchBox.value.trim();
    update();
  });

  // One listener for every stepper: the rows are replaced on each
  // change, so per-row listeners would not survive anyway.
  sections.addEventListener('click', (event) => {
    const button = event.target.closest('[data-delta]');
    if (!button) return;
    stage(button.closest('.row').dataset, Number(button.dataset.delta));
  });

  root.querySelector('#i-discard').addEventListener('click', discard);
  root.querySelector('#i-save').addEventListener('click', save);

  // The row carries what the ledger needs, so a tap costs no query.
  function stage({ ingredient, name, source }, delta) {
    const k = key(state.location, ingredient);
    const entry = staged.get(k)
      ?? { ingredient_id: ingredient, location_id: state.location,
           name, source_type: source, delta: 0 };

    entry.delta += delta;
    if (entry.delta === 0) staged.delete(k);
    else staged.set(k, entry);

    update();
  }

  function discard() {
    staged.clear();
    update();
  }

  async function save() {
    const entries = [...staged.values()];
    staged.clear();
    update();

    const written = await store.recordBatch(entries.map((e) => ({
      ingredient_id: e.ingredient_id,
      location_id: e.location_id,
      delta: e.delta,
      reason: store.reasonFor(e.source_type, e.delta),
    })));

    const ids = written.map((r) => r.id);
    toast(`Saved ${plural(entries.length, 'change')}`,
          { label: 'Undo', run: () => store.undoBatch(ids) });
  }

  function update() {
    const searching = state.search.length > 0;
    const place = locations.find((l) => l.id === state.location).name;
    const at = heldAt(state.location, place);

    if (searching) {
      const hits = queries.searchMaterials(state.search, state.location);
      // The title is already the count here.
      sections.innerHTML = section(
        plural(hits.length, 'match', 'es'),
        hits, 'No material by that name.', false);
    } else {
      // What you are holding here first, then the quick way back to
      // whatever you were logging lately.
      sections.innerHTML =
        section(at, held(state.location), `Nothing ${lower(at)} yet.`)
        + section('Recently touched', recent(state.location), '');
    }

    savebar.hidden = staged.size === 0;
    pending.textContent = `${plural(staged.size, 'unsaved change')}`;

    // Say so on the tab too, since the bar goes with the screen.
    const tab = document.querySelector('.tabs [data-route="inventory"]');
    if (tab) {
      if (staged.size) tab.dataset.pending = staged.size;
      else delete tab.dataset.pending;
    }
  }

  function section(title, list, emptyText, counted = true) {
    if (!list.length && !emptyText) return '';
    return `
      <section class="stock-section">
        <div class="section-head">
          <p class="list-label">${esc(title)}</p>
          ${counted ? `<span class="count">${plural(list.length, 'item')}</span>` : ''}
        </div>
        ${list.length
          ? `<div class="rows">${list
               .map((m) => row(m, staged.get(key(state.location, m.ingredient_id))))
               .join('')}</div>`
          : empty(emptyText)}
      </section>`;
  }

  update();
  return { update, destroy() {} };
}

const lower = (text) => text[0].toLowerCase() + text.slice(1);

/**
 * What you are holding here, plus anything staged for it — a
 * material you just added has no stock yet, but it is about to,
 * so it belongs in this list rather than vanishing from view.
 */
function held(location) {
  const stock = queries.stockAt(location);
  const seen = new Set(stock.map((m) => m.ingredient_id));

  const incoming = [...staged.values()]
    .filter((e) => e.location_id === location && !seen.has(e.ingredient_id))
    .map(asRow);

  return [...stock, ...incoming]
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Touched lately but not currently held — the quick way back. */
function recent(location) {
  const holding = new Set(held(location).map((m) => m.ingredient_id));
  return queries.recentMaterials(location)
    .filter((m) => !holding.has(m.ingredient_id));
}

function asRow(e) {
  return {
    ingredient_id: e.ingredient_id,
    name: e.name,
    source_type: e.source_type,
    quality: null,
    qty: 0,
    gathered: 0,
    used_crafting: 0,
  };
}

/**
 * What has passed through your hands here.  Only worth saying once
 * there is a history to report — on a row you have never touched it
 * would be three zeroes and no information.
 */
function history(m) {
  if (!m.gathered) return '';

  const parts = [`${m.gathered} gathered`];
  if (m.used_crafting) parts.push(`${m.used_crafting} crafted`);
  return `<small class="history">${parts.join(' - ')}</small>`;
}

function row(m, pending) {
  const delta = pending?.delta ?? 0;
  const shown = m.qty + delta;

  const badge = qualityBadge(m.quality);

  const mark = delta
    ? `<small>${delta > 0 ? '+' : '-'}${Math.abs(delta)}</small>`
    : '';

  return `
    <div class="row${delta ? ' staged' : ''}" data-ingredient="${esc(m.ingredient_id)}"
         data-name="${esc(m.name)}" data-source="${esc(m.source_type)}">
      <span class="name">${esc(m.name)}${badge}${history(m)}</span>
      <span class="stepper">
        <button type="button" data-delta="-1" ${shown <= 0 ? 'disabled' : ''}
                aria-label="One fewer ${esc(m.name)}">-</button>
        <output class="${shown > 0 ? 'held' : ''}${delta ? ' pending' : ''}"
          >${shown}${mark}</output>
        <button type="button" data-delta="1"
                aria-label="One more ${esc(m.name)}">+</button>
      </span>
    </div>`;
}

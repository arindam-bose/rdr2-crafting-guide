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
//
// A second kind of row control lives beside the stepper: a transfer,
// for handing loot from the Satchel to whichever of Pearson or
// Trapper actually wants it, and taking it back.  Where a stepper's
// delta is a gain from nowhere or a correction, a transfer is the
// same items leaving one location as they land in another, so it
// always writes two ledger rows -- one negative, one positive, both
// reason 'move' -- as one entry in the batch.  The Fence gets none of
// this: it spends straight from the Satchel, so there is nothing to
// hand it.
// ============================================================

import * as queries from '../queries.js';
import * as store from '../store.js';
import { esc, empty, heldAt, nameWith, plural, qualityStars, icon } from '../render.js';
import * as toolbar from './toolbar.js';
import * as prefs from '../prefs.js';
import { toast } from '../toast.js';

const LOCATION_KEY = 'rdr2:location';

// The icon that matches each location's id, for the segmented tabs
// and the transfer buttons alike.
const LOCATION_ICON = {
  'loc-satchel': 'satchel', 'loc-pearson': 'pearson', 'loc-trapper': 'trapper',
};

// A vendor location transfers only with the Satchel, never with each
// other, so "the other end" of a transfer is always one of these two
// from the Satchel, or always the Satchel from one of these two.
const VENDOR_LOCATIONS = ['loc-pearson', 'loc-trapper'];

// Staged, uncommitted edits and transfers, keyed so the two kinds
// never collide even when they touch the same material and location.
// Module-level, so leaving the screen does not throw them away.
const staged = new Map();
const editKey = (location, ingredient) => `edit\u0000${location}\u0000${ingredient}`;
const moveKey = (ingredient, from, to) => `move\u0000${ingredient}\u0000${from}\u0000${to}`;

/**
 * Every pending change at one location, net, by ingredient -- each
 * one's own staged edit, minus what is staged to leave from here,
 * plus what is staged to arrive here from the other end.  This is
 * what a row's count actually shows, whichever screen it is read
 * from.  Built once per render rather than rescanned per row: every
 * row on the screen asks the same question about the same fixed
 * location, so one pass over `staged` answers all of them.
 */
function pendingIndex(location) {
  const index = new Map();
  const add = (id, delta) => index.set(id, (index.get(id) ?? 0) + delta);

  for (const e of staged.values()) {
    if (e.kind === 'edit' && e.location_id === location) add(e.ingredient_id, e.delta);
    else if (e.kind === 'move' && e.from_location_id === location) add(e.ingredient_id, -e.delta);
    else if (e.kind === 'move' && e.to_location_id === location) add(e.ingredient_id, e.delta);
  }
  return index;
}

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

  // Which vendor(s) a material can be handed to, keyed by ingredient.
  // Reference data, fixed for the life of the page: read once, not on
  // every render.
  const wants = new Map();
  for (const w of queries.vendorWants()) {
    if (!wants.has(w.ingredient_id)) wants.set(w.ingredient_id, new Set());
    wants.get(w.ingredient_id).add(w.location_id);
  }

  // Rebuilt at the top of every update(), read by row() through
  // section(): every row on the same render asks pendingIndex() the
  // same question, so it is computed once rather than once each.
  let pendingIdx;

  const tabs = locations.map((l) => ({ id: l.id, title: l.name, icon: LOCATION_ICON[l.id] }));
  root.innerHTML = `
    <div class="toolbar">
      ${toolbar.searchBox('i-search', 'Search a material or animal…')}
    </div>
    ${toolbar.tabRow('i-locations', 'location', tabs,
                     { selected: state.location, counts: false })}
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

  toolbar.wireTabs(segmented, 'location', state, () => {
    prefs.set(LOCATION_KEY, state.location);
    update();
  });

  searchBox.addEventListener('input', () => {
    state.search = searchBox.value.trim();
    update();
  });
  toolbar.wireClear(searchBox);

  // One listener for every stepper: the rows are replaced on each
  // change, so per-row listeners would not survive anyway.  A
  // transfer button carries `data-move` instead of `data-delta`, so
  // the two never fire on the same tap.
  sections.addEventListener('click', (event) => {
    const moveBtn = event.target.closest('[data-move]');
    if (moveBtn) {
      stageMove(moveBtn.closest('.row').dataset, moveBtn.dataset.to,
                Number(moveBtn.dataset.move));
      return;
    }

    const button = event.target.closest('[data-delta]');
    if (!button) return;
    stage(button.closest('.row').dataset, Number(button.dataset.delta));
  });

  root.querySelector('#i-discard').addEventListener('click', discard);
  root.querySelector('#i-save').addEventListener('click', save);

  // The row carries what the ledger needs, so a tap costs no query.
  function stage({ ingredient, name, source }, delta) {
    const k = editKey(state.location, ingredient);
    const entry = staged.get(k)
      ?? { kind: 'edit', ingredient_id: ingredient, location_id: state.location,
           name, source_type: source, delta: 0 };

    entry.delta += delta;
    if (entry.delta === 0) staged.delete(k);
    else staged.set(k, entry);

    update();
  }

  // A tap always moves one unit between the Satchel and whichever
  // vendor `to` names, in the direction the screen you are on implies:
  // `state.location` is always the other end.  Sending one first
  // cancels against a transfer already staged the other way for the
  // same material, rather than piling up beside it -- three out and
  // one back, before either is saved, is one decision to send two,
  // not two ledger entries that would each write and half-undo the
  // other.  Capped at zero rather than going negative, since there is
  // no such thing as sending fewer than none.
  function stageMove({ ingredient, name, source }, to, delta) {
    const from = state.location;

    if (delta > 0) {
      const oppositeKey = moveKey(ingredient, to, from);
      const opposite = staged.get(oppositeKey);
      if (opposite) {
        const cancel = Math.min(opposite.delta, delta);
        opposite.delta -= cancel;
        delta -= cancel;
        if (opposite.delta === 0) staged.delete(oppositeKey);
        else staged.set(oppositeKey, opposite);
      }
    }

    if (delta !== 0) {
      const k = moveKey(ingredient, from, to);
      const entry = staged.get(k)
        ?? { kind: 'move', ingredient_id: ingredient, name, source_type: source,
             from_location_id: from, to_location_id: to, delta: 0 };

      entry.delta = Math.max(0, entry.delta + delta);
      if (entry.delta === 0) staged.delete(k);
      else staged.set(k, entry);
    }

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

    // A transfer is the same items leaving one place as they land in
    // another, so it is always two ledger rows, not one -- both
    // 'move', signed opposite -- written together with everything
    // else in the batch.
    const toWrite = entries.flatMap((e) => e.kind === 'move' ? [
      { ingredient_id: e.ingredient_id, location_id: e.from_location_id,
        delta: -e.delta, reason: 'move' },
      { ingredient_id: e.ingredient_id, location_id: e.to_location_id,
        delta: e.delta, reason: 'move' },
    ] : [{
      ingredient_id: e.ingredient_id, location_id: e.location_id,
      delta: e.delta, reason: store.reasonFor(e.source_type, e.delta),
    }]);

    const written = await store.recordBatch(toWrite);

    const ids = written.map((r) => r.id);
    toast(`Saved ${plural(entries.length, 'change')}`,
          { label: 'Undo', run: () => store.undoBatch(ids) });
  }

  function update() {
    const searching = state.search.length > 0;
    const place = locations.find((l) => l.id === state.location).name;
    const at = heldAt(state.location, place);
    pendingIdx = pendingIndex(state.location);

    if (searching) {
      const hits = queries.searchMaterials(state.search, state.location);
      // The title is already the count here.  Capitalised by hand
      // rather than through `plural`: every other count on the page
      // reads inline ("6 recipes"), but this one stands alone as a
      // heading, in the same sentence case as the rest of the page.
      sections.innerHTML = section(
        `${hits.length} ${hits.length === 1 ? 'Match' : 'Matches'}`,
        hits, 'No material or animal by that name.', false);
    } else {
      // What you are holding here first, then the quick way back to
      // whatever you were logging lately.
      sections.innerHTML =
        section(at, held(state.location), `Nothing ${lower(at)} yet.`)
        + section('Recently Touched', recent(state.location), '');
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
               .map((m) => row(m, state.location, wants, pendingIdx))
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

  const incoming = [];
  for (const e of staged.values()) {
    const arrives = e.kind === 'edit' ? e.location_id === location
                                       : e.to_location_id === location;
    if (!arrives || seen.has(e.ingredient_id)) continue;
    seen.add(e.ingredient_id);
    incoming.push(asRow(e));
  }

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
    received: 0,
    used_crafting: 0,
  };
}

/**
 * What has passed through your hands here.  Only worth saying once
 * there is a history to report — on a row you have never touched it
 * would be three zeroes and no information.  Gathered and received
 * are kept apart: a transfer did not come from a kill, a purchase or
 * the wild, and folding it into "gathered" would credit a vendor with
 * loot that only ever came from the Satchel.
 */
function history(m) {
  if (!m.gathered && !m.received) return '';

  const parts = [];
  if (m.gathered) parts.push(`${m.gathered} gathered`);
  if (m.received) parts.push(`${m.received} received`);
  if (m.used_crafting) parts.push(`${m.used_crafting} crafted`);
  return `<small class="history">${parts.join(' - ')}</small>`;
}

function row(m, location, wants, pendingIdx) {
  const shown = m.qty + (pendingIdx.get(m.ingredient_id) ?? 0);
  const net = shown - m.qty;

  const mark = net
    ? `<small>${net > 0 ? '+' : '-'}${Math.abs(net)}</small>`
    : '';

  return `
    <div class="row${net ? ' staged' : ''}" data-ingredient="${esc(m.ingredient_id)}"
         data-name="${esc(m.name)}" data-source="${esc(m.source_type)}">
      <span class="name">${nameWith(m.name, qualityStars(m.quality))}${history(m)}</span>
      <span class="controls">
        ${transfers(m, location, wants, shown)}
        <span class="stepper">
          <button type="button" data-delta="-1" ${shown <= 0 ? 'disabled' : ''}
                  aria-label="One fewer ${esc(m.name)}">-</button>
          <output class="${shown > 0 ? 'held' : ''}${net ? ' pending' : ''}"
            >${shown}${mark}</output>
          <button type="button" data-delta="1"
                  aria-label="One more ${esc(m.name)}">+</button>
        </span>
      </span>
    </div>`;
}

/**
 * A word for each end of a transfer, matching how the rest of the app
 * names a location -- "the Satchel", but "Pearson" and "Trapper" bare.
 */
const LOCATION_LABEL = {
  'loc-satchel': 'the Satchel', 'loc-pearson': 'Pearson', 'loc-trapper': 'Trapper',
};

/**
 * The transfer control(s) for one row: on the Satchel, one per vendor
 * that wants this material -- there can be two, since Pearson and
 * Trapper both want plenty of the same pelts; on a vendor, the single
 * way back to the Satchel.  Nothing at all for a material no vendor
 * here cares about -- a plant on the Trapper's screen, say.
 */
function transfers(m, location, wants, available) {
  const targets = VENDOR_LOCATIONS.includes(location)
    ? (wants.get(m.ingredient_id)?.has(location) ? ['loc-satchel'] : [])
    : VENDOR_LOCATIONS.filter((to) => wants.get(m.ingredient_id)?.has(to));

  if (!targets.length) return '';
  return `<span class="transfers">${
    targets.map((to) => transferStepper(m, location, to, available)).join('')}</span>`;
}

/**
 * One destination's transfer stepper: the count already staged
 * toward it, a vendor's or the Satchel's own icon standing in for the
 * usual number, and a "+" that stops offering once there is nothing
 * left here to send -- shared across every destination on the row,
 * since they all draw down the same stock.
 */
function transferStepper(m, from, to, available) {
  const count = staged.get(moveKey(m.ingredient_id, from, to))?.delta ?? 0;
  const label = LOCATION_LABEL[to];

  return `
    <span class="stepper transfer">
      <button type="button" data-move="-1" data-to="${esc(to)}"
              ${count <= 0 ? 'disabled' : ''}
              aria-label="One fewer of ${esc(m.name)} to send to ${esc(label)}">-</button>
      <output class="${count > 0 ? 'held' : ''}"
              aria-label="${count} to send to ${esc(label)}"
        >${icon(LOCATION_ICON[to])}${count || ''}</output>
      <button type="button" data-move="1" data-to="${esc(to)}"
              ${available > 0 ? '' : 'disabled'}
              aria-label="Send one ${esc(m.name)} to ${esc(label)}">+</button>
    </span>`;
}

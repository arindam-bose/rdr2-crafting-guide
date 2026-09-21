// ============================================================
// Ledger — the record everything else is derived from.
//
// Its own page rather than a panel in Settings: it is the one
// thing here that grows without limit, and a page that is mostly
// history buries the controls underneath it.
//
// Read-only.  The ledger is append-only by design — a mis-entry
// is corrected with another row, or undone from the toast at the
// moment you make it, not edited here afterwards.
// ============================================================

import * as queries from '../queries.js';
import * as store from '../store.js';
import { esc, pager, PAGE } from '../render.js';

// Plainer words than the schema's, which are written for the CHECK
// constraint rather than for reading back.
const REASON_WORDS = {
  kill: 'hunted',
  loot: 'found',
  buy: 'bought',
  craft: 'crafted',
  move: 'moved',
  correction: 'corrected',
};

export function mount(root) {
  let shown = PAGE;

  root.innerHTML = `
    <a class="back" href="#/settings">&larr; Settings</a>
    <p class="note" id="l-note"></p>
    <div id="l-entries"></div>`;

  const list = root.querySelector('#l-entries');
  const note = root.querySelector('#l-note');

  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]');
    if (!button) return;

    shown = button.dataset.page === 'more' ? shown + PAGE : PAGE;
    update();
    if (button.dataset.page === 'less') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  function update() {
    const total = store.stats().entries;

    note.textContent = total
      ? 'Current stock is the sum of this. Newest first.'
      : '';

    if (!total) {
      list.innerHTML = '<p class="empty">Nothing logged yet.</p>';
      return;
    }

    const rows = queries.ledgerEntries(Math.min(shown, total));
    list.innerHTML = `<div class="entries">${rows.map(entry).join('')}</div>`
      + pager(shown, total);
  }

  update();
  return { update, destroy() {} };
}

function entry(e) {
  const sign = e.delta > 0 ? '+' : '−';

  return `
    <div class="entry">
      <span class="delta ${e.delta > 0 ? 'up' : 'down'}">${sign}${Math.abs(e.delta)}</span>
      <span class="entry-what">
        ${esc(e.material)}${e.unknown_material
          ? ' <span class="badge stale">unknown</span>' : ''}
        <small>${esc(e.place)} · ${esc(when(e.ts))}${
          e.recipe ? ` · for ${esc(e.recipe)}` : ''}</small>
      </span>
      <span class="reason">${esc(REASON_WORDS[e.reason] ?? e.reason)}</span>
    </div>`;
}

/**
 * SQLite writes `datetime('now')` in UTC with no zone marker, and a
 * browser reads a bare "YYYY-MM-DD HH:MM:SS" as local time.  Say so
 * explicitly, or every entry is off by your offset.
 */
function when(ts) {
  const at = new Date(`${String(ts).replace(' ', 'T')}Z`);
  if (Number.isNaN(at.getTime())) return String(ts);

  return at.toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

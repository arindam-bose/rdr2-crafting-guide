// ============================================================
// The gallery toolbar, shared by Materials and Recipes.
//
// The two screens list different things, but they list them the
// same way: a search box, chips that pick one thing, chips that
// narrow to a subset, a sort field with a direction, and a pager
// under the cards.  All of that was written twice, which is how
// the two drifted -- one grew "Show less", the other did not.
//
// Each function here is either markup or wiring, never both, so
// a view still reads as "build this, then listen for that".
// ============================================================

import { esc, PAGE } from '../render.js';

// ------------------------------------------------------------
// markup
// ------------------------------------------------------------

export function searchBox(id, placeholder) {
  return `
    <input type="search" class="search" id="${esc(id)}"
           placeholder="${esc(placeholder)}"
           autocomplete="off" spellcheck="false">`;
}

/**
 * A row of chips.  `attr` is the data attribute they carry, which
 * is also the key the wiring writes on the view's state.
 *
 *   chipRow('m-stations', 'station',
 *           [{ value: '', label: 'All', pressed: true }, …])
 */
export function chipRow(id, attr, chips) {
  return `
    <div class="chips" id="${esc(id)}">
      ${chips.map((c) => `
        <button class="chip" data-${esc(attr)}="${esc(c.value)}"
                aria-pressed="${c.pressed ? 'true' : 'false'}"
          >${esc(c.label)}</button>`).join('')}
    </div>`;
}

/** The sort field and the button that reverses it. */
export function sortControl(id, sorts, label) {
  return `
    <div class="sort">Sort
      <select class="select" id="${esc(id)}-sort" aria-label="${esc(label)}">
        ${Object.entries(sorts).map(([value, s]) => `
          <option value="${esc(value)}">${esc(s.label)}</option>`).join('')}
      </select>
      <button type="button" class="sort-dir" id="${esc(id)}-dir"></button>
    </div>`;
}

// ------------------------------------------------------------
// wiring
//
// Each takes the view's `state` and the callback that reruns the
// list, so the view decides whether a change starts the pages
// over.  None of them render.
// ------------------------------------------------------------

export function wireSearch(input, state, onChange) {
  input.addEventListener('input', () => {
    state.search = input.value.trim().toLowerCase();
    onChange();
  });
}

/** Pick exactly one.  An empty value means "no filter". */
export function wirePicker(el, attr, state, onChange) {
  el.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;

    state[attr] = chip.dataset[attr] || null;
    for (const c of el.children) {
      c.setAttribute('aria-pressed', String(c === chip));
    }
    onChange();
  });
}

/**
 * Narrow to a subset, where tapping the pressed chip goes back to
 * everything.  `state[attr]` is the chip's value, or 'all'.
 */
export function wireToggles(el, attr, state, onChange) {
  el.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;

    state[attr] = state[attr] === chip.dataset[attr] ? 'all' : chip.dataset[attr];
    for (const c of el.children) {
      c.setAttribute('aria-pressed', String(c.dataset[attr] === state[attr]));
    }
    onChange();
  });
}

/**
 * The sort field and its direction.  Choosing a field also sets the
 * direction that field is nearly always wanted in.
 */
export function wireSort(root, id, sorts, state, onChange) {
  root.querySelector(`#${id}-sort`).addEventListener('change', (event) => {
    state.sort = event.target.value;
    state.dir = sorts[state.sort].start;
    onChange();
  });

  root.querySelector(`#${id}-dir`).addEventListener('click', () => {
    state.dir = state.dir === 'asc' ? 'desc' : 'asc';
    onChange();
  });
}

/**
 * Say what the direction does rather than draw an arrow you have to
 * interpret: "Most first", "Legendary first", "A-Z".
 */
export function paintDir(button, sorts, state) {
  const { ways } = sorts[state.sort];
  button.textContent = `${state.dir === 'asc' ? '↑' : '↓'} ${ways[state.dir]}`;
  button.title = `Sorted ${ways[state.dir].toLowerCase()} -- click to reverse`;
}

/** Show more, show less.  `state.shown` is how many are on screen. */
export function wirePager(el, state, update) {
  el.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]');
    if (!button) return;

    if (button.dataset.page === 'more') {
      state.shown += PAGE;
      update();
    } else {
      state.shown = PAGE;
      update();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
}

/** The comparator for `state`, with the direction folded in. */
export function comparator(sorts, state) {
  const flip = state.dir === 'asc' ? 1 : -1;
  return (a, b) => flip * sorts[state.sort].fn(a, b);
}

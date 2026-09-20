// ============================================================
// Materials — "Where to go if you have these items".
//
// One card per material, carrying a row for every station that
// wants it.  This is the headline screen and it exercises the
// trickiest query, so it is the one the rest are modelled on.
//
// A view exports mount(root) and gets back { update, destroy }.
// The chrome is built once; a store change refills the gallery
// alone, so the search box keeps its text and its focus.
// ============================================================

import * as queries from '../queries.js';
import * as store from '../store.js';
import { materialCard, empty, esc } from '../render.js';

export function mount(root) {
  const state = { search: '', station: null, shortOnly: false };

  const stations = queries.stations();

  root.innerHTML = `
    <div class="toolbar">
      <input type="search" class="search" id="m-search"
             placeholder="Search a material, animal or station…"
             autocomplete="off" spellcheck="false">
      <div class="chips" id="m-chips">
        <button class="chip" data-station="" aria-pressed="true">All</button>
        ${stations.map((s) => `
          <button class="chip" data-station="${esc(s.id)}"
                  aria-pressed="false">${esc(s.name)}</button>`).join('')}
        <button class="chip" id="m-short" aria-pressed="false">Still needed</button>
      </div>
      <span class="count" id="m-count"></span>
    </div>
    <div class="gallery" id="m-gallery"></div>`;

  const searchBox = root.querySelector('#m-search');
  const chips = root.querySelector('#m-chips');
  const gallery = root.querySelector('#m-gallery');
  const count = root.querySelector('#m-count');
  const shortChip = root.querySelector('#m-short');

  searchBox.addEventListener('input', () => {
    state.search = searchBox.value.trim().toLowerCase();
    update();
  });

  chips.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;

    if (chip === shortChip) {
      state.shortOnly = !state.shortOnly;
      shortChip.setAttribute('aria-pressed', String(state.shortOnly));
    } else {
      state.station = chip.dataset.station || null;
      for (const c of chips.querySelectorAll('[data-station]')) {
        c.setAttribute('aria-pressed', String(c === chip));
      }
    }
    update();
  });

  function update() {
    const personal = store.isPersonal();
    shortChip.hidden = !personal;

    const cards = group(queries.materials({ personal }))
      .filter((m) => matches(m, state, personal));

    sort(cards, personal);

    gallery.innerHTML = cards.length
      ? cards.map((m) => materialCard(m, { personal })).join('')
      : empty(state.search || state.station || state.shortOnly
          ? 'Nothing matches those filters.'
          : 'Every recipe is done. Go buy a hat.');

    count.textContent = `${cards.length} material${cards.length === 1 ? '' : 's'}`;
  }

  update();
  return { update, destroy() {} };
}

// ------------------------------------------------------------
// The query returns one row per (material, station).  Cards are
// per material, so fold the stations into a list.
// ------------------------------------------------------------
function group(rows) {
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

  return [...byIngredient.values()];
}

function matches(card, state, personal) {
  if (state.station && !card.demands.some((d) => d.station_id === state.station)) {
    return false;
  }
  if (personal && state.shortOnly
      && !card.demands.some((d) => d.have < d.needed)) {
    return false;
  }
  if (state.search) {
    const haystack = [card.material, card.animal, card.weapon, card.body_part,
                      ...card.demands.map((d) => d.station)]
      .filter(Boolean).join(' ').toLowerCase();
    if (!haystack.includes(state.search)) return false;
  }
  return true;
}

// Short of the most, first — that is the answer to "where to go".
function sort(cards, personal) {
  if (!personal) {
    cards.sort((a, b) => a.material.localeCompare(b.material));
    return;
  }
  const shortfall = (c) => c.demands.reduce(
    (total, d) => total + Math.max(0, d.needed - d.have), 0);

  cards.sort((a, b) => shortfall(b) - shortfall(a)
                    || a.material.localeCompare(b.material));
}

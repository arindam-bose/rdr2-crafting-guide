// ============================================================
// Recipes — the catalogue, and the place you craft from.
//
// Two queries feed the whole screen: the list, and every
// ingredient row in one go.  Filtering and grouping happen here
// rather than in SQL, because 165 recipes is nothing and a chip
// should not cost a round trip to the database.
//
// The cards are for scanning.  Crafting, skipping and putting back
// happen in the dialog a card opens: crafting spends the ingredients
// from the station's own stock and marks the recipe done, as one
// commit with an undo.
// ============================================================

import * as queries from '../queries.js';
import * as store from '../store.js';
import { esc, empty, pager, plural, qualityBadge, stationBadge, stationColour,
         detailHead, detailSection, placeName, traits, crossLink,
         PAGE } from '../render.js';
import * as nav from '../nav.js';
import * as toolbar from './toolbar.js';
import { toast } from '../toast.js';
import { detailDialog, opensCard } from '../dialog.js';

const STATE_LABEL = { wanted: '', done: 'Made', skipped: 'Skipped' };

// What you are still working on comes first; what you have made
// next; what you have retired last.  A skipped recipe keeping its
// alphabetical slot was the thing that made Skip feel like it had
// not done anything.
const RANK = { wanted: 0, done: 1, skipped: 2 };

// `total_qty` is how many items the recipe swallows, not how many
// kinds: one recipe wanting 15 snake skins is a bigger errand than
// three wanting one pelt each.
const byName = (a, b) => a.name.localeCompare(b.name);

// Ready to craft: still wanted -- not made, not skipped -- and every
// ingredient is in the station's stock.
const ready = (r) => r.state === 'wanted' && r.satisfied === r.needs;

const SORTS = {
  materials: {
    label: 'Materials needed',
    fn: (a, b) => a.total_qty - b.total_qty || byName(a, b),
    ways: { asc: 'Fewest first', desc: 'Most first' },
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
  const state = { search: '', station: null, category: '', show: 'all',
                  shown: PAGE,
                  ...toolbar.restoreSort('recipes', SORTS,
                                         { sort: 'name', dir: 'asc' }) };
  const stations = queries.stations();
  const categories = queries.categories();

  root.innerHTML = `
    <div class="toolbar">
      ${toolbar.searchBox('r-search', 'Search a recipe, set or material…')}
      <select class="select" id="r-category" aria-label="Category">
        <option value="">Every category</option>
        ${categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
      </select>
      ${toolbar.chipRow('r-stations', 'station', [
        { value: '', label: 'All', pressed: true },
        ...stations.map((s) => ({ value: s.id, label: s.name })),
      ])}
      ${toolbar.chipRow('r-show', 'show', [
        { value: 'ready', label: 'Ready to craft' },
        { value: 'done', label: 'Crafted' },
      ])}
      ${toolbar.sortControl('r', SORTS, 'Sort recipes by', state.sort)}
      <span class="count" id="r-count"></span>
    </div>
    <div class="gallery" id="r-gallery"></div>
    <div id="r-pager"></div>`;

  const gallery = root.querySelector('#r-gallery');
  const count = root.querySelector('#r-count');
  const showChips = root.querySelector('#r-show');
  const pagerBox = root.querySelector('#r-pager');
  const dirButton = root.querySelector('#r-dir');

  // Anything that changes what is in the list starts it over at the
  // first page; crafting something does not, so you keep your place.
  function refilter() {
    state.shown = PAGE;
    update();
  }

  toolbar.wirePager(pagerBox, state, update);
  toolbar.wireSearch(root.querySelector('#r-search'), state, refilter);
  toolbar.wireSort(root, 'r', SORTS, state, refilter, 'recipes');
  toolbar.wirePicker(root.querySelector('#r-stations'), 'station', state, refilter);
  toolbar.wireToggles(showChips, 'show', state, refilter);

  root.querySelector('#r-category').addEventListener('change', (event) => {
    state.category = event.target.value;
    refilter();
  });

  // Through the address, not straight to the dialog: a recipe opened
  // by tapping its card and one opened by a link from a material are
  // then the same thing, and Back shuts either.
  gallery.addEventListener('click', (event) => {
    const id = event.target.closest('.card')?.dataset.recipe;
    if (id && opensCard(event)) nav.open('recipes', id);
  });

  // The whole list, not the visible page: crafting a recipe can
  // filter it out of the gallery, and the dialog should stay put.
  let lastAll = [];

  const detail = detailDialog({
    render(id) {
      const r = lastAll.find((x) => x.id === id);
      return r ? recipeDetail(r, store.isPersonal()) : null;
    },
    onClick(event, id) {
      const button = event.target.closest('[data-act]');
      const r = lastAll.find((x) => x.id === id);
      if (button && !button.disabled && r) return act(button.dataset.act, r.id, r.name);
    },
    onClose: () => nav.closed('recipes'),
  });

  async function act(action, recipeId, name) {
    if (action === 'craft') {
      await store.craft(recipeId);
      toast(`Made ${name}`, { label: 'Undo', run: () => store.uncraft(recipeId) });
    } else if (action === 'uncraft') {
      await store.uncraft(recipeId);
      toast(`${name} is wanted again`);
    } else if (action === 'skip') {
      await store.setTarget(recipeId, 'skipped');
      toast(`Skipped ${name}`,
            { label: 'Undo', run: () => store.setTarget(recipeId, 'wanted') });
    } else if (action === 'unskip') {
      await store.setTarget(recipeId, 'wanted');
      toast(`${name} is wanted again`);
    }
  }

  function update() {
    const personal = store.isPersonal();
    showChips.hidden = !personal;

    const ingredients = group(queries.recipeIngredients());
    const all = queries.recipeList()
      .map((r) => ({ ...r, ingredients: ingredients.get(r.id) ?? [] }));

    lastAll = all;
    const list = all.filter((r) => matches(r, state, personal));

    // Made and skipped sink to the bottom whatever the field, so a
    // Skip visibly does something.
    const chosen = toolbar.comparator(SORTS, state);
    list.sort(personal
      ? (a, b) => RANK[a.state] - RANK[b.state] || chosen(a, b)
      : chosen);

    toolbar.paintDir(dirButton, SORTS, state);

    gallery.innerHTML = list.length
      ? list.slice(0, state.shown).map((r) => card(r, personal)).join('')
      : empty('Nothing matches those filters.');
    pagerBox.innerHTML = pager(state.shown, list.length);

    const readyCount = personal ? all.filter(ready).length : 0;
    count.textContent = plural(list.length, 'recipe')
      + (readyCount ? ` - ${readyCount} ready` : '');

    detail.refresh();
  }

  update();
  return {
    update,

    // Which recipe the address wants open.  An id nothing answers to
    // -- a stale bookmark, a recipe dropped from the reference data --
    // leaves the page up and takes itself back out of the address.
    focus(id) {
      if (!id) detail.close();
      else if (id !== detail.showing() && !detail.open(id)) nav.closed('recipes');
    },

    destroy: detail.destroy,
  };
}

function group(rows) {
  const byRecipe = new Map();
  for (const row of rows) {
    if (!byRecipe.has(row.recipe_id)) byRecipe.set(row.recipe_id, []);
    byRecipe.get(row.recipe_id).push(row);
  }
  return byRecipe;
}

function matches(r, state, personal) {
  if (state.station && r.station_id !== state.station) return false;
  if (state.category && r.category !== state.category) return false;

  if (personal) {
    if (state.show === 'ready' && !ready(r)) return false;
    if (state.show === 'done' && r.state !== 'done') return false;
  }

  if (state.search) {
    const haystack = [r.name, r.category, r.set_name, r.station, r.description,
                      ...r.ingredients.map((i) => i.name)]
      .filter(Boolean).join(' ').toLowerCase();
    if (!haystack.includes(state.search)) return false;
  }
  return true;
}

// ------------------------------------------------------------
// the card
// ------------------------------------------------------------

function card(r, personal) {
  const colour = stationColour(r.color);
  const settled = personal && r.state !== 'wanted';

  // The name is a real button, so the card opens from the keyboard
  // too; a click anywhere else on the card is forwarded to it.
  return `
    <article class="card recipe ${colour}${settled ? ' settled' : ''}"
             data-recipe="${esc(r.id)}">
      <header class="recipe-head">
        <h3><button type="button" class="card-open" data-open
              aria-haspopup="dialog">${esc(r.name)}</button>${
          stationBadge(r.station, r.color)}${settled ? stateBadge(r.state) : ''}</h3>
        ${r.price_cents ? `<span class="price">${money(r.price_cents)}</span>` : ''}
      </header>

      ${buff(r.description)}

      ${r.ingredients.length ? `
        <p class="list-label card-label">Ingredients</p>
        <ul class="ingredients">
          ${r.ingredients.map((i) => ingredient(i, tally(r, personal))).join('')}
        </ul>` : ''}
    </article>`;
}

/** "Made" or "Skipped", beside the station, once a recipe is settled. */
function stateBadge(state) {
  return `<span class="badge state ${state}">${esc(STATE_LABEL[state])}</span>`;
}

/**
 * The buff text.  Most recipes have one line of it; the saddles have five,
 * stored one per line since the build stopped keeping Notion's bullets.
 * A list is what that always was, so it is marked up as one -- and the
 * marker becomes a CSS hyphen, which the page's typewriter face can draw.
 */
function buff(description) {
  const lines = buffLines(description);
  if (!lines.length) return '';
  if (lines.length < 2) return `<p class="buff">${esc(lines[0])}</p>`;

  return `<ul class="buff">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;
}

function buffLines(description) {
  return (description ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
}

/**
 * Whether an ingredient list shows ticks and tallies.  Not once the
 * recipe is crafted: its ingredients were spent making it, and a row
 * of red crosses under something already made reads as a shortfall.
 */
function tally(r, personal) {
  return personal && r.state !== 'done';
}

function ingredient(i, personal) {
  const badge = qualityBadge(i.quality);
  const name = crossLink('materials', i.ingredient_id, i.name);

  if (!personal) {
    return `<li><span class="qty">${i.qty}x</span>
              <span class="what">${name}${badge}</span></li>`;
  }

  return `
    <li class="${i.satisfied ? 'have' : 'short'}">
      <span class="mark" aria-hidden="true">${i.satisfied ? '✓' : '✗'}</span>
      <span class="qty">${i.qty}x</span>
      <span class="what">${name}${badge}</span>
      <span class="tally">${i.have}/${i.qty}</span>
    </li>`;
}

// ------------------------------------------------------------
// the detail dialog
// ------------------------------------------------------------

/**
 * The same recipe, opened: what it is, what it does, what it takes,
 * and the two things you can do about it -- craft it, or change
 * your mind about wanting it.
 */
function recipeDetail(r, personal) {
  const buffs = buffLines(r.description);

  return `
    ${detailHead('Recipe', r.name, personal ? wantSwitch(r) : '')}
    ${traits([
      ['Type', esc(r.category)],
      ['Vendor', stationBadge(r.station, r.color)],
      ['Set', esc(r.set_name)],
      ['Price', r.price_cents && money(r.price_cents)],
    ])}
    ${detailSection('Buffs', buffs.length && `
      <ul class="detail-list detail-buffs">
        ${buffs.map((b) => `<li>${buffLine(b)}</li>`).join('')}
      </ul>`)}
    ${detailSection('Ingredients', r.ingredients.length && `
      <ul class="ingredients detail-ingredients">
        ${r.ingredients.map((i) => ingredient(i, tally(r, personal))).join('')}
      </ul>`)}
    ${personal ? craftRow(r) : ''}`;
}

/**
 * "Stamina Drain Rate: -50%" reads best as a stat and its value, the
 * value set apart so a column of them can be scanned.  A line with no
 * colon -- most one-line buffs are a sentence -- is left as it is.
 */
function buffLine(line) {
  const at = line.lastIndexOf(':');
  if (at < 1 || at === line.length - 1) return `<span class="stat">${esc(line)}</span>`;

  return `<span class="stat">${esc(line.slice(0, at))}</span>
          <span class="value">${esc(line.slice(at + 1).trim())}</span>`;
}

/**
 * The switch in the corner.  Two-sided, with both words showing, so
 * it reads the same whichever way it is set:
 *
 *   not made    Skip  [--o]  Want it     off skips it, on wants it back
 *   made    Put back  [--o]  Crafted     off refunds the ingredients
 */
function wantSwitch(r) {
  const made = r.state === 'done';
  const on = r.state !== 'skipped';
  const [off, onText] = made ? ['Put back', 'Crafted'] : ['Skip', 'Want it'];
  const act = made ? 'uncraft' : on ? 'skip' : 'unskip';
  const why = made
    ? `Put it back: refund the ingredients to ${placeName(r.location_id, r.location)} and want it again`
    : on ? 'Not making this -- stop asking for its materials'
         : 'Put it back on your list';

  return `
    <button type="button" class="want-switch" role="switch" aria-checked="${on}"
            data-act="${act}" data-key="switch" title="${esc(why)}"
            aria-label="${esc(onText)}">
      <span class="side off" aria-hidden="true">${off}</span>
      <span class="track" aria-hidden="true"><i></i></span>
      <span class="side on" aria-hidden="true">${onText}</span>
    </button>`;
}

/**
 * The Craft button, with the reason it is off written beside it
 * rather than hidden in a tooltip a phone cannot show.
 */
function craftRow(r) {
  const craftable = ready(r);

  const why = craftable
    ? `Spends these from ${esc(placeName(r.location_id, r.location))} and marks it made.`
    : r.state === 'done'
      ? 'Already crafted. Switch to Put back to undo it.'
      : r.state === 'skipped'
        ? 'Skipped. Switch to Want it to craft it.'
        : `Still need ${esc(shortfall(r))}.`;

  return `
    <div class="craft-row">
      <p class="craft-why${craftable ? ' ready' : ''}">${why}</p>
      <button type="button" class="craft-btn" data-act="craft" data-key="craft"
              ${craftable ? '' : 'disabled'}>Craft</button>
    </div>`;
}

/** "1x Perfect Deer Pelt, 2x Perfect Ox Hide" — what is still missing. */
function shortfall(r) {
  const missing = r.ingredients
    .filter((i) => !i.satisfied)
    .map((i) => `${i.qty - i.have}x ${i.name}`);

  return missing.length > 2
    ? `${missing.slice(0, 2).join(', ')} and ${missing.length - 2} more`
    : missing.join(', ');
}

function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

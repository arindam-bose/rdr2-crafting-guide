// ============================================================
// Recipes — the catalogue, and the place you craft from.
//
// Two queries feed the whole screen: the list, and every
// ingredient row in one go.  Filtering and grouping happen here
// rather than in SQL, because 165 recipes is nothing and a chip
// should not cost a round trip to the database.
//
// Crafting spends the ingredients from the station's own stock
// and marks the recipe done, as one commit — the same path the
// Inventory screen saves through, so undo works the same way.
// ============================================================

import * as queries from '../queries.js';
import * as store from '../store.js';
import { esc, empty, pager, plural, qualityBadge, stationColour, PAGE } from '../render.js';
import * as toolbar from './toolbar.js';
import { toast } from '../toast.js';

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
  const state = { search: '', station: null, category: '',
                  show: 'all', sort: 'name', dir: 'asc', shown: PAGE };
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
        { value: 'done', label: 'Made' },
      ])}
      ${toolbar.sortControl('r', SORTS, 'Sort recipes by')}
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
  toolbar.wireSort(root, 'r', SORTS, state, refilter);
  toolbar.wirePicker(root.querySelector('#r-stations'), 'station', state, refilter);
  toolbar.wireToggles(showChips, 'show', state, refilter);

  root.querySelector('#r-category').addEventListener('change', (event) => {
    state.category = event.target.value;
    refilter();
  });

  gallery.addEventListener('click', (event) => {
    const button = event.target.closest('[data-act]');
    if (!button) return;
    act(button.dataset.act, button.closest('.card').dataset.recipe,
        button.closest('.card').dataset.name);
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

    const ready = personal
      ? all.filter((r) => r.state === 'wanted' && r.satisfied === r.needs).length
      : 0;
    count.textContent = plural(list.length, 'recipe')
      + (personal && ready ? ` - ${ready} ready` : '');
  }

  update();
  return { update, destroy() {} };
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
    if (state.show === 'ready' && !(r.state === 'wanted' && r.satisfied === r.needs)) {
      return false;
    }
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
  const ready = r.satisfied === r.needs;

  return `
    <article class="card recipe ${colour}${r.state !== 'wanted' ? ' settled' : ''}"
             data-recipe="${esc(r.id)}" data-name="${esc(r.name)}">
      <header class="recipe-head">
        <h3>${esc(r.name)}</h3>
        ${r.price_cents ? `<span class="price">${money(r.price_cents)}</span>` : ''}
      </header>

      <p class="sub">${[r.station, r.category, r.set_name]
        .filter(Boolean).map(esc).join(' - ')}</p>

      ${buff(r.description)}

      <ul class="ingredients">
        ${r.ingredients.map((i) => ingredient(i, personal)).join('')}
      </ul>

      ${personal ? actions(r, ready) : ''}
    </article>`;
}

/**
 * The buff text.  Most recipes have one line of it; the saddles have five,
 * stored one per line since the build stopped keeping Notion's bullets.
 * A list is what that always was, so it is marked up as one -- and the
 * marker becomes a CSS hyphen, which the page's typewriter face can draw.
 */
function buff(description) {
  if (!description) return '';

  const lines = description.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return `<p class="buff">${esc(description)}</p>`;

  return `<ul class="buff">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;
}


function ingredient(i, personal) {
  const badge = qualityBadge(i.quality);

  if (!personal) {
    return `<li><span class="qty">${i.qty}x</span>
              <span class="what">${esc(i.name)}${badge}</span></li>`;
  }

  return `
    <li class="${i.satisfied ? 'have' : 'short'}">
      <span class="mark" aria-hidden="true">${i.satisfied ? '\u2713' : '\u2717'}</span>
      <span class="qty">${i.qty}x</span>
      <span class="what">${esc(i.name)}${badge}</span>
      <span class="tally">${i.have}/${i.qty}</span>
    </li>`;
}

function actions(r, ready) {
  const craftable = r.state === 'wanted' && ready;

  const label = r.state === 'wanted'
    ? `${r.satisfied} of ${r.needs} ready`
    : STATE_LABEL[r.state];

  // The button is always there, so its absence never has to be
  // interpreted; the tooltip carries why it is off.
  const why = craftable
    ? `Spend these ingredients from ${r.station}'s stock and mark it made`
    : r.state === 'done'
      ? 'Already made -- put it back first'
      : r.state === 'skipped'
        ? 'Skipped -- want it again first'
        : `Still need ${shortfall(r)}`;

  const second = r.state === 'done'
    ? { act: 'uncraft', text: 'Put back',
        why: `Refund the ingredients to ${r.station} and want it again` }
    : r.state === 'skipped'
      ? { act: 'unskip', text: 'Want it',
          why: 'Put it back on your list' }
      : { act: 'skip', text: 'Skip',
          why: 'Not making this -- stop asking for its materials' };

  return `
    <div class="actions">
      <span class="state-label">${esc(label)}</span>
      <span class="craft-wrap" title="${esc(why)}">
        <button type="button" class="craft-btn" data-act="craft"
                ${craftable ? '' : 'disabled'}>Craft</button>
      </span>
      <button type="button" class="ghost-btn" data-act="${second.act}"
              title="${esc(second.why)}">${esc(second.text)}</button>
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

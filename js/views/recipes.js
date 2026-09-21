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
import { esc, empty, pager, PAGE } from '../render.js';
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
      <input type="search" class="search" id="r-search"
             placeholder="Search a recipe, set or material…"
             autocomplete="off" spellcheck="false">
      <select class="select" id="r-category" aria-label="Category">
        <option value="">Every category</option>
        ${categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
      </select>
      <div class="chips" id="r-stations">
        <button class="chip" data-station="" aria-pressed="true">All</button>
        ${stations.map((s) => `
          <button class="chip" data-station="${esc(s.id)}"
                  aria-pressed="false">${esc(s.name)}</button>`).join('')}
      </div>
      <div class="chips" id="r-show">
        <button class="chip" data-show="ready" aria-pressed="false">Ready to craft</button>
        <button class="chip" data-show="done" aria-pressed="false">Made</button>
      </div>
      <div class="sort">Sort
        <select class="select" id="r-sort" aria-label="Sort recipes by">
          ${Object.entries(SORTS).map(([id, s]) => `
            <option value="${id}">${esc(s.label)}</option>`).join('')}
        </select>
        <button type="button" class="sort-dir" id="r-dir"></button>
      </div>
      <span class="count" id="r-count"></span>
    </div>
    <div class="gallery" id="r-gallery"></div>
    <div id="r-pager"></div>`;

  const searchBox = root.querySelector('#r-search');
  const gallery = root.querySelector('#r-gallery');
  const count = root.querySelector('#r-count');
  const showChips = root.querySelector('#r-show');
  const pagerBox = root.querySelector('#r-pager');

  // Anything that changes what is in the list starts it over at the
  // first page; crafting something does not, so you keep your place.
  function refilter() {
    state.shown = PAGE;
    update();
  }

  pagerBox.addEventListener('click', (event) => {
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

  searchBox.addEventListener('input', () => {
    state.search = searchBox.value.trim().toLowerCase();
    refilter();
  });

  const dirButton = root.querySelector('#r-dir');

  root.querySelector('#r-sort').addEventListener('change', (event) => {
    state.sort = event.target.value;
    state.dir = SORTS[state.sort].start;
    refilter();
  });

  dirButton.addEventListener('click', () => {
    state.dir = state.dir === 'asc' ? 'desc' : 'asc';
    refilter();
  });

  root.querySelector('#r-category').addEventListener('change', (event) => {
    state.category = event.target.value;
    refilter();
  });

  root.querySelector('#r-stations').addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    state.station = chip.dataset.station || null;
    for (const c of event.currentTarget.children) {
      c.setAttribute('aria-pressed', String(c === chip));
    }
    refilter();
  });

  // The two view chips are a single choice, and tapping the
  // pressed one goes back to showing everything.
  showChips.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    state.show = state.show === chip.dataset.show ? 'all' : chip.dataset.show;
    for (const c of showChips.children) {
      c.setAttribute('aria-pressed', String(c.dataset.show === state.show));
    }
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

    const { fn, ways } = SORTS[state.sort];
    const flip = state.dir === 'asc' ? 1 : -1;
    const chosen = (a, b) => flip * fn(a, b);

    list.sort(personal
      ? (a, b) => RANK[a.state] - RANK[b.state] || chosen(a, b)
      : chosen);

    dirButton.textContent = `${state.dir === 'asc' ? '\u2191' : '\u2193'} ${ways[state.dir]}`;
    dirButton.title = `Sorted ${ways[state.dir].toLowerCase()} -- click to reverse`;

    gallery.innerHTML = list.length
      ? list.slice(0, state.shown).map((r) => card(r, personal)).join('')
      : empty('Nothing matches those filters.');
    pagerBox.innerHTML = pager(state.shown, list.length);

    const ready = personal
      ? all.filter((r) => r.state === 'wanted' && r.satisfied === r.needs).length
      : 0;
    count.textContent = `${list.length} recipe${list.length === 1 ? '' : 's'}`
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
  const colour = ['blue', 'yellow', 'pink'].includes(r.color) ? r.color : '';
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

      ${r.description ? `<p class="buff">${esc(r.description)}</p>` : ''}

      <ul class="ingredients">
        ${r.ingredients.map((i) => ingredient(i, personal)).join('')}
      </ul>

      ${personal ? actions(r, ready) : ''}
    </article>`;
}

function ingredient(i, personal) {
  const badge = i.quality
    ? `<span class="badge${i.quality === 'Legendary' ? ' legendary' : ''}">${esc(i.quality)}</span>`
    : '';

  if (!personal) {
    return `<li><span class="qty">${i.qty}x</span>
              <span class="what">${esc(i.name)}${badge}</span></li>`;
  }

  return `
    <li class="${i.satisfied ? 'have' : 'short'}">
      <span class="mark" aria-hidden="true">${i.satisfied ? '+' : 'x'}</span>
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
    .map((i) => `${i.qty - i.have}\u00d7 ${i.name}`);

  return missing.length > 2
    ? `${missing.slice(0, 2).join(', ')} and ${missing.length - 2} more`
    : missing.join(', ');
}

function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

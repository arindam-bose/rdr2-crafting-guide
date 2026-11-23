// ============================================================
// Materials — "Where to go if you have these items".
//
// One card per material: the recipes it goes into, and a row for
// every station that still wants it.  A card opens a dialog with
// the rest, where stock can be logged a tap at a time.  Three
// tabs, because the three are collected in completely different
// ways: animal materials are a hunting trip, plants a walk, and
// the others -- ammunition, liquor, the odd trinket -- a shop or a
// detour.  Each tab carries the count that matches the current
// filters, so what is on the others is never a surprise.
//
// The filters are three groups of chips: All | Pearson, Trapper,
// Fence | Still needed, Done.  Each group is a radio that can be
// switched off -- tap the pressed chip and that group lets everything
// through -- and All switches off both, showing every material there
// is, finished with or not.  A vendor and a state together ask the
// state of that vendor alone: Trapper with Still needed is what the
// Trapper still wants, whatever Pearson thinks of it.
//
// A material used only at the campfire is never needed and never
// done: nothing asks for a set amount of it.  It shows when no state
// is chosen, with what you hold in the Satchel, and nowhere else.
//
// A view exports mount(root) and gets back { update, destroy }.
// The chrome is built once; a store change refills the groups
// alone, so the search box keeps its text and its focus.
// ============================================================

import * as queries from '../queries.js';
import * as store from '../store.js';
import { materialCard, empty, plural, pager, stationIcon, MISC_KINDS, PAGE } from '../render.js';
import { opensCard } from '../dialog.js';
import { group, materialDialog } from './material-dialog.js';
import * as nav from '../nav.js';
import * as toolbar from './toolbar.js';

const GROUPS = [
  { id: 'animal',   title: 'Animal Materials', types: ['animal'], icon: 'animals' },
  { id: 'plant',    title: 'Plants',           types: ['plant'], icon: 'plants' },
  { id: 'supplies', title: 'Misc. Items',      types: MISC_KINDS, icon: 'supplies' },
];
const groupOf = (card) =>
  GROUPS.find((g) => g.types.includes(card.source_type))?.id;

const { categoryOf, qualityRank: rank } = toolbar;

const byName = (a, b) => a.material.localeCompare(b.material);
const shortfall = (c) => c.demands.reduce(
  (total, d) => total + Math.max(0, d.needed - d.have), 0);

// Each field is written ascending once; the direction toggle
// negates it.  `ways` names what each direction actually does.
const SORTS = {
  needed:  {
    label: 'Still needed',
    fn: (a, b) => shortfall(a) - shortfall(b) || byName(a, b),
    ways: { asc: 'Least first', desc: 'Most first' },
    start: 'desc',
  },
  quality: {
    label: 'Quality',
    fn: (a, b) => rank(a) - rank(b) || shortfall(b) - shortfall(a) || byName(a, b),
    ways: { asc: 'Legendary first', desc: 'Legendary last' },
    start: 'asc',
  },
  name: toolbar.nameSort(byName),
};

export function mount(root) {
  // `expanded` holds the ingredient ids whose "used in" list is open.
  // It lives here rather than in the DOM because every store change --
  // crafting something, saving inventory -- rerenders the gallery, and
  // a list that closed itself when you ticked something off would be
  // worse than not opening at all.
  const stations = queries.stations();
  const categories = toolbar.categoryOptions(queries.bodyParts());

  // What this list was narrowed to earlier in the session, if anything.
  const { query, ...kept } = toolbar.recallFilters('materials', {
    station: (v) => v === null || stations.some((s) => s.id === v),
    part: (v) => v === '' || categories.some((c) => c.value === v),
    show: (v) => ['all', 'short', 'done'].includes(v),
    group: (v) => GROUPS.some((g) => g.id === v),
  });

  const state = { search: '', station: null, part: '', show: 'all',
                  group: GROUPS[0].id, shown: PAGE, expanded: new Set(),
                  ...kept,
                  ...toolbar.restoreSort('materials', SORTS,
                                         { sort: 'name', dir: 'asc' }) };

  // Reference data, fixed for the life of the page: read once, not on
  // every tap of a stepper.
  const animals = queries.materialAnimals();
  const plants = queries.materialPlants();

  root.innerHTML = `
    <div class="view-head">
    <div class="toolbar">
      ${toolbar.searchBox('m-search', 'Search a material or animal…')}
      ${toolbar.categoryFilter('m-part')}
      ${toolbar.allChip('m-all')}
      ${toolbar.chipRow('m-stations', 'station',
        stations.map((s) => ({ value: s.id, label: s.name, icon: stationIcon(s.id) })),
        state.station)}
      ${toolbar.chipRow('m-show', 'show', [
        { value: 'short', label: 'Still needed' },
        { value: 'done', label: 'Done' },
      ], state.show)}
      ${toolbar.sortControl('m', SORTS, 'Sort materials by', state.sort)}
      ${toolbar.clearFilters('m-clear')}
      <span class="count" id="m-count"></span>
    </div>
    ${toolbar.tabRow('m-groups', 'group', GROUPS, { selected: state.group })}
    </div>
    <div class="gallery" id="m-gallery"></div>
    <div id="m-pager"></div>`;

  const showChips = root.querySelector('#m-show');
  const allChips = root.querySelector('#m-all');
  const stationChips = root.querySelector('#m-stations');
  const count = root.querySelector('#m-count');
  const pagerBox = root.querySelector('#m-pager');
  const gallery = root.querySelector('#m-gallery');
  const groupTabs = root.querySelector('#m-groups');
  const dirButton = root.querySelector('#m-dir');
  const partSelect = root.querySelector('#m-part');

  // Anything that changes what is in the list starts it over at the
  // first page; a store change — crafting something — does not, so
  // you keep your place.
  function refilter() {
    state.shown = PAGE;
    update();
  }

  const searchInput = root.querySelector('#m-search');
  toolbar.wirePager(pagerBox, state, update);
  toolbar.wireSearch(searchInput, state, refilter, query);
  toolbar.wireSort(root, 'm', SORTS, state, refilter, 'materials');
  const markRules = toolbar.wireRules(root.querySelector('.toolbar'));
  const clearButton = root.querySelector('#m-clear');
  toolbar.wireClearFilters(clearButton, searchInput, () => {
    state.part = '';
    state.station = null;
    state.show = 'all';
  });

  const paintChips = toolbar.wireFilterChips(allChips, [
    { el: stationChips, attr: 'station', off: null },
    { el: showChips, attr: 'show', off: 'all' },
  ], state, refilter);

  // A category belongs to one tab, so choosing one takes you to the
  // tab its materials are on rather than leaving you on an empty one.
  partSelect.addEventListener('change', (event) => {
    state.part = event.target.value;
    if (state.part) {
      toolbar.selectTab(groupTabs, 'group', state,
        toolbar.MISC_CATEGORIES.some((k) => k.value === state.part) ? 'supplies' : 'animal');
    }
    refilter();
  });

  // Opening one card's list does not touch the others, and does not
  // start the page over: this is reading, not filtering.  Anywhere
  // else on a card opens it.
  gallery.addEventListener('click', (event) => {
    const id = event.target.closest('.card')?.dataset.ingredient;
    if (!id) return;

    if (event.target.closest('[data-expand]')) {
      if (state.expanded.has(id)) state.expanded.delete(id);
      else state.expanded.add(id);
      update();
      return;
    }

    // Through the address, not straight to the dialog: a material
    // opened by tapping its card and one opened by a link from a
    // recipe are then the same thing, and Back shuts either.
    if (opensCard(event)) nav.open('materials', id);
  });

  let lastCards = [];

  // Looked up afresh from the whole list, not the visible page: a
  // material you just finished with may have filtered itself out of
  // the gallery, and the dialog should stay put while you look at it.
  const detail = materialDialog({
    route: 'materials',
    find: (id) => lastCards.find((m) => m.ingredient_id === id),
  });

  toolbar.wireTabs(groupTabs, 'group', state, refilter);

  function update() {
    toolbar.keepFilters('materials', { query: searchInput.value, station: state.station,
                                       part: state.part, show: state.show, group: state.group });
    const personal = store.isPersonal();
    showChips.hidden = !personal;
    paintChips();
    // Still needed and Done only narrow in Personalize, where they show.
    clearButton.hidden = !(state.search || state.part || state.station
                           || (personal && state.show !== 'all'));
    markRules();

    lastCards = group(queries.materials({ personal }), queries.materialUsage(),
                      animals, plants);
    // Every filter but the category, in one pass.  The categories on
    // offer are what that lets through, across all three tabs --
    // choosing one moves you to its tab anyway -- and the cards are
    // the same list narrowed to the one chosen.
    const loose = lastCards.filter((m) => matches(m, state, personal));
    toolbar.fillCategories(partSelect, categories,
                           new Set(loose.map(categoryOf)), state.part);
    const matched = state.part
      ? loose.filter((m) => categoryOf(m) === state.part)
      : loose;

    const counts = toolbar.countTabs(groupTabs, 'group', GROUPS, matched, groupOf);

    const cards = matched.filter((m) => groupOf(m) === state.group);
    cards.sort(toolbar.comparator(SORTS, state));
    toolbar.paintDir(dirButton, SORTS, state);

    // The empty message goes where the cards would have been, as on
    // Recipes, so the pager always sits under the gallery.
    gallery.innerHTML = cards.length
      ? cards.slice(0, state.shown).map((m) => materialCard(m, {
          personal, expanded: state.expanded.has(m.ingredient_id),
          done: personal && tracked(m) && !outstanding(m),
        })).join('')
      : empty(emptyMessage(state, personal, counts));
    pagerBox.innerHTML = pager(state.shown, cards.length);

    count.textContent = plural(cards.length, 'material');

    detail.refresh();
  }

  update();
  return { update, focus: detail.focus, destroy: detail.destroy };
}

function emptyMessage(state, personal, counts) {
  const elsewhere = toolbar.elsewhere(GROUPS, state.group, counts);
  if (elsewhere) return elsewhere;
  if (state.show === 'done' && personal) return 'Nothing is finished with yet.';
  if (state.show === 'short' && personal && !state.search && !state.station && !state.part) {
    return 'Every recipe is done. Go buy a hat.';
  }
  return 'Nothing matches those filters.';
}


// Outstanding: some station still wants more than you are holding.
const outstanding = (card) =>
  card.demands.some((d) => d.needed > 0 && d.have < d.needed);

// Worked towards at all: some vendor recipe uses it, wanted or not.
const tracked = (card) => card.demands.some((d) => !d.campfire);

/** Whether `term` begins `name` or any word in it: "bear" in "Black Bear". */
function startsWord(name, term) {
  const n = name.toLowerCase();
  return n.startsWith(term) || n.includes(` ${term}`);
}

// Everything but the category, which update() offers and narrows by.
// A chosen vendor narrows the demands the state is judged on, as well
// as the cards: Done with Pearson is done for Pearson.
function matches(card, state, personal) {
  const at = state.station
    ? { ...card, demands: card.demands.filter((d) => d.station_id === state.station) }
    : card;
  if (state.station && !at.demands.length) return false;

  // Done: you have enough of it, or nothing is asking for it any more.
  // Still needed: someone wants more than you hold.  Neither: all of
  // it, finished with or not.
  if (personal) {
    if (state.show === 'done' && (outstanding(at) || !tracked(at))) return false;
    if (state.show === 'short' && !outstanding(at)) return false;
  }

  // The material's own name, and the animals it comes from -- nothing
  // about recipes.  Typing "talisman" here used to pull up every pelt
  // that feeds one, which is the question Recipes answers; on this page
  // you are looking for a material, or for what an animal you have in
  // your sights is good for.  A pelt's name already carries its animal,
  // but Big Game Meat does not say Wolf, and Flaky Fish Meat does not
  // say Perch, and Sage does not say Red.  Animals and plants match
  // from the start of a word, as they do on Inventory, so "ox" is the
  // Ox and not the Fox a dozen meats share.
  if (state.search && !card.material.toLowerCase().includes(state.search)
      && !card.animals.some((a) => startsWord(a.name, state.search))
      && !card.plants.some((p) => startsWord(p.name, state.search))) {
    return false;
  }
  return true;
}

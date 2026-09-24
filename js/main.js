// ============================================================
// Boot and routing.
//
// Order matters: open the database, replay the ledger out of
// IndexedDB, and only then render — otherwise the first paint
// shows a personal layer that is briefly empty.
// ============================================================

import * as db from './db.js';
import * as nav from './nav.js';
import * as store from './store.js';
import * as theme from './theme.js';
import { errorBox } from './render.js';
import { toast } from './toast.js';
import * as materials from './views/materials.js';
import * as inventory from './views/inventory.js';
import * as recipes from './views/recipes.js';
import * as settings from './views/settings.js';

// Each route names itself: the tab label, and the heading under it.
const ROUTES = {
  materials: { title: 'Materials',
               view: () => materials },
  recipes:   { title: 'Recipes',
               view: () => recipes },
  inventory: { title: 'Inventory',
               view: () => inventory },
  settings:  { title: 'Settings',
               view: () => settings },
};

const DEFAULT_ROUTE = 'materials';

const view = document.getElementById('view');
const pageTitle = document.getElementById('page-title');
const tabs = document.querySelector('.tabs');
const modeToggle = document.getElementById('mode-toggle');

let current = null;     // the mounted view's { update, destroy }
let currentName = null;

/** The masthead switch, told which way it is set. */
function paintMode() {
  modeToggle.setAttribute('aria-checked', String(store.isPersonal()));
}

// ------------------------------------------------------------
// routing
// ------------------------------------------------------------

/** The page and the card the address asks for. */
function route() {
  const { name, id } = nav.parse();
  return { name: name in ROUTES ? name : DEFAULT_ROUTE, id };
}

/**
 * Arrive at an address.  The page is mounted only when it changes --
 * a cross-link from Materials to Recipes mounts Recipes, but opening
 * a second recipe from the one already showing does not -- and then
 * the view is told which of its cards the address wants open.
 */
function show({ name, id }) {
  if (name !== currentName) {
    current?.destroy?.();
    currentName = name;

    for (const tab of tabs.querySelectorAll('a')) {
      if (tab.dataset.route === name) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }

    pageTitle.textContent = ROUTES[name].title;
    document.title = `${ROUTES[name].title} · RDR2 Crafting Guide`;

    try {
      current = ROUTES[name].view().mount(view);
    } catch (err) {
      console.error(err);
      view.innerHTML = errorBox(err);
      current = null;
    }
  }

  current?.focus?.(id);
}


// ------------------------------------------------------------
// boot
// ------------------------------------------------------------

async function start() {
  // The attribute is already set inline; this is only the browser
  // chrome catching up, now that the stylesheet has been applied.
  theme.syncBrowserChrome();

  // Before the database, not after: the mode is a preference, not a
  // row, and waiting on a wasm download to paint it would show the
  // wrong half of the switch for as long as that took.
  paintMode();
  modeToggle.addEventListener('click', () => {
    store.setPersonal(!store.isPersonal());
    paintMode();                      // the subscription is not up yet
  });

  await db.open();
  await store.hydrate();

  // Any write — or a mode flip — refreshes whatever is on screen, and
  // repaints the switch, so Settings' own mode button and this one can
  // never disagree.
  store.subscribe(() => { paintMode(); current?.update?.(); });

  // A cross-link is a real anchor -- middle-clickable, copyable, and
  // something the keyboard can reach -- but a plain left-click is sent
  // through nav.open() rather than left to the browser, so that every
  // card the app opens leaves the same stamped history entry and can
  // be closed by spending it again.  A modified click is left alone:
  // that is someone opening a tab, not following a link here.
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0
        || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const link = event.target.closest('a.xlink[href^="#/"]');
    if (!link) return;

    const { name, id } = nav.parse(link.getAttribute('href'));
    if (!(name in ROUTES) || !id) return;   // let the browser have it

    event.preventDefault();
    nav.open(name, id);
  });

  window.addEventListener('hashchange', () => show(route()));
  show(route());

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'offline-ready') {
        toast('Cached -- this works without a signal now.');
      }
    });
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('offline caching unavailable:', err);
    });
  }
}

start().catch((err) => {
  console.error(err);
  view.innerHTML = errorBox(err);
});

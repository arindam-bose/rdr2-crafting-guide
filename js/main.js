// ============================================================
// Boot and routing.
//
// Order matters: open the database, replay the ledger out of
// IndexedDB, and only then render — otherwise the first paint
// shows a personal layer that is briefly empty.
// ============================================================

import * as db from './db.js';
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

// ------------------------------------------------------------
// routing
// ------------------------------------------------------------

function routeName() {
  const name = location.hash.replace(/^#\/?/, '').split('/')[0];
  return name in ROUTES ? name : DEFAULT_ROUTE;
}

function show(name) {
  if (name === currentName) return;

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


// ------------------------------------------------------------
// boot
// ------------------------------------------------------------

async function start() {
  // The attribute is already set inline; this is only the browser
  // chrome catching up, now that the stylesheet has been applied.
  theme.syncBrowserChrome();

  await db.open();
  await store.hydrate();

  modeToggle.checked = store.isPersonal();
  modeToggle.addEventListener('change', () => store.setPersonal(modeToggle.checked));

  // Any write — or a mode flip — refreshes whatever is on screen.
  store.subscribe(() => current?.update?.());

  window.addEventListener('hashchange', () => show(routeName()));
  show(routeName());

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

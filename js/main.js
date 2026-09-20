// ============================================================
// Boot and routing.
//
// Order matters: open the database, replay the ledger out of
// IndexedDB, and only then render — otherwise the first paint
// shows a personal layer that is briefly empty.
// ============================================================

import * as db from './db.js';
import * as store from './store.js';
import { errorBox, placeholder } from './render.js';
import { toast } from './toast.js';
import * as materials from './views/materials.js';

const ROUTES = {
  materials: () => materials,
  recipes:   () => stub('Recipes', 'All 165 recipes, with the ingredient markers.'),
  inventory: () => stub('Inventory', 'Search a material, tap + or −, per location.'),
  settings:  () => stub('Settings', 'Export, import, reset.'),
};

const DEFAULT_ROUTE = 'materials';

const view = document.getElementById('view');
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

  try {
    current = ROUTES[name]().mount(view);
  } catch (err) {
    console.error(err);
    view.innerHTML = errorBox(err);
    current = null;
  }
}

/** A screen that isn't built yet, said plainly. */
function stub(title, message) {
  return {
    mount(root) {
      root.innerHTML = placeholder(title, `${message} — not built yet.`);
      return { update() {}, destroy() {} };
    },
  };
}

// ------------------------------------------------------------
// boot
// ------------------------------------------------------------

async function start() {
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
        toast('Cached — this works without a signal now.');
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

// ============================================================
// Putting the guide on the home screen.
//
// The manifest and the service worker already make it installable;
// this is for saying so.  Chrome, Edge and Samsung's browser fire
// `beforeinstallprompt` once they consider the page installable, and
// the event can be kept and its prompt shown later, from a button --
// so Settings can offer a real Install.  Firefox and Safari have no
// such event: there, all a page can do is say where the browser keeps
// its own Add to Home Screen, in the words that browser uses.
//
// Imported at startup through Settings, so the listener is in place
// before the event fires, whichever page the visit opens on.  The
// event is kept, not cancelled: cancelling it would also hide the
// browser's own offer, and that is worth keeping for anyone who never
// opens Settings.
// ============================================================

import { detect } from './device.js';

let deferred = null;           // the kept beforeinstallprompt event
let justInstalled = false;
const listeners = new Set();

function changed() {
  for (const fn of listeners) fn();
}

addEventListener('beforeinstallprompt', (event) => {
  deferred = event;
  changed();
});

addEventListener('appinstalled', () => {
  deferred = null;
  justInstalled = true;
  changed();
});

/** Call `fn` whenever what Settings should say changes.  Returns an unsubscribe. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * 'running' when this is the installed app itself, 'installed' when
 * it was installed during this visit (this tab is still the browser),
 * 'prompt' when the browser's own install prompt can be shown, and
 * 'manual' otherwise.  `navigator.standalone` is Safari's own word for
 * opened from the home screen.
 */
export function state() {
  if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) return 'running';
  if (justInstalled) return 'installed';
  return deferred ? 'prompt' : 'manual';
}

/**
 * Show the browser's install prompt: 'accepted', 'dismissed', or
 * 'unavailable' if there is none or the browser refused to show it.
 * An event's prompt can be shown once, so it is spent either way; if
 * the reader says no, Chrome may fire a fresh one later.
 */
export async function prompt() {
  const event = deferred;
  if (!event) return 'unavailable';
  deferred = null;
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    // Said yes: installed, as far as this tab need know, without
    // waiting on `appinstalled`, which can come seconds later.
    if (outcome === 'accepted') justInstalled = true;
    return outcome;
  } catch {
    return 'unavailable';
  } finally {
    changed();
  }
}

/**
 * Where this browser keeps Add to Home Screen, as a sentence of HTML.
 * The typewriter face has no vertical ellipsis or arrow, so the menu
 * is "the three-dot menu" and the steps are joined with "then".
 */
export function steps() {
  const { browser, system } = detect();
  const b = (words) => `<strong>${words}</strong>`;

  if (system === 'iPhone' || system === 'iPad') {
    return browser === 'Safari' || !browser
      ? `Tap Safari's ${b('Share')} button, then ${b('Add to Home Screen')}.`
      : `Open ${browser}'s ${b('Share')} menu, then choose ${b('Add to Home Screen')}.`;
  }

  if (system === 'Android') {
    if (browser === 'Chrome') {
      return `Open Chrome's three-dot menu and choose ${b('Add to Home screen')}, then ${b('Install')}.`;
    }
    if (browser === 'Firefox') {
      return `Open Firefox's three-dot menu and choose ${b('Add to Home screen')}
        (${b('Install')} on some versions).`;
    }
    if (browser === 'Samsung Internet') {
      return `Open the menu, choose ${b('Add page to')}, then ${b('Home screen')}.`;
    }
    return `Open the browser's menu and look for ${b('Add to Home screen')} or ${b('Install')}.`;
  }

  if (browser === 'Chrome' || browser === 'Edge') {
    return `Click the install icon at the right end of the address bar, or find
      ${b('Install')} in ${browser}'s menu.`;
  }
  if (browser === 'Safari' && system === 'Mac') {
    return `In Safari's ${b('File')} menu, choose ${b('Add to Dock')}.`;
  }
  if (browser === 'Firefox') {
    return `Firefox on a computer cannot install a site. Bookmark this page,
      or open it in Chrome or Edge and install it from there.`;
  }
  return `Look in the browser's menu for ${b('Install')} or ${b('Add to Home screen')}.`;
}

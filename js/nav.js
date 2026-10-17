// ============================================================
// Where you are, as an address.
//
// The hash carries two things: which page, and -- when a card is
// open -- which card.  That second half is what lets a recipe named
// on a material's card be a link rather than a word: #/recipes/<id>
// is somewhere the Recipes page knows how to arrive at, whether it
// is reached from the Materials page, from a bookmark, or from a
// cold load.
//
// Every dialog in the app opens this way, including the ones opened
// by tapping a card on the page you are already on, so there is one
// path in and one path out rather than two that can disagree.
// ============================================================

/** `#/recipes/recipe-bear-claw-talisman` -> { name: 'recipes', id: 'recipe-…' }. */
export function parse(hash = location.hash) {
  const [name, id] = hash.replace(/^#\/?/, '').split('/');
  return { name, id: id ? decodeURIComponent(id) : null };
}

/** The address of one open card -- what a cross-link's href is. */
export function href(route, id) {
  return `#/${route}/${encodeURIComponent(id)}`;
}

/**
 * Go there, as a tap on a card does -- and as a cross-link does, since
 * main.js sends plain left-clicks on one through here rather than
 * letting the anchor navigate on its own.
 *
 * The entry that lands remembers what was underneath it.  That is what
 * `closed` reads: an entry pushed from this same page with nothing
 * open can be handed back, and anything else has to be written over.
 */
export function open(route, id) {
  const from = location.hash;
  location.hash = href(route, id);
  // `at` is kept for the address that did not change -- the card
  // already open -- where no new entry was made to write it on.
  history.replaceState({ card: true, from, at: history.state?.at }, '');
}

/**
 * The card is shut, so take it out of the address -- without moving
 * the reader off the page they are looking at.  Shutting a recipe you
 * arrived at from a material is done looking at that recipe, not a
 * request to be sent back to the material.
 *
 * Which leaves two ways to do it, and the stack decides:
 *
 *   The entry below is this same page, with nothing open.  That is a
 *   card tapped on the page you were already on, so hand the entry
 *   back.  Writing over it instead would leave it pointing where it
 *   already pointed, and Back would be a press that does nothing --
 *   once per card the reader had opened.
 *
 *   Anything else -- a cross-link from the other page, a bookmark
 *   opened cold -- is written over in place.  The reader stays put,
 *   and the entry left behind is a real one: Back from it goes
 *   somewhere, because what is underneath is a different page.
 */
export function closed(route) {
  if (!parse().id) return;                  // already left by Back

  const { card, from } = history.state ?? {};
  const below = parse(from ?? '');

  if (card && below.name === route && !below.id) history.back();
  else history.replaceState({ at: history.state?.at }, '', `#/${route}`);
}

// ------------------------------------------------------------
// Back and Forward
//
// The installed app has no browser toolbar, so no Back -- the page
// draws its own (main.js).  The browser's history is already the
// stack; what a page cannot ask it is whether there is anywhere to
// go.  So every entry is numbered as it is first arrived at, in its
// state's `at`, and the furthest number reached is kept: Back has
// somewhere to go above 0, Forward below the furthest.  A new entry
// cuts off everything ahead of it, as the browser does, so it
// becomes the furthest.  The furthest is kept in sessionStorage, so
// a reload still knows what lies ahead; without it, Forward just
// starts out off.
//
// Anything here that writes over an entry's state carries `at`
// across, or the entry would be taken for a new one on the way back.
// ------------------------------------------------------------

const FURTHEST = 'history-furthest';
let here = -1;
let furthest = -1;
try { furthest = Number(sessionStorage.getItem(FURTHEST) ?? -1); } catch {}

/**
 * Number the entry the reader is on, if it is new; call on every
 * arrival -- hashchange, popstate, and after a pushState.
 */
export function stamp() {
  const at = history.state?.at;
  if (Number.isInteger(at)) {
    here = at;
  } else {
    here += 1;
    furthest = here;
    history.replaceState({ ...history.state, at: here }, '');
  }
  if (here > furthest) furthest = here;
  try { sessionStorage.setItem(FURTHEST, String(furthest)); } catch {}
}

/** { back, forward }: whether each has an entry to go to. */
export function can() {
  return { back: here > 0, forward: here < furthest };
}

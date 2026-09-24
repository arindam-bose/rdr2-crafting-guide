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

/** `#/recipes/rec-bear-claw-talisman` -> { name: 'recipes', id: 'rec-…' }. */
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
 * The entry that lands is stamped as one this app pushed.  That stamp
 * is what `closed` reads: an entry we made is ours to spend, and one
 * we did not -- a bookmark opened cold, a shared link -- is not.
 */
export function open(route, id) {
  location.hash = href(route, id);
  history.replaceState({ card: true }, '');
}

/**
 * The card is shut, so take it out of the address.
 *
 * Going back rather than rewriting, when the entry is one we pushed:
 * rewriting would leave it on the stack pointing at the same place it
 * already was, and Back would then be a press that does nothing --
 * once per card the reader had opened.  Spending it instead means
 * closing a dialog lands exactly where opening it came from, which is
 * what Back would have done anyway.
 *
 * Arrived at cold there is nothing to spend, so the address is
 * rewritten in place and the reader keeps a Back that leaves.
 */
export function closed(route) {
  if (!parse().id) return;                  // already left by Back
  if (history.state?.card) history.back();
  else history.replaceState(null, '', `#/${route}`);
}

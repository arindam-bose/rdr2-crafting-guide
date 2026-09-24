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

/** Go there, as a tap on a card does.  Same thing a link would do. */
export function open(route, id) {
  location.hash = href(route, id);
}

/**
 * Drop the card from the address, without adding to history: closing
 * a dialog is not somewhere you went, and a reader who shuts one and
 * then presses Back means to leave the page, not to reopen it.
 */
export function closed(route) {
  if (parse().id) history.replaceState(null, '', `#/${route}`);
}

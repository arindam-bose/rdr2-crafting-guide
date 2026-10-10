// ============================================================
// Small per-device preferences.
//
// Which theme, which inventory location, when you last exported:
// choices, not data.  They live in localStorage rather than the
// ledger, and they are never worth an exception.  The sort orders
// are the one kind a backup carries -- see sorts() below.
//
// Reading localStorage throws outright in a browser with site
// data blocked, and in Safari's private mode it has historically
// thrown on write.  isPersonal() is called on every render of
// every screen, so an unguarded read there does not degrade the
// app, it stops it.  Everything goes through here instead.
// ============================================================

/** The stored string, or `fallback` if there isn't one we can read. */
export function get(key, fallback = null) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Forget `key`. */
export function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch { /* nothing stored to forget */ }
}

/** Store `value`.  Losing a preference is not worth failing a write for. */
export function set(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch { /* no storage: the session keeps it, the next one starts fresh */ }
}

// ------------------------------------------------------------
// sort orders
//
// How each list is sorted, as 'field:dir' under one key per list.
// They travel in a backup, so the same person on another device gets
// their lists back the way they left them.  Which fields exist is the
// view's business: toolbar.restoreSort falls back from one it does
// not know, so these only check the shape.
// ------------------------------------------------------------

const SORT_PREFIX = 'rdr2:sort:';
const SORT_VALUE = /^[a-z_]+:(asc|desc)$/;
const LIST_NAME = /^[a-z-]+$/;

/** Where `list`'s sort is kept: 'recipes' -> 'rdr2:sort:recipes'. */
export const sortKey = (list) => SORT_PREFIX + list;

/** Every list's remembered sort, { recipes: 'materials:asc', … }. */
export function sorts() {
  const found = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(SORT_PREFIX)) continue;
      const list = key.slice(SORT_PREFIX.length);
      const value = localStorage.getItem(key);
      if (LIST_NAME.test(list) && SORT_VALUE.test(value)) found[list] = value;
    }
  } catch { /* no storage: nothing remembered to carry */ }
  return found;
}

/**
 * The sorts a backup can put back: the well-formed entries of its
 * `sorts`, or null for a file made before backups carried them.
 */
export function validSorts(given) {
  if (!given || typeof given !== 'object' || Array.isArray(given)) return null;
  return Object.fromEntries(Object.entries(given)
    .filter(([list, value]) => LIST_NAME.test(list) && SORT_VALUE.test(value)));
}

/**
 * Replace every remembered sort with `given`, as a restore replaces
 * everything else.  A list it does not name goes back to its default.
 */
export function replaceSorts(given) {
  for (const list of Object.keys(sorts())) remove(sortKey(list));
  for (const [list, value] of Object.entries(given)) set(sortKey(list), value);
}

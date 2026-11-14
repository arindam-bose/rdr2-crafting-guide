// ============================================================
// Bringing a backup back, from anywhere.
//
// Four ways in -- the masthead's Import, a file dropped on any
// page, Settings' Bring it back (a file or pasted text), and
// Inventory's offer on an empty device -- and one way through, so
// they can never disagree about what a file holds or what replacing
// costs.  As in the Money and Habit Trackers, one file at a time.
//
// A file is read and checked before anything is asked or written.
// One that will not load says why, and nothing changes.  On an
// empty device there is nothing to lose, so it loads straight away;
// otherwise a dialog sets the file beside this device, the rows that
// differ tinted, and nothing is written until Replace is pressed.
// ============================================================

import * as backup from './backup.js';
import * as store from './store.js';
import { detailDialog } from './dialog.js';
import { detailHead, esc, plural, stampDate } from './render.js';
import { toast } from './toast.js';

/** What the file input and a drop take: backups are .txt now, and older ones .json. */
export const ACCEPT = '.json,.txt,application/json,text/plain';

// The offer waiting on the dialog: the text, where it came from, what
// it holds, and the answer to give back.
let pending = null;
// One restore at a time, from start to finish -- read, asked, written --
// whichever way it came in: a paste and a drop must not both be
// clearing and refilling the store at once.
let busy = false;

// Inventory's changes made but not yet saved: nothing else knows of
// them, so Inventory says how many there are and how to drop them.  A
// restore replaces what they were counted against, so they are never
// carried over it.
let unsaved = { count: () => 0, discard: () => {} };

/** Inventory tells this module about its unsaved changes; see `unsaved`. */
export function onUnsaved(hooks) {
  unsaved = hooks;
}

const dialog = detailDialog({
  render: (offer) => (offer ? compare(offer) : null),
  async onClick(event) {
    if (event.target.id === 'restore-confirm' && pending) {
      const offer = pending;
      pending = null;
      // Shut first: a toast goes into whichever dialog is open, and the
      // one saying how it went must not be shut away inside this one.
      closeDialog();
      // Said in the dialog, so dropped now.
      unsaved.discard();
      offer.done(await backup.restoreAndSay(offer.text, offer.note));
    } else if (event.target.id === 'restore-cancel') {
      closeDialog();
    }
  },
  // However it shuts -- Cancel, Esc, the backdrop, the close button --
  // an offer still waiting is answered no.  This dialog's own close
  // only: a card closing under it is not an answer.
  onClose() {
    if (!pending) return;
    const offer = pending;
    pending = null;
    offer.done(false);
  },
});

/** Shut the dialog; Esc and the backdrop come through here too, as a Cancel. */
function closeDialog() {
  dialog.focus(null);
}

/** A SQLite stamp as the reader's own date and time: "Nothing yet" with none, "Unknown" for one that won't read. */
function stampText(stamp) {
  if (!stamp) return 'Nothing yet';
  return stampDate(stamp)?.toLocaleString() ?? 'Unknown';
}

/**
 * The dialog: what the file holds beside what this device has, and what replacing would cost, as
 * a table with the rows that differ tinted -- the way the Money and Habit Trackers ask.
 */
function compare({ source, found }) {
  const now = store.stats();
  const exported = found.exported_at
    ? `Exported ${new Date(found.exported_at).toLocaleDateString()}${found.device ? ` from ${found.device}` : ''}`
    : 'No export date';
  const saved = backup.lastSaved();
  const here = store.latestChange();
  const there = found.last_change;
  // Both stamps are SQLite's own shape, so they compare as text.
  const newerHere = here !== null && (there === null || here > there);

  const rows = [
    ['Entries', now.entries.toLocaleString(), found.ledger.toLocaleString(), true],
    ['Crafted recipes', now.made.toLocaleString(), found.made.toLocaleString(), true],
    ['Last change', stampText(here), stampText(there), true],
    // A backup and an export are different events, so this row is context, never a difference.
    ['Backup', saved ? `Backed up ${saved.toLocaleDateString()}` : 'Never backed up', exported, false],
  ];

  return `
    ${detailHead('Bring it back', 'Replace your data?')}
    <p><strong>${esc(source)}</strong> holds a backup. Restoring it replaces
      everything on this device.</p>
    <table class="restore-compare">
      <thead><tr><th></th><th scope="col">On this device</th><th scope="col">In the file</th></tr></thead>
      <tbody>${rows.map(([name, a, b, differs]) => `
        <tr${differs && a !== b ? ' class="differs"' : ''}>
          <th scope="row">${esc(name)}</th><td>${esc(a)}</td><td>${esc(b)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    ${newerHere ? '<p class="restore-warn">This device has newer changes than the file: replacing loses them.</p>' : ''}
    ${unsaved.count()
      ? `<p class="restore-warn">${esc(plural(unsaved.count(), 'unsaved change', 'unsaved changes'))} on Inventory will be dropped.</p>`
      : ''}
    ${found.problems.length
      ? `<ul class="problems">${found.problems.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`
      : ''}
    <p class="note">This cannot be undone.</p>
    <div class="panel-actions">
      <button type="button" class="more-btn danger-btn" id="restore-confirm">Replace my data</button>
      <button type="button" class="ghost-btn" id="restore-cancel">Cancel</button>
    </div>`;
}

/**
 * Offer a backup's text: checked first, then loaded -- straight away on
 * an empty device, after the dialog otherwise.  `source` names it in
 * what is said ("rdr2_inventory_….txt", "pasted text"); `note` is added
 * to the toast that says how it went.  Resolves true once it has loaded,
 * false if it would not or was not wanted.
 */
export async function offer(text, source, note = '') {
  if (busy) {
    toast(`One restore at a time: ${source} was not read.`);
    return false;
  }
  busy = true;
  try {
    const found = store.inspectImport(text);
    if (found.fatal) {
      toast(`${source} could not be restored: ${found.fatal}${note ? ` ${note}` : ''}`);
      return false;
    }
    // Nothing to lose -- nothing logged, and nothing waiting to be saved -- so nothing to ask.
    if (store.isEmpty() && !unsaved.count()) return await backup.restoreAndSay(text, note);
    return await new Promise((done) => {
      pending = { text, source, found, note, done };
      dialog.open(pending);
      // The dialog opens on its close button; the question is the thing to answer.
      document.getElementById('restore-cancel')?.focus();
    });
  } finally {
    busy = false;
  }
}

/**
 * Offer the first of some picked or dropped files.  One at a time: of
 * several, the rest are named as not read rather than half-restored
 * over each other.
 */
export async function offerFiles(files) {
  const [file] = files;
  if (!file) return false;
  if (busy) {
    toast(`One restore at a time: ${file.name} was not read.`);
    return false;
  }
  const rest = files.length - 1;
  const note = rest ? `One file at a time: the other ${rest === 1 ? "file wasn't" : `${rest} files weren't`} read.` : '';
  let text;
  try {
    text = await file.text();
  } catch (err) {
    toast(`${file.name} could not be read: ${err?.message ?? err}`);
    return false;
  }
  return offer(text, file.name, note);
}

/** A file input's change, handed to offerFiles(), and the input cleared so the same file can be picked twice. */
export function onFileInput(event) {
  const files = [...(event.target.files ?? [])];
  event.target.value = '';
  return offerFiles(files);
}

// ------------------------------------------------------------
// dropping a file anywhere
// ------------------------------------------------------------

/**
 * Take a backup dropped anywhere on the page, in either mode -- a
 * restore puts the guide in the mode the backup was taken in.  While a
 * file is over the page an overlay says where it will go.  Called once,
 * at boot.
 */
export function listen() {
  const overlay = document.createElement('div');
  overlay.className = 'drop-overlay';
  overlay.hidden = true;
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div class="drop-target">
      <svg viewBox="0 0 24 24"><path d="M12 15V4m-4.5 4.5L12 4l4.5 4.5M5 19.5h14"/></svg>
      <strong>Drop a backup to restore it</strong>
      <span class="note">A file saved by Back up, one at a time. You'll be asked before anything is replaced.</span>
    </div>`;
  document.body.append(overlay);

  // A drag that began on the page -- a card's icon, the cover picture,
  // a link -- is not a file coming in, though a browser may list
  // "Files" among what it carries.
  let fromPage = false;
  // Shown while drag events keep coming, hidden once they stop.
  // Counting enters against leaves would strand the overlay whenever
  // one goes unpaired: an element repainted away under the pointer, or
  // a browser that pairs them its own way.
  let timer;
  const hide = () => { clearTimeout(timer); overlay.hidden = true; };
  const incoming = (event) => !fromPage && (event.dataTransfer?.types.includes('Files') ?? false);
  // A card or the Replace dialog open: a restore under it would leave
  // it showing what is no longer there.
  const dialogOpen = () => document.querySelector('dialog[open]') !== null;

  window.addEventListener('dragstart', () => { fromPage = true; });
  window.addEventListener('dragend', () => { fromPage = false; hide(); });

  const over = (event) => {
    if (!incoming(event)) return;
    // Always, even when refused: without it the browser opens the file
    // in place of the guide.
    event.preventDefault();
    const refused = busy || dialogOpen();
    event.dataTransfer.dropEffect = refused ? 'none' : 'copy';
    if (refused) { hide(); return; }
    overlay.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(hide, 300);
  };
  window.addEventListener('dragenter', over);
  window.addEventListener('dragover', over);
  window.addEventListener('drop', (event) => {
    if (!incoming(event)) return;
    event.preventDefault();
    hide();
    if (!dialogOpen()) void offerFiles([...event.dataTransfer.files]);
  });
}

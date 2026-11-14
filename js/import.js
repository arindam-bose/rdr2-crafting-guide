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
import { detailHead, esc } from './render.js';
import { toast } from './toast.js';

/** What the file input and a drop take: backups are .txt now, and older ones .json. */
export const ACCEPT = '.json,.txt,application/json,text/plain';

// The offer waiting on the dialog: the text, where it came from, what
// it holds, and the answer to give back.
let pending = null;
// One restore at a time: a second drop while the dialog is up is not
// a second question.
let busy = false;

const dialog = detailDialog({
  render: (offer) => (offer ? compare(offer) : null),
  async onClick(event) {
    if (event.target.id === 'restore-confirm' && pending) {
      const offer = pending;
      pending = null;
      // Shut first: a toast goes into whichever dialog is open, and the
      // one saying how it went must not be shut away inside this one.
      closeDialog();
      offer.done(await backup.restoreAndSay(offer.text, offer.note));
    } else if (event.target.id === 'restore-cancel') {
      closeDialog();
    }
  },
});

/** Shut the dialog; Esc and the backdrop come through here too, as a Cancel. */
function closeDialog() {
  dialog.focus(null);
}

// However it shuts -- Cancel, Esc, the backdrop, the close button -- an
// offer still waiting is answered no.  The dialog empties its body on
// `close`, so this listens on the element that holds it.
document.addEventListener('close', (event) => {
  if (!pending || !event.target.matches?.('dialog.detail')) return;
  const offer = pending;
  pending = null;
  offer.done(false);
}, true);

/** A SQLite stamp ("YYYY-MM-DD HH:MM:SS", UTC) as the reader's own date and time. */
function stampText(stamp) {
  return stamp ? new Date(`${stamp.replace(' ', 'T')}Z`).toLocaleString() : 'Nothing yet';
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
  const found = store.inspectImport(text);
  if (found.fatal) {
    toast(`${source} could not be restored: ${found.fatal}${note ? ` ${note}` : ''}`);
    return false;
  }
  if (store.isEmpty()) return backup.restoreAndSay(text, note);
  if (pending) return false;
  return new Promise((done) => {
    pending = { text, source, found, note, done };
    dialog.open(pending);
    // The dialog opens on its close button; the question is the thing to answer.
    document.getElementById('restore-cancel')?.focus();
  });
}

/**
 * Offer the first of some picked or dropped files.  One at a time: of
 * several, the rest are named as not read rather than half-restored
 * over each other.
 */
export async function offerFiles(files) {
  const [file] = files;
  if (!file || busy) return false;
  busy = true;
  try {
    const rest = files.length - 1;
    const note = rest ? `One file at a time: the other ${rest === 1 ? "file wasn't" : `${rest} files weren't`} read.` : '';
    let text;
    try {
      text = await file.text();
    } catch (err) {
      toast(`${file.name} could not be read: ${err?.message ?? err}`);
      return false;
    }
    return await offer(text, file.name, note);
  } finally {
    busy = false;
  }
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

const hasFiles = (event) => event.dataTransfer?.types.includes('Files') ?? false;

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

  // Entering a child fires dragenter before the parent's dragleave:
  // counted, so the overlay does not flicker on the way across.
  let depth = 0;
  const show = (on) => { overlay.hidden = !on; };

  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth++;
    show(true);
  });
  window.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    // Without this the browser opens the file in place of the guide.
    event.preventDefault();
    event.dataTransfer.dropEffect = busy || pending ? 'none' : 'copy';
  });
  window.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) show(false);
  });
  window.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth = 0;
    show(false);
    void offerFiles([...event.dataTransfer.files]);
  });
}

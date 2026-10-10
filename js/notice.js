// ============================================================
// A one-time notice to returning visitors after an update.
//
// The 1.0.1 database took on new tables, and the offline copy could
// keep serving the old one, so a returning visitor could open the
// guide to an error.  This says what to do, once, to anyone who had
// been here before -- a first visit was never affected and is not
// told.  Set ACTIVE to false once it has run its course.
// ============================================================

import { detailHead } from './render.js';
import { detailDialog } from './dialog.js';
import * as prefs from './prefs.js';
import * as store from './store.js';
import * as backup from './backup.js';

const ACTIVE = true;

const SEEN = 'rdr2:notice-db-update-seen';

// Read as the module loads, before this visit has stored anything
// (store.hydrate() settles the mode for a first visit): anything of
// ours already in storage means someone has been here before.
const returning = (() => {
  try {
    return Object.keys(localStorage).some((k) => k.startsWith('rdr2:') && k !== SEEN);
  } catch {
    return false;
  }
})();

const TEXT = (hasData) => `
  ${detailHead('Update', 'If the guide shows an error')}
  <div class="prose">
    <p>This update changed how the guide stores its recipes. If a page shows
      an error instead of loading, reload once or twice and it should put
      itself right. <strong>Your inventory is safe</strong> either way.</p>
    <p>If the error stays:</p>
    <ol>
      <li><strong>Back up</strong> your data${hasData ? ' with the button below' : ''},
        or with <strong>Back up</strong> at the top.</li>
      <li>Clear this site's data in your browser's settings.</li>
      <li>Reload, and bring your file back from <strong>Settings</strong>,
        under <strong>Bring it back</strong>.</li>
    </ol>
  </div>
  <div class="panel-actions">
    ${hasData ? '<button type="button" class="more-btn" data-backup>Back up now</button>' : ''}
    <button type="button" class="ghost-btn" data-close>Got it</button>
  </div>`;

/** Show the notice if it is on, this is a returning visitor, and they have not seen it. */
export function maybeShow() {
  if (!ACTIVE || !returning || prefs.get(SEEN) !== null) return;
  prefs.set(SEEN, new Date().toISOString());

  const hasData = !store.isEmpty();
  const dialog = detailDialog({
    render: () => TEXT(hasData),
    onClick(event) {
      if (event.target.closest('[data-backup]')) backup.download();
    },
  });
  dialog.open('notice');
}

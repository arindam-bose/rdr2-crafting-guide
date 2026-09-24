// ============================================================
// Settings — where your data lives, and how to move it.
//
// The whole personal layer is a browser's worth of rows in
// IndexedDB: private, and gone if you clear site data.  Export
// is therefore not a nicety, it is the backup.
//
// Import replaces rather than merges.  A ledger id counts up per
// device, so two devices' rows cannot be told apart; merging them
// would double anything imported twice.  One device is the source
// of truth and the other receives.
// ============================================================

import * as store from '../store.js';
import * as theme from '../theme.js';
import { esc, plural } from '../render.js';
import * as prefs from '../prefs.js';
import { toast } from '../toast.js';
import { ledgerDialog } from './ledger.js';

const LAST_EXPORT = 'rdr2:last-export';

// The sources the reference data was built from, credited in the order
// they were leaned on.  `source` is the site or the author; `title` is
// what the page calls itself.
const REFERENCES = [
  { source: 'IGN',
    title: 'Red Dead Redemption 2 Guide',
    url: 'https://www.ign.com/wikis/red-dead-redemption-2' },
  { source: 'RDR2 Map',
    title: 'Interactive Map of Red Dead Redemption 2 Locations',
    url: 'https://rdr2map.com/' },
  { source: 'Contributors to Red Dead Wiki',
    title: 'Red Dead Redemption 2 | Red Dead Wiki | Fandom',
    url: 'https://reddead.fandom.com/wiki/Red_Dead_Redemption_2' },
  { source: 'RankedBoost',
    title: 'Red Dead Redemption 2 Wiki Guides and Walkthroughs | Database',
    url: 'https://rankedboost.com/red-dead-redemption-2/wiki-guides/' },
  { source: 'RDR2.org',
    title: 'Red Dead Redemption 2 Wiki',
    url: 'https://www.rdr2.org/wiki/' },
  { source: 'JimmyJames86',
    title: 'RDR2 Hunting and Crafting Guide (story mode)',
    url: 'https://www.reddit.com/r/reddeadredemption/comments/kunnbu/rdr2_hunting_and_crafting_guide_story_mode/' },
];

export function mount(root) {
  root.innerHTML = `
    <div class="settings">
      <section class="panel">
        <h3>Personalize and General</h3>
        <p class="note">
          <strong>Personalize</strong> folds in what you own: cards show what
          you have against what a vendor wants, recipes can be crafted, and
          anything crafted or skipped drops out of the way.<br>
          <strong>General</strong> ignores all of it and shows the reference
          data whole -- every recipe, every material, every quantity.</p>
        <div class="panel-actions">
          <button type="button" class="ghost-btn" id="s-mode"></button>
        </div>
      </section>

      <section class="panel">
        <h3>Appearance</h3>
        <p class="note">The same five colours either way -- the game's own --
          laid on paper or on leather. Remembered on this device only, since
          the right one depends on where you are reading it.</p>
        <div class="segmented" role="tablist" id="s-theme">
          ${theme.THEMES.map((t) => `
            <button type="button" role="tab" data-theme="${esc(t.id)}"
                    aria-selected="false">${esc(t.label)}</button>`).join('')}
        </div>
      </section>

      <section class="panel">
        <h3>Your data</h3>
        <dl class="facts" id="s-facts"></dl>
        <p class="note" id="s-last"></p>
      </section>

      <section class="panel">
        <h3>Take it with you</h3>
        <p class="note">Everything you have logged, as one text file. Keep it
          somewhere safe -- clearing this site's data erases the original.</p>
        <div class="panel-actions">
          <button type="button" class="more-btn" id="s-download">Download</button>
          <button type="button" class="ghost-btn" id="s-copy">Copy to clipboard</button>
        </div>
      </section>

      <section class="panel">
        <h3>Bring it back</h3>
        <p class="note">Reading a file <strong>replaces</strong> what is on this
          device. Nothing is written until you confirm.</p>
        <div class="panel-actions">
          <label class="ghost-btn file-btn">Choose a file
            <input type="file" id="s-file" accept=".json,application/json" hidden>
          </label>
        </div>
        <details class="paste">
          <summary>or paste it instead</summary>
          <textarea id="s-paste" rows="4" spellcheck="false"
                    placeholder="Paste the contents of an export…"></textarea>
          <button type="button" class="ghost-btn" id="s-read">Read this</button>
        </details>
        <div id="s-preview"></div>
      </section>

      <section class="panel">
        <h3>Offline</h3>
        <p class="note" id="s-offline">Checking…</p>
        <div class="panel-actions">
          <button type="button" class="ghost-btn" id="s-update">Check for updates</button>
        </div>
      </section>

      <section class="panel danger">
        <h3>Erase everything</h3>
        <p class="note">Removes every ledger entry and every recipe you have
          marked. The reference data is untouched. This cannot be undone --
          download a copy first.</p>
        <div class="panel-actions" id="s-danger">
          <button type="button" class="ghost-btn" id="s-reset">Erase my data</button>
        </div>
      </section>

      <section class="panel">
        <h3>About</h3>
        <dl class="facts" id="s-about"></dl>
      </section>

      <section class="panel">
        <h3>References</h3>
        <p class="note">Where the reference data came from. None of this is
          mine; the guide is only the table they add up to.</p>
        <ul class="refs">
          ${REFERENCES.map((r) => `
            <li><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer"
                   >${esc(r.title)}<small>${esc(r.source)}</small></a></li>`).join('')}
        </ul>
      </section>
    </div>`;

  const $ = (sel) => root.querySelector(sel);
  const preview = $('#s-preview');
  const ledger = ledgerDialog();

  $('#s-facts').addEventListener('click', (event) => {
    if (event.target.closest('[data-ledger]')) ledger.open();
  });
  let pending = null;          // text waiting for a confirmed import

  // ---- the file itself ------------------------------------------------

  $('#s-download').addEventListener('click', () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `rdr2-inventory-${stamp}.json`;
    link.click();
    URL.revokeObjectURL(url);

    prefs.set(LAST_EXPORT, new Date().toISOString());
    update();
    toast(`Saved rdr2-inventory-${stamp}.json`);
  });

  // The download attribute is unreliable on iOS, so there is always
  // a way to get the text out by hand.
  $('#s-copy').addEventListener('click', async () => {
    const text = store.exportJSON();
    try {
      await navigator.clipboard.writeText(text);
      prefs.set(LAST_EXPORT, new Date().toISOString());
      update();
      toast('Copied. Paste it somewhere safe.');
    } catch {
      toast('This browser would not let the page copy. Use Download.');
    }
  });

  $('#s-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    offer(await file.text(), file.name);
    event.target.value = '';            // so the same file can be picked twice
  });

  $('#s-read').addEventListener('click', () => {
    const text = $('#s-paste').value.trim();
    if (text) offer(text, 'pasted text');
  });

  /** Say what the file holds, and what replacing would cost. */
  function offer(text, source) {
    const found = store.inspectImport(text);
    const now = store.stats();

    if (found.fatal) {
      pending = null;
      preview.innerHTML = `<div class="verdict bad">
        <p>${esc(found.fatal)}</p></div>`;
      return;
    }

    pending = text;
    const when = found.exported_at
      ? new Date(found.exported_at).toLocaleDateString()
      : 'an unknown date';

    preview.innerHTML = `
      <div class="verdict">
        <p><strong>${esc(source)}</strong> holds
          ${found.ledger} ${found.ledger === 1 ? 'entry' : 'entries'} and
          ${found.targets} marked ${found.targets === 1 ? 'recipe' : 'recipes'},
          exported ${esc(when)}.</p>
        <p>This device has ${now.entries} ${now.entries === 1 ? 'entry' : 'entries'}
          and ${now.made + now.skipped} marked. All of it will be replaced.</p>
        ${found.problems.length
          ? `<ul class="problems">${found.problems
              .map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`
          : ''}
        <div class="panel-actions">
          <button type="button" class="more-btn" id="s-confirm">Replace my data</button>
          <button type="button" class="ghost-btn" id="s-cancel">Cancel</button>
        </div>
      </div>`;
  }

  preview.addEventListener('click', async (event) => {
    if (event.target.id === 's-cancel') {
      pending = null;
      preview.innerHTML = '';
    } else if (event.target.id === 's-confirm' && pending) {
      const found = await store.importJSON(pending);
      pending = null;
      preview.innerHTML = '';
      $('#s-paste').value = '';
      toast(`Loaded ${found.ledger} ${found.ledger === 1 ? 'entry' : 'entries'}.`);
    }
  });

  // ---- mode, offline, erase -------------------------------------------

  // ---- appearance -----------------------------------------------------

  const themeBar = $('#s-theme');

  function paintThemeButtons() {
    const on = theme.current();
    for (const button of themeBar.querySelectorAll('button')) {
      button.setAttribute('aria-selected', String(button.dataset.theme === on));
    }
  }

  themeBar.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-theme]');
    if (!button) return;
    theme.set(button.dataset.theme);
    paintThemeButtons();
  });

  paintThemeButtons();

  // The masthead switch repaints itself off the same store change.
  $('#s-mode').addEventListener('click', () => store.setPersonal(!store.isPersonal()));

  $('#s-update').addEventListener('click', async () => {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (!registration) return toast('Offline caching is not running.');
    await registration.update();
    toast('Checked. Any update installs on the next reload.');
  });

  // Erasing asks twice, in place, rather than through a dialog box.
  $('#s-danger').addEventListener('click', async (event) => {
    if (event.target.id === 's-reset') {
      event.currentTarget.innerHTML = `
        <span class="state-label">Erase ${store.stats().entries} entries?</span>
        <button type="button" class="ghost-btn" id="s-reset-no">Keep it</button>
        <button type="button" class="more-btn danger-btn" id="s-reset-yes">Erase</button>`;
    } else if (event.target.id === 's-reset-no') {
      resetDanger();
    } else if (event.target.id === 's-reset-yes') {
      await store.reset();
      resetDanger();
      toast('Erased.');
    }
  });

  function resetDanger() {
    $('#s-danger').innerHTML =
      '<button type="button" class="ghost-btn" id="s-reset">Erase my data</button>';
  }

  // ---- what the page reports -------------------------------------------

  function update() {
    const s = store.stats();


    $('#s-facts').innerHTML = facts([
      ['Ledger entries', s.entries, 'ledger'],
      ['Materials held', s.materials
        ? `${plural(s.materials, 'kind')} in ${plural(s.held, 'place')}`
        : 'nothing yet'],
      ['Recipes crafted', s.made],
      ['Recipes skipped', s.skipped],
    ]);

    const last = prefs.get(LAST_EXPORT);
    $('#s-last').textContent = last
      ? `Last exported ${new Date(last).toLocaleString()}.`
      : 'Never exported from this device.';

    $('#s-mode').textContent = store.isPersonal()
      ? 'Switch to General' : 'Switch to Personalize';

    $('#s-about').innerHTML = facts([
      ['Reference data', s.referenceBuild ? `built ${s.referenceBuild}` : 'unknown'],
      ['Stored in', 'this browser only -- nothing is uploaded'],
    ]);

    reportOffline();
    ledger.refresh();
  }

  async function reportOffline() {
    const target = $('#s-offline');
    if (!('serviceWorker' in navigator)) {
      target.textContent = 'This browser cannot cache the app for offline use.';
      return;
    }
    const names = await caches.keys();
    const mine = names.filter((n) => n.startsWith('rdr2-'));

    target.textContent = navigator.serviceWorker.controller
      ? `Cached and ready to use without a signal${
          mine.length ? ` (${mine[0]})` : ''}.`
      : 'Not cached yet -- reload once while online.';
  }

  // A term with an `opens` becomes the button that opens its dialog.
  function facts(pairs) {
    return pairs.map(([term, value, opens]) => `
      <div>
        <dt>${opens
          ? `<button type="button" class="fact-open" data-${esc(opens)}
                     aria-haspopup="dialog">${esc(term)}</button>`
          : esc(term)}</dt>
        <dd>${esc(value)}</dd>
      </div>`).join('');
  }

  update();
  return { update, destroy: ledger.destroy };
}

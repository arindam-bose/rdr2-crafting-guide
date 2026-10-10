// ============================================================
// Google Analytics: page visits, counted -- with consent.
//
// Nothing of Google's loads until the visitor says yes.  Until then
// a banner asks, on every page; the answer is kept in localStorage,
// and "Cookie settings" (any [data-consent-open] button: the
// footer's, the Settings row) brings the banner back to change it.
// Declining after accepting switches GA off for the rest of the
// visit and deletes its cookies.
//
// A file rather than Google's usual inline snippet, so the policy
// in <head> need not carry another hash; loaded with `defer`, so it
// never holds up the first paint.  gtag.js itself comes from
// googletagmanager.com, which the policy lets through along with
// what it reports to -- nothing else.
//
// What you log never reaches it: the inventory lives in IndexedDB,
// which this does not read.
//
// Settings listens for 'rdr2:consent' on window to repaint its row,
// and reads the answer through self.rdr2Consent.get().
// ============================================================

(() => {
  const ID = 'G-L8GJLNDBHJ';
  const KEY = 'rdr2:analytics-consent';      // 'granted' | 'denied'

  // Guarded as prefs.js guards it: storage can throw outright.  Held
  // here too, so the answer still takes for the visit where it cannot
  // be stored.
  let answer = null;
  try { answer = localStorage.getItem(KEY); } catch { /* blocked */ }

  let loaded = false;
  function load() {
    window[`ga-disable-${ID}`] = false;
    if (loaded) return;
    loaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() { dataLayer.push(arguments); };
    gtag('js', new Date());
    gtag('config', ID);
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${ID}`;
    document.head.append(script);
  }

  // GA's cookies are set on the widest domain it can, so each is
  // cleared on every parent of this host.
  function forget() {
    window[`ga-disable-${ID}`] = true;
    const names = document.cookie.split(';').map((c) => c.split('=')[0].trim())
      .filter((n) => n === '_ga' || n.startsWith('_ga_'));
    const parts = location.hostname.split('.');
    for (const name of names) {
      for (let i = 0; i < parts.length; i++) {
        const domain = parts.slice(i).join('.');
        document.cookie = `${name}=; Max-Age=0; path=/; domain=${domain}`;
      }
      document.cookie = `${name}=; Max-Age=0; path=/`;
    }
  }

  function choose(value) {
    answer = value;
    try { localStorage.setItem(KEY, value); } catch { /* the visit keeps it */ }
    if (value === 'granted') load();
    else forget();
    hide();
    window.dispatchEvent(new CustomEvent('rdr2:consent', { detail: value }));
  }

  let banner = null;
  function show() {
    if (banner) return banner.querySelector('button').focus();
    banner = document.createElement('section');
    banner.className = 'consent';
    banner.setAttribute('aria-label', 'Cookie consent');
    banner.innerHTML = `
      <p class="consent-text"><strong>May we count your visit?</strong>
        Google Analytics would set cookies to count visits to this site.
        It never sees what you log in the guide, and nothing loads unless
        you say yes. Every feature works either way, and you can change
        your mind any time in Settings.</p>
      <div class="consent-actions">
        <button type="button" class="ghost-btn" data-choice="denied">Decline</button>
        <button type="button" class="more-btn" data-choice="granted">Accept</button>
      </div>`;
    banner.addEventListener('click', (event) => {
      const button = event.target.closest('[data-choice]');
      if (button) choose(button.dataset.choice);
    });
    document.body.append(banner);
  }

  function hide() {
    banner?.remove();
    banner = null;
  }

  // Delegated, so a button drawn after this ran -- the Settings row is
  // rebuilt with its page -- still opens the banner.
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-consent-open]')) show();
  });

  self.rdr2Consent = { get: () => answer, open: show };

  if (answer === 'granted') load();
  else if (answer !== 'denied') show();
})();

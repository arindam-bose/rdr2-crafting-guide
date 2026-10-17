// ============================================================
// Back and Forward, for the installed app.
//
// Opened from the home screen, the guide has no browser toolbar,
// so no Back -- this draws its own: a pill at the left, above the
// tabs.  In a browser tab the browser's own are right there, so it
// draws nothing.  A plain script, not a module, so the app and the
// search pages (materials/, recipes/, written by build_pages.py)
// can both load it -- one pill, carried from page to page.
//
// The browser's history is already the stack; what a page cannot ask
// it is whether there is anywhere to go.  So every entry is numbered
// as it is first arrived at, in its state's `at`, and the furthest
// number reached is kept: Back has somewhere to go above 0, Forward
// below the furthest.  A new entry cuts off everything ahead of it,
// as the browser does, so it becomes the furthest.  Both numbers are
// kept in sessionStorage, which is what carries them across a search
// page and the app; without it, a new page starts the count again.
//
// Anything that writes over an entry's state carries `at` across
// (see js/nav.js), or the entry would be taken for a new one on the
// way back.  The app calls historyNav.arrived() after a pushState,
// which no event announces.
// ============================================================

(() => {
  const HERE = 'history-here';
  const FURTHEST = 'history-furthest';

  // What another page wrote, or `fallback` when nothing was (or
  // storage is shut).
  const read = (key, fallback) => {
    try {
      const v = sessionStorage.getItem(key);
      return v !== null && Number.isInteger(Number(v)) ? Number(v) : fallback;
    } catch { return fallback; }
  };
  const write = (key, n) => {
    try { sessionStorage.setItem(key, String(n)); } catch {}
  };

  let here = -1;
  let furthest = -1;
  let back = null;
  let forward = null;

  /**
   * Number the entry the reader is on, if it is new, and repaint.
   * The counts are read afresh each time, not trusted from memory: a
   * page brought back from the back-forward cache remembers them as
   * they were when it was left, before the pages after it counted on.
   */
  function arrived() {
    here = read(HERE, here);
    furthest = read(FURTHEST, furthest);
    const at = history.state?.at;
    if (Number.isInteger(at)) {
      here = at;
    } else {
      here += 1;
      furthest = here;
      history.replaceState({ ...history.state, at: here }, '');
    }
    if (here > furthest) furthest = here;
    write(HERE, here);
    write(FURTHEST, furthest);
    paint();
  }

  function paint() {
    if (!back) return;
    back.disabled = here <= 0;
    forward.disabled = here >= furthest;
  }

  function button(label, path) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
    return b;
  }

  function draw() {
    const nav = document.createElement('nav');
    nav.className = 'history-nav';
    nav.setAttribute('aria-label', 'History');
    back = button('Back', 'M15 5l-7 7 7 7');
    forward = button('Forward', 'M9 5l7 7-7 7');
    back.addEventListener('click', () => history.back());
    forward.addEventListener('click', () => history.forward());
    nav.append(back, forward);
    document.body.append(nav);
    paint();
  }

  const installed = matchMedia('(display-mode: standalone)').matches
    || navigator.standalone === true;

  // Numbered whether or not the pill shows: harmless in a browser tab,
  // and one path either way.
  arrived();
  if (installed) {
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', draw);
    else draw();
  }

  addEventListener('hashchange', arrived);
  addEventListener('popstate', arrived);
  // A page brought back from the back-forward cache runs no script
  // again, so it is told here which entry it has come back as.
  addEventListener('pageshow', (event) => { if (event.persisted) arrived(); });

  self.historyNav = { arrived };
})();

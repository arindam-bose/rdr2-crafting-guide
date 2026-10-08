// ============================================================
// Which browser, on which system.
//
// A page is never told the device's own name, so this is what it
// can know: the browser and the system, read from the user-agent
// string.  Backups are labelled with it ("Firefox on Android"), and
// Settings uses it to give the steps for putting the guide on this
// device's home screen.
//
// Edge, Opera and Samsung's browser all claim to be Chrome as well,
// so they are asked first; Chrome claims to be Safari, so Safari is
// asked last.
// ============================================================

/** { browser, system }, either null when it cannot be made out. */
export function detect() {
  const ua = navigator.userAgent;
  const browser = /Edg(e|A|iOS)?\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\/|FxiOS/.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS/.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : null;
  // An iPad asks for the desktop site and says it is a Mac; a touch
  // screen gives it away.
  const system = /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Macintosh/.test(ua) ? 'Mac'
    : /Linux/.test(ua) ? 'Linux'
    : null;
  return { browser, system };
}

/** "Firefox on Android", "Safari on iPhone" -- or null if neither is known. */
export function label() {
  const { browser, system } = detect();
  if (!browser && !system) return null;
  return [browser ?? 'A browser', system && `on ${system}`].filter(Boolean).join(' ');
}

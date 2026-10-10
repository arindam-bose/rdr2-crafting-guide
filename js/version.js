// ============================================================
// The tool's version -- the one place a release is numbered.
//
// x.0.y: x is the GitHub release, y the build within it.  Every
// change that ships bumps y; cutting a release bumps x and starts y
// again at 1 (1.0.7 -> 2.0.1).  The middle figure stays 0.
//
// A plain script rather than a module, so the service worker can
// load it too (importScripts) and name its cache after it: bumping
// `number` here is what renews everyone's offline copy.  The
// masthead shows it beside the name, and the Settings page reads
// both fields for its "Tool version" line.  Bump it, and set `date`,
// with every change that ships -- and always with a new rdr2.db,
// which the offline copy otherwise keeps serving.
// ============================================================

self.APP_VERSION = { number: '1.0.1', date: '2026-10-10' };

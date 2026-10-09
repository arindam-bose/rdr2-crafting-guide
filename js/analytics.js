// ============================================================
// Google Analytics: page visits, counted.
//
// A file rather than Google's usual inline snippet, so the policy
// in <head> need not carry another hash.  gtag.js itself loads from
// googletagmanager.com, beside this, and the policy lets that one
// script, and what it reports to, through -- nothing else.
//
// What you log never reaches it: the inventory lives in IndexedDB,
// which this does not read.
// ============================================================

window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag('js', new Date());
gtag('config', 'G-L8GJLNDBHJ');

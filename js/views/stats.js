// ============================================================
// Your stats — the scoreboard, as a dialog opened from Settings.
//
// Out of the Settings page and into a dialog of its own, opened
// from the About tile: the page is for controls, and two long
// tallies under them made it the tallest thing there.
//
// Read-only, and repainted on every store change while it is open,
// so crafting with it up keeps the numbers true.  Its "Ledger
// entries" count opens the ledger on top of it.
// ============================================================

import * as store from '../store.js';
import { detailHead, detailSection, facts, plural, icon, stationIcon,
         stationColour, money, tallyRow } from '../render.js';
import { detailDialog } from '../dialog.js';

// recipes.category is stored singular -- "Boot", not "Boots" -- so the
// Recipes page filter reads as one kind of thing.  A tally here is a
// count of several, so this dialog pluralises on the way out instead;
// irregular ones (a word ending in a consonant then "y") are listed,
// everything else just takes an "s".  A category already plural (a
// campfire one, such as "Hunting Accessories", though byCategory does
// not show those today) is left alone rather than doubled up.
const CATEGORY_PLURAL = {
  Accessory: 'Accessories',
};

function pluralCategory(category) {
  if (!category) return category;
  const words = category.split(' ');
  const last = words.pop();
  const plural = last.endsWith('s') ? last : CATEGORY_PLURAL[last] ?? `${last}s`;
  return [...words, plural].join(' ');
}

/**
 * The stats dialog.  Returns { open, refresh, destroy }, like the
 * ledger's; `ledger` is the ledger dialog its entry count opens.
 */
export function statsDialog(ledger) {
  const dialog = detailDialog({
    render,
    onClick(event) {
      if (event.target.closest('[data-ledger]')) ledger.open();
    },
  });

  function render() {
    const s = store.stats();

    return `
      ${detailHead('Your data', 'Your stats')}

      <dl class="facts">${facts([
        ['Ledger entries', s.entries, 'ledger'],
        ['Materials held', s.materials
          ? `${plural(s.materials, 'kind')} in ${plural(s.places, 'place')}`
          : 'nothing yet'],
        ['Recipes crafted', `${s.made}/${s.vendorRecipes}`],
        ['Spent crafting', money(s.spentCents)],
        ['Outfits completed', `${s.outfitsDone} of ${s.outfits}`],
      ])}</dl>

      ${detailSection('By vendor', `<div class="demands">${
        s.byVendor.map((v) => progressRow(v.station, v.made, v.total,
          { colour: stationColour(v.color), mark: icon(stationIcon(v.station_id)) })).join('')
      }</div>`)}

      ${detailSection('By category', `<div class="stat-grid">${
        s.byCategory.map((c) =>
          progressRow(pluralCategory(c.category), c.made, c.total)).join('')
      }</div>`)}`;
  }

  return {
    open: () => dialog.open('stats'),
    refresh: dialog.refresh,
    destroy: dialog.destroy,
  };
}

/** A made/total tally, with its bar -- `mark` the vendor's icon, where there is one. */
function progressRow(label, made, total, { colour = '', mark = '' } = {}) {
  return tallyRow({
    label, mark, colour, count: made, total, countClass: made ? 'have' : '',
    aria: `${made} of ${total} crafted for ${label}`,
    pct: total ? Math.round((made / total) * 100) : 0,
  });
}

// ============================================================
// Card templates.
//
// Everything here returns an HTML string and touches no state,
// so a view is a query plus a join of these.  Anything from the
// database goes through esc() on the way in.
// ============================================================

import * as nav from './nav.js';

/**
 * A name that is also somewhere to go: the recipes on a material's
 * card, the materials on a recipe's.  A real anchor with a real
 * href, so it can be middle-clicked, copied, and tabbed to, and so
 * the page it lands on can be arrived at cold from a bookmark.
 */
export function crossLink(route, id, text) {
  return `<a class="xlink" href="${esc(nav.href(route, id))}">${esc(text)}</a>`;
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/**
 * The quality chip beside a material's name.  Three screens show a
 * material by name -- a card, a recipe's ingredient list, an inventory
 * row -- and all three mark quality the same way.
 */
export function qualityBadge(quality) {
  if (!quality) return '';
  const legendary = quality === 'Legendary' ? ' legendary' : '';
  return `<span class="badge${legendary}">${esc(quality)}</span>`;
}

/**
 * A station as a chip, the same shape as the quality one, in the
 * station's own colour -- the one its stripe and demand rows use.
 */
export function stationBadge(name, colour) {
  if (!name) return '';
  return `<span class="badge station ${stationColour(colour)}">${esc(name)}</span>`;
}

/** "1 material", "2 materials", "3 matches". */
export function plural(n, word, suffix = 's') {
  return `${n} ${word}${n === 1 ? '' : suffix}`;
}

/**
 * A station's colour, as the database spells it.  Guarded because it
 * reaches the stylesheet as a class name, and only these three have a
 * rule behind them.
 */
export function stationColour(colour) {
  return ['blue', 'yellow', 'pink'].includes(colour) ? colour : '';
}

/**
 * How many recipes a material card lists before it offers the rest.
 * Only five materials in the reference data go past this.
 */
const USAGE_SHOWN = 6;

/**
 * One material: what it goes into and which stations still want it.
 * Where it comes from and the verdict live in the detail view, which
 * the whole card opens.
 *
 *   material = { ingredient_id, material, quality, source_type,
 *                animal, weapon, body_part, demands: [...],
 *                usage: [...] }
 *
 * `personal` decides whether the card talks about what you have, and
 * `expanded` whether its "used in" list is showing every entry.
 */
export function materialCard(material, { personal, expanded = false }) {
  const { material: name, quality } = material;

  const open = material.demands.filter((d) => d.needed > 0);

  // The name is a real button, so the card opens from the keyboard
  // too; a click anywhere else on the card is forwarded to it.
  return `
    <article class="card material" data-ingredient="${esc(material.ingredient_id)}">
      <h3><button type="button" class="card-open" data-open
            aria-haspopup="dialog">${esc(name)}</button>${qualityBadge(quality)}</h3>

      ${usedIn(material.usage, personal, expanded)}

      ${open.length ? `
        <p class="list-label card-label">Vendors</p>
        <div class="demands">${open.map((d) => demandRow(d, personal)).join('')}</div>`
        : ''}
    </article>`;
}

// ------------------------------------------------------------
// detail dialogs
//
// The pieces every dialog body is built from, so the three that
// exist -- a material, a recipe, the ledger -- are laid out alike.
// ------------------------------------------------------------

/**
 * A dialog's heading: a kicker over the title, anything that belongs
 * in the corner (the recipe's want switch), and the close button that
 * dialog.js listens for.
 */
export function detailHead(kicker, title, aside = '') {
  return `
    <header class="detail-head">
      <div>
        <p class="detail-kicker">${esc(kicker)}</p>
        <h2 id="detail-title">${esc(title)}</h2>
      </div>
      ${aside}
      <button type="button" class="detail-close" data-close
              aria-label="Close">&times;</button>
    </header>`;
}

/**
 * The grid of facts under a heading.  Values are HTML, already
 * escaped, since some of them are tags; a pair with no value is
 * left out rather than shown empty.
 */
export function traits(pairs) {
  const shown = pairs.filter(([, value]) => value);
  if (!shown.length) return '';
  return `
    <dl class="traits">
      ${shown.map(([label, value]) => `
        <div class="trait"><dt>${esc(label)}</dt><dd>${value}</dd></div>`).join('')}
    </dl>`;
}

/** A captioned block of a dialog; nothing at all when it has no body. */
export function detailSection(title, body) {
  if (!body) return '';
  return `
    <section class="detail-section">
      <h3 class="list-label">${esc(title)}</h3>
      ${body}
    </section>`;
}

// ------------------------------------------------------------
// locations
//
// The Satchel is a bag, so things are in it; the Trapper and
// Pearson are people, so things are with them.  Every screen that
// names a location says it the same way.
// ------------------------------------------------------------

const SATCHEL = 'loc-satchel';

/** "the Satchel", "Pearson" -- a location as the object of a sentence. */
export function placeName(id, name) {
  return id === SATCHEL ? `the ${name}` : name;
}

/** "In the Satchel", "With Pearson" -- where something is being held. */
export function heldAt(id, name) {
  return `${id === SATCHEL ? 'In' : 'With'} ${placeName(id, name)}`;
}

/**
 * The same material, opened: every fact the database has about it, laid
 * out for reading rather than scanning, with a stepper per station so
 * what you just brought in can be logged without leaving the page.
 */
export function materialDetail(material, { personal }) {
  const { material: name, quality, source_type, animal, weapon, body_part } = material;
  const isAnimal = source_type === 'animal';

  const facts = isAnimal
    ? [['Animal', esc(animal)], ['Quality', qualityBadge(quality)],
       ['Type', esc(body_part)], ['Weapon', esc(weapon)]]
    : [['Source', 'Found out in the world'], ['Quality', qualityBadge(quality)]];

  // Stations with nothing left to make still show in personal mode --
  // faded, as "needs no more" -- because you may be holding some there
  // to sell.
  const demands = personal
    ? material.demands
    : material.demands.filter((d) => d.needed > 0);

  return `
    ${detailHead(isAnimal ? 'Animal material' : 'Misc. item', name)}
    ${traits(facts)}
    ${detailSection('Recipes used in', material.usage.length && `
      <ul class="detail-list detail-recipes">
        ${material.usage.map((u) => recipeLine(u, personal)).join('')}
      </ul>`)}
    ${detailSection('Vendors', demands.length && `
      <div class="detail-stock">
        ${demands.map((d) => stockLine(d, personal)).join('')}
      </div>`)}
    ${detailSection('Comments', verdict(material, personal))}`;
}

/** "2x for " when a recipe takes more than one of this; nothing for one. */
function forQty(qty) {
  return qty > 1 ? `${qty}x for ` : '';
}

/** One recipe in the detail view, with its state spelled out. */
function recipeLine(u, personal) {
  // The same three words Recipes uses for the same three states, so a
  // recipe does not change its name on the way across.
  const [state, label] = !personal ? ['plain', '']
    : u.state === 'done' ? ['made', 'Crafted']
    : u.state === 'skipped' ? ['retired', 'Skipped']
    : ['open', 'Not crafted'];

  return `
    <li class="${state}">
      <span class="what">${forQty(u.qty)}${
        crossLink('recipes', u.recipe_id, u.recipe)}
        <small>${esc(u.station)}</small></span>
      ${label ? `<span class="state">${label}</span>` : ''}
    </li>`;
}

/**
 * One station in the detail view: what it asks for, what you hold where
 * it draws from, and a stepper that writes straight to that location.
 * The Fence is the odd one -- it sells at its own counter but spends
 * from your Satchel -- so the location is named whenever it differs.
 * The row carries only its location; the view knows the material.
 */
function stockLine(d, personal) {
  const colour = stationColour(d.color);
  const place = placeName(d.location_id, d.location);
  const where = d.location && d.location !== d.station
    ? `<small class="from">from your ${esc(d.location)}</small>` : '';

  if (!personal) {
    return `
      <div class="stock-line demand ${colour}">
        <span class="stock-text"><span class="station">${esc(d.station)}</span>
          needs ${d.needed}${where}</span>
      </div>`;
  }

  const enough = d.have >= d.needed;
  const retired = d.needed === 0;
  const needs = retired ? 'needs no more' : `needs ${d.needed}`;

  return `
    <div class="stock-line demand ${colour}${retired ? ' retired' : ''}"
         data-location="${esc(d.location_id)}">
      <span class="stock-text"><span class="station">${esc(d.station)}</span>
        ${needs}, has <span class="${enough ? 'have' : 'short'}">${d.have}</span>${where}</span>
      <span class="stepper">
        <button type="button" data-delta="-1" data-key="${esc(d.location_id)}-less"
                ${d.have <= 0 ? 'disabled' : ''}
                aria-label="One fewer with ${esc(place)}">-</button>
        <button type="button" class="add" data-delta="1" data-key="${esc(d.location_id)}-more"
                aria-label="Add one to ${esc(place)}">+ Add to ${esc(d.location)}</button>
      </span>
    </div>`;
}

/**
 * The Comments line in the detail view, carried over from the formula the
 * Notion table used.  Two numbers decide it:
 *
 *   totalNeeded  what the recipes you still intend to make ask for.
 *                A made or skipped recipe stops asking, so this falls
 *                to zero once you are finished with a material.
 *   moreNeeded   totalNeeded minus what you are holding.  Negative
 *                means you have more than anything still wants.
 *
 * Both sum across the station rows above it, so the line can never
 * contradict them.  Each station draws on its own
 * location -- the Fence on your Satchel, the Trapper on the Trapper --
 * so nothing is counted twice.
 *
 * Animal materials and misc items had separate formulas in Notion and
 * keep them here: only animals get the "done with this item" case, and
 * the two word a surplus differently.
 */
function verdict(material, personal) {
  // Without a personal layer there is no "have", so there is nothing
  // to weigh what the stations want against.
  if (!personal) return '';

  const totalNeeded = material.demands.reduce((n, d) => n + d.needed, 0);
  const have = material.demands.reduce((n, d) => n + d.have, 0);
  const moreNeeded = totalNeeded - have;
  const animal = material.source_type === 'animal';

  const [state, words] =
    animal && totalNeeded === 0
      ? ['done', "You are done with this item, you don't need more!!"]
    : moreNeeded === 0
      ? ['enough', 'You have what you need!']
    : moreNeeded > 0
      ? ['short', animal ? 'You need to go hunting!' : 'You need to go find it!']
    : animal
      ? ['spare', "You're already golden! If you have more, sell them to Butcher!!"]
      : ['spare', 'You may sell the rest!'];

  return `<p class="hint ${state}">${words}</p>`;
}

/** The recipes a material goes into, each with its tick or cross. */
function usedIn(usage = [], personal, expanded = false) {
  if (!usage.length) return '';

  const shown = expanded ? usage : usage.slice(0, USAGE_SHOWN);
  const rest = usage.length - shown.length;
  const over = usage.length > USAGE_SHOWN;

  const line = (u) => {
    const state = !personal ? 'plain'
      : u.state === 'done' ? 'made'
      : u.state === 'skipped' ? 'retired'
      : 'open';
    // These four are icons, not type.  Each sits alone in a .mark span
    // with its own font stack, so the typewriter face not having them is
    // contained -- unlike a gap in the middle of a word.
    const mark = { made: '\u2713', retired: '\u2013', open: '\u2717', plain: '\u00b7' }[state];

    return `<li class="${state}">
      <span class="mark" aria-hidden="true">${mark}</span>
      <span class="what">${forQty(u.qty)}${
        crossLink('recipes', u.recipe_id, u.recipe)}</span>
    </li>`;
  };

  // Rare -- five materials reach it -- but on those five the tail is
  // most of the list, and a card ending in "and 6 more" with no way to
  // read them is the card failing at its one job.
  const toggle = !over ? '' : `
    <li class="more">
      <button type="button" class="more-link" data-expand
              aria-expanded="${expanded}">${
        expanded ? 'Show fewer' : `and ${rest} more`}</button>
    </li>`;

  // Captioned: with a single entry -- which is every misc material,
  // each feeding exactly one talisman -- an unlabelled line under the
  // demand rows reads as another demand row, not as a list.
  return `
    <p class="list-label card-label">Used in</p>
    <ul class="used-in">
      ${shown.map(line).join('')}
      ${toggle}
    </ul>`;
}

/**
 * One station's demand for this material, and how close you are:
 * "Pearson: 0/2", the station's colour down the left edge.
 */
function demandRow(d, personal) {
  const colour = stationColour(d.color);

  if (!personal) {
    return `
      <div class="demand ${colour}">
        <span class="station">${esc(d.station)}:</span>
        <span class="qty">${d.needed}</span>
        <span></span>
      </div>`;
  }

  const enough = d.have >= d.needed;
  const pct = d.needed ? Math.min(100, Math.round((d.have / d.needed) * 100)) : 100;

  return `
    <div class="demand ${colour}">
      <span class="station">${esc(d.station)}:</span>
      <span class="qty">
        <span class="${enough ? 'have' : 'short'}">${d.have}</span>/${d.needed}
      </span>
      <span class="bar ${enough ? '' : 'short'}"
            role="img" aria-label="${d.have} of ${d.needed} for ${esc(d.station)}"
        ><i style="width:${pct}%"></i></span>
    </div>`;
}

/**
 * How many cards a gallery shows before you ask for more.  Both
 * galleries run to three figures, and a phone rendering 165 cards
 * to show you the first four is work nobody asked for.
 */
export const PAGE = 20;

/** The control under a gallery.  Absent when everything fits. */
export function pager(shown, total) {
  if (total <= PAGE) return '';

  const next = Math.min(PAGE, total - shown);

  return `
    <div class="pager">
      <span class="pager-count">${Math.min(shown, total)} of ${total}</span>
      ${next > 0
        ? `<button type="button" class="more-btn" data-page="more" data-key="page-more"
             >Show ${next} more</button>`
        : ''}
      ${shown > PAGE
        ? '<button type="button" class="ghost-btn" data-page="less" data-key="page-less">Show less</button>'
        : ''}
    </div>`;
}

export function empty(message) {
  return `<p class="empty">${esc(message)}</p>`;
}

export function errorBox(err) {
  return `
    <div class="error">
      <h2>That didn't load.</h2>
      <p>${esc(err.message || err)}</p>
    </div>`;
}

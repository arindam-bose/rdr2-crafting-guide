// ============================================================
// Card templates.
//
// Everything here returns an HTML string and touches no state,
// so a view is a query plus a join of these.  Anything from the
// database goes through esc() on the way in.
// ============================================================

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
 * One material: where it comes from, which stations still want it,
 * and what it goes into.
 *
 *   material = { ingredient_id, material, quality, source_type,
 *                animal, weapon, body_part, demands: [...],
 *                usage: [...] }
 *
 * `personal` decides whether the card talks about what you have, and
 * `expanded` whether its "used in" list is showing every entry.
 */
export function materialCard(material, { personal, expanded = false }) {
  const { material: name, quality, source_type, animal, weapon, body_part } = material;

  // Where it comes from.  The database knows the animal and the
  // weapon that leaves a pelt unspoiled, which is the actionable half.
  const origin = source_type === 'animal'
    ? [animal && esc(animal), weapon && `with the ${esc(weapon)}`]
        .filter(Boolean).join(' ')
    : 'Found out in the world';

  const open = material.demands.filter((d) => d.needed > 0);
  const short = personal && open.some((d) => d.have < d.needed);

  const hint = short
    ? `<p class="sub hint">${source_type === 'animal'
        ? 'You need to go hunting!'
        : 'You need to go find it!'}</p>`
    : '';

  return `
    <article class="card" data-ingredient="${esc(material.ingredient_id)}">
      <h3>${esc(name)}${qualityBadge(quality)}</h3>
      <p class="sub">${origin || '&nbsp;'}${
        body_part ? ` - ${esc(body_part)}` : ''}</p>

      ${open.length
        ? `<div class="demands">${open.map((d) => demandRow(d, personal)).join('')}</div>`
        : '<p class="retired-note">Nothing wants this any more.</p>'}

      ${usedIn(material.usage, personal, expanded)}
      ${hint}
    </article>`;
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
      <span class="what">${u.qty > 1 ? `${u.qty}x ` : ''}${esc(u.recipe)}</span>
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
    <p class="list-label used-in-label">Used in</p>
    <ul class="used-in">
      ${shown.map(line).join('')}
      ${toggle}
    </ul>`;
}

/** One station's demand for this material, and how close you are. */
function demandRow(d, personal) {
  const colour = stationColour(d.color);

  if (!personal) {
    return `
      <div class="demand ${colour}">
        <span class="qty">${d.needed}x</span>
        <span class="station">${esc(d.station)}</span>
        <span></span>
      </div>`;
  }

  const enough = d.have >= d.needed;
  const pct = d.needed ? Math.min(100, Math.round((d.have / d.needed) * 100)) : 100;

  return `
    <div class="demand ${colour}">
      <span class="qty">
        <span class="${enough ? 'have' : 'short'}">${d.have}</span>/${d.needed}
      </span>
      <span class="station">${esc(d.station)}</span>
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
        ? `<button type="button" class="more-btn" data-page="more"
             >Show ${next} more</button>`
        : ''}
      ${shown > PAGE
        ? '<button type="button" class="ghost-btn" data-page="less">Show less</button>'
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

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
 * One material, with a row per station that wants it.
 *
 *   material = { ingredient_id, material, quality, source_type,
 *                animal, weapon, body_part, demands: [...] }
 *
 * `personal` decides whether the card talks about what you have.
 */
export function materialCard(material, { personal }) {
  const { material: name, quality, source_type, animal, weapon, body_part } = material;

  const badge = quality
    ? `<span class="badge${quality === 'Legendary' ? ' legendary' : ''}">${esc(quality)}</span>`
    : '';

  // Where it comes from.  The database knows the animal and the
  // weapon that leaves a pelt unspoiled, which is the actionable half.
  const origin = source_type === 'animal'
    ? [animal && esc(animal), weapon && `with the ${esc(weapon)}`]
        .filter(Boolean).join(' ')
    : 'Found out in the world';

  const short = personal && material.demands.some((d) => d.have < d.needed);
  const hint = short
    ? `<p class="sub hint">${source_type === 'animal'
        ? 'You need to go hunting!'
        : 'You need to go find it!'}</p>`
    : '';

  return `
    <article class="card" data-ingredient="${esc(material.ingredient_id)}">
      <h3>${esc(name)}${badge}</h3>
      <p class="sub">${origin || '&nbsp;'}${
        body_part ? ` · ${esc(body_part)}` : ''}</p>
      <div class="demands">
        ${material.demands.map((d) => demandRow(d, personal)).join('')}
      </div>
      ${hint}
    </article>`;
}

function demandRow(d, personal) {
  const color = ['blue', 'yellow', 'pink'].includes(d.color) ? d.color : '';

  if (!personal) {
    return `
      <div class="demand ${color}">
        <span class="qty">${d.needed}&times;</span>
        <span class="station">${esc(d.station)}</span>
        <span></span>
      </div>`;
  }

  const enough = d.have >= d.needed;
  const pct = d.needed ? Math.min(100, Math.round((d.have / d.needed) * 100)) : 100;

  return `
    <div class="demand ${color}">
      <span class="qty">
        <span class="${enough ? 'have' : 'short'}">${d.have}</span>/${d.needed}
      </span>
      <span class="station">${esc(d.station)}</span>
      <span class="bar ${enough ? '' : 'short'}" style="width:52px"
            role="img" aria-label="${d.have} of ${d.needed} for ${esc(d.station)}"
        ><i style="width:${pct}%"></i></span>
    </div>`;
}

export function empty(message) {
  return `<p class="empty">${esc(message)}</p>`;
}

export function placeholder(title, message) {
  return `
    <div class="placeholder">
      <h2>${esc(title)}</h2>
      <p>${esc(message)}</p>
    </div>`;
}

export function errorBox(err) {
  return `
    <div class="error">
      <h2>That didn't load.</h2>
      <p>${esc(err.message || err)}</p>
    </div>`;
}

// ============================================================
// Every read the screens make, as functions.
//
// database/personal_schema.sql sketches four queries; these are
// them, kept close to that SQL, plus the extra columns the cards
// need for display and the ids the views hand back on a tap.
// "What can I craft right now" (query 3) has no function of its
// own: recipeList() counts each recipe's stocked ingredients, and
// a recipe is ready when that count is all of them.
//
// These read.  The one that writes — crafting, query 4 — lives
// in store.js instead, so that every ledger write goes through
// the single path that also persists it.  What stays here is
// `craftSpend`, the SELECT half that says what a craft costs.
// ============================================================

import * as db from './db.js';

// ------------------------------------------------------------
// 1. Material card — "Where to go if you have these items".
//
// Demand is per STATION, stock is per LOCATION: the Fence sells
// from its own counter but draws on your Satchel.  One row per
// (material, station) pair.
// ------------------------------------------------------------
export function materials({ personal = true } = {}) {
  // Open demand is what wanted recipes still ask for; the total is
  // what every recipe asks for, done and skipped included.  Keeping
  // both means a material whose recipes are all finished can still
  // be listed — as retired, rather than vanishing.
  const open = personal
    ? "SUM(CASE WHEN COALESCE(t.state, 'wanted') = 'wanted' THEN ri.qty ELSE 0 END)"
    : 'SUM(ri.qty)';

  return db.all(`
    SELECT     ing.id               AS ingredient_id,
               ing.name             AS material,
               ing.source_type      AS source_type,
               ing.quality          AS quality,
               ing.body_part        AS body_part,
               a.name               AS animal,
               w.name               AS weapon,
               st.id                AS station_id,
               st.name              AS station,
               st.color             AS color,
               loc.id               AS location_id,
               loc.name             AS location,
               ${open}              AS needed,
               COALESCE(inv.qty, 0) AS have
    FROM       recipe_ingredients ri
    JOIN       recipes      r   ON r.id   = ri.recipe_id
    JOIN       stations     st  ON st.id  = r.station_id
    JOIN       locations    loc ON loc.id = st.location_id
    JOIN       ingredients  ing ON ing.id = ri.ingredient_id
    LEFT JOIN  animals      a   ON a.id   = ing.animal_id
    LEFT JOIN  weapons      w   ON w.id   = a.weapon_id
    LEFT JOIN  targets      t   ON t.recipe_id = r.id
    LEFT JOIN  inventory    inv ON inv.ingredient_id = ing.id
                               AND inv.location_id   = st.location_id
    GROUP BY   ing.id, st.id
    ORDER BY   ing.name, st.name
  `);
}

/**
 * What each material is used in: every recipe that calls for it,
 * with the state that decides its tick or cross.  One query for
 * the whole screen, grouped by material in the view.
 */
export function materialUsage() {
  return db.all(`
    SELECT     ri.ingredient_id,
               r.id                        AS recipe_id,
               r.name                      AS recipe,
               ri.qty                      AS qty,
               st.name                     AS station,
               COALESCE(t.state, 'wanted') AS state
    FROM       recipe_ingredients ri
    JOIN       recipes  r  ON r.id  = ri.recipe_id
    JOIN       stations st ON st.id = r.station_id
    LEFT JOIN  targets  t  ON t.recipe_id = r.id
    ORDER BY   r.name
  `);
}

/**
 * The stations, for the filter chips: Pearson, Trapper, Fence, a
 * chosen order rather than the alphabet's.  Anything new sorts after.
 */
export function stations() {
  return db.all(`
    SELECT   id, name, color FROM stations
    ORDER BY CASE id WHEN 'station-pearson' THEN 0
                     WHEN 'station-trapper' THEN 1
                     WHEN 'station-fence'   THEN 2
                     ELSE 3 END, name`);
}

/** What part of an animal a material is -- Pelt, Hide, Skin -- for the filter. */
export function bodyParts() {
  return db.all(`SELECT DISTINCT body_part FROM ingredients
                 WHERE body_part IS NOT NULL ORDER BY body_part`)
           .map((r) => r.body_part);
}

// ------------------------------------------------------------
// 2. Recipe card — ingredients with the inline marker.
//
// Two queries for the whole screen rather than two per card:
// the list, and every ingredient row in one go, grouped by
// recipe in the view.  165 recipes and 261 ingredient rows.
// ------------------------------------------------------------
export function recipeList() {
  return db.all(`
    SELECT     r.id, r.name, r.category, r.price_cents, r.description,
               r.warmth_rank,
               st.id   AS station_id,
               st.name AS station,
               st.color,
               loc.id   AS location_id,
               loc.name AS location,
               s.name  AS set_name,
               s.set_type,
               COALESCE(t.state, 'wanted')             AS state,
               COUNT(ri.ingredient_id)                 AS needs,
               COALESCE(SUM(ri.qty), 0)                AS total_qty,
               SUM(COALESCE(inv.qty, 0) >= ri.qty)     AS satisfied
    FROM       recipes  r
    LEFT JOIN  stations st ON st.id = r.station_id
    LEFT JOIN  locations loc ON loc.id = st.location_id
    LEFT JOIN  sets     s  ON s.id  = r.set_id
    LEFT JOIN  targets  t  ON t.recipe_id = r.id
    LEFT JOIN  recipe_ingredients ri ON ri.recipe_id = r.id
    LEFT JOIN  inventory          inv ON inv.ingredient_id = ri.ingredient_id
                                     AND inv.location_id   = st.location_id
    GROUP BY   r.id
    ORDER BY   r.name
  `);
}

/** Every ingredient of every recipe, with the marker's two numbers. */
export function recipeIngredients() {
  return db.all(`
    SELECT     ri.recipe_id,
               ing.id          AS ingredient_id,
               ing.name        AS name,
               ing.source_type AS source_type,
               ing.quality     AS quality,
               ri.qty          AS qty,
               COALESCE(inv.qty, 0)           AS have,
               COALESCE(inv.qty, 0) >= ri.qty AS satisfied
    FROM       recipe_ingredients ri
    JOIN       recipes     r   ON r.id   = ri.recipe_id
    JOIN       stations    st  ON st.id  = r.station_id
    JOIN       ingredients ing ON ing.id = ri.ingredient_id
    LEFT JOIN  inventory   inv ON inv.ingredient_id = ing.id
                              AND inv.location_id   = st.location_id
    ORDER BY   ing.name
  `);
}

/** The categories in use, for the filter. */
export function categories() {
  return db.all(`SELECT DISTINCT category FROM recipes
                 WHERE category IS NOT NULL ORDER BY category`)
           .map((r) => r.category);
}

// ------------------------------------------------------------
// 4. What a craft costs — the SELECT that store.craft() spends.
// ------------------------------------------------------------
export function craftSpend(recipeId) {
  return db.all(`
    SELECT ri.ingredient_id, st.location_id, -ri.qty AS delta
    FROM   recipes r
    JOIN   stations           st ON st.id = r.station_id
    JOIN   recipe_ingredients ri ON ri.recipe_id = r.id
    WHERE  r.id = :recipe_id
  `, { recipe_id: recipeId });
}

// ------------------------------------------------------------
// inventory entry
//
// Both of these report `qty` at one location, because the
// stepper on a row writes to the location you have selected.
// ------------------------------------------------------------
export function locations() {
  // Satchel, Pearson, Trapper: a chosen order, matching the station
  // chips elsewhere.  The Satchel -- what you carry -- leads, and is
  // the default.  Anything new sorts after.
  return db.all(`
    SELECT   id, name FROM locations
    ORDER BY CASE id WHEN 'loc-satchel' THEN 0
                     WHEN 'loc-pearson' THEN 1
                     WHEN 'loc-trapper' THEN 2
                     ELSE 3 END, name`);
}

// `inventory` is the balance, `inventory_totals` the history: how
// many have passed through your hands here, and how many of those
// went into something.  Both are the same ledger, read differently.
const STOCK_AT = `
  SELECT     ing.id          AS ingredient_id,
             ing.name        AS name,
             ing.source_type AS source_type,
             ing.quality     AS quality,
             COALESCE(inv.qty, 0)            AS qty,
             COALESCE(tot.gathered, 0)       AS gathered,
             COALESCE(tot.used_crafting, 0)  AS used_crafting
  FROM       ingredients ing
  LEFT JOIN  inventory        inv ON inv.ingredient_id = ing.id
                                 AND inv.location_id   = :location_id
  LEFT JOIN  inventory_totals tot ON tot.ingredient_id = ing.id
                                 AND tot.location_id   = :location_id`;

/** Materials whose name matches, for the search box. */
export function searchMaterials(term, locationId, limit = 40) {
  return db.all(`${STOCK_AT}
    WHERE     ing.name LIKE :term
    ORDER BY  ing.name
    LIMIT     :limit`,
    { location_id: locationId, term: `%${term}%`, limit });
}

/**
 * The ledger, newest first, with names rather than slugs.
 *
 * COALESCE back to the raw id rather than leaving a blank: a row
 * imported from a build that knew a different slug should be
 * visible as the odd thing it is, not invisible.
 */
export function ledgerEntries(limit) {
  return db.all(`
    SELECT     l.id, l.ts, l.delta, l.reason,
               COALESCE(ing.name, l.ingredient_id) AS material,
               COALESCE(loc.name, l.location_id)   AS place,
               ing.id IS NULL                      AS unknown_material,
               r.name                              AS recipe
    FROM       ledger l
    LEFT JOIN  ingredients ing ON ing.id = l.ingredient_id
    LEFT JOIN  locations   loc ON loc.id = l.location_id
    LEFT JOIN  recipes     r   ON r.id   = l.recipe_id
    ORDER BY   l.id DESC
    LIMIT      :limit`, { limit });
}

/** What you are holding at one location, most of it first. */
export function stockAt(locationId) {
  return db.all(`${STOCK_AT}
    WHERE     COALESCE(inv.qty, 0) > 0
    ORDER BY  ing.name`,
    { location_id: locationId });
}

/**
 * What the empty search box shows: the materials you touched
 * last, anywhere.  You hunt the same handful of animals over and
 * over, so after a week the row you want is usually already here
 * and search is the fallback rather than the default.
 */
export function recentMaterials(locationId, limit = 12) {
  return db.all(`${STOCK_AT}
    JOIN      (SELECT ingredient_id, MAX(id) AS last
               FROM   ledger
               GROUP BY ingredient_id) touched
                ON touched.ingredient_id = ing.id
    ORDER BY  touched.last DESC
    LIMIT     :limit`,
    { location_id: locationId, limit });
}

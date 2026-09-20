// ============================================================
// The four queries from database/personal_schema.sql, as
// functions.  The SQL is kept close to the version written in
// that file; what is added here is the extra columns the cards
// need for display, and the ids the views hand back on a tap.
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
  // In general mode there are no targets, so nothing is filtered
  // out and the view shows the reference data whole.
  const unfinished = personal
    ? "COALESCE(t.state, 'wanted') <> 'done'"
    : '1';

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
               SUM(ri.qty)          AS needed,
               COALESCE(inv.qty, 0) AS have
    FROM       recipe_ingredients ri
    JOIN       recipes      r   ON r.id   = ri.recipe_id
    JOIN       stations     st  ON st.id  = r.station_id
    JOIN       ingredients  ing ON ing.id = ri.ingredient_id
    LEFT JOIN  animals      a   ON a.id   = ing.animal_id
    LEFT JOIN  weapons      w   ON w.id   = a.weapon_id
    LEFT JOIN  targets      t   ON t.recipe_id = r.id
    LEFT JOIN  inventory    inv ON inv.ingredient_id = ing.id
                               AND inv.location_id   = st.location_id
    WHERE      ${unfinished}
    GROUP BY   ing.id, st.id
    ORDER BY   ing.name, st.name
  `);
}

/** The stations, for the filter chips. */
export function stations() {
  return db.all('SELECT id, name, color FROM stations ORDER BY name');
}

// ------------------------------------------------------------
// 2. Recipe card — ingredients with the inline marker.
// ------------------------------------------------------------
export function recipe(recipeId) {
  const head = db.one(`
    SELECT     r.id, r.name, r.category, r.price_cents, r.description,
               r.warmth_rank,
               st.id   AS station_id,
               st.name AS station,
               st.color,
               s.name  AS set_name,
               COALESCE(t.state, 'wanted') AS state
    FROM       recipes  r
    LEFT JOIN  stations st ON st.id = r.station_id
    LEFT JOIN  sets     s  ON s.id  = r.set_id
    LEFT JOIN  targets  t  ON t.recipe_id = r.id
    WHERE      r.id = :recipe_id
  `, { recipe_id: recipeId });

  if (!head) return null;

  head.ingredients = db.all(`
    SELECT     ing.id                          AS ingredient_id,
               ing.name                        AS name,
               ing.source_type                 AS source_type,
               ri.qty                          AS qty,
               COALESCE(inv.qty, 0)            AS have,
               COALESCE(inv.qty, 0) >= ri.qty  AS satisfied
    FROM       recipes r
    JOIN       stations           st  ON st.id  = r.station_id
    JOIN       recipe_ingredients ri  ON ri.recipe_id = r.id
    JOIN       ingredients        ing ON ing.id = ri.ingredient_id
    LEFT JOIN  inventory          inv ON inv.ingredient_id = ing.id
                                     AND inv.location_id   = st.location_id
    WHERE      r.id = :recipe_id
    ORDER BY   ing.name
  `, { recipe_id: recipeId });

  return head;
}

// ------------------------------------------------------------
// 3. What can I craft right now?
//    MIN() over a boolean is 1 only when every ingredient passes.
// ------------------------------------------------------------
export function craftable() {
  return db.all(`
    SELECT     r.id, r.name, st.name AS station, st.color
    FROM       recipes r
    JOIN       stations           st  ON st.id = r.station_id
    JOIN       recipe_ingredients ri  ON ri.recipe_id = r.id
    LEFT JOIN  targets            t   ON t.recipe_id = r.id
    LEFT JOIN  inventory          inv ON inv.ingredient_id = ri.ingredient_id
                                     AND inv.location_id   = st.location_id
    WHERE      COALESCE(t.state, 'wanted') = 'wanted'
    GROUP BY   r.id
    HAVING     MIN(COALESCE(inv.qty, 0) >= ri.qty) = 1
    ORDER BY   r.name
  `);
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
  // Insertion order, not alphabetical: build_db.py writes them as
  // Satchel, Trapper, Pearson, and the Satchel — what you carry —
  // is the one that should lead and be the default.
  return db.all('SELECT id, name FROM locations ORDER BY rowid');
}

const STOCK_AT = `
  SELECT     ing.id          AS ingredient_id,
             ing.name        AS name,
             ing.source_type AS source_type,
             ing.quality     AS quality,
             COALESCE(inv.qty, 0) AS qty
  FROM       ingredients ing
  LEFT JOIN  inventory   inv ON inv.ingredient_id = ing.id
                            AND inv.location_id   = :location_id`;

/** Materials whose name matches, for the search box. */
export function searchMaterials(term, locationId, limit = 40) {
  return db.all(`${STOCK_AT}
    WHERE     ing.name LIKE :term
    ORDER BY  ing.name
    LIMIT     :limit`,
    { location_id: locationId, term: `%${term}%`, limit });
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

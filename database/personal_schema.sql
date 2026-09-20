-- ============================================================
-- RDR2 Crafting Guide — PERSONAL LAYER
-- ============================================================
-- Lives in the user's browser, never on the server.  Attaches
-- alongside the read-only reference database so the queries
-- below can join across both.
--
--   ATTACH DATABASE 'personal.db' AS me;
-- ============================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- Append-only history.  Nothing here is ever updated in place:
-- current stock is SUM(delta), an undo is a DELETE, and a
-- mis-entry is fixed with a correcting row.
-- ------------------------------------------------------------
CREATE TABLE ledger (
    id             INTEGER PRIMARY KEY,
    ts             TEXT    NOT NULL DEFAULT (datetime('now')),
    ingredient_id  TEXT    NOT NULL,   -- ingredients.id
    location_id    TEXT    NOT NULL,   -- locations.id
    delta          INTEGER NOT NULL,      -- +gain, -spend
    reason         TEXT    NOT NULL
                   CHECK (reason IN ('kill','loot','buy','craft',
                                     'move','correction')),
    recipe_id      TEXT,                  -- recipes.id, when reason='craft'
    note           TEXT
);

CREATE INDEX idx_ledger_ingredient ON ledger(ingredient_id, location_id);
CREATE INDEX idx_ledger_ts         ON ledger(ts);

-- ------------------------------------------------------------
-- Current stock, derived.  Read this; write to `ledger`.
-- ------------------------------------------------------------
CREATE VIEW inventory AS
    SELECT ingredient_id, location_id, SUM(delta) AS qty
    FROM   ledger
    GROUP BY ingredient_id, location_id
    HAVING SUM(delta) <> 0;

-- ------------------------------------------------------------
-- The same ledger read as a lifetime total rather than a balance.
--
-- Nothing new is recorded for this: a gain is any row with a
-- positive delta, and crafting is the rows the craft transaction
-- below writes, so both numbers were already in the history.
--
-- Unlike `inventory` this keeps rows that have netted to zero --
-- a pelt you gathered and then spent is exactly the case these
-- totals exist to describe.
--
-- qty <= gathered holds by construction: qty is the sum of every
-- delta, gathered only the positive ones.
-- ------------------------------------------------------------
CREATE VIEW inventory_totals AS
    SELECT ingredient_id,
           location_id,
           SUM(delta)                                            AS qty,
           SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END)        AS gathered,
           -SUM(CASE WHEN reason = 'craft' THEN delta ELSE 0 END) AS used_crafting,
           -SUM(CASE WHEN reason <> 'craft' AND delta < 0
                     THEN delta ELSE 0 END)                      AS given_back
    FROM   ledger
    GROUP BY ingredient_id, location_id;

-- ------------------------------------------------------------
-- What you're working toward.  Absent = 'wanted'.
-- ------------------------------------------------------------
CREATE TABLE targets (
    recipe_id   TEXT PRIMARY KEY,   -- recipes.id
    state       TEXT NOT NULL DEFAULT 'wanted'
                CHECK (state IN ('wanted','done','skipped')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);


-- ============================================================
-- QUERIES
-- ============================================================

-- ------------------------------------------------------------
-- 1. Material card — "Where to go if you have these items".
--    Demand is per STATION (your cards say "for Fence"), stock
--    is per LOCATION (Fence draws from the Satchel).
--    Drop the targets join for the general, non-personal mode.
-- ------------------------------------------------------------
-- SELECT     ing.name                        AS material,
--            st.name                         AS station,
--            SUM(ri.qty)                     AS needed,
--            COALESCE(inv.qty, 0)            AS have,
--            w.name                          AS weapon,
--            CASE ing.source_type
--                 WHEN 'animal' THEN 'You need to go hunting!'
--                 ELSE               'You need to go find it!'
--            END                             AS hint
-- FROM       recipe_ingredients ri
-- JOIN       recipes      r   ON r.id  = ri.recipe_id
-- JOIN       stations     st  ON st.id = r.station_id
-- JOIN       ingredients  ing ON ing.id = ri.ingredient_id
-- LEFT JOIN  animals      a   ON a.id  = ing.animal_id
-- LEFT JOIN  weapons      w   ON w.id  = a.weapon_id
-- LEFT JOIN  targets      t   ON t.recipe_id = r.id
-- LEFT JOIN  inventory    inv ON inv.ingredient_id = ing.id
--                            AND inv.location_id   = st.location_id
-- WHERE      COALESCE(t.state, 'wanted') <> 'done'
-- GROUP BY   ing.id, st.id;

-- ------------------------------------------------------------
-- 2. Recipe card — ingredients with the inline marker.
-- ------------------------------------------------------------
-- SELECT     r.name,
--            ri.qty,
--            ing.name,
--            COALESCE(inv.qty, 0)                        AS have,
--            COALESCE(inv.qty, 0) >= ri.qty              AS satisfied
-- FROM       recipes r
-- JOIN       stations           st  ON st.id = r.station_id
-- JOIN       recipe_ingredients ri  ON ri.recipe_id = r.id
-- JOIN       ingredients        ing ON ing.id = ri.ingredient_id
-- LEFT JOIN  inventory          inv ON inv.ingredient_id = ing.id
--                                  AND inv.location_id   = st.location_id
-- WHERE      r.id = :recipe_id;

-- ------------------------------------------------------------
-- 3. What can I craft right now?
--    MIN() over a boolean is 1 only when every ingredient passes.
-- ------------------------------------------------------------
-- SELECT     r.name, st.name AS station
-- FROM       recipes r
-- JOIN       stations           st  ON st.id = r.station_id
-- JOIN       recipe_ingredients ri  ON ri.recipe_id = r.id
-- LEFT JOIN  targets            t   ON t.recipe_id = r.id
-- LEFT JOIN  inventory          inv ON inv.ingredient_id = ri.ingredient_id
--                                  AND inv.location_id   = st.location_id
-- WHERE      COALESCE(t.state, 'wanted') = 'wanted'
-- GROUP BY   r.id
-- HAVING     MIN(COALESCE(inv.qty, 0) >= ri.qty) = 1;

-- ------------------------------------------------------------
-- 4. Crafting, as one transaction: spend the ingredients from
--    the station's stock and mark the recipe done.
-- ------------------------------------------------------------
-- BEGIN;
--   INSERT INTO ledger (ingredient_id, location_id, delta, reason, recipe_id)
--   SELECT ri.ingredient_id, st.location_id, -ri.qty, 'craft', r.id
--   FROM   recipes r
--   JOIN   stations           st ON st.id = r.station_id
--   JOIN   recipe_ingredients ri ON ri.recipe_id = r.id
--   WHERE  r.id = :recipe_id;
--
--   INSERT INTO targets (recipe_id, state) VALUES (:recipe_id, 'done')
--   ON CONFLICT (recipe_id)
--   DO UPDATE SET state = 'done', updated_at = datetime('now');
-- COMMIT;
--
-- Undo:
--   DELETE FROM ledger WHERE recipe_id = :recipe_id AND reason = 'craft';
--   UPDATE targets SET state = 'wanted' WHERE recipe_id = :recipe_id;

// ============================================================
// The personal layer's durable half.
//
// sql.js is in memory and dies with the tab, so IndexedDB holds
// the ledger and targets as plain rows and replays them on
// startup.  Only the personal tables are stored; the reference
// database is re-fetched (and service-worker cached) instead.
//
// Every write goes to SQLite first, then to IndexedDB, then
// tells the views.  The ledger is append-only, so a write is an
// INSERT and an undo is a DELETE of that one row.
// ============================================================

import * as db from './db.js';
import { craftSpend } from './queries.js';

const IDB_NAME = 'rdr2-personal';
const IDB_VERSION = 1;
const LEDGER = 'ledger';
const TARGETS = 'targets';

const MODE_KEY = 'rdr2:personal-mode';

// ------------------------------------------------------------
// IndexedDB, wrapped just enough to await
// ------------------------------------------------------------

let idbPromise = null;

function idb() {
  return (idbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const conn = req.result;
      if (!conn.objectStoreNames.contains(LEDGER)) {
        conn.createObjectStore(LEDGER, { keyPath: 'id' });
      }
      if (!conn.objectStoreNames.contains(TARGETS)) {
        conn.createObjectStore(TARGETS, { keyPath: 'recipe_id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

function tx(stores, mode, fn) {
  return idb().then((conn) => new Promise((resolve, reject) => {
    const t = conn.transaction(stores, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    result = fn(...stores.map((s) => t.objectStore(s)));
  }));
}

function readAll(store) {
  return idb().then((conn) => new Promise((resolve, reject) => {
    const req = conn.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

// ------------------------------------------------------------
// change notification
// ------------------------------------------------------------

const listeners = new Set();

/** Call `fn` after every write.  Returns an unsubscribe. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed() {
  for (const fn of listeners) fn();
}

// ------------------------------------------------------------
// startup
// ------------------------------------------------------------

/** Replay the stored rows into the open sql.js instance. */
export async function hydrate() {
  const [ledger, targets] = await Promise.all([readAll(LEDGER), readAll(TARGETS)]);

  db.transaction(() => {
    for (const r of ledger) {
      db.run(
        `INSERT INTO ledger (id, ts, ingredient_id, location_id, delta, reason,
                             recipe_id, note)
         VALUES (:id, :ts, :ingredient_id, :location_id, :delta, :reason,
                 :recipe_id, :note)`,
        {
          id: r.id, ts: r.ts, ingredient_id: r.ingredient_id,
          location_id: r.location_id, delta: r.delta, reason: r.reason,
          recipe_id: r.recipe_id ?? null, note: r.note ?? null,
        });
    }
    for (const t of targets) {
      db.run(
        `INSERT INTO targets (recipe_id, state, updated_at)
         VALUES (:recipe_id, :state, :updated_at)`,
        { recipe_id: t.recipe_id, state: t.state, updated_at: t.updated_at });
    }
  });

  return { ledger: ledger.length, targets: targets.length };
}

// ------------------------------------------------------------
// writes
// ------------------------------------------------------------

/**
 * Append one ledger row.  `delta` is signed: positive for a gain,
 * negative for a spend.  Returns the stored row, whose id is what
 * `undo` takes.
 */
export async function record({ ingredient_id, location_id, delta, reason,
                               recipe_id = null, note = null }) {
  const row = db.transaction(() => {
    db.run(
      `INSERT INTO ledger (ingredient_id, location_id, delta, reason, recipe_id, note)
       VALUES (:ingredient_id, :location_id, :delta, :reason, :recipe_id, :note)`,
      { ingredient_id, location_id, delta, reason, recipe_id, note });
    return db.one('SELECT * FROM ledger WHERE id = :id', { id: db.lastInsertId() });
  });

  await tx([LEDGER], 'readwrite', (s) => s.put(row));
  changed();
  return row;
}

/** Remove one ledger row — the undo behind the toast. */
export async function undo(id) {
  db.run('DELETE FROM ledger WHERE id = :id', { id });
  await tx([LEDGER], 'readwrite', (s) => s.delete(id));
  changed();
}

/** Mark a recipe wanted / done / skipped. */
export async function setTarget(recipe_id, state) {
  const row = db.transaction(() => {
    db.run(
      `INSERT INTO targets (recipe_id, state) VALUES (:recipe_id, :state)
       ON CONFLICT (recipe_id)
       DO UPDATE SET state = :state, updated_at = datetime('now')`,
      { recipe_id, state });
    return db.one('SELECT * FROM targets WHERE recipe_id = :recipe_id', { recipe_id });
  });

  await tx([TARGETS], 'readwrite', (s) => s.put(row));
  changed();
  return row;
}

// ------------------------------------------------------------
// export / import / reset
// ------------------------------------------------------------

/** Everything personal, as portable JSON. */
export function exportJSON() {
  return JSON.stringify({
    format: 'rdr2-crafting-guide/personal',
    version: 1,
    exported_at: new Date().toISOString(),
    ledger: db.all('SELECT * FROM ledger ORDER BY id'),
    targets: db.all('SELECT * FROM targets ORDER BY recipe_id'),
  }, null, 2);
}

/** Replace everything personal with the contents of an export. */
export async function importJSON(text) {
  const data = JSON.parse(text);
  if (data?.format !== 'rdr2-crafting-guide/personal') {
    throw new Error('Not a crafting-guide export.');
  }

  db.transaction(() => {
    db.run('DELETE FROM ledger');
    db.run('DELETE FROM targets');
  });
  await tx([LEDGER, TARGETS], 'readwrite', (l, t) => { l.clear(); t.clear(); });

  await tx([LEDGER, TARGETS], 'readwrite', (l, t) => {
    for (const r of data.ledger ?? []) l.put(r);
    for (const r of data.targets ?? []) t.put(r);
  });

  await hydrate();
  changed();
}

/** Throw the personal layer away. */
export async function reset() {
  db.transaction(() => {
    db.run('DELETE FROM ledger');
    db.run('DELETE FROM targets');
  });
  await tx([LEDGER, TARGETS], 'readwrite', (l, t) => { l.clear(); t.clear(); });
  changed();
}

// ------------------------------------------------------------
// personal vs general mode
//
// The two Notion versions, collapsed into one app: general shows
// the reference data alone, personal folds in what you have.
// ------------------------------------------------------------

export function isPersonal() {
  return localStorage.getItem(MODE_KEY) !== 'general';
}

export function setPersonal(on) {
  localStorage.setItem(MODE_KEY, on ? 'personal' : 'general');
  changed();
}

// ------------------------------------------------------------
// crafting — query 4, with persistence
//
// Spending and marking done is one SQLite transaction, mirrored
// to IndexedDB in one IndexedDB transaction.  Undo deletes the
// same rows: that is the whole point of an append-only ledger.
// ------------------------------------------------------------

/** Spend a recipe's ingredients from its station's stock, and mark it done. */
export async function craft(recipe_id) {
  const spend = craftSpend(recipe_id);
  if (!spend.length) throw new Error(`Nothing to spend for ${recipe_id}.`);

  const { rows, target } = db.transaction(() => {
    const ids = [];
    for (const s of spend) {
      db.run(
        `INSERT INTO ledger (ingredient_id, location_id, delta, reason, recipe_id)
         VALUES (:ingredient_id, :location_id, :delta, 'craft', :recipe_id)`,
        { ...s, recipe_id });
      ids.push(db.lastInsertId());
    }
    db.run(
      `INSERT INTO targets (recipe_id, state) VALUES (:recipe_id, 'done')
       ON CONFLICT (recipe_id)
       DO UPDATE SET state = 'done', updated_at = datetime('now')`,
      { recipe_id });

    return {
      rows: ids.map((id) => db.one('SELECT * FROM ledger WHERE id = :id', { id })),
      target: db.one('SELECT * FROM targets WHERE recipe_id = :recipe_id', { recipe_id }),
    };
  });

  await tx([LEDGER, TARGETS], 'readwrite', (l, t) => {
    for (const r of rows) l.put(r);
    t.put(target);
  });
  changed();
  return rows;
}

/** Put a crafted recipe back: refund the spend, mark it wanted again. */
export async function uncraft(recipe_id) {
  const { ids, target } = db.transaction(() => {
    const ids = db.all(
      `SELECT id FROM ledger WHERE recipe_id = :recipe_id AND reason = 'craft'`,
      { recipe_id }).map((r) => r.id);

    db.run(`DELETE FROM ledger WHERE recipe_id = :recipe_id AND reason = 'craft'`,
           { recipe_id });
    db.run(`UPDATE targets SET state = 'wanted', updated_at = datetime('now')
            WHERE recipe_id = :recipe_id`, { recipe_id });

    return {
      ids,
      target: db.one('SELECT * FROM targets WHERE recipe_id = :recipe_id', { recipe_id }),
    };
  });

  await tx([LEDGER, TARGETS], 'readwrite', (l, t) => {
    for (const id of ids) l.delete(id);
    if (target) t.put(target);
  });
  changed();
}

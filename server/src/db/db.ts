import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { MIGRATIONS } from "./migrations.ts";

export type DB = DatabaseSync;

export function openDb(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

export function migrate(db: DB): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.prepare("SELECT version FROM schema_version").get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare("INSERT INTO schema_version (version) VALUES (0)").run();
  while (version < MIGRATIONS.length) {
    tx(db, () => {
      db.exec(MIGRATIONS[version]);
      db.prepare("UPDATE schema_version SET version = ?").run(version + 1);
    });
    version++;
  }
}

let depth = 0;

/** Runs fn in a transaction. Nested calls join the outer transaction. */
export function tx<T>(db: DB, fn: () => T): T {
  if (depth > 0) return fn();
  depth++;
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    depth--;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Tiny key/value cache on SQLite (built into Node 24, no native build).
 * Tables are namespaced so the same DB can hold products, manufacturers,
 * search results and OFF category pages.
 */
export class Cache {
  private db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS kv (
        ns TEXT NOT NULL,
        key TEXT NOT NULL,
        json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (ns, key)
      );
      CREATE TABLE IF NOT EXISTS scans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id TEXT NOT NULL,
        path TEXT NOT NULL,
        verdict TEXT,
        ms INTEGER,
        created_at INTEGER NOT NULL
      );
    `);
  }

  get<T>(ns: string, key: string, maxAgeMs?: number): T | undefined {
    const row = this.db
      .prepare("SELECT json, updated_at FROM kv WHERE ns = ? AND key = ?")
      .get(ns, key) as { json: string; updated_at: number } | undefined;
    if (!row) return undefined;
    if (maxAgeMs !== undefined && Date.now() - row.updated_at > maxAgeMs) return undefined;
    try {
      return JSON.parse(row.json) as T;
    } catch {
      return undefined;
    }
  }

  set(ns: string, key: string, value: unknown): void {
    this.db
      .prepare(
        "INSERT INTO kv (ns, key, json, updated_at) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(ns, key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at",
      )
      .run(ns, key, JSON.stringify(value), Date.now());
  }

  delete(ns: string, key: string): void {
    this.db.prepare("DELETE FROM kv WHERE ns = ? AND key = ?").run(ns, key);
  }

  count(ns: string): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM kv WHERE ns = ?").get(ns) as { n: number };
    return row.n;
  }

  logScan(productId: string, path: string, verdict: string | undefined, ms: number): void {
    this.db
      .prepare("INSERT INTO scans (product_id, path, verdict, ms, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(productId, path, verdict ?? null, Math.round(ms), Date.now());
  }

  close(): void {
    this.db.close();
  }
}

export const TTL = {
  product: 7 * 24 * 3600 * 1000,
  productNotFound: 6 * 3600 * 1000,
  search: 3600 * 1000,
  category: 24 * 3600 * 1000,
  manufacturer: 30 * 24 * 3600 * 1000,
  insight: 14 * 24 * 3600 * 1000,
  translation: 180 * 24 * 3600 * 1000,
};

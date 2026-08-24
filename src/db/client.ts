import "server-only";

import fs from "node:fs";
import path from "node:path";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { PGlite } from "@electric-sql/pglite";

import * as schema from "./schema";

export type Database = PgliteDatabase<typeof schema>;

/**
 * One database, two homes.
 *
 * With no DATABASE_URL the app runs an embedded Postgres (PGlite) out of
 * ./.data/pg — real Postgres semantics, no server to install, so `npm run dev`
 * works on a fresh laptop. Set DATABASE_URL and the same schema, the same
 * migrations and the same queries run against hosted Postgres (Supabase,
 * Railway, RDS) instead. Nothing above this file knows which one it got.
 */
const DATA_DIR = path.join(process.cwd(), ".data", "pg");
const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

type Cache = { db: Database; ready: Promise<Database> } | undefined;

// Next's dev server re-evaluates modules on every hot reload. Without stashing
// the handle on globalThis we would open a new Postgres on each edit and leak
// them until the machine complains.
const globalCache = globalThis as unknown as { __venderDb?: Cache };

async function create(): Promise<Database> {
  if (process.env.DATABASE_URL) {
    // Hosted Postgres. Imported lazily so the local path never pays for it.
    const [{ drizzle }, { migrate }, postgres] = await Promise.all([
      import("drizzle-orm/postgres-js"),
      import("drizzle-orm/postgres-js/migrator"),
      import("postgres").then((m) => m.default),
    ]);
    const sql = postgres(process.env.DATABASE_URL, { max: 10 });
    const db = drizzle(sql, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    return db as unknown as Database;
  }

  // PGlite creates its own data directory but not the parents above it.
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const client = new PGlite(DATA_DIR);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

/**
 * Returns the migrated database handle. Concurrent callers during startup all
 * await the same promise, so migrations run exactly once.
 */
export function getDb(): Promise<Database> {
  if (globalCache.__venderDb) return globalCache.__venderDb.ready;

  const ready = create().then((db) => {
    globalCache.__venderDb = { db, ready: Promise.resolve(db) };
    return db;
  });

  // Park the in-flight promise immediately so a second caller joins this run
  // instead of starting a competing one.
  globalCache.__venderDb = { db: undefined as unknown as Database, ready };
  return ready;
}

export { schema };

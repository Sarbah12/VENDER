import "server-only";

import fs from "node:fs";
import path from "node:path";
import type { PgliteDatabase } from "drizzle-orm/pglite";

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
/**
 * PGlite is an in-process Postgres, so exactly one process may hold a data
 * directory at a time — the dev server and a CLI script cannot share one.
 * PGLITE_DIR lets tests and scripts point at their own database instead of
 * fighting over the development one.
 */
const DATA_DIR = process.env.PGLITE_DIR
  ? path.resolve(process.env.PGLITE_DIR)
  : path.join(process.cwd(), ".data", "pg");
const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

/**
 * PGlite runs Postgres inside this process, so two processes opening the same
 * data directory corrupt it — silently, and only noticeably later. A lock file
 * turns that into an error you can read.
 *
 * The lock records a PID; a lock whose process is gone is stale and gets taken
 * over, so a hard crash does not leave the project unrunnable.
 */
const LOCK_FILE = `${DATA_DIR}.lock`;

function acquireLock(): void {
  try {
    const raw = fs.readFileSync(LOCK_FILE, "utf8");
    const holder = JSON.parse(raw) as { pid: number; startedAt: string };

    if (holder.pid !== process.pid && isAlive(holder.pid)) {
      throw new Error(
        `Another process (pid ${holder.pid}, since ${holder.startedAt}) already has the database at ` +
          `${DATA_DIR} open. PGlite allows only one. Stop the dev server before running a script, ` +
          `or point the script somewhere else with PGLITE_DIR.`,
      );
    }
  } catch (error) {
    // A missing or unreadable lock is fine — we are about to write our own.
    if (error instanceof Error && error.message.startsWith("Another process")) throw error;
  }

  fs.writeFileSync(
    LOCK_FILE,
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
  );

  const release = () => {
    try {
      const holder = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8")) as { pid: number };
      if (holder.pid === process.pid) fs.rmSync(LOCK_FILE, { force: true });
    } catch {
      // Already gone, or never written. Nothing to release.
    }
  };

  process.once("exit", release);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      release();
      process.exit(0);
    });
  }
}

function isAlive(pid: number): boolean {
  try {
    // Signal 0 checks for existence without touching the process.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

type Cache = { db: Database; ready: Promise<Database> } | undefined;

// Next's dev server re-evaluates modules on every hot reload. Without stashing
// the handle on globalThis we would open a new Postgres on each edit and leak
// them until the machine complains.
const globalCache = globalThis as unknown as { __venderDb?: Cache };

/**
 * Connection settings for hosted Postgres.
 *
 * The one that bites people: a transaction-mode connection pooler (Supabase's
 * Supavisor on port 6543, PgBouncer, Neon's pooled endpoint) hands each
 * statement to a different backend, so prepared statements break. Detecting the
 * pooler from the URL and turning them off is the difference between "works
 * locally, fails in production" and just working.
 */
export function poolSettings(url: string): { max: number; prepare: boolean; pooled: boolean } {
  const pooled =
    url.includes(":6543") ||
    url.includes("pooler.supabase") ||
    url.includes("-pooler.") ||
    url.includes("pgbouncer=true");

  // Serverless runtimes start many short-lived instances; a big pool per
  // instance exhausts the database's connection limit long before it helps.
  const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  const configured = Number(process.env.DATABASE_POOL_MAX);

  return {
    max: Number.isFinite(configured) && configured > 0 ? configured : serverless ? 1 : 10,
    prepare: !pooled,
    pooled,
  };
}

async function create(): Promise<Database> {
  const url = process.env.DATABASE_URL;

  if (url) {
    // Hosted Postgres. Imported lazily so the local path never pays for it.
    const [{ drizzle }, postgres] = await Promise.all([
      import("drizzle-orm/postgres-js"),
      import("postgres").then((m) => m.default),
    ]);

    const { max, prepare } = poolSettings(url);
    const sql = postgres(url, {
      max,
      prepare,
      idle_timeout: 20,
      connect_timeout: 15,
      // Most managed providers terminate TLS with their own CA.
      ssl: url.includes("sslmode=disable") ? false : "require",
    });
    const db = drizzle(sql, { schema });

    // Migrations belong to deploys, not to whichever request happens to be
    // first: several instances starting at once would race, and a cold start
    // would pay for schema work. `npm run db:migrate` runs them explicitly.
    if (process.env.MIGRATE_ON_START === "true") {
      const { migrate } = await import("drizzle-orm/postgres-js/migrator");
      await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    }

    return db as unknown as Database;
  }

  // Embedded Postgres, for development. Imported lazily so a production build
  // pointed at a real database never pulls in the WASM Postgres at all.
  const [{ drizzle }, { migrate }, { PGlite }] = await Promise.all([
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
    import("@electric-sql/pglite"),
  ]);

  // PGlite creates its own data directory but not the parents above it.
  fs.mkdirSync(DATA_DIR, { recursive: true });
  acquireLock();

  const client = new PGlite(DATA_DIR);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

/**
 * Returns the migrated database handle. Concurrent callers during startup all
 * await the same promise, so migrations run exactly once.
 */
export function getDb(): Promise<Database> {
  if (globalCache.__venderDb) return globalCache.__venderDb.ready;

  const ready = create().then(
    (db) => {
      globalCache.__venderDb = { db, ready: Promise.resolve(db) };
      return db;
    },
    (error: unknown) => {
      // Never cache a failure. A rejected promise left in the cache poisons every
      // later request, so a transient problem — the data directory briefly held
      // by another process, a database still starting up — would look permanent
      // until someone restarted the server.
      if (globalCache.__venderDb?.ready === ready) globalCache.__venderDb = undefined;
      throw error;
    },
  );

  // Park the in-flight promise immediately so a second caller joins this run
  // instead of starting a competing one.
  globalCache.__venderDb = { db: undefined as unknown as Database, ready };
  return ready;
}

export { schema };

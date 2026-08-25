/**
 * Confirms the database is reachable and reports what it found:
 * `npm run db:ping`.
 *
 * The reporting lives in probe.ts, shared with `db:setup`.
 */
import { probe } from "./probe";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("No DATABASE_URL set — the app is running on embedded Postgres under .data/.");
    console.log("To connect it to Supabase, run:  npm run db:setup");
    process.exit(0);
  }

  const result = await probe(process.env.DATABASE_URL);
  process.exit(result === "failed" ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

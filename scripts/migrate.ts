/**
 * Applies pending migrations. Run at deploy time, before the new version starts
 * serving: `npm run db:migrate`.
 *
 * Keeping this out of the request path means several app instances booting at
 * once cannot race each other through the same migration, and a cold start never
 * pays for schema work.
 */
import path from "node:path";

async function main() {
  // Prefer the direct connection: migrations need a session a pooler will not give.
  const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;

  if (!url) {
    // Local development uses embedded Postgres, which migrates itself on open.
    const { getDb } = await import("../src/db/client");
    await getDb();
    console.log("Embedded Postgres is up to date.");
    process.exit(0);
  }

  const [{ drizzle }, { migrate }, postgres, { poolSettings }] = await Promise.all([
    import("drizzle-orm/postgres-js"),
    import("drizzle-orm/postgres-js/migrator"),
    import("postgres").then((m) => m.default),
    import("../src/db/client"),
  ]);

  const { prepare, transactionPooled } = poolSettings(url);
  if (transactionPooled) {
    console.error(
      "This is a transaction-pooled connection string (port 6543). Migrations need a session:\n" +
        "  • Supabase — use the Session pooler URL (port 5432 on the pooler host), or the\n" +
        "    Direct connection if your network has IPv6.\n" +
        "  • Set it as DIRECT_DATABASE_URL and leave DATABASE_URL on 6543 for the app.",
    );
    process.exit(1);
  }

  // One connection, and no pool to leave hanging when the script ends.
  const sql = postgres(url, {
    max: 1,
    prepare,
    ssl: url.includes("sslmode=disable") ? false : "require",
  });

  try {
    await migrate(drizzle(sql), { migrationsFolder: path.join(process.cwd(), "drizzle") });
    console.log("Migrations applied.");
  } finally {
    await sql.end({ timeout: 5 });
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * Confirms the database is reachable and reports what it found:
 * `npm run db:ping`.
 *
 * Deliberately prints nothing that could leak a credential — no connection
 * string, no password, no host. Just whether it connected, which server
 * answered, and whether the schema is in place.
 */
async function main() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    console.log("No DATABASE_URL set — the app is running on embedded Postgres under .data/.");
    process.exit(0);
  }

  const [postgres, { poolSettings }, { checkDatabaseUrl }] = await Promise.all([
    import("postgres").then((m) => m.default),
    import("../src/db/client"),
    import("../src/lib/env"),
  ]);

  const check = checkDatabaseUrl(url, "DATABASE_URL");
  if (!check.ok) {
    console.error(check.message);
    process.exit(1);
  }

  const { prepare, transactionPooled } = poolSettings(url);
  console.log(
    `Connecting… mode: ${transactionPooled ? "transaction pooler" : "session / direct"}, ` +
      `prepared statements: ${prepare ? "on" : "off"}`,
  );

  const sql = postgres(url, {
    max: 1,
    prepare,
    connect_timeout: 15,
    ssl: url.includes("sslmode=disable") ? false : "require",
  });

  try {
    const startedAt = Date.now();
    const [{ version }] = await sql<{ version: string }[]>`select version()`;
    const latency = Date.now() - startedAt;

    // Round-trip time matters for a till: every sale is a few queries.
    console.log(`Connected in ${latency}ms`);
    console.log(`Server: ${version.split(" on ")[0]}`);

    const [{ present }] = await sql<{ present: boolean }[]>`
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'businesses'
      ) as present
    `;

    if (!present) {
      console.log("\nSchema is not there yet. Run:  npm run db:migrate");
      process.exit(0);
    }

    const [counts] = await sql<{ businesses: number; products: number; sales: number }[]>`
      select
        (select count(*) from businesses)::int as businesses,
        (select count(*) from products)::int as products,
        (select count(*) from sales)::int as sales
    `;

    console.log(
      `\nSchema is in place — ${counts.businesses} business(es), ` +
        `${counts.products} product(s), ${counts.sales} sale(s).`,
    );
    if (counts.businesses === 0) {
      console.log("Open the app and visit /setup to create your business.");
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  process.exit(0);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`\nCould not connect: ${message}\n`);
  if (message.includes("ENETUNREACH") || message.includes("ENOTFOUND")) {
    console.error(
      "That often means the direct Supabase host is IPv6-only and your network is IPv4.\n" +
        "Use the Session pooler URL (port 5432 on the pooler host) instead.",
    );
  }
  if (message.includes("password authentication failed")) {
    console.error(
      "The password in DATABASE_URL is wrong. Reset it in Supabase under\n" +
        "Project Settings → Database → Database password, then update your env file.",
    );
  }
  if (message.includes("Tenant or user not found")) {
    console.error(
      "The username is wrong for a pooled connection. Pooled URLs use\n" +
        "postgres.PROJECT_REF as the username, not plain postgres.",
    );
  }
  process.exit(1);
});

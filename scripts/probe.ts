/**
 * Connects, reports what it found, and says what to do next.
 *
 * Shared by `db:ping` and the tail of `db:setup`, so connecting and verifying
 * are never two different opinions about the same database.
 *
 * Prints nothing that could leak a credential: no connection string, no
 * password, no hostname.
 */
import { poolSettings } from "../src/db/client";
import { checkDatabaseUrl } from "../src/lib/env";

export type ProbeResult = "ok" | "needs-migration" | "failed";

export async function probe(url: string | undefined): Promise<ProbeResult> {
  const check = checkDatabaseUrl(url, "DATABASE_URL");
  if (!check.ok) {
    console.error(`\n${check.message}`);
    return "failed";
  }

  const postgres = (await import("postgres")).default;
  const { prepare, transactionPooled } = poolSettings(url!);

  console.log(
    `\nConnecting… mode: ${transactionPooled ? "transaction pooler" : "session / direct"}, ` +
      `prepared statements: ${prepare ? "on" : "off"}`,
  );

  const sql = postgres(url!, {
    max: 1,
    prepare,
    connect_timeout: 15,
    ssl: url!.includes("sslmode=disable") ? false : "require",
  });

  try {
    const startedAt = Date.now();
    const [{ version }] = await sql<{ version: string }[]>`select version()`;
    // Round-trip time matters for a till: every sale is a handful of queries.
    console.log(`Connected in ${Date.now() - startedAt}ms`);
    console.log(`Server: ${version.split(" on ")[0]}`);

    const [{ present }] = await sql<{ present: boolean }[]>`
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'businesses'
      ) as present
    `;

    if (!present) {
      console.log("\nThe schema is not there yet. Run:  npm run db:migrate");
      return "needs-migration";
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

    // On Supabase the public schema is served over HTTP with a key that ships in
    // client code, so a table without RLS is a table anyone can read. Reported
    // rather than assumed, because it fails silently.
    const unprotected = await sql<{ relname: string }[]>`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
      order by c.relname
    `;

    const [exposed] = await sql<{ role_count: number }[]>`
      select count(*)::int as role_count
      from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated')
    `;

    if (unprotected.length === 0 && exposed.role_count === 0) {
      console.log("Row-level security: on for every table, API roles have no grants ✓");
    } else {
      console.warn("\n⚠  This database is reachable over Supabase's HTTP API.");
      if (unprotected.length > 0) {
        console.warn(
          `   Tables without row-level security: ${unprotected.map((t) => t.relname).join(", ")}`,
        );
      }
      if (exposed.role_count > 0) {
        console.warn(`   anon/authenticated still hold ${exposed.role_count} table grant(s).`);
      }
      console.warn("   Fix with:  npm run db:migrate");
    }

    if (counts.businesses === 0) {
      console.log("\nNext:  npm run dev  — then open /setup to create your business.");
    }

    return "ok";
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nCould not connect: ${message}\n`);

    // Ordered most specific first. Supabase reports an unknown tenant as an
    // ENOTFOUND, so a bare ENOTFOUND check would blame the network for what is
    // actually a wrong region or username — and send you fixing the wrong thing.
    if (/tenant/i.test(message)) {
      console.error(
        "The pooler does not recognise that project. Two usual causes:\n" +
          "  • the region in the hostname is wrong — copy the Transaction pooler string\n" +
          "    exactly as the dashboard shows it, rather than editing one by hand;\n" +
          "  • the username is plain 'postgres' — pooled URLs need postgres.PROJECT_REF.",
      );
    } else if (message.includes("ENETUNREACH")) {
      console.error(
        "That is the IPv6 problem: the 'Direct connection' host is IPv6-only unless you buy\n" +
          "the IPv4 add-on. Use the Transaction pooler URL (port 6543) instead — in the Connect\n" +
          "dialog, change Connection Method from 'Direct connection' to 'Transaction pooler'.",
      );
    } else if (message.includes("ENOTFOUND")) {
      console.error(
        "That hostname does not resolve. Check the region part of the host, and that you\n" +
          "copied the whole string. If you are on the 'Direct connection' tab, switch to\n" +
          "'Transaction pooler' — the direct host is IPv6-only without the IPv4 add-on.",
      );
    } else if (message.includes("password authentication failed")) {
      console.error(
        "The password is wrong. Supabase never shows it again after project creation, so if\n" +
          "you do not have it: Project Settings → Database → Reset database password.\n" +
          "Then run:  npm run db:setup",
      );
    } else if (message.includes("Tenant or user not found")) {
      console.error(
        "The username is wrong for a pooled connection. Pooled URLs use\n" +
          "postgres.PROJECT_REF as the username, not plain postgres. Copy the string exactly\n" +
          "as the Transaction pooler box shows it.",
      );
    } else if (message.includes("timeout") || message.includes("ETIMEDOUT")) {
      console.error(
        "Timed out. If the project has been idle for a while, the free plan may have paused\n" +
          "it — open the Supabase dashboard to wake it, then try again.",
      );
    }

    return "failed";
  } finally {
    await sql.end({ timeout: 5 });
  }
}

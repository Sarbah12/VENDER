import { asc, count, desc, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { customers, sales } from "@/db/schema";
import { formatDate } from "@/lib/datetime";
import { formatMoney } from "@/lib/money";
import { getShopContext } from "@/server/context";

export const metadata = { title: "Customers" };
export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const context = await getShopContext();
  if (!context) redirect("/setup");

  const db = await getDb();
  const currency = context.business.currencyCode;

  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      email: customers.email,
      balance: customers.balance,
      purchases: count(sales.id),
      spent: sql`coalesce(sum(${sales.total}), 0)`,
      lastSale: sql<Date | null>`max(${sales.soldAt})`,
    })
    .from(customers)
    .leftJoin(sales, eq(sales.customerId, customers.id))
    .where(eq(customers.businessId, context.business.id))
    .groupBy(customers.id, customers.name, customers.phone, customers.email, customers.balance)
    .orderBy(desc(sql`coalesce(sum(${sales.total}), 0)`), asc(customers.name));

  const owed = rows.reduce((a, r) => a + r.balance, 0);

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-3">
        <Summary label="Customers" value={String(rows.length)} detail="On the books" />
        <Summary
          label="Owed to the shop"
          value={formatMoney(owed, currency)}
          detail={owed > 0 ? "Sitting in Accounts Receivable" : "Everyone is settled up"}
          tone={owed > 0 ? "warning" : undefined}
        />
        <Summary
          label="Lifetime sales"
          value={formatMoney(rows.reduce((a, r) => a + Number(r.spent), 0), currency)}
          detail="Attributed to a named customer"
        />
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-line px-5 py-3.5 text-[0.9375rem] font-bold tracking-tight">
          Customer accounts
        </h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Phone</th>
                <th className="num">Purchases</th>
                <th className="num">Lifetime spend</th>
                <th className="num">Balance owing</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="block font-semibold">{row.name}</span>
                    {row.email && (
                      <span className="block text-[0.6875rem] text-muted">{row.email}</span>
                    )}
                  </td>
                  <td className="tnum text-muted">{row.phone ?? "—"}</td>
                  <td className="num text-muted">{row.purchases}</td>
                  <td className="num font-semibold">
                    {formatMoney(Number(row.spent), currency)}
                  </td>
                  <td className="num">
                    {row.balance > 0 ? (
                      <span className="chip tnum bg-warning-soft text-warning">
                        {formatMoney(row.balance, currency)}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="tnum whitespace-nowrap text-muted">
                    {row.lastSale ? formatDate(row.lastSale) : "Never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Summary({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "warning";
}) {
  return (
    <div className="card p-5">
      <p className="label mb-2">{label}</p>
      <p
        className={`tnum text-[1.5rem] font-bold leading-none tracking-tight ${
          tone === "warning" ? "text-warning" : ""
        }`}
      >
        {value}
      </p>
      <p className="mt-1.5 text-[0.75rem] text-muted">{detail}</p>
    </div>
  );
}

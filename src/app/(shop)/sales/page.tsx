import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { customers, employees, payments, saleLines, sales } from "@/db/schema";
import { PAYMENT_LABEL } from "@/domain/accounts";
import { formatDayTime } from "@/lib/datetime";
import { formatMoney, formatQty } from "@/lib/money";
import { getShopContext } from "@/server/context";

export const metadata = { title: "Sales" };
export const dynamic = "force-dynamic";

export default async function SalesPage() {
  const context = await getShopContext();
  if (!context) redirect("/setup");

  const db = await getDb();
  const currency = context.business.currencyCode;

  const rows = await db
    .select({
      id: sales.id,
      number: sales.number,
      soldAt: sales.soldAt,
      status: sales.status,
      total: sales.total,
      taxTotal: sales.taxTotal,
      discountTotal: sales.discountTotal,
      costTotal: sales.costTotal,
      balanceDue: sales.balanceDue,
      cashier: employees.name,
      customer: customers.name,
      items: sql<string>`(select coalesce(sum(${saleLines.quantity}), 0) from ${saleLines} where ${saleLines.saleId} = ${sales.id})`,
      methods: sql<string>`(select string_agg(distinct ${payments.method}::text, ',') from ${payments} where ${payments.saleId} = ${sales.id})`,
    })
    .from(sales)
    .leftJoin(employees, eq(employees.id, sales.employeeId))
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .where(eq(sales.businessId, context.business.id))
    .orderBy(desc(sales.soldAt))
    .limit(200);

  const takings = rows.reduce((a, r) => a + r.total, 0);
  const profit = rows.reduce((a, r) => a + (r.total - r.taxTotal - r.costTotal), 0);
  const owed = rows.reduce((a, r) => a + r.balanceDue, 0);

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-3">
        <Summary label="Sales shown" value={String(rows.length)} detail="Most recent 200" />
        <Summary label="Takings" value={formatMoney(takings, currency)} detail="Including tax" />
        <Summary
          label="Owed on account"
          value={formatMoney(owed, currency)}
          detail={owed > 0 ? "Outstanding from customers" : "Nothing outstanding"}
          tone={owed > 0 ? "warning" : undefined}
        />
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-[0.9375rem] font-bold tracking-tight">All sales</h2>
          <span className="tnum text-[0.75rem] text-muted">
            Gross profit {formatMoney(profit, currency)}
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="px-5 py-14 text-center text-sm text-muted">
            No sales yet.{" "}
            <Link href="/pos" className="font-semibold text-brand hover:underline">
              Open the till
            </Link>{" "}
            to record the first one.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>When</th>
                  <th>Customer</th>
                  <th>Served by</th>
                  <th>Payment</th>
                  <th className="num">Items</th>
                  <th className="num">Tax</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link
                        href={`/sales/${row.id}`}
                        className="tnum font-semibold text-brand hover:underline"
                      >
                        {row.number}
                      </Link>
                      {row.balanceDue > 0 && (
                        <span className="chip ml-2 bg-warning-soft text-warning">On account</span>
                      )}
                    </td>
                    <td className="tnum whitespace-nowrap text-muted">
                      {formatDayTime(row.soldAt)}
                    </td>
                    <td className="text-muted">{row.customer ?? "Walk-in"}</td>
                    <td className="text-muted">{row.cashier ?? "—"}</td>
                    <td>
                      <span className="flex flex-wrap gap-1">
                        {(row.methods ?? "")
                          .split(",")
                          .filter(Boolean)
                          .map((method) => (
                            <span key={method} className="chip bg-surface-3 text-muted">
                              {PAYMENT_LABEL[method as keyof typeof PAYMENT_LABEL] ?? method}
                            </span>
                          ))}
                        {!row.methods && <span className="text-faint">—</span>}
                      </span>
                    </td>
                    <td className="num text-muted">{formatQty(Number(row.items))}</td>
                    <td className="num text-muted">{formatMoney(row.taxTotal, currency)}</td>
                    <td className="num font-bold">{formatMoney(row.total, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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

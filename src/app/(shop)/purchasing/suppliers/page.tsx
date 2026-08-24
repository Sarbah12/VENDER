import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { suppliers } from "@/db/schema";
import { formatMoney } from "@/lib/money";
import { getShopContext } from "@/server/context";

export const metadata = { title: "Suppliers" };
export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const context = await getShopContext();
  if (!context) redirect("/setup");

  const db = await getDb();
  const currency = context.business.currencyCode;

  const rows = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.businessId, context.business.id))
    .orderBy(asc(suppliers.name));

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line px-5 py-3.5">
        <h2 className="text-[0.9375rem] font-bold tracking-tight">Suppliers</h2>
        <p className="mt-0.5 text-[0.75rem] text-muted">
          Balances stay at zero until the purchasing module starts posting invoices to Accounts
          Payable.
        </p>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Phone</th>
              <th>Email</th>
              <th className="num">Owed to them</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="font-semibold">{row.name}</td>
                <td className="tnum text-muted">{row.phone ?? "—"}</td>
                <td className="text-muted">{row.email ?? "—"}</td>
                <td className="num">
                  {row.balance > 0 ? (
                    <span className="chip tnum bg-warning-soft text-warning">
                      {formatMoney(row.balance, currency)}
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

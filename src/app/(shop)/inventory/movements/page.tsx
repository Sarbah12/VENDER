import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { employees, products, stockMovements } from "@/db/schema";
import { formatDayTime } from "@/lib/datetime";
import { formatMoney, formatQty } from "@/lib/money";
import { getShopContext } from "@/server/context";

export const metadata = { title: "Stock movements" };
export const dynamic = "force-dynamic";

const REASON_LABEL: Record<string, string> = {
  sale: "Sale",
  refund: "Refund",
  purchase: "Purchase",
  adjustment: "Adjustment",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  opening_balance: "Opening balance",
  wastage: "Wastage",
};

export default async function MovementsPage() {
  const context = await getShopContext();
  if (!context) redirect("/setup");

  const db = await getDb();
  const currency = context.business.currencyCode;

  const rows = await db
    .select({
      id: stockMovements.id,
      createdAt: stockMovements.createdAt,
      product: products.name,
      unit: products.unit,
      delta: stockMovements.quantityDelta,
      balanceAfter: stockMovements.balanceAfter,
      reason: stockMovements.reason,
      refType: stockMovements.refType,
      refId: stockMovements.refId,
      unitCost: stockMovements.unitCost,
      employee: employees.name,
      note: stockMovements.note,
    })
    .from(stockMovements)
    .innerJoin(products, eq(products.id, stockMovements.productId))
    .leftJoin(employees, eq(employees.id, stockMovements.employeeId))
    .where(eq(stockMovements.businessId, context.business.id))
    .orderBy(desc(stockMovements.createdAt))
    .limit(200);

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line px-5 py-3.5">
        <h2 className="text-[0.9375rem] font-bold tracking-tight">Stock movements</h2>
        <p className="mt-0.5 text-[0.75rem] text-muted">
          The append-only record behind every stock figure. On-hand quantities are a running total
          of these rows, so a number can always be traced back to what caused it.
        </p>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Product</th>
              <th>Reason</th>
              <th className="num">Change</th>
              <th className="num">Balance after</th>
              <th className="num">At cost</th>
              <th>By</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const delta = Number(row.delta);
              return (
                <tr key={row.id}>
                  <td className="tnum whitespace-nowrap text-muted">
                    {formatDayTime(row.createdAt)}
                  </td>
                  <td className="font-semibold">{row.product}</td>
                  <td>
                    <span className="chip bg-surface-3 text-muted">
                      {REASON_LABEL[row.reason] ?? row.reason}
                    </span>
                  </td>
                  <td className={`num font-bold ${delta < 0 ? "text-danger" : "text-positive"}`}>
                    {delta > 0 ? "+" : ""}
                    {formatQty(delta)} {row.unit}
                  </td>
                  <td className="num text-muted">
                    {formatQty(Number(row.balanceAfter))} {row.unit}
                  </td>
                  <td className="num text-muted">
                    {formatMoney(Math.abs(row.unitCost * delta), currency)}
                  </td>
                  <td className="text-muted">{row.employee ?? "—"}</td>
                  <td>
                    {row.refType === "sale" && row.refId ? (
                      <Link
                        href={`/sales/${row.refId}`}
                        className="text-[0.75rem] font-semibold text-brand hover:underline"
                      >
                        View sale
                      </Link>
                    ) : (
                      <span className="text-[0.75rem] text-muted">{row.note ?? "—"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

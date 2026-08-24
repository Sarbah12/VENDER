import { and, asc, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { categories, products, stockLevels } from "@/db/schema";
import { formatDayMonth } from "@/lib/datetime";
import { formatMoney, formatQty } from "@/lib/money";
import { getShopContext } from "@/server/context";

export const metadata = { title: "Stock on hand" };
export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const context = await getShopContext();
  if (!context) redirect("/setup");

  const db = await getDb();
  const currency = context.business.currencyCode;
  const warehouseId = context.register?.warehouseId ?? context.warehouse.id;

  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      unit: products.unit,
      costPrice: products.costPrice,
      sellPrice: products.sellPrice,
      reorderPoint: products.reorderPoint,
      category: categories.name,
      quantity: stockLevels.quantity,
      updatedAt: stockLevels.updatedAt,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(
      stockLevels,
      and(eq(stockLevels.productId, products.id), eq(stockLevels.warehouseId, warehouseId)),
    )
    .where(
      and(
        eq(products.businessId, context.business.id),
        eq(products.isActive, true),
        eq(products.trackStock, true),
      ),
    )
    .orderBy(asc(sql`coalesce(${stockLevels.quantity}, 0) - ${products.reorderPoint}`));

  const totalCost = rows.reduce((a, r) => a + r.costPrice * Number(r.quantity ?? 0), 0);
  const belowReorder = rows.filter(
    (r) => Number(r.quantity ?? 0) <= Number(r.reorderPoint),
  ).length;
  const outOfStock = rows.filter((r) => Number(r.quantity ?? 0) <= 0).length;

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Summary label="Stock lines" value={String(rows.length)} detail={context.warehouse.name} />
        <Summary label="Value at cost" value={formatMoney(totalCost, currency)} detail="Matches the Inventory account" />
        <Summary label="Below reorder point" value={String(belowReorder)} detail="Worth ordering" tone={belowReorder > 0 ? "warning" : undefined} />
        <Summary label="Out of stock" value={String(outOfStock)} detail="Cannot be sold" tone={outOfStock > 0 ? "danger" : undefined} />
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-line px-5 py-3.5 text-[0.9375rem] font-bold tracking-tight">
          Stock on hand — {context.warehouse.name}
        </h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th className="num">On hand</th>
                <th className="num">Reorder at</th>
                <th className="num">Unit cost</th>
                <th className="num">Value at cost</th>
                <th>Last movement</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const quantity = Number(row.quantity ?? 0);
                const reorder = Number(row.reorderPoint);
                return (
                  <tr key={row.id}>
                    <td>
                      <span className="block font-semibold">{row.name}</span>
                      <span className="tnum block text-[0.6875rem] text-muted">{row.sku}</span>
                    </td>
                    <td className="text-muted">{row.category ?? "—"}</td>
                    <td className="num">
                      <span
                        className={`chip tnum ${
                          quantity <= 0
                            ? "bg-danger-soft text-danger"
                            : quantity <= reorder
                              ? "bg-warning-soft text-warning"
                              : "bg-positive-soft text-positive"
                        }`}
                      >
                        {formatQty(quantity)} {row.unit}
                      </span>
                    </td>
                    <td className="num text-muted">{formatQty(reorder)}</td>
                    <td className="num text-muted">{formatMoney(row.costPrice, currency)}</td>
                    <td className="num font-semibold">
                      {formatMoney(row.costPrice * quantity, currency)}
                    </td>
                    <td className="tnum whitespace-nowrap text-muted">
                      {row.updatedAt ? formatDayMonth(row.updatedAt) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-surface-2 font-bold">
                <td colSpan={5}>Total</td>
                <td className="num">{formatMoney(totalCost, currency)}</td>
                <td />
              </tr>
            </tfoot>
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
  tone?: "warning" | "danger";
}) {
  return (
    <div className="card p-5">
      <p className="label mb-2">{label}</p>
      <p
        className={`tnum text-[1.5rem] font-bold leading-none tracking-tight ${
          tone === "warning" ? "text-warning" : tone === "danger" ? "text-danger" : ""
        }`}
      >
        {value}
      </p>
      <p className="mt-1.5 text-[0.75rem] text-muted">{detail}</p>
    </div>
  );
}

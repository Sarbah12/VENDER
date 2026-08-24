import { and, asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { categories, products, stockLevels } from "@/db/schema";
import { bpToPercent, formatMoney, formatQty } from "@/lib/money";
import { getShopContext } from "@/server/context";

export const metadata = { title: "Products" };
export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const context = await getShopContext();
  if (!context) redirect("/setup");

  const db = await getDb();
  const currency = context.business.currencyCode;
  const warehouseId = context.register?.warehouseId ?? context.warehouse.id;

  const rows = await db
    .select({
      id: products.id,
      sku: products.sku,
      barcode: products.barcode,
      name: products.name,
      unit: products.unit,
      costPrice: products.costPrice,
      sellPrice: products.sellPrice,
      taxRateBp: products.taxRateBp,
      trackStock: products.trackStock,
      isActive: products.isActive,
      reorderPoint: products.reorderPoint,
      category: categories.name,
      colour: categories.colour,
      stock: stockLevels.quantity,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(
      stockLevels,
      and(eq(stockLevels.productId, products.id), eq(stockLevels.warehouseId, warehouseId)),
    )
    .where(eq(products.businessId, context.business.id))
    .orderBy(asc(categories.sortOrder), asc(products.name));

  const stockValue = rows.reduce(
    (acc, r) => acc + (r.trackStock ? r.costPrice * Number(r.stock ?? 0) : 0),
    0,
  );
  const retailValue = rows.reduce(
    (acc, r) => acc + (r.trackStock ? r.sellPrice * Number(r.stock ?? 0) : 0),
    0,
  );

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-3">
        <Summary label="Products" value={String(rows.length)} detail={`${rows.filter((r) => r.isActive).length} active`} />
        <Summary label="Stock at cost" value={formatMoney(stockValue, currency)} detail="What it owes the balance sheet" />
        <Summary label="Stock at retail" value={formatMoney(retailValue, currency)} detail="If every unit sells at list" />
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-line px-5 py-3.5 text-[0.9375rem] font-bold tracking-tight">
          Catalogue
        </h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th>Barcode</th>
                <th className="num">Cost</th>
                <th className="num">Price</th>
                <th className="num">Margin</th>
                <th className="num">Tax</th>
                <th className="num">On hand</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const margin =
                  row.sellPrice > 0
                    ? Math.round(((row.sellPrice - row.costPrice) / row.sellPrice) * 100)
                    : 0;
                const stock = Number(row.stock ?? 0);
                const low = row.trackStock && stock <= Number(row.reorderPoint);

                return (
                  <tr key={row.id}>
                    <td>
                      <span className="block font-semibold">{row.name}</span>
                      <span className="tnum block text-[0.6875rem] text-muted">{row.sku}</span>
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-1.5 text-muted">
                        <span
                          aria-hidden
                          className="size-2 rounded-full"
                          style={{ background: row.colour ?? "var(--border-strong)" }}
                        />
                        {row.category ?? "—"}
                      </span>
                    </td>
                    <td className="tnum text-muted">{row.barcode ?? "—"}</td>
                    <td className="num text-muted">{formatMoney(row.costPrice, currency)}</td>
                    <td className="num font-semibold">{formatMoney(row.sellPrice, currency)}</td>
                    <td className="num">
                      <span
                        className={
                          margin >= 30 ? "text-positive" : margin >= 15 ? "" : "text-warning"
                        }
                      >
                        {margin}%
                      </span>
                    </td>
                    <td className="num text-muted">
                      {bpToPercent(row.taxRateBp ?? context.business.taxRateBp)}%
                    </td>
                    <td className="num">
                      {row.trackStock ? (
                        <span
                          className={`chip tnum ${
                            stock <= 0
                              ? "bg-danger-soft text-danger"
                              : low
                                ? "bg-warning-soft text-warning"
                                : "bg-surface-3 text-muted"
                          }`}
                        >
                          {formatQty(stock)} {row.unit}
                        </span>
                      ) : (
                        <span className="chip bg-info-soft text-info">Service</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Summary({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="card p-5">
      <p className="label mb-2">{label}</p>
      <p className="tnum text-[1.5rem] font-bold leading-none tracking-tight">{value}</p>
      <p className="mt-1.5 text-[0.75rem] text-muted">{detail}</p>
    </div>
  );
}

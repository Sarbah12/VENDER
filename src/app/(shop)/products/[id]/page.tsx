import { and, asc, desc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { categories, products, stockLevels, stockMovements } from "@/db/schema";
import { formatDayTime } from "@/lib/datetime";
import { bpToPercent, formatMoney, formatQty } from "@/lib/money";
import { can } from "@/server/authz";
import { getShopContext, isSignedIn } from "@/server/context";
import { ProductForm } from "../ProductForm";
import { StockCountPanel } from "./StockCountPanel";

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

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getShopContext();
  if (!context) return { title: "Product" };

  const db = await getDb();
  const [product] = await db
    .select({ name: products.name })
    .from(products)
    .where(and(eq(products.id, id), eq(products.businessId, context.business.id)))
    .limit(1);

  return { title: product?.name ?? "Product" };
}

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const context = await getShopContext();
  if (!context) redirect("/setup");
  if (!isSignedIn(context)) redirect("/sign-in");

  const db = await getDb();
  const warehouseId = context.register?.warehouseId ?? context.warehouse.id;
  const currency = context.business.currencyCode;

  const [row] = await db
    .select({
      product: products,
      onHand: stockLevels.quantity,
    })
    .from(products)
    .leftJoin(
      stockLevels,
      and(eq(stockLevels.productId, products.id), eq(stockLevels.warehouseId, warehouseId)),
    )
    .where(and(eq(products.id, id), eq(products.businessId, context.business.id)))
    .limit(1);

  if (!row) notFound();

  const [categoryList, movements] = await Promise.all([
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.businessId, context.business.id))
      .orderBy(asc(categories.sortOrder), asc(categories.name)),
    db
      .select({
        id: stockMovements.id,
        createdAt: stockMovements.createdAt,
        delta: stockMovements.quantityDelta,
        balanceAfter: stockMovements.balanceAfter,
        reason: stockMovements.reason,
        refType: stockMovements.refType,
        refId: stockMovements.refId,
        note: stockMovements.note,
      })
      .from(stockMovements)
      .where(eq(stockMovements.productId, id))
      .orderBy(desc(stockMovements.createdAt))
      .limit(12),
  ]);

  const product = row.product;
  const onHand = Number(row.onHand ?? 0);
  const editable = can(context.employee, "catalogue:write");
  const margin =
    product.sellPrice > 0
      ? Math.round(((product.sellPrice - product.costPrice) / product.sellPrice) * 100)
      : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/products"
          className="inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold text-muted hover:text-brand"
        >
          <ArrowLeft size={15} /> All products
        </Link>
        <div className="flex items-center gap-2 text-[0.75rem]">
          <span className="chip bg-surface-3 text-muted">Margin {margin}%</span>
          <span
            className={`chip ${product.isActive ? "bg-positive-soft text-positive" : "bg-surface-3 text-muted"}`}
          >
            {product.isActive ? "On sale" : "Retired"}
          </span>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr] lg:items-start">
        <div>
          {editable ? (
            <ProductForm
              values={{
                id: product.id,
                sku: product.sku,
                name: product.name,
                barcode: product.barcode ?? "",
                categoryId: product.categoryId ?? "",
                unit: product.unit,
                costPrice: product.costPrice,
                sellPrice: product.sellPrice,
                taxRateBp: product.taxRateBp,
                trackStock: product.trackStock,
                allowNegativeStock: product.allowNegativeStock,
                reorderPoint: Number(product.reorderPoint),
                isActive: product.isActive,
              }}
              categories={categoryList}
              currencyCode={currency}
              defaultTaxPercent={bpToPercent(context.business.taxRateBp)}
              onHandLabel={
                product.trackStock ? `${formatQty(onHand)} ${product.unit}` : "Not stock-tracked"
              }
            />
          ) : (
            <section className="card p-5">
              <h2 className="text-lg font-bold tracking-tight">{product.name}</h2>
              <dl className="mt-4 grid grid-cols-2 gap-4 text-[0.8125rem]">
                <Detail label="SKU" value={product.sku} />
                <Detail label="Barcode" value={product.barcode ?? "—"} />
                <Detail label="Sell price" value={formatMoney(product.sellPrice, currency)} />
                <Detail label="Cost price" value={formatMoney(product.costPrice, currency)} />
                <Detail
                  label="On hand"
                  value={product.trackStock ? `${formatQty(onHand)} ${product.unit}` : "Not tracked"}
                />
                <Detail label="Unit" value={product.unit} />
              </dl>
              <p className="mt-4 rounded-lg bg-surface-2 px-3 py-2.5 text-[0.75rem] text-muted">
                Your role can view the catalogue but not change it.
              </p>
            </section>
          )}
        </div>

        <div className="space-y-5">
          {product.trackStock && (
            <StockCountPanel
              productId={product.id}
              onHand={onHand}
              unit={product.unit}
              canAdjust={can(context.employee, "stock:adjust")}
            />
          )}

          <section className="card overflow-hidden">
            <h2 className="border-b border-line px-5 py-3.5 text-[0.9375rem] font-bold tracking-tight">
              Recent movements
            </h2>
            {movements.length === 0 ? (
              <p className="px-5 py-8 text-center text-[0.8125rem] text-muted">
                Nothing has moved yet.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {movements.map((movement) => {
                  const delta = Number(movement.delta);
                  return (
                    <li key={movement.id} className="flex items-center gap-3 px-5 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block text-[0.8125rem] font-semibold">
                          {REASON_LABEL[movement.reason] ?? movement.reason}
                        </span>
                        <span className="tnum block text-[0.6875rem] text-muted">
                          {formatDayTime(movement.createdAt)}
                          {movement.note ? ` · ${movement.note}` : ""}
                        </span>
                      </span>
                      {movement.refType === "sale" && movement.refId && (
                        <Link
                          href={`/sales/${movement.refId}`}
                          className="shrink-0 text-[0.6875rem] font-semibold text-brand hover:underline"
                        >
                          Sale
                        </Link>
                      )}
                      <span
                        className={`tnum shrink-0 text-[0.8125rem] font-bold ${
                          delta < 0 ? "text-danger" : "text-positive"
                        }`}
                      >
                        {delta > 0 ? "+" : ""}
                        {formatQty(delta)}
                      </span>
                      <span className="tnum w-12 shrink-0 text-right text-[0.6875rem] text-muted">
                        {formatQty(Number(movement.balanceAfter))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.6875rem] font-semibold uppercase tracking-wide text-faint">{label}</dt>
      <dd className="mt-0.5 font-semibold">{value}</dd>
    </div>
  );
}

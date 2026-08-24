import { and, asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { categories, customers, products, stockLevels } from "@/db/schema";
import { getShopContext, isSignedIn } from "@/server/context";
import { PosTerminal } from "./PosTerminal";
import type { PosProduct } from "./types";

export const metadata = { title: "Point of Sale" };

// A till must always show current stock, never a cached shelf from ten minutes ago.
export const dynamic = "force-dynamic";

export default async function PosPage() {
  const context = await getShopContext();
  if (!context) redirect("/setup");
  if (!isSignedIn(context)) redirect("/sign-in");

  const db = await getDb();
  const warehouseId = context.register?.warehouseId ?? context.warehouse.id;

  const [catalogue, customerRows] = await Promise.all([
    db
      .select({
        id: products.id,
        name: products.name,
        sku: products.sku,
        barcode: products.barcode,
        unit: products.unit,
        sellPrice: products.sellPrice,
        taxRateBp: products.taxRateBp,
        trackStock: products.trackStock,
        allowNegativeStock: products.allowNegativeStock,
        stock: stockLevels.quantity,
        categoryId: categories.id,
        categoryName: categories.name,
        categoryColour: categories.colour,
        categorySort: categories.sortOrder,
      })
      .from(products)
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .leftJoin(
        stockLevels,
        and(eq(stockLevels.productId, products.id), eq(stockLevels.warehouseId, warehouseId)),
      )
      .where(and(eq(products.businessId, context.business.id), eq(products.isActive, true)))
      .orderBy(asc(categories.sortOrder), asc(products.name)),

    db
      .select({ id: customers.id, name: customers.name, phone: customers.phone })
      .from(customers)
      .where(eq(customers.businessId, context.business.id))
      .orderBy(asc(customers.name)),
  ]);

  const items: PosProduct[] = catalogue.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    unit: p.unit,
    sellPrice: p.sellPrice,
    // A product with no rate of its own inherits the business default.
    taxRateBp: p.taxRateBp ?? context.business.taxRateBp,
    trackStock: p.trackStock,
    allowNegativeStock: p.allowNegativeStock,
    stock: Number(p.stock ?? 0),
    categoryId: p.categoryId,
    categoryName: p.categoryName ?? "Uncategorised",
    categoryColour: p.categoryColour,
  }));

  return (
    <PosTerminal
      products={items}
      customers={customerRows}
      currencyCode={context.business.currencyCode}
      pricesIncludeTax={context.business.pricesIncludeTax}
      shopName={context.business.name}
      registerName={context.register?.name ?? "Counter"}
      cashierName={context.employee.name}
    />
  );
}

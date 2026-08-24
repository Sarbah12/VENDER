import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { customers } from "@/db/schema";
import { catalogueSize, listCategories, searchCatalogue } from "@/server/catalogue";
import { getShopContext, isSignedIn } from "@/server/context";
import { PosTerminal } from "./PosTerminal";
import type { PosProduct } from "./types";

export const metadata = { title: "Point of Sale" };

// A till must always show current stock, never a cached shelf from ten minutes ago.
export const dynamic = "force-dynamic";

/**
 * Below this many products the till holds the whole catalogue in memory, so
 * browsing and searching are instant and survive a brief network drop. Above it,
 * shipping every row to a tablet would cost megabytes and seconds, so the till
 * loads a slice and asks the server as the cashier types.
 */
export const POS_FULL_LOAD_LIMIT = 1500;

/** How many products to show for browsing when the catalogue is too big to hold. */
const BROWSE_SLICE = 300;

export default async function PosPage() {
  const context = await getShopContext();
  if (!context) redirect("/setup");
  if (!isSignedIn(context)) redirect("/sign-in");

  const db = await getDb();
  const warehouseId = context.register?.warehouseId ?? context.warehouse.id;

  const size = await catalogueSize(context.business.id);
  const holdsEverything = size <= POS_FULL_LOAD_LIMIT;

  const [catalogue, categoryRows, customerRows] = await Promise.all([
    searchCatalogue({
      businessId: context.business.id,
      warehouseId,
      limit: holdsEverything ? POS_FULL_LOAD_LIMIT : BROWSE_SLICE,
    }),
    listCategories(context.business.id),
    db
      .select({ id: customers.id, name: customers.name, phone: customers.phone })
      .from(customers)
      .where(eq(customers.businessId, context.business.id))
      .orderBy(asc(customers.name))
      .limit(500),
  ]);

  const items: PosProduct[] = catalogue.rows.map((p) => ({
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
    stock: p.stock,
    categoryId: p.categoryId,
    categoryName: p.categoryName,
    categoryColour: p.categoryColour,
  }));

  return (
    <PosTerminal
      products={items}
      categories={categoryRows.map((c) => ({
        id: c.id,
        name: c.name,
        colour: c.colour,
        count: c.products,
      }))}
      catalogueSize={size}
      holdsEverything={holdsEverything}
      customers={customerRows}
      currencyCode={context.business.currencyCode}
      pricesIncludeTax={context.business.pricesIncludeTax}
      shopName={context.business.name}
      registerName={context.register?.name ?? "Counter"}
      cashierName={context.employee.name}
    />
  );
}

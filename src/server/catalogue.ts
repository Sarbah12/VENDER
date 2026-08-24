import "server-only";

import { and, asc, count, eq, ilike, or, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { categories, products, stockLevels } from "@/db/schema";

/**
 * Reading the catalogue at scale.
 *
 * A shop with four hundred lines and a distributor with forty thousand are the
 * same product, so nothing here loads "all products". The till and the product
 * list both go through these functions, which page, search and count in the
 * database rather than in JavaScript.
 */

export type CatalogueRow = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  unit: string;
  sellPrice: number;
  costPrice: number;
  taxRateBp: number | null;
  trackStock: boolean;
  allowNegativeStock: boolean;
  reorderPoint: number;
  isActive: boolean;
  stock: number;
  categoryId: string | null;
  categoryName: string;
  categoryColour: string | null;
};

const SELECTION = {
  id: products.id,
  name: products.name,
  sku: products.sku,
  barcode: products.barcode,
  unit: products.unit,
  sellPrice: products.sellPrice,
  costPrice: products.costPrice,
  taxRateBp: products.taxRateBp,
  trackStock: products.trackStock,
  allowNegativeStock: products.allowNegativeStock,
  reorderPoint: products.reorderPoint,
  isActive: products.isActive,
  stock: stockLevels.quantity,
  categoryId: categories.id,
  categoryName: categories.name,
  categoryColour: categories.colour,
};

function shape(row: Record<string, unknown>): CatalogueRow {
  return {
    id: row.id as string,
    name: row.name as string,
    sku: row.sku as string,
    barcode: (row.barcode as string | null) ?? null,
    unit: row.unit as string,
    sellPrice: row.sellPrice as number,
    costPrice: row.costPrice as number,
    taxRateBp: (row.taxRateBp as number | null) ?? null,
    trackStock: row.trackStock as boolean,
    allowNegativeStock: row.allowNegativeStock as boolean,
    reorderPoint: Number(row.reorderPoint ?? 0),
    isActive: row.isActive as boolean,
    stock: Number(row.stock ?? 0),
    categoryId: (row.categoryId as string | null) ?? null,
    categoryName: (row.categoryName as string | null) ?? "Uncategorised",
    categoryColour: (row.categoryColour as string | null) ?? null,
  };
}

/**
 * `%term%` matching is a sequential scan. That is genuinely fine into the tens
 * of thousands of products with a LIMIT on the end, and it avoids depending on
 * pg_trgm, which is not available in every Postgres this can run on. If a
 * catalogue ever outgrows it, a trigram index on name is the next step.
 */
function matches(term: string) {
  const like = `%${term.replace(/[%_]/g, (c) => `\\${c}`)}%`;
  return or(ilike(products.name, like), ilike(products.sku, like), ilike(products.barcode, like));
}

export type CatalogueQuery = {
  businessId: string;
  warehouseId: string;
  query?: string;
  /** Restrict to one category; "none" means uncategorised. */
  categoryId?: string | null;
  includeInactive?: boolean;
  limit?: number;
  offset?: number;
};

export async function searchCatalogue(
  options: CatalogueQuery,
): Promise<{ rows: CatalogueRow[]; total: number }> {
  const db = await getDb();
  const term = options.query?.trim() ?? "";

  const filters = [eq(products.businessId, options.businessId)];
  if (!options.includeInactive) filters.push(eq(products.isActive, true));
  if (term) filters.push(matches(term)!);
  if (options.categoryId === "none") filters.push(sql`${products.categoryId} is null`);
  else if (options.categoryId) filters.push(eq(products.categoryId, options.categoryId));

  const where = and(...filters);

  const [rows, [totals]] = await Promise.all([
    db
      .select(SELECTION)
      .from(products)
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .leftJoin(
        stockLevels,
        and(
          eq(stockLevels.productId, products.id),
          eq(stockLevels.warehouseId, options.warehouseId),
        ),
      )
      .where(where)
      .orderBy(asc(categories.sortOrder), asc(products.name))
      .limit(options.limit ?? 50)
      .offset(options.offset ?? 0),

    db.select({ n: count() }).from(products).where(where),
  ]);

  return { rows: rows.map(shape), total: totals?.n ?? 0 };
}

/** How many sellable products exist. Decides whether the till can hold them all. */
export async function catalogueSize(businessId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ n: count() })
    .from(products)
    .where(and(eq(products.businessId, businessId), eq(products.isActive, true)));
  return row?.n ?? 0;
}

/**
 * Exact barcode or SKU lookup — the scanner's path.
 *
 * Indexed and unique, so this stays instant no matter how big the catalogue
 * gets. It never falls back to a fuzzy match: a scan that resolves to the wrong
 * product is worse than one that resolves to nothing.
 */
export async function findByCode(
  businessId: string,
  warehouseId: string,
  code: string,
): Promise<CatalogueRow | null> {
  const db = await getDb();
  const trimmed = code.trim();
  if (!trimmed) return null;

  const [row] = await db
    .select(SELECTION)
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(
      stockLevels,
      and(eq(stockLevels.productId, products.id), eq(stockLevels.warehouseId, warehouseId)),
    )
    .where(
      and(
        eq(products.businessId, businessId),
        eq(products.isActive, true),
        or(eq(products.barcode, trimmed), sql`lower(${products.sku}) = lower(${trimmed})`),
      ),
    )
    .limit(1);

  return row ? shape(row) : null;
}

/** Whole-catalogue figures for the summary tiles, computed in the database. */
export async function catalogueTotals(
  businessId: string,
  warehouseId: string,
): Promise<{ products: number; active: number; stockAtCost: number; stockAtRetail: number }> {
  const db = await getDb();

  const [row] = await db
    .select({
      products: count(),
      active: sql<string>`coalesce(sum(case when ${products.isActive} then 1 else 0 end), 0)`,
      stockAtCost: sql<string>`coalesce(sum(case when ${products.trackStock} then ${products.costPrice} * coalesce(${stockLevels.quantity}, 0) else 0 end), 0)`,
      stockAtRetail: sql<string>`coalesce(sum(case when ${products.trackStock} then ${products.sellPrice} * coalesce(${stockLevels.quantity}, 0) else 0 end), 0)`,
    })
    .from(products)
    .leftJoin(
      stockLevels,
      and(eq(stockLevels.productId, products.id), eq(stockLevels.warehouseId, warehouseId)),
    )
    .where(eq(products.businessId, businessId));

  return {
    products: row?.products ?? 0,
    active: Number(row?.active ?? 0),
    stockAtCost: Math.round(Number(row?.stockAtCost ?? 0)),
    stockAtRetail: Math.round(Number(row?.stockAtRetail ?? 0)),
  };
}

export async function listCategories(businessId: string) {
  const db = await getDb();
  return db
    .select({
      id: categories.id,
      name: categories.name,
      colour: categories.colour,
      products: count(products.id),
    })
    .from(categories)
    .leftJoin(
      products,
      and(eq(products.categoryId, categories.id), eq(products.isActive, true)),
    )
    .where(eq(categories.businessId, businessId))
    .groupBy(categories.id, categories.name, categories.colour, categories.sortOrder)
    .orderBy(asc(categories.sortOrder), asc(categories.name));
}

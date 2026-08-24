import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { getDb, type Database } from "@/db/client";
import { products, stockLevels, stockMovements } from "@/db/schema";
import { roundHalfAwayFromZero, roundQty } from "@/lib/money";
import { postJournal } from "./ledger";

export class ProductError extends Error {
  constructor(
    readonly code: "duplicate_sku" | "duplicate_barcode" | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "ProductError";
  }
}

export type ProductWrite = {
  sku: string;
  name: string;
  barcode: string | null;
  categoryId: string | null;
  unit: string;
  /** Minor units. */
  costPrice: number;
  sellPrice: number;
  /** null inherits the business default rate. */
  taxRateBp: number | null;
  trackStock: boolean;
  allowNegativeStock: boolean;
  reorderPoint: number;
  isActive: boolean;
};

/* ────────────────────────────── Uniqueness ─────────────────────────────── */

/**
 * Checked in code as well as by the unique indexes.
 *
 * The index is what guarantees correctness under concurrency; this exists so the
 * person filling in the form is told which field clashes, rather than being
 * handed a constraint-violation stack trace.
 */
async function assertUnique(
  tx: Database,
  businessId: string,
  input: Pick<ProductWrite, "sku" | "barcode">,
  excludeProductId?: string,
): Promise<void> {
  const clashes = await tx
    .select({ id: products.id, sku: products.sku, barcode: products.barcode })
    .from(products)
    .where(
      and(
        eq(products.businessId, businessId),
        input.barcode
          ? sql`(${products.sku} = ${input.sku} or ${products.barcode} = ${input.barcode})`
          : eq(products.sku, input.sku),
      ),
    );

  for (const clash of clashes) {
    if (excludeProductId && clash.id === excludeProductId) continue;
    if (clash.sku === input.sku) {
      throw new ProductError("duplicate_sku", `SKU "${input.sku}" is already used.`);
    }
    if (input.barcode && clash.barcode === input.barcode) {
      throw new ProductError(
        "duplicate_barcode",
        `Barcode "${input.barcode}" already belongs to "${clash.sku}".`,
      );
    }
  }
}

/* ──────────────────────────────── Writes ───────────────────────────────── */

export async function createProductIn(
  tx: Database,
  args: {
    businessId: string;
    warehouseId: string;
    branchId?: string | null;
    employeeId?: string | null;
    input: ProductWrite;
    /** Counted-in quantity. Posts to Inventory against Opening Balance Equity. */
    openingStock?: number;
  },
): Promise<string> {
  await assertUnique(tx, args.businessId, args.input);

  const [created] = await tx
    .insert(products)
    .values({
      businessId: args.businessId,
      categoryId: args.input.categoryId,
      sku: args.input.sku,
      barcode: args.input.barcode,
      name: args.input.name,
      unit: args.input.unit,
      costPrice: args.input.costPrice,
      sellPrice: args.input.sellPrice,
      taxRateBp: args.input.taxRateBp,
      trackStock: args.input.trackStock,
      allowNegativeStock: args.input.allowNegativeStock,
      reorderPoint: args.input.reorderPoint,
      isActive: args.input.isActive,
    })
    .returning({ id: products.id });

  const opening = roundQty(args.openingStock ?? 0);
  if (args.input.trackStock && opening > 0) {
    await recordOpeningStockIn(tx, {
      businessId: args.businessId,
      branchId: args.branchId ?? null,
      warehouseId: args.warehouseId,
      employeeId: args.employeeId ?? null,
      productId: created.id,
      quantity: opening,
      unitCost: args.input.costPrice,
      memo: `Opening stock — ${args.input.name}`,
    });
  }

  return created.id;
}

export async function updateProductIn(
  tx: Database,
  args: {
    businessId: string;
    productId: string;
    branchId?: string | null;
    input: ProductWrite;
  },
): Promise<void> {
  await assertUnique(tx, args.businessId, args.input, args.productId);

  const [before] = await tx
    .select({ costPrice: products.costPrice, trackStock: products.trackStock, name: products.name })
    .from(products)
    .where(and(eq(products.id, args.productId), eq(products.businessId, args.businessId)))
    .limit(1);

  const updated = await tx
    .update(products)
    .set({
      categoryId: args.input.categoryId,
      sku: args.input.sku,
      barcode: args.input.barcode,
      name: args.input.name,
      unit: args.input.unit,
      costPrice: args.input.costPrice,
      sellPrice: args.input.sellPrice,
      taxRateBp: args.input.taxRateBp,
      trackStock: args.input.trackStock,
      allowNegativeStock: args.input.allowNegativeStock,
      reorderPoint: args.input.reorderPoint,
      isActive: args.input.isActive,
    })
    .where(and(eq(products.id, args.productId), eq(products.businessId, args.businessId)))
    .returning({ id: products.id });

  if (updated.length === 0) {
    throw new ProductError("not_found", "That product no longer exists.");
  }

  if (before) {
    await revalueOnHand(tx, {
      businessId: args.businessId,
      branchId: args.branchId ?? null,
      productId: args.productId,
      name: args.input.name,
      previousCost: before.costPrice,
      newCost: args.input.costPrice,
      trackStock: before.trackStock && args.input.trackStock,
    });
  }
}

/**
 * Keeps the Inventory account honest when a cost price changes.
 *
 * Stock on the shelf was booked in at the old cost. If a new supplier price is
 * saved — one product at a time, or four hundred at once through an import —
 * and nothing is posted, the Inventory balance quietly stops matching the stock
 * report, and the difference is invisible. Writing the revaluation means the
 * two always agree, and the gain or loss is a line the owner can actually see.
 */
async function revalueOnHand(
  tx: Database,
  args: {
    businessId: string;
    branchId: string | null;
    productId: string;
    name: string;
    previousCost: number;
    newCost: number;
    trackStock: boolean;
  },
): Promise<void> {
  if (!args.trackStock || args.newCost === args.previousCost) return;

  const [held] = await tx
    .select({ quantity: sql<string>`coalesce(sum(${stockLevels.quantity}), 0)` })
    .from(stockLevels)
    .where(
      and(eq(stockLevels.productId, args.productId), eq(stockLevels.businessId, args.businessId)),
    );

  const quantity = roundQty(Number(held?.quantity ?? 0));
  if (quantity === 0) return;

  const delta = roundHalfAwayFromZero((args.newCost - args.previousCost) * quantity);
  if (delta === 0) return;

  const value = Math.abs(delta);
  const worthMore = delta > 0;

  await postJournal(tx, {
    businessId: args.businessId,
    branchId: args.branchId,
    memo: `Cost revaluation — ${args.name}`,
    refType: "revaluation",
    refId: args.productId,
    lines: worthMore
      ? [
          { key: "inventory", debit: value, credit: 0, memo: "Stock revalued upward" },
          { key: "stock_adjustments", debit: 0, credit: value, memo: "Cost price increased" },
        ]
      : [
          { key: "stock_adjustments", debit: value, credit: 0, memo: "Cost price reduced" },
          { key: "inventory", debit: 0, credit: value, memo: "Stock revalued downward" },
        ],
  });
}

/**
 * Stock counted in for the first time.
 *
 * Opening stock is not free — it is an asset the owner put into the business —
 * so it is debited to Inventory against Opening Balance Equity. Skipping that
 * would leave the balance sheet understating what the shop owns.
 */
export async function recordOpeningStockIn(
  tx: Database,
  args: {
    businessId: string;
    branchId?: string | null;
    warehouseId: string;
    employeeId?: string | null;
    productId: string;
    quantity: number;
    unitCost: number;
    memo: string;
  },
): Promise<void> {
  const quantity = roundQty(args.quantity);
  if (quantity <= 0) return;

  const [level] = await tx
    .insert(stockLevels)
    .values({
      businessId: args.businessId,
      warehouseId: args.warehouseId,
      productId: args.productId,
      quantity,
    })
    .onConflictDoUpdate({
      target: [stockLevels.warehouseId, stockLevels.productId],
      set: { quantity: sql`${stockLevels.quantity} + ${quantity}`, updatedAt: new Date() },
    })
    .returning({ quantity: stockLevels.quantity });

  await tx.insert(stockMovements).values({
    businessId: args.businessId,
    warehouseId: args.warehouseId,
    productId: args.productId,
    quantityDelta: quantity,
    balanceAfter: roundQty(Number(level.quantity)),
    reason: "opening_balance",
    refType: "opening_balance",
    unitCost: args.unitCost,
    employeeId: args.employeeId ?? null,
    note: args.memo,
  });

  const value = roundHalfAwayFromZero(args.unitCost * quantity);
  if (value !== 0) {
    await postJournal(tx, {
      businessId: args.businessId,
      branchId: args.branchId ?? null,
      memo: args.memo,
      refType: "opening_balance",
      refId: args.productId,
      lines: [
        { key: "inventory", debit: value, credit: 0, memo: "Stock counted in at cost" },
        {
          key: "opening_balance_equity",
          debit: 0,
          credit: value,
          memo: "Owner's opening contribution",
        },
      ],
    });
  }
}

/**
 * Correct on-hand stock to a counted figure.
 *
 * The difference is written off to (or recovered from) Stock Adjustments rather
 * than quietly changing Inventory on its own, so shrinkage is a number the owner
 * can see in the P&L instead of a gap nobody can explain.
 */
export async function adjustStock(args: {
  businessId: string;
  branchId?: string | null;
  warehouseId: string;
  employeeId?: string | null;
  productId: string;
  countedQuantity: number;
  note: string;
}): Promise<{ delta: number; balanceAfter: number }> {
  const db = await getDb();

  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Database;

    const [product] = await tx
      .select({ id: products.id, name: products.name, costPrice: products.costPrice })
      .from(products)
      .where(and(eq(products.id, args.productId), eq(products.businessId, args.businessId)))
      .limit(1);
    if (!product) throw new ProductError("not_found", "That product no longer exists.");

    const [existing] = await tx
      .select({ quantity: stockLevels.quantity })
      .from(stockLevels)
      .where(
        and(
          eq(stockLevels.productId, args.productId),
          eq(stockLevels.warehouseId, args.warehouseId),
        ),
      )
      .limit(1);

    const current = roundQty(Number(existing?.quantity ?? 0));
    const counted = roundQty(args.countedQuantity);
    const delta = roundQty(counted - current);

    if (delta === 0) return { delta: 0, balanceAfter: current };

    await tx
      .insert(stockLevels)
      .values({
        businessId: args.businessId,
        warehouseId: args.warehouseId,
        productId: args.productId,
        quantity: counted,
      })
      .onConflictDoUpdate({
        target: [stockLevels.warehouseId, stockLevels.productId],
        set: { quantity: counted, updatedAt: new Date() },
      });

    await tx.insert(stockMovements).values({
      businessId: args.businessId,
      warehouseId: args.warehouseId,
      productId: args.productId,
      quantityDelta: delta,
      balanceAfter: counted,
      reason: "adjustment",
      refType: "adjustment",
      refId: args.productId,
      unitCost: product.costPrice,
      employeeId: args.employeeId ?? null,
      note: args.note,
    });

    const value = Math.abs(roundHalfAwayFromZero(product.costPrice * delta));
    if (value !== 0) {
      const foundMore = delta > 0;
      await postJournal(tx, {
        businessId: args.businessId,
        branchId: args.branchId ?? null,
        memo: `Stock adjustment — ${product.name}`,
        refType: "adjustment",
        refId: args.productId,
        lines: foundMore
          ? [
              { key: "inventory", debit: value, credit: 0, memo: args.note },
              { key: "stock_adjustments", debit: 0, credit: value, memo: "Surplus on count" },
            ]
          : [
              { key: "stock_adjustments", debit: value, credit: 0, memo: "Shortfall on count" },
              { key: "inventory", debit: 0, credit: value, memo: args.note },
            ],
      });
    }

    return { delta, balanceAfter: counted };
  });
}

/* ─────────────────── Single-product convenience wrappers ───────────────── */

export async function createProduct(args: {
  businessId: string;
  warehouseId: string;
  branchId?: string | null;
  employeeId?: string | null;
  input: ProductWrite;
  openingStock?: number;
}): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => createProductIn(tx as unknown as Database, args));
}

export async function updateProduct(args: {
  businessId: string;
  productId: string;
  branchId?: string | null;
  input: ProductWrite;
}): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => updateProductIn(tx as unknown as Database, args));
}

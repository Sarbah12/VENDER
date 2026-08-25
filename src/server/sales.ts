import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { getDb, type Database } from "@/db/client";
import {
  businesses,
  customers,
  counters,
  payments as paymentsTable,
  products as productsTable,
  registers,
  saleLines,
  sales,
  stockLevels,
  stockMovements,
  type PaymentMethod,
} from "@/db/schema";
import { PAYMENT_ACCOUNT, PAYMENT_LABEL } from "@/domain/accounts";
import { priceLine, settle, totalsFor, type PricedLine } from "@/domain/pricing";
import { roundHalfAwayFromZero, roundQty, type Minor } from "@/lib/money";
import { LedgerError, postJournal, type JournalDraftLine } from "./ledger";

export type SaleLineInput = {
  productId: string;
  quantity: number;
  /** Override the catalogue price (manager discretion, weighed goods). */
  unitPrice?: Minor;
  /** Line discount, in the business's price basis. */
  discount?: Minor;
};

export type SalePaymentInput = {
  method: PaymentMethod;
  amount: Minor;
  reference?: string;
};

export type RecordSaleInput = {
  businessId: string;
  branchId: string;
  warehouseId: string;
  registerId?: string | null;
  registerSessionId?: string | null;
  employeeId?: string | null;
  customerId?: string | null;
  lines: SaleLineInput[];
  payments: SalePaymentInput[];
  /** Idempotency key minted by the till before the first attempt. */
  clientRef?: string | null;
  note?: string | null;
  /** When the till rang it up — may be well before it reached the server. */
  soldAt?: Date;
};

export type RecordSaleResult = {
  saleId: string;
  number: string;
  total: Minor;
  changeGiven: Minor;
  balanceDue: Minor;
  /** True when this clientRef had already been recorded and was replayed. */
  duplicate: boolean;
};

export class SaleError extends Error {
  constructor(
    readonly code:
      | "empty_sale"
      | "unknown_product"
      | "inactive_product"
      | "bad_quantity"
      | "insufficient_stock"
      | "overpayment_without_cash"
      | "credit_requires_customer"
      | "unknown_customer"
      | "unbalanced_ledger"
      | "missing_accounts",
    message: string,
  ) {
    super(message);
    this.name = "SaleError";
  }
}

/**
 * Record a completed sale.
 *
 * This is the function the whole product is built around. The idea document's
 * core principle — "a transaction should never exist in isolation" — is enforced
 * here and nowhere else: one database transaction writes the sale, its lines,
 * its tenders, the stock movements, the running stock levels, the customer's
 * balance and a balanced double-entry journal. Either every one of those lands
 * or none of them do. There is no path in the product that sells stock without
 * also moving inventory and posting to the ledger.
 */
export async function recordSale(input: RecordSaleInput): Promise<RecordSaleResult> {
  const db = await getDb();
  return db.transaction(async (tx) => runRecordSale(tx as unknown as Database, input));
}

async function runRecordSale(tx: Database, input: RecordSaleInput): Promise<RecordSaleResult> {
  const { businessId } = input;

  // ── 0. Idempotent replay ────────────────────────────────────────────────
  // A till that lost the network mid-checkout retries with the same clientRef.
  // Returning the original sale keeps a flaky connection from double-charging
  // the customer and double-depleting the shelf.
  if (input.clientRef) {
    const [existing] = await tx
      .select({
        id: sales.id,
        number: sales.number,
        total: sales.total,
        changeGiven: sales.changeGiven,
        balanceDue: sales.balanceDue,
      })
      .from(sales)
      .where(and(eq(sales.businessId, businessId), eq(sales.clientRef, input.clientRef)))
      .limit(1);

    if (existing) {
      return {
        saleId: existing.id,
        number: existing.number,
        total: existing.total,
        changeGiven: existing.changeGiven,
        balanceDue: existing.balanceDue,
        duplicate: true,
      };
    }
  }

  if (input.lines.length === 0) {
    throw new SaleError("empty_sale", "A sale needs at least one line.");
  }

  // ── 1. Load everything the arithmetic depends on ────────────────────────
  const [business] = await tx.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!business) throw new SaleError("unknown_product", "Unknown business.");

  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  const catalogue = await tx
    .select()
    .from(productsTable)
    .where(and(eq(productsTable.businessId, businessId), inArray(productsTable.id, productIds)));

  const byId = new Map(catalogue.map((p) => [p.id, p]));
  for (const id of productIds) {
    const product = byId.get(id);
    if (!product) throw new SaleError("unknown_product", `Product ${id} is not in this catalogue.`);
    if (!product.isActive) {
      throw new SaleError("inactive_product", `${product.name} is no longer for sale.`);
    }
  }

  // ── 2. Price every line ─────────────────────────────────────────────────
  const priced: Array<{ input: SaleLineInput; product: (typeof catalogue)[number]; price: PricedLine; taxRateBp: number }> = [];

  for (const line of input.lines) {
    const product = byId.get(line.productId)!;
    const quantity = roundQty(line.quantity);
    if (!(quantity > 0)) {
      throw new SaleError("bad_quantity", `${product.name} needs a quantity greater than zero.`);
    }

    const taxRateBp = product.taxRateBp ?? business.taxRateBp;
    const unitPrice = line.unitPrice ?? product.sellPrice;
    const price = priceLine(
      { quantity, unitPrice, discount: line.discount, taxRateBp },
      business.pricesIncludeTax,
    );

    priced.push({ input: { ...line, quantity }, product, price, taxRateBp });
  }

  const totals = totalsFor(priced.map((p) => p.price));
  const costTotal = priced.reduce(
    (acc, p) => acc + roundHalfAwayFromZero(p.product.costPrice * p.input.quantity),
    0,
  );

  // ── 3. Settle the tenders ───────────────────────────────────────────────
  const settlement = settle(totals.total, input.payments);

  if (settlement.applied > totals.total) {
    throw new SaleError(
      "overpayment_without_cash",
      "More was tendered than the sale total, and change can only be given from cash.",
    );
  }
  if (settlement.balanceDue > 0 && !input.customerId) {
    throw new SaleError(
      "credit_requires_customer",
      "A sale left unpaid has to be attached to a customer account.",
    );
  }

  // The customer id arrives from the till, so it is not to be trusted with a
  // balance update until it is confirmed to belong to this business.
  if (input.customerId) {
    const [customer] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, input.customerId), eq(customers.businessId, businessId)))
      .limit(1);

    if (!customer) {
      throw new SaleError("unknown_customer", "That customer is not on this business's books.");
    }
  }

  // ── 4. Mint the receipt number ──────────────────────────────────────────
  const prefix = await receiptPrefix(tx, input.registerId ?? null);
  const number = await nextNumber(tx, businessId, `receipt:${prefix}`, prefix);

  const soldAt = input.soldAt ?? new Date();

  // ── 5. The sale itself ──────────────────────────────────────────────────
  const [sale] = await tx
    .insert(sales)
    .values({
      businessId,
      branchId: input.branchId,
      registerSessionId: input.registerSessionId ?? null,
      employeeId: input.employeeId ?? null,
      customerId: input.customerId ?? null,
      number,
      status: "completed",
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      taxTotal: totals.taxTotal,
      total: totals.total,
      paidTotal: settlement.applied,
      changeGiven: settlement.changeGiven,
      balanceDue: settlement.balanceDue,
      costTotal,
      clientRef: input.clientRef ?? null,
      note: input.note ?? null,
      soldAt,
    })
    .returning({ id: sales.id });

  await tx.insert(saleLines).values(
    priced.map((p, index) => ({
      saleId: sale.id,
      productId: p.product.id,
      lineNumber: index + 1,
      nameSnapshot: p.product.name,
      skuSnapshot: p.product.sku,
      unitSnapshot: p.product.unit,
      quantity: p.input.quantity,
      unitPrice: p.input.unitPrice ?? p.product.sellPrice,
      discountAmount: p.price.discountNet,
      taxRateBp: p.taxRateBp,
      taxAmount: p.price.taxAmount,
      netAmount: p.price.netAmount,
      lineTotal: p.price.lineTotal,
      costSnapshot: p.product.costPrice,
    })),
  );

  if (input.payments.length > 0) {
    await tx.insert(paymentsTable).values(
      input.payments.map((p) => ({
        businessId,
        saleId: sale.id,
        method: p.method,
        amount: p.amount,
        reference: p.reference ?? null,
      })),
    );
  }

  // ── 6. Move the stock ───────────────────────────────────────────────────
  // The upsert increments in place, so two tills selling the last tin of milk
  // serialise on the row rather than both reading "1 left".
  for (const p of priced) {
    if (!p.product.trackStock) continue;

    const delta = -p.input.quantity;
    const [level] = await tx
      .insert(stockLevels)
      .values({
        businessId,
        warehouseId: input.warehouseId,
        productId: p.product.id,
        quantity: delta,
      })
      .onConflictDoUpdate({
        target: [stockLevels.warehouseId, stockLevels.productId],
        set: {
          quantity: sql`${stockLevels.quantity} + ${delta}`,
          updatedAt: new Date(),
        },
      })
      .returning({ quantity: stockLevels.quantity });

    const balanceAfter = roundQty(Number(level.quantity));
    if (balanceAfter < 0 && !p.product.allowNegativeStock) {
      // Throwing unwinds the whole transaction, including the decrement above.
      throw new SaleError(
        "insufficient_stock",
        `Not enough ${p.product.name} in stock — short by ${Math.abs(balanceAfter)} ${p.product.unit}.`,
      );
    }

    await tx.insert(stockMovements).values({
      businessId,
      warehouseId: input.warehouseId,
      productId: p.product.id,
      quantityDelta: delta,
      balanceAfter,
      reason: "sale",
      refType: "sale",
      refId: sale.id,
      unitCost: p.product.costPrice,
      employeeId: input.employeeId ?? null,
    });
  }

  // ── 7. Post the ledger ──────────────────────────────────────────────────
  await postSaleToLedger(tx, {
    businessId,
    branchId: input.branchId,
    saleId: sale.id,
    number,
    entryDate: soldAt,
    totals,
    costTotal,
    balanceDue: settlement.balanceDue,
    tenders: input.payments.map((p, i) => ({
      method: p.method,
      applied: settlement.appliedPerPayment[i],
    })),
  });

  // ── 8. Carry any unpaid balance onto the customer's account ─────────────
  if (settlement.balanceDue > 0 && input.customerId) {
    await tx
      .update(customers)
      .set({ balance: sql`${customers.balance} + ${settlement.balanceDue}` })
      .where(and(eq(customers.id, input.customerId), eq(customers.businessId, businessId)));
  }

  return {
    saleId: sale.id,
    number,
    total: totals.total,
    changeGiven: settlement.changeGiven,
    balanceDue: settlement.balanceDue,
    duplicate: false,
  };
}

/* ─────────────────────────────── Ledger posting ────────────────────────── */

async function postSaleToLedger(
  tx: Database,
  args: {
    businessId: string;
    branchId: string;
    saleId: string;
    number: string;
    entryDate: Date;
    totals: { subtotal: Minor; discountTotal: Minor; taxTotal: Minor; total: Minor };
    costTotal: Minor;
    balanceDue: Minor;
    tenders: Array<{ method: PaymentMethod; applied: Minor }>;
  },
) {
  const draft: JournalDraftLine[] = [];

  // Money in, by tender type.
  for (const tender of args.tenders) {
    if (tender.applied === 0) continue;
    draft.push({
      key: PAYMENT_ACCOUNT[tender.method],
      debit: tender.applied,
      credit: 0,
      memo: `${PAYMENT_LABEL[tender.method]} — ${args.number}`,
    });
  }

  // Anything unpaid is a receivable, not revenue we never earned.
  if (args.balanceDue > 0) {
    draft.push({
      key: "accounts_receivable",
      debit: args.balanceDue,
      credit: 0,
      memo: `Balance due — ${args.number}`,
    });
  }

  // Revenue is credited gross, with the discount shown on its own contra line,
  // so "how much did we give away this month" is a question the ledger answers.
  if (args.totals.discountTotal > 0) {
    draft.push({
      key: "sales_discounts",
      debit: args.totals.discountTotal,
      credit: 0,
      memo: `Discount — ${args.number}`,
    });
  }
  draft.push({
    key: "sales_revenue",
    debit: 0,
    credit: args.totals.subtotal,
    memo: `Sale ${args.number}`,
  });

  // Tax collected belongs to the revenue authority, so it is a liability the
  // moment it is rung up — never part of the shop's income.
  if (args.totals.taxTotal > 0) {
    draft.push({
      key: "tax_payable",
      debit: 0,
      credit: args.totals.taxTotal,
      memo: `Tax — ${args.number}`,
    });
  }

  // Goods leaving the shelf convert an asset into an expense. This is what makes
  // gross profit fall out of the ledger instead of a spreadsheet.
  if (args.costTotal > 0) {
    draft.push({
      key: "cost_of_goods_sold",
      debit: args.costTotal,
      credit: 0,
      memo: `Cost of goods — ${args.number}`,
    });
    draft.push({
      key: "inventory",
      debit: 0,
      credit: args.costTotal,
      memo: `Stock released — ${args.number}`,
    });
  }

  try {
    await postJournal(tx, {
      businessId: args.businessId,
      branchId: args.branchId,
      entryDate: args.entryDate,
      memo: `Sale ${args.number}`,
      refType: "sale",
      refId: args.saleId,
      lines: draft,
    });
  } catch (error) {
    // Restate as a SaleError so the till shows a sale-shaped message rather than
    // an accounting one, while still refusing to complete the sale.
    if (error instanceof LedgerError) {
      throw new SaleError(
        error.code === "unbalanced" ? "unbalanced_ledger" : "missing_accounts",
        error.message,
      );
    }
    throw error;
  }
}

/* ────────────────────────────── Numbering ──────────────────────────────── */

async function receiptPrefix(tx: Database, registerId: string | null): Promise<string> {
  if (!registerId) return "S";
  const [register] = await tx
    .select({ prefix: registers.receiptPrefix })
    .from(registers)
    .where(eq(registers.id, registerId))
    .limit(1);
  return register?.prefix ?? "S";
}

/**
 * Sequence numbers come from a counter row incremented in the same transaction
 * as the document. `max(number) + 1` would hand two simultaneous tills the same
 * receipt number the first busy Saturday.
 */
export async function nextNumber(
  tx: Database,
  businessId: string,
  key: string,
  prefix: string,
): Promise<string> {
  const [row] = await tx
    .insert(counters)
    .values({ businessId, key, value: 1 })
    .onConflictDoUpdate({
      target: [counters.businessId, counters.key],
      set: { value: sql`${counters.value} + 1` },
    })
    .returning({ value: counters.value });

  return `${prefix}-${String(row.value).padStart(6, "0")}`;
}

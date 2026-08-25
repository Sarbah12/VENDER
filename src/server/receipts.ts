import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { cache } from "react";

import { getDb } from "@/db/client";
import {
  branches,
  businesses,
  customers,
  employees,
  payments as paymentsTable,
  saleLines,
  sales,
} from "@/db/schema";
import type { PaymentMethod } from "@/db/schema";

export type ReceiptLine = {
  name: string;
  sku: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxRateBp: number;
  lineTotal: number;
};

export type Receipt = {
  id: string;
  number: string;
  /** ISO string — the client formats it in the shop's locale. */
  soldAt: string;
  status: string;
  currencyCode: string;
  business: { name: string; taxNumber: string | null };
  branch: { name: string; address: string | null; phone: string | null };
  cashier: string | null;
  customer: string | null;
  lines: ReceiptLine[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  paidTotal: number;
  changeGiven: number;
  balanceDue: number;
  payments: Array<{ method: PaymentMethod; amount: number; reference: string | null }>;
};

/**
 * Everything needed to print or re-print one sale.
 *
 * `businessId` is required, not optional. The sale id comes from a URL, so
 * without it any signed-in user could read any other shop's receipt — line
 * items, customer, cashier, totals — by guessing or harvesting an id.
 *
 * Wrapped in React's `cache` so a page and its `generateMetadata` share a single
 * read rather than querying the same sale twice per request.
 */
export const getReceipt = cache(async (businessId: string, saleId: string): Promise<Receipt | null> => {
  const db = await getDb();

  const [row] = await db
    .select({
      sale: sales,
      business: businesses,
      branch: branches,
      cashier: employees.name,
      customer: customers.name,
    })
    .from(sales)
    .innerJoin(businesses, eq(businesses.id, sales.businessId))
    .innerJoin(branches, eq(branches.id, sales.branchId))
    .leftJoin(employees, eq(employees.id, sales.employeeId))
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .where(and(eq(sales.id, saleId), eq(sales.businessId, businessId)))
    .limit(1);

  if (!row) return null;

  const [lines, tenders] = await Promise.all([
    db.select().from(saleLines).where(eq(saleLines.saleId, saleId)).orderBy(asc(saleLines.lineNumber)),
    db.select().from(paymentsTable).where(eq(paymentsTable.saleId, saleId)).orderBy(asc(paymentsTable.createdAt)),
  ]);

  return {
    id: row.sale.id,
    number: row.sale.number,
    soldAt: row.sale.soldAt.toISOString(),
    status: row.sale.status,
    currencyCode: row.business.currencyCode,
    business: { name: row.business.name, taxNumber: row.business.taxNumber },
    branch: { name: row.branch.name, address: row.branch.address, phone: row.branch.phone },
    cashier: row.cashier,
    customer: row.customer,
    lines: lines.map((l) => ({
      name: l.nameSnapshot,
      sku: l.skuSnapshot,
      unit: l.unitSnapshot,
      quantity: Number(l.quantity),
      unitPrice: l.unitPrice,
      discountAmount: l.discountAmount,
      taxRateBp: l.taxRateBp,
      lineTotal: l.lineTotal,
    })),
    subtotal: row.sale.subtotal,
    discountTotal: row.sale.discountTotal,
    taxTotal: row.sale.taxTotal,
    total: row.sale.total,
    paidTotal: row.sale.paidTotal,
    changeGiven: row.sale.changeGiven,
    balanceDue: row.sale.balanceDue,
    payments: tenders.map((p) => ({ method: p.method, amount: p.amount, reference: p.reference })),
  };
});

import "server-only";

import { eq, inArray, sql } from "drizzle-orm";

import { getDb, type Database } from "@/db/client";
import {
  accounts,
  auditLog,
  branches,
  businesses,
  categories,
  counters,
  customers,
  employees,
  journalEntries,
  journalLines,
  memberships,
  payments,
  products,
  purchaseOrderLines,
  purchaseOrders,
  registerSessions,
  registers,
  saleLines,
  sales,
  stockLevels,
  stockMovements,
  suppliers,
  warehouses,
} from "@/db/schema";

/**
 * Removes a business and everything belonging to it.
 *
 * `ON DELETE CASCADE` from `businesses` is not enough on its own. Several
 * foreign keys are deliberately `RESTRICT` — journal lines must not lose the
 * account they posted to, sales must not lose their branch — and Postgres has
 * no way to order a cascade around them, so deleting a business simply failed
 * with a constraint violation.
 *
 * Those RESTRICTs are worth keeping: they are what stops someone deleting a
 * single account that has a year of postings behind it. Whole-business deletion
 * is a different act, and gets an explicit order instead.
 *
 * This is irreversible and takes the books with it. It exists for closing an
 * account and for erasure requests, and every caller should have asked first.
 */
export async function deleteBusiness(businessId: string): Promise<void> {
  const db = await getDb();

  await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Database;

    // Innermost first: children whose parents are about to go, then the parents.
    const entryIds = tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(eq(journalEntries.businessId, businessId));
    await tx.delete(journalLines).where(inArray(journalLines.entryId, entryIds));
    await tx.delete(journalEntries).where(eq(journalEntries.businessId, businessId));

    const saleIds = tx.select({ id: sales.id }).from(sales).where(eq(sales.businessId, businessId));
    await tx.delete(saleLines).where(inArray(saleLines.saleId, saleIds));
    await tx.delete(payments).where(eq(payments.businessId, businessId));
    await tx.delete(sales).where(eq(sales.businessId, businessId));

    const orderIds = tx
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.businessId, businessId));
    await tx.delete(purchaseOrderLines).where(inArray(purchaseOrderLines.purchaseOrderId, orderIds));
    await tx.delete(purchaseOrders).where(eq(purchaseOrders.businessId, businessId));

    await tx.delete(stockMovements).where(eq(stockMovements.businessId, businessId));
    await tx.delete(stockLevels).where(eq(stockLevels.businessId, businessId));

    await tx.delete(registerSessions).where(eq(registerSessions.businessId, businessId));
    await tx.delete(registers).where(eq(registers.businessId, businessId));

    await tx.delete(products).where(eq(products.businessId, businessId));
    await tx.delete(categories).where(eq(categories.businessId, businessId));
    await tx.delete(customers).where(eq(customers.businessId, businessId));
    await tx.delete(suppliers).where(eq(suppliers.businessId, businessId));

    await tx.delete(auditLog).where(eq(auditLog.businessId, businessId));
    await tx.delete(counters).where(eq(counters.businessId, businessId));
    await tx.delete(accounts).where(eq(accounts.businessId, businessId));

    await tx.delete(employees).where(eq(employees.businessId, businessId));
    await tx.delete(memberships).where(eq(memberships.businessId, businessId));

    await tx.delete(warehouses).where(eq(warehouses.businessId, businessId));
    await tx.delete(branches).where(eq(branches.businessId, businessId));

    await tx.delete(businesses).where(eq(businesses.id, businessId));
  });
}

/**
 * What deleting would destroy. Show this before asking anyone to confirm —
 * "this cannot be undone" means little next to "this deletes 1,847 sales".
 */
export async function describeBusinessContents(businessId: string): Promise<{
  products: number;
  sales: number;
  customers: number;
  journalEntries: number;
}> {
  const db = await getDb();

  const [row] = await db
    .select({
      products: sql<number>`(select count(*)::int from ${products} where ${products.businessId} = ${businessId})`,
      sales: sql<number>`(select count(*)::int from ${sales} where ${sales.businessId} = ${businessId})`,
      customers: sql<number>`(select count(*)::int from ${customers} where ${customers.businessId} = ${businessId})`,
      journalEntries: sql<number>`(select count(*)::int from ${journalEntries} where ${journalEntries.businessId} = ${businessId})`,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  return row ?? { products: 0, sales: 0, customers: 0, journalEntries: 0 };
}

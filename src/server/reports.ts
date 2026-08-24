import "server-only";

import { and, asc, count, desc, eq, gte, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import {
  accounts,
  categories,
  customers,
  employees,
  journalEntries,
  journalLines,
  products,
  saleLines,
  sales,
  stockLevels,
} from "@/db/schema";
import { signedBalance, type AccountType } from "@/domain/accounts";

/** Postgres returns sum() over bigint as numeric, which arrives as a string. */
const num = (value: unknown): number => Number(value ?? 0);

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function daysAgo(days: number): Date {
  const d = startOfToday();
  d.setDate(d.getDate() - days);
  return d;
}

export type DashboardData = {
  counts: {
    products: number;
    categories: number;
    customers: number;
    staff: number;
    salesToday: number;
    salesTotal: number;
  };
  today: { revenue: number; cost: number; profit: number; transactions: number; averageSale: number };
  month: { revenue: number; profit: number };
  series: Array<{ day: string; revenue: number; tax: number; discount: number; transactions: number }>;
  topProducts: Array<{ name: string; quantity: number; revenue: number }>;
  lowStock: Array<{ name: string; unit: string; quantity: number; reorderPoint: number }>;
  recentSales: Array<{
    id: string;
    number: string;
    soldAt: string;
    total: number;
    items: number;
    cashier: string | null;
  }>;
};

export async function getDashboard(businessId: string, warehouseId: string): Promise<DashboardData> {
  const db = await getDb();
  const today = startOfToday();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const seriesFrom = daysAgo(13);

  const [
    productCount,
    categoryCount,
    customerCount,
    staffCount,
    salesAll,
    todayRow,
    monthRow,
    seriesRows,
    topRows,
    lowRows,
    recentRows,
  ] = await Promise.all([
    db.select({ n: count() }).from(products).where(and(eq(products.businessId, businessId), eq(products.isActive, true))),
    db.select({ n: count() }).from(categories).where(eq(categories.businessId, businessId)),
    db.select({ n: count() }).from(customers).where(eq(customers.businessId, businessId)),
    db.select({ n: count() }).from(employees).where(and(eq(employees.businessId, businessId), eq(employees.isActive, true))),
    db.select({ n: count() }).from(sales).where(eq(sales.businessId, businessId)),

    db
      .select({
        revenue: sql`coalesce(sum(${sales.total}), 0)`,
        cost: sql`coalesce(sum(${sales.costTotal}), 0)`,
        transactions: count(),
      })
      .from(sales)
      .where(and(eq(sales.businessId, businessId), gte(sales.soldAt, today))),

    db
      .select({
        revenue: sql`coalesce(sum(${sales.total}), 0)`,
        cost: sql`coalesce(sum(${sales.costTotal}), 0)`,
      })
      .from(sales)
      .where(and(eq(sales.businessId, businessId), gte(sales.soldAt, monthStart))),

    db
      .select({
        day: sql<string>`to_char(${sales.soldAt}, 'YYYY-MM-DD')`,
        revenue: sql`coalesce(sum(${sales.total}), 0)`,
        tax: sql`coalesce(sum(${sales.taxTotal}), 0)`,
        discount: sql`coalesce(sum(${sales.discountTotal}), 0)`,
        transactions: count(),
      })
      .from(sales)
      .where(and(eq(sales.businessId, businessId), gte(sales.soldAt, seriesFrom)))
      .groupBy(sql`1`)
      .orderBy(sql`1`),

    db
      .select({
        name: saleLines.nameSnapshot,
        quantity: sql`coalesce(sum(${saleLines.quantity}), 0)`,
        revenue: sql`coalesce(sum(${saleLines.lineTotal}), 0)`,
      })
      .from(saleLines)
      .innerJoin(sales, eq(sales.id, saleLines.saleId))
      .where(and(eq(sales.businessId, businessId), gte(sales.soldAt, monthStart)))
      .groupBy(saleLines.nameSnapshot)
      .orderBy(desc(sql`sum(${saleLines.lineTotal})`))
      .limit(8),

    db
      .select({
        name: products.name,
        unit: products.unit,
        quantity: stockLevels.quantity,
        reorderPoint: products.reorderPoint,
      })
      .from(products)
      .innerJoin(
        stockLevels,
        and(eq(stockLevels.productId, products.id), eq(stockLevels.warehouseId, warehouseId)),
      )
      .where(
        and(
          eq(products.businessId, businessId),
          eq(products.isActive, true),
          eq(products.trackStock, true),
          sql`${stockLevels.quantity} <= ${products.reorderPoint}`,
        ),
      )
      .orderBy(asc(sql`${stockLevels.quantity} - ${products.reorderPoint}`))
      .limit(8),

    db
      .select({
        id: sales.id,
        number: sales.number,
        soldAt: sales.soldAt,
        total: sales.total,
        cashier: employees.name,
        items: sql`(select coalesce(sum(${saleLines.quantity}), 0) from ${saleLines} where ${saleLines.saleId} = ${sales.id})`,
      })
      .from(sales)
      .leftJoin(employees, eq(employees.id, sales.employeeId))
      .where(eq(sales.businessId, businessId))
      .orderBy(desc(sales.soldAt))
      .limit(6),
  ]);

  const todayRevenue = num(todayRow[0]?.revenue);
  const todayCost = num(todayRow[0]?.cost);
  const todayTransactions = todayRow[0]?.transactions ?? 0;
  const monthRevenue = num(monthRow[0]?.revenue);
  const monthCost = num(monthRow[0]?.cost);

  // Fill the gaps so a quiet Tuesday shows as a zero, not a missing bar.
  const byDay = new Map(seriesRows.map((r) => [r.day, r]));
  const series = Array.from({ length: 14 }, (_, i) => {
    const date = daysAgo(13 - i);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const row = byDay.get(key);
    return {
      day: key,
      revenue: num(row?.revenue),
      tax: num(row?.tax),
      discount: num(row?.discount),
      transactions: row?.transactions ?? 0,
    };
  });

  return {
    counts: {
      products: productCount[0]?.n ?? 0,
      categories: categoryCount[0]?.n ?? 0,
      customers: customerCount[0]?.n ?? 0,
      staff: staffCount[0]?.n ?? 0,
      salesToday: todayTransactions,
      salesTotal: salesAll[0]?.n ?? 0,
    },
    today: {
      revenue: todayRevenue,
      cost: todayCost,
      profit: todayRevenue - todayCost,
      transactions: todayTransactions,
      averageSale: todayTransactions > 0 ? Math.round(todayRevenue / todayTransactions) : 0,
    },
    month: { revenue: monthRevenue, profit: monthRevenue - monthCost },
    series,
    topProducts: topRows.map((r) => ({
      name: r.name,
      quantity: num(r.quantity),
      revenue: num(r.revenue),
    })),
    lowStock: lowRows.map((r) => ({
      name: r.name,
      unit: r.unit,
      quantity: Number(r.quantity),
      reorderPoint: Number(r.reorderPoint),
    })),
    recentSales: recentRows.map((r) => ({
      id: r.id,
      number: r.number,
      soldAt: r.soldAt.toISOString(),
      total: r.total,
      items: num(r.items),
      cashier: r.cashier,
    })),
  };
}

/* ────────────────────────────── Finance ────────────────────────────────── */

export type TrialBalanceRow = {
  code: string;
  name: string;
  type: AccountType;
  debit: number;
  credit: number;
  balance: number;
};

/**
 * Every account with its debit and credit totals. If the two columns do not
 * agree to the pesewa, something posted an unbalanced entry — which the sale
 * path refuses to do, so this doubles as an integrity check on the whole system.
 */
export async function getTrialBalance(businessId: string): Promise<TrialBalanceRow[]> {
  const db = await getDb();

  const rows = await db
    .select({
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      debit: sql`coalesce(sum(${journalLines.debit}), 0)`,
      credit: sql`coalesce(sum(${journalLines.credit}), 0)`,
    })
    .from(accounts)
    .leftJoin(journalLines, eq(journalLines.accountId, accounts.id))
    .where(eq(accounts.businessId, businessId))
    .groupBy(accounts.id, accounts.code, accounts.name, accounts.type)
    .orderBy(asc(accounts.code));

  return rows.map((r) => {
    const debit = num(r.debit);
    const credit = num(r.credit);
    return {
      code: r.code,
      name: r.name,
      type: r.type,
      debit,
      credit,
      balance: signedBalance(r.type, debit, credit),
    };
  });
}

export type JournalEntryRow = {
  id: string;
  entryDate: string;
  memo: string | null;
  refType: string | null;
  refId: string | null;
  lines: Array<{ account: string; code: string; debit: number; credit: number; memo: string | null }>;
};

export async function getJournal(businessId: string, limit = 40): Promise<JournalEntryRow[]> {
  const db = await getDb();

  const entries = await db
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.businessId, businessId))
    .orderBy(desc(journalEntries.entryDate), desc(journalEntries.createdAt))
    .limit(limit);

  if (entries.length === 0) return [];

  const lines = await db
    .select({
      entryId: journalLines.entryId,
      account: accounts.name,
      code: accounts.code,
      debit: journalLines.debit,
      credit: journalLines.credit,
      memo: journalLines.memo,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(
      sql`${journalLines.entryId} in (${sql.join(entries.map((e) => sql`${e.id}`), sql`, `)})`,
    )
    .orderBy(desc(journalLines.debit));

  const byEntry = new Map<string, JournalEntryRow["lines"]>();
  for (const line of lines) {
    const list = byEntry.get(line.entryId) ?? [];
    list.push({
      account: line.account,
      code: line.code,
      debit: line.debit,
      credit: line.credit,
      memo: line.memo,
    });
    byEntry.set(line.entryId, list);
  }

  return entries.map((entry) => ({
    id: entry.id,
    entryDate: entry.entryDate.toISOString(),
    memo: entry.memo,
    refType: entry.refType,
    refId: entry.refId,
    lines: byEntry.get(entry.id) ?? [],
  }));
}

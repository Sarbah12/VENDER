/**
 * End-to-end check of the sale transaction against a real Postgres.
 *
 * Run with `npm run smoke`. It asserts the properties that matter most and are
 * hardest to eyeball in the UI: stock actually moves, the ledger balances, the
 * receipt sequence does not repeat, a replayed sale is not charged twice, and a
 * sale that would oversell the shelf is refused with nothing left behind.
 */
import { and, eq, sql } from "drizzle-orm";

import { getDb } from "../src/db/client";
import {
  accounts,
  branches,
  businesses,
  employees,
  journalEntries,
  journalLines,
  products,
  registers,
  sales,
  stockLevels,
  warehouses,
} from "../src/db/schema";
import { seedDemoBusiness } from "../src/db/seed";
import { recordSale, SaleError } from "../src/server/sales";

let failures = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  await seedDemoBusiness();
  const db = await getDb();

  const [business] = await db.select().from(businesses).limit(1);
  const [branch] = await db.select().from(branches).where(eq(branches.businessId, business.id)).limit(1);
  const [warehouse] = await db
    .select()
    .from(warehouses)
    .where(eq(warehouses.businessId, business.id))
    .limit(1);
  const [register] = await db
    .select()
    .from(registers)
    .where(eq(registers.businessId, business.id))
    .limit(1);
  const [cashier] = await db.select().from(employees).where(eq(employees.businessId, business.id)).limit(1);

  const [water] = await db
    .select()
    .from(products)
    .where(and(eq(products.businessId, business.id), eq(products.sku, "DRK-001")))
    .limit(1);
  const [rice] = await db
    .select()
    .from(products)
    .where(and(eq(products.businessId, business.id), eq(products.sku, "FOD-001")))
    .limit(1);

  const stockBefore = await stockOf(water.id);

  const base = {
    businessId: business.id,
    branchId: branch.id,
    warehouseId: warehouse.id,
    registerId: register.id,
    employeeId: cashier.id,
  };

  /* ── 1. A plain cash sale ──────────────────────────────────────────── */
  console.log("\nCash sale with change");
  const clientRef = crypto.randomUUID();
  const sale = await recordSale({
    ...base,
    clientRef,
    lines: [
      { productId: water.id, quantity: 3 },
      { productId: rice.id, quantity: 1 },
    ],
    // 3 × 3.50 + 98.00 = 108.50, tendered 200.00
    payments: [{ method: "cash", amount: 20_000 }],
  });

  check("total is right", sale.total === 3 * 350 + 9800, `got ${sale.total}`);
  check("change is right", sale.changeGiven === 20_000 - sale.total, `got ${sale.changeGiven}`);
  check("nothing left on account", sale.balanceDue === 0);
  check("receipt number is prefixed by the till", sale.number.startsWith(`${register.receiptPrefix}-`), sale.number);

  const stockAfter = await stockOf(water.id);
  check("stock fell by the quantity sold", stockAfter === stockBefore - 3, `${stockBefore} → ${stockAfter}`);

  /* ── 2. The ledger ─────────────────────────────────────────────────── */
  console.log("\nDouble-entry posting");
  const [entry] = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.refType, "sale"), eq(journalEntries.refId, sale.saleId)))
    .limit(1);
  check("a journal entry was posted for the sale", Boolean(entry));

  const lines = await db
    .select({
      debit: journalLines.debit,
      credit: journalLines.credit,
      key: accounts.systemKey,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(eq(journalLines.entryId, entry.id));

  const debits = lines.reduce((a, l) => a + l.debit, 0);
  const credits = lines.reduce((a, l) => a + l.credit, 0);
  check("the entry balances", debits === credits, `${debits} vs ${credits}`);

  const cashDebit = lines.filter((l) => l.key === "cash").reduce((a, l) => a + l.debit, 0);
  check("cash debited net of change", cashDebit === sale.total, `got ${cashDebit}`);

  const cogs = lines.filter((l) => l.key === "cost_of_goods_sold").reduce((a, l) => a + l.debit, 0);
  const inventoryCredit = lines.filter((l) => l.key === "inventory").reduce((a, l) => a + l.credit, 0);
  check("cost of goods was recognised", cogs > 0 && cogs === inventoryCredit, `${cogs} vs ${inventoryCredit}`);

  const taxCredit = lines.filter((l) => l.key === "tax_payable").reduce((a, l) => a + l.credit, 0);
  check("tax was carved out as a liability", taxCredit > 0, `got ${taxCredit}`);

  /* ── 3. Replaying the same sale ────────────────────────────────────── */
  console.log("\nIdempotent replay");
  const replay = await recordSale({
    ...base,
    clientRef,
    lines: [
      { productId: water.id, quantity: 3 },
      { productId: rice.id, quantity: 1 },
    ],
    payments: [{ method: "cash", amount: 20_000 }],
  });
  check("replay returned the original sale", replay.saleId === sale.saleId && replay.duplicate);
  check("replay did not move stock again", (await stockOf(water.id)) === stockAfter);

  /* ── 4. Overselling is refused ─────────────────────────────────────── */
  console.log("\nOverselling");
  const available = await stockOf(water.id);
  let refused = false;
  try {
    await recordSale({
      ...base,
      clientRef: crypto.randomUUID(),
      lines: [{ productId: water.id, quantity: available + 50 }],
      payments: [{ method: "cash", amount: 1_000_000 }],
    });
  } catch (error) {
    refused = error instanceof SaleError && error.code === "insufficient_stock";
  }
  check("selling more than we hold is rejected", refused);
  check("the failed attempt left stock untouched", (await stockOf(water.id)) === available);

  /* ── 5. Receipt numbers never repeat ───────────────────────────────── */
  console.log("\nReceipt numbering");
  const second = await recordSale({
    ...base,
    clientRef: crypto.randomUUID(),
    lines: [{ productId: water.id, quantity: 1 }],
    payments: [{ method: "mobile_money", amount: 350, reference: "MM-778812" }],
  });
  check("a second sale got a new number", second.number !== sale.number, `${sale.number} vs ${second.number}`);

  const duplicates = await db
    .select({ number: sales.number, n: sql<number>`count(*)` })
    .from(sales)
    .where(eq(sales.businessId, business.id))
    .groupBy(sales.number)
    .having(sql`count(*) > 1`);
  check("no receipt number is used twice", duplicates.length === 0);

  /* ── 6. Credit sale ────────────────────────────────────────────────── */
  console.log("\nSale on account");
  let creditRefused = false;
  try {
    await recordSale({
      ...base,
      clientRef: crypto.randomUUID(),
      lines: [{ productId: rice.id, quantity: 1 }],
      payments: [],
    });
  } catch (error) {
    creditRefused = error instanceof SaleError && error.code === "credit_requires_customer";
  }
  check("an unpaid sale needs a customer", creditRefused);

  /* ── 7. Whole-business integrity ───────────────────────────────────── */
  console.log("\nTrial balance");
  const [totals] = await db
    .select({
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
    })
    .from(journalLines);
  check(
    "every entry ever posted still balances",
    Number(totals.debit) === Number(totals.credit),
    `${totals.debit} vs ${totals.credit}`,
  );

  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);

  async function stockOf(productId: string): Promise<number> {
    const [row] = await db
      .select({ quantity: stockLevels.quantity })
      .from(stockLevels)
      .where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, warehouse.id)))
      .limit(1);
    return Number(row?.quantity ?? 0);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

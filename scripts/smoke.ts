/**
 * End-to-end check of the sale transaction against a real Postgres.
 *
 * Run with `npm run smoke`. It asserts the properties that matter most and are
 * hardest to eyeball in the UI: stock actually moves, the ledger balances, the
 * receipt sequence does not repeat, a replayed sale is not charged twice, and a
 * sale that would oversell the shelf is refused with nothing left behind.
 */
import fs from "node:fs";
import path from "node:path";

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
import { buildPreview, buildTemplateWorkbook, commitImport } from "../src/server/import";
import { updateProduct } from "../src/server/products";
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
  // This script creates, sells and deletes. Running it against a real database
  // would seed a demo shop into someone's books, so it refuses outright rather
  // than trusting that DATABASE_URL was not left set in the shell.
  if (process.env.DATABASE_URL) {
    console.error(
      "Refusing to run: DATABASE_URL is set, and the smoke test writes and deletes data.\n" +
        "It is meant for a throwaway embedded database. Unset DATABASE_URL and try again.",
    );
    process.exit(1);
  }

  // Always start from an empty database, so the assertions below describe the
  // code rather than whatever happened to be left over from the last run. Safe
  // to delete because PGLITE_DIR points somewhere disposable.
  const dir = process.env.PGLITE_DIR;
  if (dir) fs.rmSync(path.resolve(dir), { recursive: true, force: true });

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

  /* ── 8. Importing a catalogue from a spreadsheet ───────────────────── */
  console.log("\nSpreadsheet import");

  const csv = [
    "Item Code,Product Name,Bar-Code,Category,Unit,Buying Price,Selling Price,Qty,Reorder Level,Track Stock,Supplier Notes",
    'IMP-001,"Milk Powder, 400g",6009900000011,Imported Goods,tin,"GH₵ 42.00","GH₵ 58.00",30,6,Yes,ignored column',
    "IMP-002,Cornflakes 500g,6009900000028,Imported Goods,pack,\"1,250\",\"1,600\",12,3,Yes,",
    "IMP-003,Gift Wrapping,,Services,pc,0,5.00,0,0,No,",
    "IMP-004,Broken Row,,Imported Goods,pc,10,not-a-price,5,0,Yes,",
    "IMP-001,Duplicate Code,,Imported Goods,pc,1,2,1,0,Yes,",
  ].join("\n");

  const preview = await buildPreview(
    business.id,
    { name: "supplier-list.csv", buffer: new TextEncoder().encode(csv).buffer as ArrayBuffer },
    { taxRateBp: business.taxRateBp },
  );

  check("headers were matched despite different names", preview.missingRequired.length === 0);
  check("unrecognised columns are ignored, not rejected", preview.unmatchedHeaders.includes("Supplier Notes"));
  check("three good rows are ready to create", preview.summary.create === 3, `got ${preview.summary.create}`);
  check("two bad rows are flagged", preview.summary.error === 2, `got ${preview.summary.error}`);
  check(
    "the promised opening-stock value excludes skipped rows",
    // Only IMP-001 (42.00 × 30) and IMP-002 (1,250.00 × 12) are written.
    preview.summary.openingStockValue === 4200 * 30 + 125_000 * 12,
    `got ${preview.summary.openingStockValue}`,
  );

  const cornflakes = preview.rows.find((r) => r.sku === "IMP-002");
  check(
    "a thousands separator is not read as decimals",
    cornflakes?.sellPrice === 160_000 && cornflakes?.costPrice === 125_000,
    `got ${cornflakes?.costPrice} / ${cornflakes?.sellPrice}`,
  );
  const milk = preview.rows.find((r) => r.sku === "IMP-001" && r.action === "create");
  check("currency symbols are stripped", milk?.sellPrice === 5800, `got ${milk?.sellPrice}`);
  check(
    "a repeated code in the same file is refused",
    preview.rows.some((r) => r.errors.some((e) => e.includes("also appears on row"))),
  );
  check(
    "a service row keeps its opening stock at zero",
    preview.rows.find((r) => r.sku === "IMP-003")?.openingStock === 0,
  );

  const inventoryBefore = await accountBalance("inventory");
  const result = await commitImport({
    businessId: business.id,
    branchId: branch.id,
    warehouseId: warehouse.id,
    employeeId: cashier.id,
    rows: preview.rows,
  });

  check("only the good rows were written", result.created === 3 && result.updated === 0);
  check("the new category was created", result.categoriesCreated === 1);

  const [imported] = await db
    .select()
    .from(products)
    .where(and(eq(products.businessId, business.id), eq(products.sku, "IMP-001")))
    .limit(1);
  check("the product exists with its barcode", imported?.barcode === "6009900000011");
  check("opening stock was counted in", (await stockOf(imported.id)) === 30);

  const inventoryAfter = await accountBalance("inventory");
  check(
    "opening stock was posted to Inventory at cost",
    inventoryAfter - inventoryBefore === 42_00 * 30 + 125_000 * 12,
    `moved ${inventoryAfter - inventoryBefore}`,
  );

  /* ── 9. Re-importing the same file ─────────────────────────────────── */
  console.log("\nRe-import");

  const reimport = await buildPreview(
    business.id,
    { name: "supplier-list.csv", buffer: new TextEncoder().encode(csv).buffer as ArrayBuffer },
    { taxRateBp: business.taxRateBp },
  );

  check(
    "known codes are updates, not duplicates",
    reimport.summary.update === 3 && reimport.summary.create === 0,
  );
  check(
    "stock is left alone on re-import",
    reimport.rows.filter((row) => row.action !== "error").every((row) => row.openingStock === 0),
  );
  check(
    "and the user is told why",
    reimport.rows.some((row) => row.warnings.some((w) => w.includes("Stock left unchanged"))),
  );

  await commitImport({
    businessId: business.id,
    branchId: branch.id,
    warehouseId: warehouse.id,
    employeeId: cashier.id,
    rows: reimport.rows,
  });
  check("re-importing did not double the stock", (await stockOf(imported.id)) === 30);

  const [productCount] = await db
    .select({ n: sql<number>`count(*)` })
    .from(products)
    .where(and(eq(products.businessId, business.id), eq(products.sku, "IMP-001")));
  check("and did not create a second product", Number(productCount.n) === 1);

  /* ── 10. The template we hand out can be read back ─────────────────── */
  console.log("\nTemplate round-trip");

  const template = await buildTemplateWorkbook("GHS");
  const templatePreview = await buildPreview(
    business.id,
    {
      name: "template.xlsx",
      buffer: template.buffer.slice(
        template.byteOffset,
        template.byteOffset + template.byteLength,
      ) as ArrayBuffer,
    },
    { taxRateBp: business.taxRateBp },
  );
  check("the generated template parses as a valid import", templatePreview.missingRequired.length === 0);
  check(
    "its example rows are usable",
    templatePreview.summary.error === 0 && templatePreview.rows.length >= 2,
    `${templatePreview.rows.length} rows, ${templatePreview.summary.error} errors`,
  );

  /* ── 11. Re-pricing keeps the Inventory account honest ─────────────── */
  console.log("\nCost revaluation");

  const heldBefore = await stockOf(imported.id);
  const inventoryBeforeRepricing = await accountBalance("inventory");

  await updateProduct({
    businessId: business.id,
    branchId: branch.id,
    productId: imported.id,
    input: {
      sku: imported.sku,
      name: imported.name,
      barcode: imported.barcode,
      categoryId: imported.categoryId,
      unit: imported.unit,
      // Supplier raised the price by GH₵ 8.00 a tin.
      costPrice: imported.costPrice + 800,
      sellPrice: imported.sellPrice,
      taxRateBp: imported.taxRateBp,
      trackStock: true,
      allowNegativeStock: false,
      reorderPoint: Number(imported.reorderPoint),
      isActive: true,
    },
  });

  const inventoryAfterRepricing = await accountBalance("inventory");
  check(
    "a cost change revalues the stock already on hand",
    inventoryAfterRepricing - inventoryBeforeRepricing === 800 * heldBefore,
    `moved ${inventoryAfterRepricing - inventoryBeforeRepricing}, expected ${800 * heldBefore}`,
  );

  // The claim the inventory page makes — "value at cost matches the Inventory
  // account" — is only true if this holds.
  const valuation = await db
    .select({ quantity: stockLevels.quantity, costPrice: products.costPrice })
    .from(stockLevels)
    .innerJoin(products, eq(products.id, stockLevels.productId))
    .where(eq(stockLevels.businessId, business.id));

  const stockAtCost = valuation.reduce(
    (total, row) => total + Math.round(row.costPrice * Number(row.quantity)),
    0,
  );
  check(
    "the stock report and the Inventory account agree",
    stockAtCost === inventoryAfterRepricing,
    `report ${stockAtCost} vs ledger ${inventoryAfterRepricing}`,
  );

  /* ── 12. Books still balance after all of that ─────────────────────── */
  console.log("\nTrial balance, after imports");
  const [finalTotals] = await db
    .select({
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
    })
    .from(journalLines);
  check(
    "every entry still balances",
    Number(finalTotals.debit) === Number(finalTotals.credit),
    `${finalTotals.debit} vs ${finalTotals.credit}`,
  );

  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);

  async function accountBalance(systemKey: string): Promise<number> {
    const [row] = await db
      .select({
        debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
        credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
      })
      .from(journalLines)
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(and(eq(accounts.businessId, business.id), eq(accounts.systemKey, systemKey)));
    return Number(row.debit) - Number(row.credit);
  }

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

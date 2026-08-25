/**
 * Proves the whole chain works against the *hosted* database, then removes
 * everything it created: `npm run db:verify`.
 *
 * The smoke and tenancy suites run on embedded Postgres. This exists because
 * "it worked locally" is not evidence about Supabase — a transaction pooler,
 * TLS, a different Postgres version and real latency are all in the path here
 * and in none of the others.
 *
 * Self-cleaning by design: it records the business it creates and deletes it at
 * the end, cascade included, whether the checks pass or fail.
 */
import { and, eq, sql } from "drizzle-orm";

import { getDb } from "../src/db/client";
import { businesses, journalLines, sales, stockLevels, users } from "../src/db/schema";
import { createUser } from "../src/server/accounts";
import { createBusiness } from "../src/server/onboarding";
import { getReceipt } from "../src/server/receipts";
import { recordSale } from "../src/server/sales";
import { createProduct } from "../src/server/products";

let failures = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

const MARKER = `verify-${Date.now()}`;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("No DATABASE_URL — this checks the hosted database specifically.");
    process.exit(1);
  }

  const db = await getDb();
  let businessId: string | null = null;
  let userId: string | null = null;

  try {
    console.log("\nWriting to the hosted database");

    userId = await createUser({
      email: `${MARKER}@verify.invalid`,
      name: "Verification Run",
      password: "temporary-verification-password",
    });
    check("an account can be created", Boolean(userId));

    const shop = await createBusiness({
      businessName: `Verification ${MARKER}`,
      legalName: null,
      countryCode: "GH",
      currencyCode: "GHS",
      taxNumber: null,
      taxRateBp: 300,
      pricesIncludeTax: true,
      branchName: "Verification Branch",
      branchAddress: null,
      branchPhone: null,
      ownerName: "Verification Run",
      ownerEmail: `${MARKER}@verify.invalid`,
      ownerPin: "1234",
      userId,
    });
    businessId = shop.businessId;
    check("a business, chart of accounts, branch and till are created", Boolean(businessId));

    const [branch] = await db
      .select()
      .from((await import("../src/db/schema")).branches)
      .where(eq((await import("../src/db/schema")).branches.businessId, businessId))
      .limit(1);
    const [warehouse] = await db
      .select()
      .from((await import("../src/db/schema")).warehouses)
      .where(eq((await import("../src/db/schema")).warehouses.businessId, businessId))
      .limit(1);

    const productId = await createProduct({
      businessId,
      warehouseId: warehouse.id,
      branchId: branch.id,
      employeeId: shop.employeeId,
      input: {
        sku: "VERIFY-001",
        name: "Verification Item",
        barcode: null,
        categoryId: null,
        unit: "pc",
        costPrice: 600,
        sellPrice: 1000,
        taxRateBp: null,
        trackStock: true,
        allowNegativeStock: false,
        reorderPoint: 0,
        isActive: true,
      },
      openingStock: 5,
    });
    check("a product with opening stock is created", Boolean(productId));

    console.log("\nRinging up a sale");

    const sale = await recordSale({
      businessId,
      branchId: branch.id,
      warehouseId: warehouse.id,
      employeeId: shop.employeeId,
      clientRef: crypto.randomUUID(),
      lines: [{ productId, quantity: 2 }],
      payments: [{ method: "cash", amount: 5000 }],
    });

    check("the sale totals correctly", sale.total === 2000, `got ${sale.total}`);
    check("change is right", sale.changeGiven === 3000, `got ${sale.changeGiven}`);

    const [level] = await db
      .select({ quantity: stockLevels.quantity })
      .from(stockLevels)
      .where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, warehouse.id)));
    check("stock fell from 5 to 3", Number(level.quantity) === 3, `got ${level.quantity}`);

    const receipt = await getReceipt(businessId, sale.saleId);
    check("the receipt reads back", receipt?.number === sale.number);

    console.log("\nThe books");

    const [totals] = await db
      .select({
        debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
        credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
      })
      .from(journalLines);
    check(
      "every journal entry balances",
      Number(totals.debit) === Number(totals.credit),
      `${totals.debit} vs ${totals.credit}`,
    );

    // Replay the same idempotency key: the pooler must not turn one sale into two.
    const replay = await recordSale({
      businessId,
      branchId: branch.id,
      warehouseId: warehouse.id,
      employeeId: shop.employeeId,
      clientRef: sale.saleId ? (await originalClientRef(sale.saleId)) : crypto.randomUUID(),
      lines: [{ productId, quantity: 2 }],
      payments: [{ method: "cash", amount: 5000 }],
    });
    check("a replayed sale is recognised, not duplicated", replay.duplicate === true);
  } finally {
    console.log("\nCleaning up");
    if (businessId) {
      const { deleteBusiness } = await import("../src/server/delete-business");
      await deleteBusiness(businessId);
      const [left] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(sales)
        .where(eq(sales.businessId, businessId));
      check("the test business and everything under it is gone", Number(left.n) === 0);
    }
    if (userId) await db.delete(users).where(eq(users.id, userId));

    const [remaining] = await db.select({ n: sql<number>`count(*)::int` }).from(businesses);
    check(
      "the database is back to how it was",
      Number(remaining.n) === 0,
      `${remaining.n} business(es) left`,
    );
  }

  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);

  async function originalClientRef(saleId: string): Promise<string> {
    const [row] = await db
      .select({ clientRef: sales.clientRef })
      .from(sales)
      .where(eq(sales.id, saleId))
      .limit(1);
    return row.clientRef ?? crypto.randomUUID();
  }
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});

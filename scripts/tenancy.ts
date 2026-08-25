/**
 * Proves two businesses in one database cannot reach each other.
 *
 * Run with `npm run tenancy`. This is the test that matters most now the app is
 * multi-tenant: every other bug costs one shop its evening, but a missing
 * `business_id` filter shows one shop another's takings, customers and staff.
 *
 * It builds two complete businesses with deliberately colliding data — same
 * SKUs, same customer names — and then tries, through the real server
 * functions, to reach one from the other.
 */
import fs from "node:fs";
import path from "node:path";

import { and, eq } from "drizzle-orm";

import { getDb } from "../src/db/client";
import { customers, products, sales, stockLevels } from "../src/db/schema";
import { addMembership, authenticate, createUser, hasMembership } from "../src/server/accounts";
import { searchCatalogue, catalogueTotals, findByCode } from "../src/server/catalogue";
import { createBusiness } from "../src/server/onboarding";
import { getReceipt } from "../src/server/receipts";
import { getDashboard } from "../src/server/reports";
import { recordSale } from "../src/server/sales";

let failures = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  if (process.env.DATABASE_URL) {
    console.error("Refusing to run: DATABASE_URL is set. This script creates and deletes data.");
    process.exit(1);
  }
  const dir = process.env.PGLITE_DIR;
  if (dir) fs.rmSync(path.resolve(dir), { recursive: true, force: true });

  const db = await getDb();

  /* ── Two businesses, deliberately alike ──────────────────────────────── */
  console.log("\nSetting up two businesses");

  const makeShop = async (label: string, email: string) => {
    const userId = await createUser({ email, name: `${label} Owner`, password: "correct-horse-battery" });
    const shop = await createBusiness({
      businessName: `${label} Stores`,
      legalName: null,
      countryCode: "GH",
      currencyCode: "GHS",
      taxNumber: null,
      taxRateBp: 300,
      pricesIncludeTax: true,
      branchName: `${label} Main`,
      branchAddress: null,
      branchPhone: null,
      ownerName: `${label} Owner`,
      ownerEmail: email,
      ownerPin: "1234",
      userId,
    });
    return { userId, ...shop };
  };

  const alpha = await makeShop("Alpha", "alpha@example.com");
  const beta = await makeShop("Beta", "beta@example.com");
  check("two separate businesses exist", alpha.businessId !== beta.businessId);

  // Same SKU in both, so a leak shows up as the wrong shop's product.
  const seed = async (businessId: string, warehouseId: string, name: string, price: number) => {
    const [p] = await db
      .insert(products)
      .values({ businessId, sku: "SHARED-001", barcode: "5000000000001", name, sellPrice: price, costPrice: 100 })
      .returning({ id: products.id });
    await db.insert(stockLevels).values({ businessId, warehouseId, productId: p.id, quantity: 10 });
    const [c] = await db
      .insert(customers)
      .values({ businessId, name: `${name} Customer` })
      .returning({ id: customers.id });
    return { productId: p.id, customerId: c.id };
  };

  const [alphaBranchId, alphaWarehouseId] = await branchAndWarehouse(alpha.businessId);
  const [betaBranchId, betaWarehouseId] = await branchAndWarehouse(beta.businessId);

  const alphaData = await seed(alpha.businessId, alphaWarehouseId, "Alpha Widget", 5000);
  const betaData = await seed(beta.businessId, betaWarehouseId, "Beta Widget", 9900);

  /* ── Catalogue ───────────────────────────────────────────────────────── */
  console.log("\nCatalogue is scoped");

  const alphaSearch = await searchCatalogue({
    businessId: alpha.businessId,
    warehouseId: alphaWarehouseId,
    query: "Widget",
  });
  check(
    "a search returns only this business's products",
    alphaSearch.rows.length === 1 && alphaSearch.rows[0].name === "Alpha Widget",
    alphaSearch.rows.map((r) => r.name).join(", "),
  );

  const scanned = await findByCode(alpha.businessId, alphaWarehouseId, "5000000000001");
  check(
    "a shared barcode resolves to this business's product",
    scanned?.name === "Alpha Widget",
    scanned?.name,
  );

  const totals = await catalogueTotals(beta.businessId, betaWarehouseId);
  check("catalogue totals count only this business", totals.products === 1, `got ${totals.products}`);

  /* ── Sales ───────────────────────────────────────────────────────────── */
  console.log("\nSales are scoped");

  const alphaSale = await recordSale({
    businessId: alpha.businessId,
    branchId: alphaBranchId,
    warehouseId: alphaWarehouseId,
    employeeId: alpha.employeeId,
    clientRef: crypto.randomUUID(),
    lines: [{ productId: alphaData.productId, quantity: 1 }],
    payments: [{ method: "cash", amount: 5000 }],
  });
  check("a sale records normally", alphaSale.total === 5000);

  // The id is real, and belongs to someone else. This is the URL-guessing case.
  const stolen = await getReceipt(beta.businessId, alphaSale.saleId);
  check("another business cannot read that receipt", stolen === null);

  const own = await getReceipt(alpha.businessId, alphaSale.saleId);
  check("its own business still can", own !== null);

  /* ── Cross-tenant writes are refused ─────────────────────────────────── */
  console.log("\nCross-tenant writes are refused");

  let sellingAnothersProduct = false;
  try {
    await recordSale({
      businessId: beta.businessId,
      branchId: betaBranchId,
      warehouseId: betaWarehouseId,
      employeeId: beta.employeeId,
      clientRef: crypto.randomUUID(),
      // Alpha's product id, submitted by Beta's till.
      lines: [{ productId: alphaData.productId, quantity: 1 }],
      payments: [{ method: "cash", amount: 5000 }],
    });
  } catch (error) {
    sellingAnothersProduct = error instanceof Error && /not in this catalogue/i.test(error.message);
  }
  check("one business cannot sell another's product", sellingAnothersProduct);

  let chargingAnothersCustomer = false;
  try {
    await recordSale({
      businessId: beta.businessId,
      branchId: betaBranchId,
      warehouseId: betaWarehouseId,
      employeeId: beta.employeeId,
      clientRef: crypto.randomUUID(),
      // Alpha's customer, charged on Beta's till.
      customerId: alphaData.customerId,
      lines: [{ productId: betaData.productId, quantity: 1 }],
      payments: [],
    });
  } catch (error) {
    chargingAnothersCustomer = error instanceof Error && /not on this business/i.test(error.message);
  }
  check("one business cannot charge another's customer", chargingAnothersCustomer);

  /* ── Reporting ───────────────────────────────────────────────────────── */
  console.log("\nReporting is scoped");

  const betaDashboard = await getDashboard(beta.businessId, betaWarehouseId);
  check(
    "another business's sale is absent from the dashboard",
    betaDashboard.counts.salesTotal === 0,
    `got ${betaDashboard.counts.salesTotal}`,
  );

  const alphaDashboard = await getDashboard(alpha.businessId, alphaWarehouseId);
  check("its own sale is present", alphaDashboard.counts.salesTotal === 1);

  /* ── Memberships ─────────────────────────────────────────────────────── */
  console.log("\nMembership decides access");

  check("an owner holds a membership", await hasMembership(alpha.userId, alpha.businessId));
  check(
    "and holds none in the other business",
    !(await hasMembership(alpha.userId, beta.businessId)),
  );

  const signedIn = await authenticate("alpha@example.com", "correct-horse-battery");
  check("correct credentials authenticate", signedIn.id === alpha.userId);

  let wrongPasswordRefused = false;
  try {
    await authenticate("alpha@example.com", "not-the-password");
  } catch {
    wrongPasswordRefused = true;
  }
  check("a wrong password is refused", wrongPasswordRefused);

  // Granting access is explicit, and only then does the other business open up.
  await db.transaction(async (tx) => {
    await addMembership(tx as never, {
      userId: alpha.userId,
      businessId: beta.businessId,
      branchId: betaBranchId,
      role: "manager",
      name: "Alpha Owner",
      email: "alpha@example.com",
    });
  });
  check("an invited user gains access", await hasMembership(alpha.userId, beta.businessId));

  /* ── Totals ──────────────────────────────────────────────────────────── */
  const allSales = await db.select({ id: sales.id, businessId: sales.businessId }).from(sales);
  check(
    "the database holds both businesses' rows side by side",
    allSales.length === 1 && allSales[0].businessId === alpha.businessId,
    `${allSales.length} sale(s)`,
  );

  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);

  async function branchAndWarehouse(businessId: string): Promise<[string, string]> {
    const { branches, warehouses } = await import("../src/db/schema");
    const [branch] = await db.select().from(branches).where(eq(branches.businessId, businessId)).limit(1);
    const [warehouse] = await db
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.businessId, businessId), eq(warehouses.branchId, branch.id)))
      .limit(1);
    return [branch.id, warehouse.id];
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

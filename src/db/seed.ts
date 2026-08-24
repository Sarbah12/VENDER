import "server-only";

import { eq, sql } from "drizzle-orm";

import { getDb, type Database } from "./client";
import {
  accounts,
  branches,
  businesses,
  categories,
  customers,
  employees,
  journalEntries,
  journalLines,
  products,
  registers,
  stockLevels,
  stockMovements,
  suppliers,
  warehouses,
} from "./schema";
import { DEFAULT_CHART } from "@/domain/accounts";
import { hashPin } from "@/server/pin";

/**
 * A demo shop with enough depth to exercise the whole chain: catalogue with
 * barcodes, opening stock that is actually posted to the ledger, staff with
 * till PINs, and customers to sell to on account.
 *
 * Modelled on a Ghanaian neighbourhood mini-mart because that is the first
 * market in the idea document, but nothing here is country-specific beyond the
 * currency and the product names.
 */

type SeedProduct = {
  sku: string;
  barcode: string | null;
  name: string;
  unit: string;
  /** Major units for readability; converted to pesewas below. */
  cost: number;
  sell: number;
  stock: number;
  reorder?: number;
  trackStock?: boolean;
};

const CATALOGUE: Array<{ category: string; colour: string; items: SeedProduct[] }> = [
  {
    category: "Drinks",
    colour: "#2563eb",
    items: [
      { sku: "DRK-001", barcode: "6001240100011", name: "Voltic Water 750ml", unit: "pc", cost: 2.2, sell: 3.5, stock: 120, reorder: 24 },
      { sku: "DRK-002", barcode: "6001240100028", name: "Coca-Cola 500ml", unit: "pc", cost: 4.0, sell: 6.0, stock: 96, reorder: 24 },
      { sku: "DRK-003", barcode: "6001240100035", name: "Malta Guinness 330ml", unit: "pc", cost: 6.5, sell: 9.0, stock: 60, reorder: 12 },
      { sku: "DRK-004", barcode: "6001240100042", name: "Kalyppo Mango 250ml", unit: "pc", cost: 2.8, sell: 4.5, stock: 84, reorder: 24 },
      { sku: "DRK-005", barcode: "6001240100059", name: "Lipton Tea Bags (25s)", unit: "box", cost: 12.0, sell: 18.0, stock: 30, reorder: 6 },
      { sku: "DRK-006", barcode: "6001240100066", name: "Nescafé Classic 100g", unit: "pc", cost: 38.0, sell: 52.0, stock: 18, reorder: 4 },
      { sku: "DRK-007", barcode: "6001240100073", name: "Club Beer 625ml", unit: "pc", cost: 11.0, sell: 16.0, stock: 48, reorder: 12 },
    ],
  },
  {
    category: "Food & Staples",
    colour: "#16a34a",
    items: [
      { sku: "FOD-001", barcode: "6001240200018", name: "Perfumed Rice 5kg", unit: "bag", cost: 78.0, sell: 98.0, stock: 40, reorder: 8 },
      { sku: "FOD-002", barcode: "6001240200025", name: "Frytol Cooking Oil 1L", unit: "pc", cost: 32.0, sell: 44.0, stock: 36, reorder: 8 },
      { sku: "FOD-003", barcode: "6001240200032", name: "Gino Tomato Paste 400g", unit: "tin", cost: 9.5, sell: 14.0, stock: 72, reorder: 24 },
      { sku: "FOD-004", barcode: "6001240200049", name: "Ideal Milk 160g", unit: "tin", cost: 7.0, sell: 10.0, stock: 90, reorder: 24 },
      { sku: "FOD-005", barcode: "6001240200056", name: "Indomie Chicken (40s)", unit: "carton", cost: 88.0, sell: 115.0, stock: 14, reorder: 3 },
      { sku: "FOD-006", barcode: "6001240200063", name: "Sugar 1kg", unit: "pc", cost: 14.0, sell: 20.0, stock: 55, reorder: 12 },
      { sku: "FOD-007", barcode: "6001240200070", name: "Milo Refill 400g", unit: "pc", cost: 42.0, sell: 58.0, stock: 26, reorder: 6 },
      { sku: "FOD-008", barcode: null, name: "Fresh Tomatoes", unit: "kg", cost: 8.0, sell: 14.0, stock: 25, reorder: 5 },
      { sku: "FOD-009", barcode: null, name: "Onions", unit: "kg", cost: 6.5, sell: 11.0, stock: 30, reorder: 5 },
      { sku: "FOD-010", barcode: "6001240200094", name: "Sardines 125g", unit: "tin", cost: 8.0, sell: 12.0, stock: 64, reorder: 18 },
    ],
  },
  {
    category: "Snacks",
    colour: "#f59e0b",
    items: [
      { sku: "SNK-001", barcode: "6001240300017", name: "Digestive Biscuits", unit: "pack", cost: 9.0, sell: 14.0, stock: 48, reorder: 12 },
      { sku: "SNK-002", barcode: "6001240300024", name: "Pringles Original", unit: "pc", cost: 26.0, sell: 36.0, stock: 22, reorder: 6 },
      { sku: "SNK-003", barcode: "6001240300031", name: "Groundnuts 200g", unit: "pack", cost: 5.0, sell: 8.0, stock: 60, reorder: 15 },
      { sku: "SNK-004", barcode: "6001240300048", name: "Plantain Chips", unit: "pack", cost: 4.5, sell: 7.5, stock: 55, reorder: 15 },
      { sku: "SNK-005", barcode: "6001240300055", name: "Chocolate Bar", unit: "pc", cost: 6.0, sell: 10.0, stock: 70, reorder: 20 },
    ],
  },
  {
    category: "Household",
    colour: "#7c3aed",
    items: [
      { sku: "HSE-001", barcode: "6001240400016", name: "Key Soap Bar", unit: "pc", cost: 6.5, sell: 10.0, stock: 80, reorder: 20 },
      { sku: "HSE-002", barcode: "6001240400023", name: "Omo Washing Powder 900g", unit: "pc", cost: 34.0, sell: 47.0, stock: 28, reorder: 6 },
      { sku: "HSE-003", barcode: "6001240400030", name: "Toilet Roll (4s)", unit: "pack", cost: 12.0, sell: 18.0, stock: 44, reorder: 12 },
      { sku: "HSE-004", barcode: "6001240400047", name: "Bleach 750ml", unit: "pc", cost: 11.0, sell: 16.0, stock: 32, reorder: 8 },
      { sku: "HSE-005", barcode: "6001240400054", name: "Matches (10s)", unit: "pack", cost: 3.0, sell: 5.0, stock: 90, reorder: 20 },
      { sku: "HSE-006", barcode: "6001240400061", name: "Mosquito Coil (10s)", unit: "pack", cost: 8.0, sell: 12.0, stock: 40, reorder: 10 },
    ],
  },
  {
    category: "Personal Care",
    colour: "#db2777",
    items: [
      { sku: "PER-001", barcode: "6001240500015", name: "Colgate Toothpaste 140g", unit: "pc", cost: 16.0, sell: 23.0, stock: 38, reorder: 10 },
      { sku: "PER-002", barcode: "6001240500022", name: "Toothbrush", unit: "pc", cost: 5.0, sell: 9.0, stock: 46, reorder: 12 },
      { sku: "PER-003", barcode: "6001240500039", name: "Nivea Body Lotion 400ml", unit: "pc", cost: 52.0, sell: 72.0, stock: 16, reorder: 4 },
      { sku: "PER-004", barcode: "6001240500046", name: "Shaving Stick", unit: "pc", cost: 7.0, sell: 11.0, stock: 34, reorder: 10 },
      { sku: "PER-005", barcode: "6001240500053", name: "Sanitary Pads (10s)", unit: "pack", cost: 15.0, sell: 22.0, stock: 30, reorder: 8 },
    ],
  },
  {
    category: "Services",
    colour: "#0891b2",
    items: [
      // Services have no shelf, so they opt out of stock control entirely.
      { sku: "SRV-001", barcode: null, name: "MTN Airtime Top-up", unit: "pc", cost: 0, sell: 10.0, stock: 0, trackStock: false },
      { sku: "SRV-002", barcode: null, name: "Photocopy (per page)", unit: "pc", cost: 0.1, sell: 0.5, stock: 0, trackStock: false },
      { sku: "SRV-003", barcode: null, name: "Phone Charging", unit: "pc", cost: 0, sell: 2.0, stock: 0, trackStock: false },
    ],
  },
];

const toMinor = (major: number) => Math.round(major * 100);

/** Creates the demo business if this database has none. Safe to run repeatedly. */
export async function seedDemoBusiness(db?: Database): Promise<{ businessId: string; created: boolean }> {
  const database = db ?? (await getDb());

  const [existing] = await database.select({ id: businesses.id }).from(businesses).limit(1);
  if (existing) return { businessId: existing.id, created: false };

  const businessId = await database.transaction(async (tx) => {
    const [business] = await tx
      .insert(businesses)
      .values({
        name: "Adom Mini Mart",
        legalName: "Adom Enterprise Ltd",
        currencyCode: "GHS",
        countryCode: "GH",
        // 3% VAT Flat Rate Scheme — what a small Ghanaian retailer actually
        // charges. Shelf prices already include it, as customers expect.
        taxRateBp: 300,
        pricesIncludeTax: true,
        taxNumber: "C0012345678",
      })
      .returning({ id: businesses.id });

    const bid = business.id;

    await tx.insert(accounts).values(
      DEFAULT_CHART.map((a) => ({
        businessId: bid,
        code: a.code,
        name: a.name,
        type: a.type,
        systemKey: a.systemKey,
      })),
    );

    const [branch] = await tx
      .insert(branches)
      .values({
        businessId: bid,
        name: "Osu Main Shop",
        code: "OSU",
        address: "18 Oxford Street, Osu, Accra",
        phone: "+233 30 276 1188",
      })
      .returning({ id: branches.id });

    const [warehouse] = await tx
      .insert(warehouses)
      .values({
        businessId: bid,
        branchId: branch.id,
        name: "Osu Shop Floor",
        code: "OSU-FLOOR",
        isDefault: true,
      })
      .returning({ id: warehouses.id });

    await tx.insert(registers).values([
      {
        businessId: bid,
        branchId: branch.id,
        warehouseId: warehouse.id,
        name: "Till 1",
        receiptPrefix: "T1",
      },
      {
        businessId: bid,
        branchId: branch.id,
        warehouseId: warehouse.id,
        name: "Till 2",
        receiptPrefix: "T2",
      },
    ]);

    const [ownerPin, managerPin, cashierPin] = await Promise.all([
      hashPin("1234"),
      hashPin("2345"),
      hashPin("3456"),
    ]);

    const staff = await tx
      .insert(employees)
      .values([
        { businessId: bid, branchId: branch.id, name: "Ama Serwaa", role: "owner", pinHash: ownerPin, phone: "+233 24 400 1122" },
        { businessId: bid, branchId: branch.id, name: "Kojo Mensah", role: "manager", pinHash: managerPin, phone: "+233 24 400 3344" },
        { businessId: bid, branchId: branch.id, name: "Efua Danso", role: "cashier", pinHash: cashierPin, phone: "+233 24 400 5566" },
      ])
      .returning({ id: employees.id });

    await tx.insert(suppliers).values([
      { businessId: bid, name: "Accra Wholesale Depot", phone: "+233 30 222 8899" },
      { businessId: bid, name: "Kasapreko Distribution", phone: "+233 30 233 1100" },
      { businessId: bid, name: "Makola Fresh Produce", phone: "+233 24 811 4477" },
    ]);

    await tx.insert(customers).values([
      { businessId: bid, name: "Walk-in Customer" },
      { businessId: bid, name: "Nana Adjei", phone: "+233 20 555 7788", email: "nana.adjei@example.com" },
      { businessId: bid, name: "Osu Presby School", phone: "+233 30 277 4455", address: "Osu, Accra" },
      { businessId: bid, name: "Sarah Owusu", phone: "+233 27 909 1122" },
    ]);

    // ── Catalogue and opening stock ──────────────────────────────────────
    let openingCost = 0;

    for (const [index, group] of CATALOGUE.entries()) {
      const [category] = await tx
        .insert(categories)
        .values({ businessId: bid, name: group.category, colour: group.colour, sortOrder: index })
        .returning({ id: categories.id });

      for (const item of group.items) {
        const [product] = await tx
          .insert(products)
          .values({
            businessId: bid,
            categoryId: category.id,
            sku: item.sku,
            barcode: item.barcode,
            name: item.name,
            unit: item.unit,
            costPrice: toMinor(item.cost),
            sellPrice: toMinor(item.sell),
            trackStock: item.trackStock ?? true,
            reorderPoint: item.reorder ?? 0,
          })
          .returning({ id: products.id });

        if (item.trackStock === false || item.stock <= 0) continue;

        await tx.insert(stockLevels).values({
          businessId: bid,
          warehouseId: warehouse.id,
          productId: product.id,
          quantity: item.stock,
        });

        await tx.insert(stockMovements).values({
          businessId: bid,
          warehouseId: warehouse.id,
          productId: product.id,
          quantityDelta: item.stock,
          balanceAfter: item.stock,
          reason: "opening_balance",
          unitCost: toMinor(item.cost),
          employeeId: staff[0].id,
          note: "Opening stock take",
        });

        openingCost += toMinor(item.cost) * item.stock;
      }
    }

    // Opening stock is not free — it is an asset the owner put in. Posting it
    // means the balance sheet is right from the very first day.
    if (openingCost > 0) {
      const chart = await tx
        .select({ id: accounts.id, systemKey: accounts.systemKey })
        .from(accounts)
        .where(eq(accounts.businessId, bid));
      const byKey = new Map(chart.map((a) => [a.systemKey, a.id]));

      const [entry] = await tx
        .insert(journalEntries)
        .values({
          businessId: bid,
          branchId: branch.id,
          memo: "Opening stock",
          refType: "opening_balance",
        })
        .returning({ id: journalEntries.id });

      await tx.insert(journalLines).values([
        { entryId: entry.id, accountId: byKey.get("inventory")!, debit: openingCost, credit: 0, memo: "Opening stock at cost" },
        { entryId: entry.id, accountId: byKey.get("opening_balance_equity")!, debit: 0, credit: openingCost, memo: "Owner's opening contribution" },
      ]);
    }

    return bid;
  });

  return { businessId, created: true };
}

/** Wipes every business and everything hanging off it. Used by `npm run db:reset`. */
export async function resetDatabase(db?: Database): Promise<void> {
  const database = db ?? (await getDb());
  // Cascades take care of the rest of the graph.
  await database.execute(sql`delete from businesses`);
}

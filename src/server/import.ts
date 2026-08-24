import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import ExcelJS from "exceljs";

import { getDb, type Database } from "@/db/client";
import { categories, products } from "@/db/schema";
import {
  REQUIRED_FIELDS,
  mapColumns,
  parseBooleanCell,
  parseCsv,
  parseMoneyCell,
  parseNumberCell,
  type ImportField,
} from "@/domain/spreadsheet";
import { percentToBp } from "@/lib/money";
import { createProductIn, updateProductIn, type ProductWrite } from "./products";

/**
 * Bulk catalogue import from a spreadsheet.
 *
 * A shop moving off paper or another till has its whole product list in Excel,
 * and retyping four hundred rows is how a migration dies. So this is deliberately
 * forgiving about the file it is given — column names vary, prices arrive with
 * currency symbols and thousands separators, "yes" and "TRUE" both mean true —
 * and deliberately strict about what it will write, refusing the whole import
 * rather than half-applying a file with bad rows in it.
 */

/* ──────────────────────────── Column mapping ───────────────────────────── */

export type { ImportField } from "@/domain/spreadsheet";

export const TEMPLATE_HEADERS: Array<{ field: ImportField; header: string; note: string }> = [
  { field: "sku", header: "SKU", note: "Required. Your code for the item — must be unique." },
  { field: "name", header: "Name", note: "Required. What the cashier sees." },
  { field: "barcode", header: "Barcode", note: "Optional, but scanning needs it." },
  { field: "category", header: "Category", note: "Created automatically if new." },
  { field: "unit", header: "Unit", note: "pc, kg, box, carton… Defaults to pc." },
  { field: "costPrice", header: "Cost Price", note: "What you pay. Drives profit reporting." },
  { field: "sellPrice", header: "Sell Price", note: "Required. What the customer pays." },
  { field: "taxRate", header: "Tax Rate %", note: "Blank uses the shop default." },
  { field: "trackStock", header: "Track Stock", note: "Yes / No. No for services." },
  { field: "reorderPoint", header: "Reorder Point", note: "Flagged on the dashboard below this." },
  { field: "openingStock", header: "Opening Stock", note: "Counted-in quantity. New items only." },
];

/** ExcelJS cells can be numbers, dates, formula results, rich text or hyperlinks. */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();

  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("").trim();
    }
    if ("text" in value && typeof value.text === "string") return value.text.trim();
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("formula" in value) return "";
    if ("error" in value) return "";
  }
  return String(value).trim();
}

/* ─────────────────────────────── Reading ───────────────────────────────── */

type Sheet = { headers: string[]; rows: Array<{ rowNumber: number; cells: string[] }> };

async function readWorkbook(buffer: ArrayBuffer): Promise<Sheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets.find((w) => w.rowCount > 0);
  if (!sheet) throw new ImportError("The workbook has no sheets with any rows in it.");

  const rows: Array<{ rowNumber: number; cells: string[] }> = [];
  let headers: string[] = [];

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    // row.values is 1-based with a leading hole; drop it so cells are 0-based.
    const cells = (row.values as ExcelJS.CellValue[]).slice(1).map(cellText);

    if (headers.length === 0) {
      headers = cells;
      return;
    }
    if (cells.every((cell) => cell === "")) return;
    rows.push({ rowNumber, cells });
  });

  if (headers.length === 0) throw new ImportError("The first row must contain column headings.");
  return { headers, rows };
}

function readCsv(text: string): Sheet {
  const grid = parseCsv(text).map((cells) => cells.map((cell) => cell.trim()));
  const headerIndex = grid.findIndex((cells) => cells.some((cell) => cell !== ""));
  if (headerIndex === -1) throw new ImportError("That file has no rows in it.");

  const headers = grid[headerIndex];
  const rows = grid
    .slice(headerIndex + 1)
    .map((cells, index) => ({ rowNumber: headerIndex + index + 2, cells }))
    .filter(({ cells }) => cells.some((cell) => cell !== ""));

  return { headers, rows };
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

/* ────────────────────────────── Validation ─────────────────────────────── */

export type ImportRow = {
  rowNumber: number;
  action: "create" | "update" | "error";
  errors: string[];
  warnings: string[];
  sku: string;
  name: string;
  barcode: string | null;
  categoryName: string | null;
  unit: string;
  costPrice: number;
  sellPrice: number;
  taxRateBp: number | null;
  trackStock: boolean;
  reorderPoint: number;
  openingStock: number;
  existingProductId: string | null;
};

export type ImportPreview = {
  fileName: string;
  /** Which spreadsheet heading was matched to each field, for the mapping table. */
  matched: Array<{ field: ImportField; header: string | null }>;
  unmatchedHeaders: string[];
  missingRequired: ImportField[];
  rows: ImportRow[];
  summary: {
    total: number;
    create: number;
    update: number;
    error: number;
    newCategories: string[];
    openingStockValue: number;
  };
};

const FIELD_LABEL: Record<ImportField, string> = Object.fromEntries(
  TEMPLATE_HEADERS.map((h) => [h.field, h.header]),
) as Record<ImportField, string>;

export async function buildPreview(
  businessId: string,
  file: { name: string; buffer: ArrayBuffer },
  defaults: { taxRateBp: number },
): Promise<ImportPreview> {
  const isCsv = /\.csv$/i.test(file.name);
  const sheet = isCsv
    ? readCsv(new TextDecoder().decode(file.buffer))
    : await readWorkbook(file.buffer);

  const mapping = mapColumns(sheet.headers);
  const missingRequired = REQUIRED_FIELDS.filter((field) => mapping[field] === null);

  const matched = TEMPLATE_HEADERS.map(({ field }) => ({
    field,
    header: mapping[field] === null ? null : (sheet.headers[mapping[field]!] ?? null),
  }));
  const mappedIndexes = new Set(Object.values(mapping).filter((i): i is number => i !== null));
  const unmatchedHeaders = sheet.headers.filter(
    (header, index) => header !== "" && !mappedIndexes.has(index),
  );

  if (missingRequired.length > 0) {
    return {
      fileName: file.name,
      matched,
      unmatchedHeaders,
      missingRequired,
      rows: [],
      summary: { total: 0, create: 0, update: 0, error: 0, newCategories: [], openingStockValue: 0 },
    };
  }

  const db = await getDb();
  const cell = (cells: string[], field: ImportField): string => {
    const index = mapping[field];
    return index === null ? "" : (cells[index] ?? "").trim();
  };

  // One query for the whole file rather than one per row.
  const skus = [...new Set(sheet.rows.map((r) => cell(r.cells, "sku")).filter(Boolean))];
  const existing = skus.length
    ? await db
        .select({ id: products.id, sku: products.sku, barcode: products.barcode })
        .from(products)
        .where(and(eq(products.businessId, businessId), inArray(products.sku, skus)))
    : [];
  const bySku = new Map(existing.map((p) => [p.sku, p]));

  const existingCategories = await db
    .select({ name: categories.name })
    .from(categories)
    .where(eq(categories.businessId, businessId));
  const knownCategories = new Set(existingCategories.map((c) => c.name.toLowerCase()));

  const seenSkus = new Map<string, number>();
  const seenBarcodes = new Map<string, number>();
  const newCategories = new Set<string>();
  const rows: ImportRow[] = [];

  for (const raw of sheet.rows) {
    const errors: string[] = [];
    const warnings: string[] = [];

    const sku = cell(raw.cells, "sku");
    const name = cell(raw.cells, "name");
    const barcodeRaw = cell(raw.cells, "barcode");
    const categoryName = cell(raw.cells, "category") || null;
    const unit = cell(raw.cells, "unit") || "pc";

    if (!sku) errors.push("SKU is missing.");
    else if (sku.length > 60) errors.push("SKU is longer than 60 characters.");
    if (!name) errors.push("Name is missing.");
    else if (name.length > 200) errors.push("Name is longer than 200 characters.");

    // A file that repeats a SKU would apply twice; catch it before it writes.
    if (sku) {
      const firstSeen = seenSkus.get(sku.toLowerCase());
      if (firstSeen) errors.push(`SKU "${sku}" also appears on row ${firstSeen}.`);
      else seenSkus.set(sku.toLowerCase(), raw.rowNumber);
    }

    const barcode = barcodeRaw || null;
    if (barcode) {
      if (barcode.length > 60) errors.push("Barcode is longer than 60 characters.");
      const firstSeen = seenBarcodes.get(barcode);
      if (firstSeen) errors.push(`Barcode "${barcode}" also appears on row ${firstSeen}.`);
      else seenBarcodes.set(barcode, raw.rowNumber);
    }

    const sellRaw = cell(raw.cells, "sellPrice");
    const sellPrice = sellRaw ? parseMoneyCell(sellRaw) : null;
    if (sellRaw && sellPrice === null) errors.push(`Sell price "${sellRaw}" is not a number.`);
    else if (sellPrice === null) errors.push("Sell price is missing.");
    else if (sellPrice < 0) errors.push("Sell price cannot be negative.");

    const costRaw = cell(raw.cells, "costPrice");
    const costParsed = costRaw ? parseMoneyCell(costRaw) : 0;
    if (costRaw && costParsed === null) errors.push(`Cost price "${costRaw}" is not a number.`);
    const costPrice = costParsed ?? 0;
    if (costPrice < 0) errors.push("Cost price cannot be negative.");

    if (sellPrice !== null && costPrice > 0 && sellPrice < costPrice) {
      warnings.push("Sell price is below cost — this item would lose money on every sale.");
    }

    const taxRaw = cell(raw.cells, "taxRate");
    let taxRateBp: number | null = null;
    if (taxRaw) {
      const percent = parseNumberCell(taxRaw);
      if (percent === null) errors.push(`Tax rate "${taxRaw}" is not a number.`);
      else if (percent < 0 || percent > 100) errors.push("Tax rate must be between 0 and 100.");
      else taxRateBp = percentToBp(percent);
    }

    const trackRaw = cell(raw.cells, "trackStock");
    let trackStock = true;
    if (trackRaw) {
      const parsed = parseBooleanCell(trackRaw);
      if (parsed === null) errors.push(`Track stock "${trackRaw}" should be Yes or No.`);
      else trackStock = parsed;
    }

    const reorderRaw = cell(raw.cells, "reorderPoint");
    const reorderParsed = reorderRaw ? parseNumberCell(reorderRaw) : 0;
    if (reorderRaw && reorderParsed === null) {
      errors.push(`Reorder point "${reorderRaw}" is not a number.`);
    }
    const reorderPoint = Math.max(0, reorderParsed ?? 0);

    const stockRaw = cell(raw.cells, "openingStock");
    const stockParsed = stockRaw ? parseNumberCell(stockRaw) : 0;
    if (stockRaw && stockParsed === null) {
      errors.push(`Opening stock "${stockRaw}" is not a number.`);
    }
    let openingStock = Math.max(0, stockParsed ?? 0);

    const match = sku ? (bySku.get(sku) ?? null) : null;

    if (match && openingStock > 0) {
      // Re-importing a price list should never silently double someone's stock.
      warnings.push(
        `Stock left unchanged — "${sku}" already exists. Use a stock adjustment to correct a count.`,
      );
      openingStock = 0;
    }
    if (openingStock > 0 && !trackStock) {
      warnings.push("Opening stock ignored because this item is not stock-tracked.");
      openingStock = 0;
    }
    if (openingStock > 0 && costPrice === 0) {
      warnings.push("Opening stock has no cost, so it adds nothing to the inventory value.");
    }

    // Only rows that will actually be written may contribute to the summary —
    // a category or a stock value promised by a row that gets skipped is a lie
    // told at exactly the moment the user is deciding whether to go ahead.
    if (errors.length === 0 && categoryName && !knownCategories.has(categoryName.toLowerCase())) {
      newCategories.add(categoryName);
    }

    rows.push({
      rowNumber: raw.rowNumber,
      action: errors.length > 0 ? "error" : match ? "update" : "create",
      errors,
      warnings,
      sku,
      name,
      barcode,
      categoryName,
      unit: unit.slice(0, 20),
      costPrice,
      sellPrice: sellPrice ?? 0,
      taxRateBp: taxRateBp ?? (taxRaw ? defaults.taxRateBp : null),
      trackStock,
      reorderPoint,
      openingStock,
      existingProductId: match?.id ?? null,
    });
  }

  return {
    fileName: file.name,
    matched,
    unmatchedHeaders,
    missingRequired,
    rows,
    summary: {
      total: rows.length,
      create: rows.filter((r) => r.action === "create").length,
      update: rows.filter((r) => r.action === "update").length,
      error: rows.filter((r) => r.action === "error").length,
      newCategories: [...newCategories],
      openingStockValue: rows
        .filter((row) => row.action !== "error")
        .reduce((a, r) => a + Math.round(r.costPrice * r.openingStock), 0),
    },
  };
}

export function describeMissing(fields: ImportField[]): string {
  return fields.map((field) => `"${FIELD_LABEL[field]}"`).join(", ");
}

/* ─────────────────────────────── Committing ────────────────────────────── */

export type ImportResult = { created: number; updated: number; categoriesCreated: number };

/**
 * Applies the whole file in one transaction.
 *
 * All or nothing: a file that fails halfway would leave a catalogue nobody can
 * reason about, and re-running it would then double-count opening stock. Rows
 * marked as errors are refused up front rather than skipped, so what the user
 * approved in the preview is exactly what gets written.
 */
export async function commitImport(args: {
  businessId: string;
  branchId: string;
  warehouseId: string;
  employeeId: string | null;
  rows: ImportRow[];
}): Promise<ImportResult> {
  const usable = args.rows.filter((row) => row.action !== "error");
  if (usable.length === 0) throw new ImportError("There are no rows to import.");

  const db = await getDb();

  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Database;

    // Categories first, so every product below can be attached to one.
    const existing = await tx
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.businessId, args.businessId));

    const categoryIds = new Map(existing.map((c) => [c.name.toLowerCase(), c.id]));
    const wanted = [
      ...new Set(
        usable
          .map((row) => row.categoryName)
          .filter((name): name is string => Boolean(name))
          .filter((name) => !categoryIds.has(name.toLowerCase())),
      ),
    ];

    for (const [index, name] of wanted.entries()) {
      const [created] = await tx
        .insert(categories)
        .values({ businessId: args.businessId, name, sortOrder: existing.length + index })
        .returning({ id: categories.id });
      categoryIds.set(name.toLowerCase(), created.id);
    }

    let created = 0;
    let updated = 0;

    for (const row of usable) {
      const input: ProductWrite = {
        sku: row.sku,
        name: row.name,
        barcode: row.barcode,
        categoryId: row.categoryName
          ? (categoryIds.get(row.categoryName.toLowerCase()) ?? null)
          : null,
        unit: row.unit,
        costPrice: row.costPrice,
        sellPrice: row.sellPrice,
        taxRateBp: row.taxRateBp,
        trackStock: row.trackStock,
        allowNegativeStock: false,
        reorderPoint: row.reorderPoint,
        isActive: true,
      };

      if (row.existingProductId) {
        await updateProductIn(tx, {
          businessId: args.businessId,
          branchId: args.branchId,
          productId: row.existingProductId,
          input,
        });
        updated += 1;
      } else {
        await createProductIn(tx, {
          businessId: args.businessId,
          branchId: args.branchId,
          warehouseId: args.warehouseId,
          employeeId: args.employeeId,
          input,
          openingStock: row.openingStock,
        });
        created += 1;
      }
    }

    return { created, updated, categoriesCreated: wanted.length };
  });
}

/* ──────────────────────────── Template download ────────────────────────── */

/** A starter workbook: headers, a note row explaining each, and two examples. */
export async function buildTemplateWorkbook(currencyCode: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Vender";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Products");
  sheet.columns = TEMPLATE_HEADERS.map((column) => ({
    header: column.header,
    key: column.field,
    width: Math.max(column.header.length + 4, 16),
  }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD81F26" } };
  headerRow.alignment = { vertical: "middle" };
  headerRow.height = 22;

  // Guidance rides on the header cells as hover notes rather than as a row of
  // its own. A row of explanations would come straight back in as a product on
  // re-upload — which is exactly what someone does after filling the file in.
  TEMPLATE_HEADERS.forEach((column, index) => {
    headerRow.getCell(index + 1).note = column.note;
  });

  sheet.addRow({
    sku: "DRK-001",
    name: "Voltic Water 750ml",
    barcode: "6001240100011",
    category: "Drinks",
    unit: "pc",
    costPrice: 2.2,
    sellPrice: 3.5,
    taxRate: 3,
    trackStock: "Yes",
    reorderPoint: 24,
    openingStock: 120,
  });
  sheet.addRow({
    sku: "SRV-001",
    name: "Photocopy (per page)",
    barcode: "",
    category: "Services",
    unit: "pc",
    costPrice: 0.1,
    sellPrice: 0.5,
    taxRate: "",
    trackStock: "No",
    reorderPoint: 0,
    openingStock: 0,
  });

  for (const key of ["costPrice", "sellPrice"] as const) {
    sheet.getColumn(key).numFmt = "#,##0.00";
  }

  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const guide = workbook.addWorksheet("How to use");
  guide.columns = [{ width: 22 }, { width: 90 }];
  guide.addRow(["Column", "What it means"]).font = { bold: true };
  for (const column of TEMPLATE_HEADERS) guide.addRow([column.header, column.note]);
  guide.addRow([]);
  guide.addRow(["Prices", `Enter in ${currencyCode}, e.g. 12.50. Symbols and commas are fine.`]);
  guide.addRow(["Matching", "Rows are matched to existing products by SKU: new SKUs are created, known SKUs are updated."]);
  guide.addRow(["Opening Stock", "Only applied when the product is created. Use a stock adjustment to correct an existing count."]);
  guide.addRow(["Extra columns", "Anything this list does not mention is ignored, so you can import an export from another system as-is."]);
  guide.getColumn(2).alignment = { wrapText: true, vertical: "top" };

  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}

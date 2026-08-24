/**
 * Reading what people actually put in spreadsheets.
 *
 * Pure and dependency-free, so the awkward cases — a price typed as
 * "GH₵ 1,250.00", a European "1.250,00", a header called "Item Code" instead of
 * "SKU" — can be pinned down in tests rather than discovered during someone's
 * migration.
 */

export type ImportField =
  | "sku"
  | "name"
  | "barcode"
  | "category"
  | "unit"
  | "costPrice"
  | "sellPrice"
  | "taxRate"
  | "trackStock"
  | "reorderPoint"
  | "openingStock";

/** Header aliases seen in real exports, matched case- and punctuation-insensitively. */
export const ALIASES: Record<ImportField, string[]> = {
  sku: ["sku", "code", "itemcode", "productcode", "itemno", "articlenumber", "ref"],
  name: ["name", "productname", "item", "itemname", "product", "description", "particulars"],
  barcode: ["barcode", "barcodes", "ean", "ean13", "upc", "gtin", "scancode"],
  category: ["category", "categoryname", "group", "productgroup", "department", "class"],
  unit: ["unit", "uom", "unitofmeasure", "measure", "packaging"],
  costPrice: ["cost", "costprice", "buyingprice", "purchaseprice", "unitcost", "buy"],
  sellPrice: ["price", "sellprice", "sellingprice", "retailprice", "unitprice", "sell", "rate"],
  taxRate: ["tax", "taxrate", "vat", "vatrate", "taxpercent", "tax%"],
  trackStock: ["trackstock", "tracked", "stocktracked", "istracked", "managestock"],
  reorderPoint: ["reorderpoint", "reorderlevel", "minstock", "minimum", "minimumstock", "reorder"],
  openingStock: [
    "openingstock",
    "stock",
    "quantity",
    "qty",
    "onhand",
    "stockonhand",
    "instock",
    "balance",
    "openingbalance",
  ],
};

export const REQUIRED_FIELDS: ImportField[] = ["sku", "name", "sellPrice"];

export function normaliseHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9%]/g, "");
}

/** Matches each field to a column index, or null when the file has no such column. */
export function mapColumns(headerRow: string[]): Record<ImportField, number | null> {
  const mapping = {} as Record<ImportField, number | null>;
  const normalised = headerRow.map(normaliseHeader);

  for (const field of Object.keys(ALIASES) as ImportField[]) {
    const index = normalised.findIndex((header) => header && ALIASES[field].includes(header));
    mapping[field] = index === -1 ? null : index;
  }
  return mapping;
}

/**
 * Money in, minor units out. Handles currency symbols, spaces, and both decimal
 * conventions.
 */
export function parseMoneyCell(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,-]/g, "").trim();
  if (!cleaned || cleaned === "-") return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalised: string;

  if (lastComma > -1 && lastDot > -1) {
    // Whichever separator comes last is the decimal point.
    normalised =
      lastComma > lastDot ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, "");
  } else if (lastComma > -1) {
    // A lone comma is a decimal point only if it separates 1–2 trailing digits;
    // "1,250" is one thousand two hundred and fifty, not 1.25.
    const decimals = cleaned.length - lastComma - 1;
    normalised =
      decimals > 0 && decimals <= 2 ? cleaned.replace(",", ".") : cleaned.replace(/,/g, "");
  } else {
    normalised = cleaned;
  }

  const value = Number(normalised);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** Same tolerance as money, but returns a plain number (quantities, rates). */
export function parseNumberCell(raw: string): number | null {
  const minor = parseMoneyCell(raw);
  return minor === null ? null : minor / 100;
}

export function parseBooleanCell(raw: string): boolean | null {
  const value = raw.trim().toLowerCase();
  if (["yes", "y", "true", "1", "tracked", "t"].includes(value)) return true;
  if (["no", "n", "false", "0", "untracked", "f"].includes(value)) return false;
  return null;
}

/** Minimal RFC-4180 reader: quoted fields, escaped quotes, embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  // Strip a UTF-8 BOM — Excel writes one, and it would corrupt the first header.
  const source = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");

  for (let i = 0; i < source.length; i++) {
    const char = source[i];

    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += char;
      continue;
    }

    if (char === '"') inQuotes = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

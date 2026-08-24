import assert from "node:assert/strict";
import { test } from "node:test";

import {
  mapColumns,
  parseBooleanCell,
  parseCsv,
  parseMoneyCell,
  parseNumberCell,
} from "./spreadsheet.ts";

/*
 * These are the shapes a real supplier price list arrives in. Getting any of
 * them wrong silently mis-prices a shop's entire catalogue, which is the worst
 * possible failure for an import: it looks like it worked.
 */

test("plain prices parse to minor units", () => {
  assert.equal(parseMoneyCell("12.50"), 1250);
  assert.equal(parseMoneyCell("12"), 1200);
  assert.equal(parseMoneyCell("0.05"), 5);
  assert.equal(parseMoneyCell("  3.5  "), 350);
});

test("currency symbols and spaces are stripped", () => {
  assert.equal(parseMoneyCell("GH₵ 12.50"), 1250);
  assert.equal(parseMoneyCell("$1,250.00"), 125_000);
  assert.equal(parseMoneyCell("₦ 900"), 90_000);
});

test("a lone comma is a thousands separator unless it looks like decimals", () => {
  // The case that quietly turns GH₵1,250 into GH₵1.25 if you get it wrong.
  assert.equal(parseMoneyCell("1,250"), 125_000);
  assert.equal(parseMoneyCell("12,345"), 1_234_500);
  assert.equal(parseMoneyCell("12,5"), 1250, "European single-decimal");
  assert.equal(parseMoneyCell("12,50"), 1250, "European two-decimal");
});

test("European formatting with both separators", () => {
  assert.equal(parseMoneyCell("1.250,00"), 125_000);
  assert.equal(parseMoneyCell("1,250.00"), 125_000);
  assert.equal(parseMoneyCell("1.234.567,89"), 123_456_789);
});

test("nonsense is rejected rather than guessed at", () => {
  assert.equal(parseMoneyCell(""), null);
  assert.equal(parseMoneyCell("   "), null);
  assert.equal(parseMoneyCell("n/a"), null);
  assert.equal(parseMoneyCell("-"), null);
  assert.equal(parseMoneyCell("call for price"), null);
});

test("quantities come back as plain numbers", () => {
  assert.equal(parseNumberCell("24"), 24);
  assert.equal(parseNumberCell("0.5"), 0.5);
  assert.equal(parseNumberCell("1,000"), 1000);
  assert.equal(parseNumberCell("abc"), null);
});

test("yes and no are spelled many ways", () => {
  for (const yes of ["Yes", "y", "TRUE", "1", "tracked"]) {
    assert.equal(parseBooleanCell(yes), true, yes);
  }
  for (const no of ["No", "n", "false", "0", "UNTRACKED"]) {
    assert.equal(parseBooleanCell(no), false, no);
  }
  assert.equal(parseBooleanCell("maybe"), null);
});

test("headers are matched regardless of case, spacing or punctuation", () => {
  const mapping = mapColumns([
    "Item Code",
    "Product Name",
    "Bar-Code",
    "Buying Price",
    "SELLING PRICE",
    "Qty",
  ]);

  assert.equal(mapping.sku, 0);
  assert.equal(mapping.name, 1);
  assert.equal(mapping.barcode, 2);
  assert.equal(mapping.costPrice, 3);
  assert.equal(mapping.sellPrice, 4);
  assert.equal(mapping.openingStock, 5);
  assert.equal(mapping.category, null, "absent columns map to null");
});

test("CSV handles quotes, commas inside fields and escaped quotes", () => {
  const rows = parseCsv('SKU,Name,Price\nA1,"Rice, 5kg",98.00\nA2,"He said ""hi""",10\n');

  assert.deepEqual(rows[0], ["SKU", "Name", "Price"]);
  assert.deepEqual(rows[1], ["A1", "Rice, 5kg", "98.00"]);
  assert.deepEqual(rows[2], ["A2", 'He said "hi"', "10"]);
});

test("CSV survives a BOM, CRLF line endings and a newline inside a field", () => {
  const rows = parseCsv('﻿SKU,Name\r\nA1,"Line one\nLine two"\r\n');

  assert.equal(rows[0][0], "SKU", "the BOM must not corrupt the first heading");
  assert.deepEqual(rows[1], ["A1", "Line one\nLine two"]);
});

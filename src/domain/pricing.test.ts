import assert from "node:assert/strict";
import { test } from "node:test";

import { allocate, applyRate, parseMoney, taxIncludedIn } from "../lib/money.ts";
import { priceLine, settle, totalsFor } from "./pricing.ts";

/*
 * These are the sums a shopkeeper would redo by hand if the till got them
 * wrong, so they are pinned here rather than left to the UI to demonstrate.
 */

test("tax-inclusive pricing carves tax out of the shelf price", () => {
  // GH₵ 10.00 shelf price at 3% VAT flat rate.
  const line = priceLine({ quantity: 1, unitPrice: 1000, taxRateBp: 300 }, true);

  assert.equal(line.lineTotal, 1000, "customer pays the shelf price");
  assert.equal(line.taxAmount, 29, "3% of the net, not 3% of the gross");
  assert.equal(line.netAmount, 971);
  assert.equal(line.netAmount + line.taxAmount, line.lineTotal);
});

test("tax-exclusive pricing adds tax on top", () => {
  const line = priceLine({ quantity: 2, unitPrice: 1000, taxRateBp: 1500 }, false);

  assert.equal(line.baseNet, 2000);
  assert.equal(line.taxAmount, 300);
  assert.equal(line.lineTotal, 2300);
});

test("a discount never leaves baseNet and netAmount inconsistent", () => {
  // 3 × 3.33 inclusive at 12.5%, less 1.00 — the rounding-prone case.
  const line = priceLine({ quantity: 3, unitPrice: 333, discount: 100, taxRateBp: 1250 }, true);

  assert.equal(line.baseNet - line.discountNet, line.netAmount);
  assert.equal(line.netAmount + line.taxAmount, line.lineTotal);
  assert.equal(line.lineTotal, 899, "999 gross less a 100 discount");
});

test("a discount cannot push a line negative", () => {
  const line = priceLine({ quantity: 1, unitPrice: 500, discount: 900, taxRateBp: 0 }, true);
  assert.equal(line.lineTotal, 0);
  assert.equal(line.netAmount, 0);
});

test("receipt totals reconcile: subtotal - discount + tax = total", () => {
  const lines = [
    priceLine({ quantity: 3, unitPrice: 350, taxRateBp: 300 }, true),
    priceLine({ quantity: 1, unitPrice: 9800, discount: 500, taxRateBp: 300 }, true),
    priceLine({ quantity: 2.5, unitPrice: 1400, taxRateBp: 300 }, true),
  ];
  const totals = totalsFor(lines);

  assert.equal(totals.subtotal - totals.discountTotal + totals.taxTotal, totals.total);
  assert.equal(
    totals.total,
    lines.reduce((a, l) => a + l.lineTotal, 0),
  );
});

test("cash overpayment becomes change, not revenue", () => {
  const result = settle(10_850, [{ method: "cash", amount: 20_000 }]);

  assert.equal(result.changeGiven, 9150);
  assert.equal(result.applied, 10_850);
  assert.equal(result.balanceDue, 0);
  assert.equal(result.appliedPerPayment[0], 10_850, "only the settled part hits the drawer");
});

test("change is taken from the cash tender in a split payment", () => {
  const result = settle(10_000, [
    { method: "mobile_money", amount: 4000 },
    { method: "cash", amount: 8000 },
  ]);

  assert.equal(result.changeGiven, 2000);
  assert.deepEqual(result.appliedPerPayment, [4000, 6000], "MoMo is untouched, cash absorbs the change");
});

test("an overpayment with no cash cannot be settled", () => {
  const result = settle(10_000, [{ method: "card", amount: 12_000 }]);

  // applied exceeds the total, which recordSale rejects rather than pocketing.
  assert.equal(result.applied, 12_000);
  assert.equal(result.changeGiven, 0);
});

test("underpayment leaves a balance due", () => {
  const result = settle(10_000, [{ method: "cash", amount: 4000 }]);

  assert.equal(result.balanceDue, 6000);
  assert.equal(result.changeGiven, 0);
  assert.equal(result.applied, 4000);
});

test("allocate never loses or invents a pesewa", () => {
  for (const [total, shares] of [
    [1000, 3],
    [1, 4],
    [9999, 7],
    [-1000, 3],
  ] as const) {
    const parts = allocate(total, shares);
    assert.equal(parts.length, shares);
    assert.equal(
      parts.reduce((a, b) => a + b, 0),
      total,
      `allocate(${total}, ${shares}) must sum back`,
    );
  }
});

test("rates round half away from zero, the way a cashier expects", () => {
  assert.equal(applyRate(1, 5000), 1, "0.5 rounds up, not to even");
  assert.equal(taxIncludedIn(1000, 300), 29);
  assert.equal(applyRate(0, 1500), 0);
});

test("money input is forgiving about how people type it", () => {
  assert.equal(parseMoney("15.50"), 1550);
  assert.equal(parseMoney("15,50"), 1550);
  assert.equal(parseMoney(" GH₵ 15 "), 1500);
  assert.equal(parseMoney(""), null);
  assert.equal(parseMoney("abc"), null);
});

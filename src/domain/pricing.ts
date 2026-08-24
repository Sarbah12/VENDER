import {
  applyRate,
  roundHalfAwayFromZero,
  taxIncludedIn,
  type BasisPoints,
  type Minor,
} from "@/lib/money";

/**
 * Line and receipt arithmetic, isolated from storage and UI so it can be reasoned
 * about (and tested) on its own. Every function here is pure.
 *
 * Two tax regimes are supported, because retailers genuinely differ:
 *   - tax-INCLUSIVE  (Ghana, UK, most of the EU): the shelf price is what the
 *     customer pays, and tax is carved out of it.
 *   - tax-EXCLUSIVE  (US-style): tax is added on top at the till.
 *
 * A receipt reads: subtotal − discount + tax = total, so every figure below is
 * expressed net of tax except `lineTotal`, which is what the customer pays.
 */

export type PricedLineInput = {
  quantity: number;
  /** In the business's price basis: tax-inclusive or not, per `pricesIncludeTax`. */
  unitPrice: Minor;
  /** Discount on this line, in the same basis as unitPrice. */
  discount?: Minor;
  taxRateBp: BasisPoints;
};

export type PricedLine = {
  /** Quantity × unit price before any discount, excluding tax. */
  baseNet: Minor;
  /** The discount, restated excluding tax. */
  discountNet: Minor;
  /** What we actually earned on this line, excluding tax. */
  netAmount: Minor;
  taxAmount: Minor;
  /** What the customer pays for this line: netAmount + taxAmount. */
  lineTotal: Minor;
};

export function priceLine(line: PricedLineInput, pricesIncludeTax: boolean): PricedLine {
  const rate = Math.max(0, line.taxRateBp);
  const discount = Math.max(0, line.discount ?? 0);

  if (pricesIncludeTax) {
    const baseGross = roundHalfAwayFromZero(line.unitPrice * line.quantity);
    // Never let a discount push a line negative — that is a refund, not a sale.
    const grossAfterDiscount = Math.max(0, baseGross - discount);

    const taxAmount = taxIncludedIn(grossAfterDiscount, rate);
    const netAmount = grossAfterDiscount - taxAmount;

    const baseNet = baseGross - taxIncludedIn(baseGross, rate);
    // Deriving the discount by subtraction (rather than carving tax out of the
    // discount separately) guarantees baseNet − discountNet === netAmount even
    // when both roundings would otherwise land a pesewa apart.
    const discountNet = baseNet - netAmount;

    return { baseNet, discountNet, netAmount, taxAmount, lineTotal: grossAfterDiscount };
  }

  const baseNet = roundHalfAwayFromZero(line.unitPrice * line.quantity);
  const discountNet = Math.min(discount, baseNet);
  const netAmount = baseNet - discountNet;
  const taxAmount = applyRate(netAmount, rate);

  return { baseNet, discountNet, netAmount, taxAmount, lineTotal: netAmount + taxAmount };
}

export type SaleTotals = {
  /** Sum of line values before discount, excluding tax. */
  subtotal: Minor;
  discountTotal: Minor;
  taxTotal: Minor;
  /** subtotal − discountTotal + taxTotal */
  total: Minor;
};

export function totalsFor(lines: PricedLine[]): SaleTotals {
  const subtotal = sum(lines.map((l) => l.baseNet));
  const discountTotal = sum(lines.map((l) => l.discountNet));
  const taxTotal = sum(lines.map((l) => l.taxAmount));
  const total = sum(lines.map((l) => l.lineTotal));
  return { subtotal, discountTotal, taxTotal, total };
}

/**
 * Resolve how a set of tendered payments settles a sale.
 *
 * Change can only ever come out of the cash drawer, so an overpayment with no
 * cash tendered is rejected rather than silently pocketed. Anything still
 * outstanding becomes `balanceDue` — a receivable against the customer.
 */
export type TenderInput = { method: string; amount: Minor };

export type Settlement = {
  tendered: Minor;
  /** Amount that actually settles the sale, i.e. tendered minus change. */
  applied: Minor;
  changeGiven: Minor;
  balanceDue: Minor;
  /** Per-payment settled amount, aligned by index with the input. */
  appliedPerPayment: Minor[];
};

export function settle(total: Minor, payments: TenderInput[]): Settlement {
  const tendered = sum(payments.map((p) => p.amount));
  const overpaid = Math.max(0, tendered - total);
  const balanceDue = Math.max(0, total - tendered);

  const appliedPerPayment = payments.map((p) => p.amount);

  // Give change back against cash tenders, last one first — that is the note
  // the cashier is holding when the drawer opens.
  let changeOwed = overpaid;
  for (let i = appliedPerPayment.length - 1; i >= 0 && changeOwed > 0; i--) {
    if (payments[i].method !== "cash") continue;
    const deducted = Math.min(changeOwed, appliedPerPayment[i]);
    appliedPerPayment[i] -= deducted;
    changeOwed -= deducted;
  }

  return {
    tendered,
    applied: tendered - overpaid + changeOwed,
    changeGiven: overpaid - changeOwed,
    balanceDue,
    appliedPerPayment,
  };
}

/** True when the customer handed over more than the drawer can give back. */
export function hasUnrefundableOverpayment(total: Minor, payments: TenderInput[]): boolean {
  return settle(total, payments).applied > total;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

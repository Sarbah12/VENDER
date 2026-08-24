/**
 * Money is stored and computed exclusively in integer minor units (pesewas for
 * GHS, cents for USD). Floating point never touches a monetary value: a POS that
 * is off by a pesewa on 400 sales a day is a POS nobody trusts with their till.
 *
 * Quantities are separate — they are measurements, not money, and live as
 * numeric(14,3) in the database (so 0.250 kg is expressible).
 */

/** Minor units, e.g. 1550 === GHS 15.50 */
export type Minor = number;

export type CurrencyConfig = {
  code: string;
  symbol: string;
  /** Number of decimal places, i.e. minor units per major unit = 10 ** decimals */
  decimals: number;
};

export const GHS: CurrencyConfig = { code: "GHS", symbol: "GH₵", decimals: 2 };

const CURRENCIES: Record<string, CurrencyConfig> = {
  GHS,
  USD: { code: "USD", symbol: "$", decimals: 2 },
  EUR: { code: "EUR", symbol: "€", decimals: 2 },
  GBP: { code: "GBP", symbol: "£", decimals: 2 },
  NGN: { code: "NGN", symbol: "₦", decimals: 2 },
  KES: { code: "KES", symbol: "KSh", decimals: 2 },
  ZAR: { code: "ZAR", symbol: "R", decimals: 2 },
};

export function currency(code: string): CurrencyConfig {
  return CURRENCIES[code] ?? { code, symbol: code, decimals: 2 };
}

/** Format minor units for display: formatMoney(1550) -> "GH₵ 15.50" */
export function formatMoney(minor: Minor, code = "GHS"): string {
  const c = currency(code);
  const factor = 10 ** c.decimals;
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const body = (abs / factor).toLocaleString("en-US", {
    minimumFractionDigits: c.decimals,
    maximumFractionDigits: c.decimals,
  });
  return `${negative ? "-" : ""}${c.symbol} ${body}`;
}

/** Same as formatMoney but without the currency symbol, for tight table cells. */
export function formatAmount(minor: Minor, code = "GHS"): string {
  const c = currency(code);
  const factor = 10 ** c.decimals;
  return (minor / factor).toLocaleString("en-US", {
    minimumFractionDigits: c.decimals,
    maximumFractionDigits: c.decimals,
  });
}

/** Parse user keyboard input ("15.50", "15,50", "  15 ") into minor units. */
export function parseMoney(input: string, code = "GHS"): Minor | null {
  const c = currency(code);
  const cleaned = input.replace(/[^0-9.,-]/g, "").replace(",", ".");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10 ** c.decimals);
}

/**
 * Tax and discount rates are held in basis points (1% === 100 bp) so that a
 * 12.5% VAT rate is an exact integer rather than a repeating binary fraction.
 */
export type BasisPoints = number;

export const percentToBp = (percent: number): BasisPoints => Math.round(percent * 100);
export const bpToPercent = (bp: BasisPoints): number => bp / 100;

/**
 * Apply a basis-point rate to a minor-unit amount, rounding half away from zero
 * (the convention every cashier expects: 0.5 rounds up, never to even).
 */
export function applyRate(amount: Minor, bp: BasisPoints): Minor {
  return roundHalfAwayFromZero((amount * bp) / 10_000);
}

/** Extract the tax already contained inside a tax-inclusive amount. */
export function taxIncludedIn(grossAmount: Minor, bp: BasisPoints): Minor {
  if (bp === 0) return 0;
  return roundHalfAwayFromZero((grossAmount * bp) / (10_000 + bp));
}

export function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Split a total across n shares without losing or inventing minor units.
 * Remainder pesewas are handed to the earliest shares, so the parts always sum
 * back to exactly `total`.
 */
export function allocate(total: Minor, shares: number): Minor[] {
  if (shares <= 0) return [];
  const base = Math.trunc(total / shares);
  let remainder = total - base * shares;
  const step = remainder < 0 ? -1 : 1;
  remainder = Math.abs(remainder);
  return Array.from({ length: shares }, (_, i) => base + (i < remainder ? step : 0));
}

/** Quantities: 3 decimal places, matching numeric(14,3) in the schema. */
export const QTY_DECIMALS = 3;

export function roundQty(qty: number): number {
  return Math.round(qty * 10 ** QTY_DECIMALS) / 10 ** QTY_DECIMALS;
}

export function formatQty(qty: number): string {
  // Whole numbers read as "2", fractional as "0.25" — never "2.000".
  return Number.isInteger(qty) ? String(qty) : String(roundQty(qty));
}

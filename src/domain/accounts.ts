import type { PaymentMethod } from "@/db/schema";

/**
 * The default chart of accounts every new business is created with.
 *
 * `systemKey` is what the posting rules reference, so a business can rename or
 * renumber an account without breaking the ledger. Accounts carrying a system
 * key cannot be deleted.
 */
export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

export type SystemAccountKey =
  | "cash"
  | "mobile_money"
  | "bank"
  | "accounts_receivable"
  | "inventory"
  | "accounts_payable"
  | "tax_payable"
  | "store_credit"
  | "opening_balance_equity"
  | "sales_revenue"
  | "sales_discounts"
  | "cost_of_goods_sold"
  | "operating_expenses"
  | "stock_adjustments";

export const DEFAULT_CHART: ReadonlyArray<{
  code: string;
  name: string;
  type: AccountType;
  systemKey: SystemAccountKey;
}> = [
  { code: "1000", name: "Cash on Hand", type: "asset", systemKey: "cash" },
  { code: "1010", name: "Mobile Money", type: "asset", systemKey: "mobile_money" },
  { code: "1020", name: "Bank / Card Settlement", type: "asset", systemKey: "bank" },
  { code: "1100", name: "Accounts Receivable", type: "asset", systemKey: "accounts_receivable" },
  { code: "1200", name: "Inventory", type: "asset", systemKey: "inventory" },
  { code: "2000", name: "Accounts Payable", type: "liability", systemKey: "accounts_payable" },
  { code: "2100", name: "Sales Tax Payable", type: "liability", systemKey: "tax_payable" },
  { code: "2200", name: "Store Credit Issued", type: "liability", systemKey: "store_credit" },
  { code: "3000", name: "Opening Balance Equity", type: "equity", systemKey: "opening_balance_equity" },
  { code: "4000", name: "Sales Revenue", type: "income", systemKey: "sales_revenue" },
  // Contra-revenue: lives under income but carries a debit balance, so a P&L
  // computed as (credits − debits) per income account nets discounts out for free.
  { code: "4100", name: "Sales Discounts", type: "income", systemKey: "sales_discounts" },
  { code: "5000", name: "Cost of Goods Sold", type: "expense", systemKey: "cost_of_goods_sold" },
  { code: "5100", name: "Stock Adjustments", type: "expense", systemKey: "stock_adjustments" },
  { code: "6000", name: "Operating Expenses", type: "expense", systemKey: "operating_expenses" },
];

/** Where money received by each tender type lands on the balance sheet. */
export const PAYMENT_ACCOUNT: Record<PaymentMethod, SystemAccountKey> = {
  cash: "cash",
  card: "bank",
  mobile_money: "mobile_money",
  bank_transfer: "bank",
  store_credit: "store_credit",
  on_account: "accounts_receivable",
};

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  mobile_money: "Mobile Money",
  bank_transfer: "Bank Transfer",
  store_credit: "Store Credit",
  on_account: "On Account",
};

/**
 * Asset and expense accounts increase on the debit side; liability, equity and
 * income accounts increase on the credit side. Used when turning raw journal
 * lines into readable balances.
 */
export function normalBalance(type: AccountType): "debit" | "credit" {
  return type === "asset" || type === "expense" ? "debit" : "credit";
}

export function signedBalance(type: AccountType, debit: number, credit: number): number {
  return normalBalance(type) === "debit" ? debit - credit : credit - debit;
}

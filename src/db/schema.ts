import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Conventions used throughout:
 *  - Money columns are bigint holding MINOR UNITS (pesewas). See src/lib/money.ts.
 *  - Rates (tax, discount %) are integer BASIS POINTS. 1250 === 12.5%.
 *  - Quantities are numeric(14,3), so weights and part-units are expressible.
 *  - Every business-owned row carries business_id. The platform is multi-tenant
 *    and multi-branch from the first row, because retrofitting tenancy is the
 *    single most expensive mistake this kind of product can make.
 */
const money = (name: string) => bigint(name, { mode: "number" });
const qty = (name: string) => numeric(name, { precision: 14, scale: 3, mode: "number" });
const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/* ───────────────────────────── Organisation ───────────────────────────── */

export const businesses = pgTable("businesses", {
  id: id(),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  currencyCode: text("currency_code").notNull().default("GHS"),
  countryCode: text("country_code").notNull().default("GH"),
  /** Default sales-tax rate in basis points; products may override. */
  taxRateBp: integer("tax_rate_bp").notNull().default(0),
  /** When true, product sell prices already contain tax (common in Ghana/EU retail). */
  pricesIncludeTax: boolean("prices_include_tax").notNull().default(true),
  taxNumber: text("tax_number"),
  createdAt: createdAt(),
});

export const branches = pgTable(
  "branches",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    address: text("address"),
    phone: text("phone"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("branches_business_code_uq").on(t.businessId, t.code)],
);

/** Stock lives in a warehouse. A shop floor is just a warehouse attached to a branch. */
export const warehouses = pgTable(
  "warehouses",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    /** The warehouse a sale at this branch draws stock from by default. */
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("warehouses_business_code_uq").on(t.businessId, t.code)],
);

export const employeeRole = pgEnum("employee_role", ["owner", "manager", "cashier", "stock_clerk"]);

export const employees = pgTable(
  "employees",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    role: employeeRole("role").notNull().default("cashier"),
    /**
     * Scrypt hash of the till PIN — never the PIN itself. This gates the POS
     * for shift attribution; it is deliberately NOT a substitute for real
     * account authentication, which belongs with the Administration module.
     */
    pinHash: text("pin_hash"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("employees_business_idx").on(t.businessId)],
);

/* ─────────────────────────────── Catalogue ─────────────────────────────── */

export const categories = pgTable(
  "categories",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    colour: text("colour"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("categories_business_name_uq").on(t.businessId, t.name)],
);

export const products = pgTable(
  "products",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    sku: text("sku").notNull(),
    barcode: text("barcode"),
    name: text("name").notNull(),
    description: text("description"),
    /** Unit of measure: pc, kg, L, box… */
    unit: text("unit").notNull().default("pc"),
    /** What we pay. Drives cost of goods sold on every sale. */
    costPrice: money("cost_price").notNull().default(0),
    /** What the customer pays, before line discounts. */
    sellPrice: money("sell_price").notNull().default(0),
    /** null = fall back to the business default rate. */
    taxRateBp: integer("tax_rate_bp"),
    /** Services and unweighed items opt out of stock control. */
    trackStock: boolean("track_stock").notNull().default(true),
    /** Allow selling below zero on hand (a bar selling from an unbooked delivery). */
    allowNegativeStock: boolean("allow_negative_stock").notNull().default(false),
    reorderPoint: qty("reorder_point").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("products_business_sku_uq").on(t.businessId, t.sku),
    // Partial-free unique index: two products may both have NULL barcode, but a
    // real barcode must resolve to exactly one product or scanning is ambiguous.
    uniqueIndex("products_business_barcode_uq").on(t.businessId, t.barcode),
    index("products_business_active_idx").on(t.businessId, t.isActive),
    // The catalogue is always listed in name order. Without this, every page of
    // a large catalogue sorts the whole filtered set before returning 50 rows.
    index("products_business_name_idx").on(t.businessId, t.name),
  ],
);

export const stockLevels = pgTable(
  "stock_levels",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    quantity: qty("quantity").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("stock_levels_warehouse_product_uq").on(t.warehouseId, t.productId),
    // Revaluing a product sums its stock across every warehouse in the business.
    index("stock_levels_business_product_idx").on(t.businessId, t.productId),
  ],
);

export const stockMovementReason = pgEnum("stock_movement_reason", [
  "sale",
  "refund",
  "purchase",
  "adjustment",
  "transfer_in",
  "transfer_out",
  "opening_balance",
  "wastage",
]);

/**
 * The immutable audit trail. stock_levels is a cached running total; this table
 * is the truth, and a level can always be rebuilt by summing its movements.
 */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Signed: negative leaves the warehouse, positive enters it. */
    quantityDelta: qty("quantity_delta").notNull(),
    /** Running total after this movement, for point-in-time stock reports. */
    balanceAfter: qty("balance_after").notNull(),
    reason: stockMovementReason("reason").notNull(),
    /** What caused it: "sale", "purchase_order", "adjustment"… */
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    unitCost: money("unit_cost").notNull().default(0),
    employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("stock_movements_product_idx").on(t.productId, t.createdAt),
    index("stock_movements_ref_idx").on(t.refType, t.refId),
    // The movements page reads the newest few hundred for the whole business.
    // This table grows with every line of every sale, so it must not be scanned.
    index("stock_movements_business_time_idx").on(t.businessId, t.createdAt),
  ],
);

/* ──────────────────────────── People we trade with ─────────────────────── */

export const customers = pgTable(
  "customers",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    /** Outstanding balance owed to us, in minor units. Positive = customer owes. */
    balance: money("balance").notNull().default(0),
    loyaltyPoints: integer("loyalty_points").notNull().default(0),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("customers_business_idx").on(t.businessId, t.name)],
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    /** Positive = we owe the supplier. */
    balance: money("balance").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("suppliers_business_idx").on(t.businessId, t.name)],
);

/* ──────────────────────────── Tills and shifts ─────────────────────────── */

export const registers = pgTable(
  "registers",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    /** Per-register receipt prefix, so two tills never mint the same number. */
    receiptPrefix: text("receipt_prefix").notNull().default("R"),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [index("registers_branch_idx").on(t.branchId)],
);

/** One cashier's stint at one till: opening float in, cash counted out. */
export const registerSessions = pgTable(
  "register_sessions",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    registerId: uuid("register_id")
      .notNull()
      .references(() => registers.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    openingFloat: money("opening_float").notNull().default(0),
    /** Filled in at close: what the system says vs what was in the drawer. */
    expectedCash: money("expected_cash"),
    countedCash: money("counted_cash"),
    openedAt: createdAt(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    note: text("note"),
  },
  (t) => [index("register_sessions_open_idx").on(t.registerId, t.closedAt)],
);

/* ───────────────────────────────── Selling ─────────────────────────────── */

export const saleStatus = pgEnum("sale_status", [
  "completed",
  "held",
  "refunded",
  "partially_refunded",
  "voided",
]);

export const sales = pgTable(
  "sales",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    registerSessionId: uuid("register_session_id").references(() => registerSessions.id, {
      onDelete: "set null",
    }),
    employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "set null" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    /** Human-facing receipt number, e.g. "R1-000042". Unique per business. */
    number: text("number").notNull(),
    status: saleStatus("status").notNull().default("completed"),
    subtotal: money("subtotal").notNull().default(0),
    discountTotal: money("discount_total").notNull().default(0),
    taxTotal: money("tax_total").notNull().default(0),
    total: money("total").notNull().default(0),
    paidTotal: money("paid_total").notNull().default(0),
    changeGiven: money("change_given").notNull().default(0),
    /** total - paidTotal when the customer is buying on account. */
    balanceDue: money("balance_due").notNull().default(0),
    /** Sum of cost_snapshot across lines — lets margin be reported without a join. */
    costTotal: money("cost_total").notNull().default(0),
    /**
     * Client-generated idempotency key. A till that loses connectivity mid-sale
     * retries the same key, and the unique index turns a double-submit into a
     * no-op instead of a duplicate sale.
     */
    clientRef: text("client_ref"),
    note: text("note"),
    /** When the till actually rang it up, which may precede sync by hours. */
    soldAt: timestamp("sold_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("sales_business_number_uq").on(t.businessId, t.number),
    uniqueIndex("sales_business_client_ref_uq").on(t.businessId, t.clientRef),
    index("sales_business_sold_at_idx").on(t.businessId, t.soldAt),
    index("sales_branch_sold_at_idx").on(t.branchId, t.soldAt),
    // Both of these are joined from list pages — the customer's history and the
    // cashier's takings — and neither is covered by the indexes above.
    index("sales_customer_idx").on(t.customerId),
    index("sales_employee_idx").on(t.employeeId),
  ],
);

export const saleLines = pgTable(
  "sale_lines",
  {
    id: id(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    lineNumber: integer("line_number").notNull(),
    /**
     * Snapshots, not joins. A receipt reprinted next year must show the name and
     * price as they were sold, even after the product is renamed or repriced.
     */
    nameSnapshot: text("name_snapshot").notNull(),
    skuSnapshot: text("sku_snapshot"),
    unitSnapshot: text("unit_snapshot").notNull().default("pc"),
    quantity: qty("quantity").notNull(),
    unitPrice: money("unit_price").notNull(),
    discountAmount: money("discount_amount").notNull().default(0),
    taxRateBp: integer("tax_rate_bp").notNull().default(0),
    taxAmount: money("tax_amount").notNull().default(0),
    /** Net of discount, exclusive of tax. */
    netAmount: money("net_amount").notNull().default(0),
    /** What the customer is charged for this line: net + tax. */
    lineTotal: money("line_total").notNull().default(0),
    /** Unit cost at the moment of sale, for COGS and margin. */
    costSnapshot: money("cost_snapshot").notNull().default(0),
    quantityRefunded: qty("quantity_refunded").notNull().default(0),
  },
  (t) => [
    index("sale_lines_sale_idx").on(t.saleId),
    // "How much of this product have we sold" — the basis of every product
    // performance report, over the fastest-growing table in the schema.
    index("sale_lines_product_idx").on(t.productId),
  ],
);

export const paymentMethod = pgEnum("payment_method", [
  "cash",
  "card",
  "mobile_money",
  "bank_transfer",
  "store_credit",
  "on_account",
]);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    saleId: uuid("sale_id").references(() => sales.id, { onDelete: "cascade" }),
    method: paymentMethod("method").notNull(),
    /** Tendered amount. For cash this may exceed the sale total; change is on the sale. */
    amount: money("amount").notNull(),
    /** MoMo transaction id, card auth code, cheque number… */
    reference: text("reference"),
    createdAt: createdAt(),
  },
  (t) => [index("payments_sale_idx").on(t.saleId)],
);

/* ────────────────────────────── Purchasing ─────────────────────────────── */

export const purchaseOrderStatus = pgEnum("purchase_order_status", [
  "draft",
  "ordered",
  "partially_received",
  "received",
  "cancelled",
]);

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    number: text("number").notNull(),
    status: purchaseOrderStatus("status").notNull().default("draft"),
    subtotal: money("subtotal").notNull().default(0),
    taxTotal: money("tax_total").notNull().default(0),
    total: money("total").notNull().default(0),
    expectedAt: timestamp("expected_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("purchase_orders_business_number_uq").on(t.businessId, t.number)],
);

export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: id(),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    quantityOrdered: qty("quantity_ordered").notNull(),
    quantityReceived: qty("quantity_received").notNull().default(0),
    unitCost: money("unit_cost").notNull(),
    lineTotal: money("line_total").notNull().default(0),
  },
  (t) => [index("purchase_order_lines_po_idx").on(t.purchaseOrderId)],
);

/* ───────────────────────── Finance: double-entry ledger ────────────────── */

export const accountType = pgEnum("account_type", [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
]);

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: accountType("type").notNull(),
    /** System accounts are wired into posting rules and cannot be deleted. */
    systemKey: text("system_key"),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    uniqueIndex("accounts_business_code_uq").on(t.businessId, t.code),
    uniqueIndex("accounts_business_system_key_uq").on(t.businessId, t.systemKey),
  ],
);

/**
 * Every financial event in the platform posts a balanced journal entry. This is
 * what makes "a sale is not an isolated transaction" true rather than a slogan:
 * the P&L and balance sheet are derived from the same write that moved the stock.
 */
export const journalEntries = pgTable(
  "journal_entries",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    entryDate: timestamp("entry_date", { withTimezone: true }).notNull().defaultNow(),
    memo: text("memo"),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("journal_entries_business_date_idx").on(t.businessId, t.entryDate),
    index("journal_entries_ref_idx").on(t.refType, t.refId),
  ],
);

export const journalLines = pgTable(
  "journal_lines",
  {
    id: id(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    /** Exactly one of debit/credit is non-zero on any given line. */
    debit: money("debit").notNull().default(0),
    credit: money("credit").notNull().default(0),
    memo: text("memo"),
  },
  (t) => [index("journal_lines_entry_idx").on(t.entryId), index("journal_lines_account_idx").on(t.accountId)],
);

/* ───────────────────────────── Numbering counters ──────────────────────── */

/**
 * Receipt and document numbers come from here rather than count(*) or max()+1,
 * both of which hand two concurrent tills the same number. The row is locked
 * with UPDATE … RETURNING inside the sale transaction.
 */
export const counters = pgTable(
  "counters",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: integer("value").notNull().default(0),
  },
  (t) => [uniqueIndex("counters_business_key_uq").on(t.businessId, t.key)],
);

/* ─────────────────────────────── Audit trail ───────────────────────────── */

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    detail: jsonb("detail"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_business_idx").on(t.businessId, t.createdAt)],
);

export type Business = typeof businesses.$inferSelect;
export type Branch = typeof branches.$inferSelect;
export type Warehouse = typeof warehouses.$inferSelect;
export type Employee = typeof employees.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Product = typeof products.$inferSelect;
export type StockLevel = typeof stockLevels.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Register = typeof registers.$inferSelect;
export type RegisterSession = typeof registerSessions.$inferSelect;
export type Sale = typeof sales.$inferSelect;
export type SaleLine = typeof saleLines.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type PaymentMethod = (typeof paymentMethod.enumValues)[number];

export type PosProduct = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  unit: string;
  sellPrice: number;
  taxRateBp: number;
  trackStock: boolean;
  allowNegativeStock: boolean;
  stock: number;
  categoryId: string | null;
  categoryName: string;
  categoryColour: string | null;
};

export type PosCategory = {
  id: string;
  name: string;
  colour: string | null;
  /** Products in this category across the whole catalogue, not just what is loaded. */
  count: number;
};

export type PosCustomer = { id: string; name: string; phone: string | null };

export type CartLine = {
  /** Stable key so React keeps focus while a row is edited. */
  key: string;
  productId: string;
  name: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  discount: number;
  taxRateBp: number;
  trackStock: boolean;
  allowNegativeStock: boolean;
  stock: number;
};

export type Tender = {
  key: string;
  method: "cash" | "card" | "mobile_money" | "bank_transfer" | "store_credit" | "on_account";
  amount: number;
  reference: string | null;
};

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getShopContext, isSignedIn } from "@/server/context";
import { getReceipt, type Receipt } from "@/server/receipts";
import { recordSale, SaleError } from "@/server/sales";

const CheckoutSchema = z.object({
  /** Minted by the till before the first attempt; makes retries idempotent. */
  clientRef: z.uuid(),
  customerId: z.uuid().nullable(),
  note: z.string().max(500).nullable(),
  /** ISO timestamp from the till, so an offline sale keeps the hour it happened. */
  soldAt: z.iso.datetime().nullable(),
  lines: z
    .array(
      z.object({
        productId: z.uuid(),
        quantity: z.number().positive().max(100_000),
        unitPrice: z.number().int().min(0),
        discount: z.number().int().min(0),
      }),
    )
    .min(1),
  payments: z.array(
    z.object({
      method: z.enum(["cash", "card", "mobile_money", "bank_transfer", "store_credit", "on_account"]),
      amount: z.number().int().min(0),
      reference: z.string().max(120).nullable(),
    }),
  ),
});

export type CheckoutInput = z.input<typeof CheckoutSchema>;

export type CheckoutResult =
  | { ok: true; receipt: Receipt; duplicate: boolean }
  | { ok: false; code: string; message: string };

/**
 * The one entry point the till uses to commit a sale.
 *
 * Everything it is handed is re-validated and re-priced on the server: a till is
 * a client, and a client's arithmetic is a suggestion. Prices, tax and totals
 * are recomputed from the catalogue, so a tampered or stale cart cannot decide
 * what the shop gets paid.
 */
export async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
  const parsed = CheckoutSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid sale." };
  }

  const context = await getShopContext();
  if (!context || !isSignedIn(context)) {
    return { ok: false, code: "signed_out", message: "Your session ended. Sign in again to continue." };
  }

  const sale = parsed.data;

  try {
    const result = await recordSale({
      businessId: context.business.id,
      branchId: context.branch.id,
      warehouseId: context.register?.warehouseId ?? context.warehouse.id,
      registerId: context.register?.id ?? null,
      employeeId: context.employee.id,
      customerId: sale.customerId,
      clientRef: sale.clientRef,
      note: sale.note,
      soldAt: sale.soldAt ? new Date(sale.soldAt) : undefined,
      lines: sale.lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: l.discount,
      })),
      payments: sale.payments.map((p) => ({
        method: p.method,
        amount: p.amount,
        reference: p.reference ?? undefined,
      })),
    });

    const receipt = await getReceipt(result.saleId);
    if (!receipt) {
      return { ok: false, code: "receipt_missing", message: "The sale saved but the receipt could not be read." };
    }

    // Stock, takings and the ledger all just changed.
    revalidatePath("/dashboard");
    revalidatePath("/sales");
    revalidatePath("/inventory");
    revalidatePath("/finance");
    revalidatePath("/products");

    return { ok: true, receipt, duplicate: result.duplicate };
  } catch (error) {
    if (error instanceof SaleError) {
      return { ok: false, code: error.code, message: error.message };
    }
    console.error("checkout failed", error);
    return { ok: false, code: "unexpected", message: "The sale could not be completed. Nothing was charged." };
  }
}

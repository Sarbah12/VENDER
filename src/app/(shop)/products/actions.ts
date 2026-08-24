"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getDb } from "@/db/client";
import { categories, products } from "@/db/schema";
import { parseMoney, percentToBp } from "@/lib/money";
import { NotAllowedError, requirePermission } from "@/server/authz";
import { getShopContext, isSignedIn } from "@/server/context";
import {
  ProductError,
  adjustStock,
  createProduct,
  updateProduct,
  type ProductWrite,
} from "@/server/products";

export type ProductFormState = {
  error?: string;
  /** Field-level messages, keyed by input name. */
  fieldErrors?: Record<string, string>;
};

const text = (max: number) => z.string().trim().max(max);

const ProductSchema = z.object({
  sku: text(60).min(1, "Give the item a code."),
  name: text(200).min(1, "Give the item a name."),
  barcode: text(60).optional(),
  categoryId: z.union([z.uuid(), z.literal("")]).optional(),
  unit: text(20).optional(),
  costPrice: text(30).optional(),
  sellPrice: text(30).min(1, "A selling price is required."),
  taxRate: text(10).optional(),
  trackStock: z.union([z.literal("on"), z.literal("")]).optional(),
  allowNegativeStock: z.union([z.literal("on"), z.literal("")]).optional(),
  reorderPoint: text(20).optional(),
  openingStock: text(20).optional(),
  isActive: z.union([z.literal("on"), z.literal("")]).optional(),
});

function readForm(formData: FormData) {
  return ProductSchema.safeParse({
    sku: formData.get("sku") ?? "",
    name: formData.get("name") ?? "",
    barcode: formData.get("barcode") ?? "",
    categoryId: formData.get("categoryId") ?? "",
    unit: formData.get("unit") ?? "",
    costPrice: formData.get("costPrice") ?? "",
    sellPrice: formData.get("sellPrice") ?? "",
    taxRate: formData.get("taxRate") ?? "",
    trackStock: (formData.get("trackStock") as string) ?? "",
    allowNegativeStock: (formData.get("allowNegativeStock") as string) ?? "",
    reorderPoint: formData.get("reorderPoint") ?? "",
    openingStock: formData.get("openingStock") ?? "",
    isActive: (formData.get("isActive") as string) ?? "",
  });
}

function toProductWrite(
  parsed: z.infer<typeof ProductSchema>,
  currencyCode: string,
): { input: ProductWrite; openingStock: number } | { fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};

  const sellPrice = parseMoney(parsed.sellPrice ?? "", currencyCode);
  if (sellPrice === null) fieldErrors.sellPrice = "That is not a price.";
  else if (sellPrice < 0) fieldErrors.sellPrice = "A price cannot be negative.";

  const costPrice = parsed.costPrice ? parseMoney(parsed.costPrice, currencyCode) : 0;
  if (parsed.costPrice && costPrice === null) fieldErrors.costPrice = "That is not a price.";
  else if ((costPrice ?? 0) < 0) fieldErrors.costPrice = "A cost cannot be negative.";

  let taxRateBp: number | null = null;
  if (parsed.taxRate) {
    const percent = Number(parsed.taxRate.replace(",", "."));
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      fieldErrors.taxRate = "Enter a rate between 0 and 100.";
    } else taxRateBp = percentToBp(percent);
  }

  const reorderPoint = parsed.reorderPoint ? Number(parsed.reorderPoint.replace(",", ".")) : 0;
  if (!Number.isFinite(reorderPoint) || reorderPoint < 0) {
    fieldErrors.reorderPoint = "Enter a quantity of zero or more.";
  }

  const openingStock = parsed.openingStock ? Number(parsed.openingStock.replace(",", ".")) : 0;
  if (!Number.isFinite(openingStock) || openingStock < 0) {
    fieldErrors.openingStock = "Enter a quantity of zero or more.";
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  return {
    input: {
      sku: parsed.sku,
      name: parsed.name,
      barcode: parsed.barcode ? parsed.barcode : null,
      categoryId: parsed.categoryId ? parsed.categoryId : null,
      unit: parsed.unit || "pc",
      costPrice: costPrice ?? 0,
      sellPrice: sellPrice!,
      taxRateBp,
      trackStock: parsed.trackStock === "on",
      allowNegativeStock: parsed.allowNegativeStock === "on",
      reorderPoint,
      isActive: parsed.isActive === "on",
    },
    openingStock,
  };
}

function revalidateCatalogue() {
  revalidatePath("/products");
  revalidatePath("/products/categories");
  revalidatePath("/inventory");
  revalidatePath("/inventory/movements");
  revalidatePath("/pos");
  revalidatePath("/dashboard");
  revalidatePath("/finance");
}

export async function saveProduct(
  productId: string | null,
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const context = await getShopContext();
  if (!context || !isSignedIn(context)) return { error: "Your session ended. Sign in again." };

  try {
    requirePermission(context.employee, "catalogue:write");
  } catch (error) {
    if (error instanceof NotAllowedError) {
      return { error: "Only an owner, manager or stock clerk can change the catalogue." };
    }
    throw error;
  }

  const parsed = readForm(formData);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { error: "Check the highlighted fields.", fieldErrors };
  }

  const converted = toProductWrite(parsed.data, context.business.currencyCode);
  if ("fieldErrors" in converted) {
    return { error: "Check the highlighted fields.", fieldErrors: converted.fieldErrors };
  }

  try {
    if (productId) {
      await updateProduct({
        businessId: context.business.id,
        branchId: context.branch.id,
        productId,
        input: converted.input,
      });
    } else {
      await createProduct({
        businessId: context.business.id,
        branchId: context.branch.id,
        warehouseId: context.register?.warehouseId ?? context.warehouse.id,
        employeeId: context.employee.id,
        input: converted.input,
        openingStock: converted.openingStock,
      });
    }
  } catch (error) {
    if (error instanceof ProductError) {
      const field = error.code === "duplicate_sku" ? "sku" : error.code === "duplicate_barcode" ? "barcode" : "";
      return {
        error: error.message,
        fieldErrors: field ? { [field]: error.message } : undefined,
      };
    }
    console.error("saveProduct failed", error);
    return { error: "That could not be saved. Nothing was changed." };
  }

  revalidateCatalogue();
  redirect("/products");
}

export async function setProductActive(productId: string, isActive: boolean) {
  const context = await getShopContext();
  if (!context || !isSignedIn(context)) redirect("/sign-in");
  requirePermission(context.employee, "catalogue:write");

  const db = await getDb();
  await db
    .update(products)
    .set({ isActive })
    .where(and(eq(products.id, productId), eq(products.businessId, context.business.id)));

  revalidateCatalogue();
}

export type StockFormState = { error?: string; message?: string };

export async function recountStock(
  productId: string,
  _prev: StockFormState,
  formData: FormData,
): Promise<StockFormState> {
  const context = await getShopContext();
  if (!context || !isSignedIn(context)) return { error: "Your session ended. Sign in again." };

  try {
    requirePermission(context.employee, "stock:adjust");
  } catch (error) {
    if (error instanceof NotAllowedError) return { error: "You cannot adjust stock." };
    throw error;
  }

  const counted = Number(String(formData.get("countedQuantity") ?? "").replace(",", "."));
  if (!Number.isFinite(counted) || counted < 0) {
    return { error: "Enter the counted quantity as a number of zero or more." };
  }

  const note = String(formData.get("note") ?? "").trim() || "Stock count";

  try {
    const result = await adjustStock({
      businessId: context.business.id,
      branchId: context.branch.id,
      warehouseId: context.register?.warehouseId ?? context.warehouse.id,
      employeeId: context.employee.id,
      productId,
      countedQuantity: counted,
      note,
    });

    revalidateCatalogue();

    if (result.delta === 0) return { message: "Counted figure matches — nothing to adjust." };
    return {
      message:
        result.delta > 0
          ? `Stock increased by ${result.delta}. The surplus was posted to Stock Adjustments.`
          : `Stock reduced by ${Math.abs(result.delta)}. The shortfall was written off to Stock Adjustments.`,
    };
  } catch (error) {
    console.error("recountStock failed", error);
    return { error: "The adjustment could not be saved. Nothing was changed." };
  }
}

export type CategoryFormState = { error?: string };

export async function createCategory(
  _prev: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const context = await getShopContext();
  if (!context || !isSignedIn(context)) return { error: "Your session ended. Sign in again." };

  try {
    requirePermission(context.employee, "catalogue:write");
  } catch (error) {
    if (error instanceof NotAllowedError) return { error: "You cannot change the catalogue." };
    throw error;
  }

  const name = String(formData.get("name") ?? "").trim();
  const colour = String(formData.get("colour") ?? "").trim() || null;
  if (!name) return { error: "Give the category a name." };
  if (name.length > 80) return { error: "That name is too long." };

  const db = await getDb();
  const existing = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.businessId, context.business.id), eq(categories.name, name)))
    .limit(1);

  if (existing.length > 0) return { error: `"${name}" already exists.` };

  await db.insert(categories).values({ businessId: context.business.id, name, colour });

  revalidateCatalogue();
  return {};
}

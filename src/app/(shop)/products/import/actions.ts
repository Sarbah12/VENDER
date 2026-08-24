"use server";

import { revalidatePath } from "next/cache";

import { NotAllowedError, requirePermission } from "@/server/authz";
import { getShopContext, isSignedIn } from "@/server/context";
import {
  ImportError,
  buildPreview,
  commitImport,
  describeMissing,
  type ImportPreview,
  type ImportRow,
} from "@/server/import";
import { ProductError } from "@/server/products";

const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPTED = /\.(xlsx|csv)$/i;

export type PreviewState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "ready"; preview: ImportPreview };

export async function previewImport(_prev: PreviewState, formData: FormData): Promise<PreviewState> {
  const context = await getShopContext();
  if (!context || !isSignedIn(context)) {
    return { status: "error", message: "Your session ended. Sign in again." };
  }

  try {
    requirePermission(context.employee, "catalogue:import");
  } catch (error) {
    if (error instanceof NotAllowedError) {
      return { status: "error", message: "Only an owner, manager or stock clerk can import." };
    }
    throw error;
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose a spreadsheet to import." };
  }
  if (!ACCEPTED.test(file.name)) {
    return {
      status: "error",
      message: "That file type is not supported — save it as .xlsx or .csv and try again.",
    };
  }
  if (file.size > MAX_BYTES) {
    return {
      status: "error",
      message: `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 8MB — split it and import in parts.`,
    };
  }

  try {
    const preview = await buildPreview(
      context.business.id,
      { name: file.name, buffer: await file.arrayBuffer() },
      { taxRateBp: context.business.taxRateBp },
    );

    if (preview.missingRequired.length > 0) {
      return {
        status: "error",
        message: `Could not find the ${describeMissing(preview.missingRequired)} column${
          preview.missingRequired.length === 1 ? "" : "s"
        }. Download the template to see what is expected.`,
      };
    }
    if (preview.rows.length === 0) {
      return { status: "error", message: "That file has headings but no product rows." };
    }

    return { status: "ready", preview };
  } catch (error) {
    if (error instanceof ImportError) return { status: "error", message: error.message };
    console.error("previewImport failed", error);
    return {
      status: "error",
      message: "That file could not be read. If it came from another system, try saving it as .csv.",
    };
  }
}

export type CommitState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "done"; created: number; updated: number; categoriesCreated: number };

export async function applyImport(rows: ImportRow[]): Promise<CommitState> {
  const context = await getShopContext();
  if (!context || !isSignedIn(context)) {
    return { status: "error", message: "Your session ended. Sign in again." };
  }

  try {
    requirePermission(context.employee, "catalogue:import");
  } catch (error) {
    if (error instanceof NotAllowedError) {
      return { status: "error", message: "Only an owner, manager or stock clerk can import." };
    }
    throw error;
  }

  try {
    const result = await commitImport({
      businessId: context.business.id,
      branchId: context.branch.id,
      warehouseId: context.register?.warehouseId ?? context.warehouse.id,
      employeeId: context.employee.id,
      rows,
    });

    for (const path of [
      "/products",
      "/products/categories",
      "/inventory",
      "/inventory/movements",
      "/pos",
      "/dashboard",
      "/finance",
    ]) {
      revalidatePath(path);
    }

    return { status: "done", ...result };
  } catch (error) {
    // The whole import runs in one transaction, so a failure here has written
    // nothing — say so plainly rather than leaving the user wondering.
    if (error instanceof ProductError) {
      return { status: "error", message: `${error.message} Nothing was imported.` };
    }
    if (error instanceof ImportError) {
      return { status: "error", message: `${error.message} Nothing was imported.` };
    }
    console.error("applyImport failed", error);
    return { status: "error", message: "The import failed. Nothing was imported." };
  }
}

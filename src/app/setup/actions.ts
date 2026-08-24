"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { percentToBp } from "@/lib/money";
import { createBusiness, needsSetup } from "@/server/onboarding";
import { startSession } from "@/server/session";

export type SetupState = { error?: string; fieldErrors?: Record<string, string> };

const SetupSchema = z.object({
  businessName: z.string().trim().min(1, "Give the business a name.").max(120),
  legalName: z.string().trim().max(160).optional(),
  countryCode: z.string().trim().length(2, "Pick a country."),
  currencyCode: z.string().trim().length(3, "Pick a currency."),
  taxNumber: z.string().trim().max(60).optional(),
  taxRate: z.string().trim().max(10).optional(),
  pricesIncludeTax: z.union([z.literal("on"), z.literal("")]).optional(),
  branchName: z.string().trim().min(1, "Name this shop or branch.").max(120),
  branchAddress: z.string().trim().max(200).optional(),
  branchPhone: z.string().trim().max(40).optional(),
  ownerName: z.string().trim().min(1, "Who owns this?").max(120),
  ownerPin: z.string().regex(/^\d{4}$/, "The PIN must be four digits."),
  confirmPin: z.string().trim(),
});

export async function setUpBusiness(_prev: SetupState, formData: FormData): Promise<SetupState> {
  // Guard the whole action, not just the page: a stale form left open must not
  // be able to create a second business over the top of a live one.
  if (!(await needsSetup())) {
    return { error: "This installation is already set up." };
  }

  const parsed = SetupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { error: "Check the highlighted fields.", fieldErrors };
  }

  const data = parsed.data;

  if (data.ownerPin !== data.confirmPin) {
    return { error: "The two PINs do not match.", fieldErrors: { confirmPin: "These do not match." } };
  }

  let taxRateBp = 0;
  if (data.taxRate) {
    const percent = Number(data.taxRate.replace(",", "."));
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return { error: "Check the highlighted fields.", fieldErrors: { taxRate: "Enter 0 to 100." } };
    }
    taxRateBp = percentToBp(percent);
  }

  let created;
  try {
    created = await createBusiness({
      businessName: data.businessName,
      legalName: data.legalName || null,
      countryCode: data.countryCode.toUpperCase(),
      currencyCode: data.currencyCode.toUpperCase(),
      taxNumber: data.taxNumber || null,
      taxRateBp,
      pricesIncludeTax: data.pricesIncludeTax === "on",
      branchName: data.branchName,
      branchAddress: data.branchAddress || null,
      branchPhone: data.branchPhone || null,
      ownerName: data.ownerName,
      ownerPin: data.ownerPin,
    });
  } catch (error) {
    console.error("setUpBusiness failed", error);
    return { error: "The business could not be created. Nothing was saved." };
  }

  // Sign the owner straight in — making them re-enter the PIN they just chose
  // would be a pointless gate.
  await startSession(created.employeeId, created.registerId);
  redirect("/products/import?welcome=1");
}

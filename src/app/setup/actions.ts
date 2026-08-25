"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { percentToBp } from "@/lib/money";
import { createBusiness } from "@/server/onboarding";
import { readSession, startSession } from "@/server/session";
import { endSignUpSession, readSignUpSession } from "@/server/signup-session";

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
  ownerPin: z.string().regex(/^\d{4}$/, "The till PIN must be four digits."),
  confirmPin: z.string().trim(),
});

/**
 * Creates a business for whoever is signed in.
 *
 * The owner comes from the session — the signup cookie for someone who has just
 * registered, or a full session for an existing user adding a second business.
 * It is never taken from the form, which would let anyone create a business
 * owned by someone else.
 */
export async function setUpBusiness(_prev: SetupState, formData: FormData): Promise<SetupState> {
  const session = await readSession();
  const pendingUserId = await readSignUpSession();
  const userId = session?.userId ?? pendingUserId;

  if (!userId) {
    return { error: "Your session ended. Sign in again to continue." };
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

  const db = await getDb();
  const [owner] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!owner) return { error: "Your session ended. Sign in again to continue." };

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
      ownerName: owner.name,
      ownerEmail: owner.email,
      ownerPin: data.ownerPin,
      userId,
    });
  } catch (error) {
    console.error("setUpBusiness failed", error);
    return { error: "The business could not be created. Nothing was saved." };
  }

  await startSession({
    userId,
    businessId: created.businessId,
    employeeId: created.employeeId,
    registerId: created.registerId,
  });
  await endSignUpSession();

  redirect("/products/import?welcome=1");
}

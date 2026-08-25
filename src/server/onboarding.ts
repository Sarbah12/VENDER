import "server-only";

import { eq } from "drizzle-orm";

import { getDb, type Database } from "@/db/client";
import { accounts, branches, businesses, employees, registers, warehouses } from "@/db/schema";
import { DEFAULT_CHART } from "@/domain/accounts";
import { addMembership } from "./accounts";
import { hashPin } from "./pin";

/**
 * Creating a real business — empty.
 *
 * No sample products, no fictional customers. The only rows written are the ones
 * the shop cannot function without: the business and its tax settings, a chart
 * of accounts for the ledger to post into, one branch with a stockroom, one till,
 * and the owner's login. Everything else comes from the owner's own catalogue.
 */
export type NewBusiness = {
  businessName: string;
  legalName: string | null;
  countryCode: string;
  currencyCode: string;
  taxNumber: string | null;
  taxRateBp: number;
  pricesIncludeTax: boolean;
  branchName: string;
  branchAddress: string | null;
  branchPhone: string | null;
  ownerName: string;
  ownerEmail: string;
  ownerPin: string;
  /** The login that will own this business. Created beforehand. */
  userId: string;
};

export type OnboardingResult = { businessId: string; employeeId: string; registerId: string };

export async function createBusiness(input: NewBusiness): Promise<OnboardingResult> {
  const db = await getDb();
  const pinHash = await hashPin(input.ownerPin);

  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Database;

    const [business] = await tx
      .insert(businesses)
      .values({
        name: input.businessName,
        legalName: input.legalName,
        currencyCode: input.currencyCode,
        countryCode: input.countryCode,
        taxRateBp: input.taxRateBp,
        pricesIncludeTax: input.pricesIncludeTax,
        taxNumber: input.taxNumber,
      })
      .returning({ id: businesses.id });

    // Without a chart of accounts the first sale cannot post, so it is created
    // with the business rather than left as a setup step someone might skip.
    await tx.insert(accounts).values(
      DEFAULT_CHART.map((account) => ({
        businessId: business.id,
        code: account.code,
        name: account.name,
        type: account.type,
        systemKey: account.systemKey,
      })),
    );

    const [branch] = await tx
      .insert(branches)
      .values({
        businessId: business.id,
        name: input.branchName,
        code: branchCode(input.branchName),
        address: input.branchAddress,
        phone: input.branchPhone,
      })
      .returning({ id: branches.id });

    const [warehouse] = await tx
      .insert(warehouses)
      .values({
        businessId: business.id,
        branchId: branch.id,
        name: `${input.branchName} stock`,
        code: `${branchCode(input.branchName)}-MAIN`,
        isDefault: true,
      })
      .returning({ id: warehouses.id });

    const [till] = await tx
      .insert(registers)
      .values({
        businessId: business.id,
        branchId: branch.id,
        warehouseId: warehouse.id,
        name: "Till 1",
        receiptPrefix: "T1",
      })
      .returning({ id: registers.id });

    // The membership is what grants this account access to this business, and
    // the staff record is what a sale gets attributed to. Both, or neither.
    const employeeId = await addMembership(tx, {
      userId: input.userId,
      businessId: business.id,
      branchId: branch.id,
      role: "owner",
      name: input.ownerName,
      email: input.ownerEmail,
    });

    await tx.update(employees).set({ pinHash }).where(eq(employees.id, employeeId));

    return { businessId: business.id, employeeId, registerId: till.id };
  });
}

/** "Osu Main Shop" -> "OSUMAI". Short, stable, and used in receipt numbers. */
function branchCode(name: string): string {
  const letters = name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
  return letters || "MAIN";
}

/**
 * There is deliberately no "does this installation need setting up" check any
 * more. That question only made sense when one deployment meant one shop; now
 * any number of businesses live here, and whether a *user* has one is answered
 * by their memberships.
 */

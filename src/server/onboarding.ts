import "server-only";

import { getDb, type Database } from "@/db/client";
import { accounts, branches, businesses, employees, registers, warehouses } from "@/db/schema";
import { DEFAULT_CHART } from "@/domain/accounts";
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
  ownerPin: string;
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

    const [owner] = await tx
      .insert(employees)
      .values({
        businessId: business.id,
        branchId: branch.id,
        name: input.ownerName,
        role: "owner",
        pinHash,
      })
      .returning({ id: employees.id });

    return { businessId: business.id, employeeId: owner.id, registerId: till.id };
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

/** True when this database has no business yet, i.e. the app needs setting up. */
export async function needsSetup(): Promise<boolean> {
  const db = await getDb();
  const [existing] = await db.select({ id: businesses.id }).from(businesses).limit(1);
  return !existing;
}

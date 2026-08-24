import "server-only";

import { eq } from "drizzle-orm";

import type { Database } from "@/db/client";
import { accounts, journalEntries, journalLines } from "@/db/schema";
import type { SystemAccountKey } from "@/domain/accounts";

export class LedgerError extends Error {
  constructor(
    readonly code: "unbalanced" | "missing_account",
    message: string,
  ) {
    super(message);
    this.name = "LedgerError";
  }
}

export type JournalDraftLine = {
  /** Referenced by system key so a renamed or renumbered account still posts. */
  key: SystemAccountKey;
  debit: number;
  credit: number;
  memo: string;
};

export async function systemAccountIds(
  tx: Database,
  businessId: string,
): Promise<Map<SystemAccountKey, string>> {
  const rows = await tx
    .select({ id: accounts.id, systemKey: accounts.systemKey })
    .from(accounts)
    .where(eq(accounts.businessId, businessId));

  return new Map(rows.filter((r) => r.systemKey).map((r) => [r.systemKey as SystemAccountKey, r.id]));
}

/**
 * The only way anything reaches the ledger.
 *
 * Refusing to write an unbalanced entry means the books cannot silently drift:
 * a rounding bug surfaces as a failed operation, not as a wrong balance sheet
 * discovered months later. Every caller runs inside the same transaction as the
 * thing being recorded, so the entry and its cause land together or not at all.
 */
export async function postJournal(
  tx: Database,
  args: {
    businessId: string;
    branchId?: string | null;
    entryDate?: Date;
    memo: string;
    refType?: string | null;
    refId?: string | null;
    lines: JournalDraftLine[];
  },
): Promise<string> {
  const lines = args.lines.filter((line) => line.debit !== 0 || line.credit !== 0);
  if (lines.length === 0) {
    throw new LedgerError("unbalanced", `Journal "${args.memo}" has nothing to post.`);
  }

  const totalDebit = lines.reduce((a, l) => a + l.debit, 0);
  const totalCredit = lines.reduce((a, l) => a + l.credit, 0);
  if (totalDebit !== totalCredit) {
    throw new LedgerError(
      "unbalanced",
      `Journal "${args.memo}" is out by ${totalDebit - totalCredit}.`,
    );
  }

  const accountIds = await systemAccountIds(tx, args.businessId);
  const resolved = lines.map((line) => {
    const accountId = accountIds.get(line.key);
    if (!accountId) {
      throw new LedgerError("missing_account", `Chart of accounts is missing "${line.key}".`);
    }
    return { accountId, debit: line.debit, credit: line.credit, memo: line.memo };
  });

  const [entry] = await tx
    .insert(journalEntries)
    .values({
      businessId: args.businessId,
      branchId: args.branchId ?? null,
      entryDate: args.entryDate ?? new Date(),
      memo: args.memo,
      refType: args.refType ?? null,
      refId: args.refId ?? null,
    })
    .returning({ id: journalEntries.id });

  await tx.insert(journalLines).values(resolved.map((line) => ({ entryId: entry.id, ...line })));

  return entry.id;
}

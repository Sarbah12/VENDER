import Link from "next/link";
import { redirect } from "next/navigation";

import { formatDateTime } from "@/lib/datetime";
import { formatMoney } from "@/lib/money";
import { getShopContext } from "@/server/context";
import { getJournal } from "@/server/reports";

export const metadata = { title: "Journal" };
export const dynamic = "force-dynamic";

export default async function JournalPage() {
  const context = await getShopContext();
  if (!context) redirect("/setup");

  const currency = context.business.currencyCode;
  const entries = await getJournal(context.business.id);

  return (
    <div className="space-y-4">
      <p className="text-[0.8125rem] leading-relaxed text-muted">
        Every entry here was written by the same transaction that recorded a sale or counted in
        stock. Nothing posts to the ledger on its own, and an entry that does not balance is
        rejected before the sale is allowed to complete.
      </p>

      {entries.length === 0 ? (
        <div className="card px-5 py-14 text-center text-sm text-muted">
          Nothing posted yet.{" "}
          <Link href="/pos" className="font-semibold text-brand hover:underline">
            Make a sale
          </Link>{" "}
          and it will appear here.
        </div>
      ) : (
        entries.map((entry) => {
          const debit = entry.lines.reduce((a, l) => a + l.debit, 0);
          const credit = entry.lines.reduce((a, l) => a + l.credit, 0);

          return (
            <article key={entry.id} className="card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
                <div>
                  <h2 className="text-[0.875rem] font-bold tracking-tight">
                    {entry.memo ?? "Journal entry"}
                  </h2>
                  <p className="tnum text-[0.6875rem] text-muted">
                    {formatDateTime(entry.entryDate)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {entry.refType === "sale" && entry.refId && (
                    <Link
                      href={`/sales/${entry.refId}`}
                      className="text-[0.75rem] font-semibold text-brand hover:underline"
                    >
                      View sale
                    </Link>
                  )}
                  <span
                    className={`chip ${
                      debit === credit ? "bg-positive-soft text-positive" : "bg-danger-soft text-danger"
                    }`}
                  >
                    {formatMoney(debit, currency)}
                  </span>
                </div>
              </div>

              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {entry.lines.map((line, index) => (
                      <tr key={index}>
                        <td className="tnum w-16 text-muted">{line.code}</td>
                        <td>
                          <span className="font-semibold">{line.account}</span>
                          {line.memo && (
                            <span className="block text-[0.6875rem] text-muted">{line.memo}</span>
                          )}
                        </td>
                        <td className="num w-32">
                          {line.debit ? formatMoney(line.debit, currency) : ""}
                        </td>
                        <td className="num w-32 text-muted">
                          {line.credit ? formatMoney(line.credit, currency) : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          );
        })
      )}
    </div>
  );
}

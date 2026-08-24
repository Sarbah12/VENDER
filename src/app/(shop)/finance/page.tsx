import { redirect } from "next/navigation";

import { formatMoney } from "@/lib/money";
import { getShopContext } from "@/server/context";
import { getTrialBalance } from "@/server/reports";

export const metadata = { title: "Finance" };
export const dynamic = "force-dynamic";

const TYPE_LABEL = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  income: "Income",
  expense: "Expenses",
} as const;

const ORDER = ["asset", "liability", "equity", "income", "expense"] as const;

export default async function FinancePage() {
  const context = await getShopContext();
  if (!context) redirect("/setup");

  const currency = context.business.currencyCode;
  const rows = await getTrialBalance(context.business.id);

  const debitTotal = rows.reduce((a, r) => a + r.debit, 0);
  const creditTotal = rows.reduce((a, r) => a + r.credit, 0);
  const balanced = debitTotal === creditTotal;

  const income = rows.filter((r) => r.type === "income").reduce((a, r) => a + r.balance, 0);
  const expenses = rows.filter((r) => r.type === "expense").reduce((a, r) => a + r.balance, 0);
  const assets = rows.filter((r) => r.type === "asset").reduce((a, r) => a + r.balance, 0);
  const liabilities = rows.filter((r) => r.type === "liability").reduce((a, r) => a + r.balance, 0);

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Summary label="Income" value={formatMoney(income, currency)} detail="Net of discounts" />
        <Summary label="Expenses" value={formatMoney(expenses, currency)} detail="Mostly cost of goods" />
        <Summary
          label="Profit"
          value={formatMoney(income - expenses, currency)}
          detail="Income less expenses"
          accent
        />
        <Summary
          label="Assets less liabilities"
          value={formatMoney(assets - liabilities, currency)}
          detail="What the business is worth on paper"
        />
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
          <div>
            <h2 className="text-[0.9375rem] font-bold tracking-tight">Trial balance</h2>
            <p className="mt-0.5 text-[0.75rem] text-muted">
              Built entirely from transactions the till posted — nothing here was typed in by hand.
            </p>
          </div>
          <span
            className={`chip ${balanced ? "bg-positive-soft text-positive" : "bg-danger-soft text-danger"}`}
          >
            {balanced ? "Debits equal credits" : `Out by ${formatMoney(debitTotal - creditTotal, currency)}`}
          </span>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Account</th>
                <th className="num">Debit</th>
                <th className="num">Credit</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {ORDER.flatMap((type) => {
                const group = rows.filter((r) => r.type === type);
                if (group.length === 0) return [];
                return [
                  <tr key={`head-${type}`}>
                    <td colSpan={5} className="bg-surface-2 text-[0.6875rem] font-bold uppercase tracking-wide text-faint">
                      {TYPE_LABEL[type]}
                    </td>
                  </tr>,
                  ...group.map((row) => (
                    <tr key={row.code}>
                      <td className="tnum text-muted">{row.code}</td>
                      <td className="font-semibold">{row.name}</td>
                      <td className="num text-muted">
                        {row.debit ? formatMoney(row.debit, currency) : "—"}
                      </td>
                      <td className="num text-muted">
                        {row.credit ? formatMoney(row.credit, currency) : "—"}
                      </td>
                      <td className="num font-semibold">{formatMoney(row.balance, currency)}</td>
                    </tr>
                  )),
                ];
              })}
            </tbody>
            <tfoot>
              <tr className="bg-surface-2 font-bold">
                <td colSpan={2}>Total</td>
                <td className="num">{formatMoney(debitTotal, currency)}</td>
                <td className="num">{formatMoney(creditTotal, currency)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
}

function Summary({
  label,
  value,
  detail,
  accent,
}: {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div className="card p-5">
      <p className="label mb-2">{label}</p>
      <p
        className={`tnum text-[1.5rem] font-bold leading-none tracking-tight ${
          accent ? "text-brand" : ""
        }`}
      >
        {value}
      </p>
      <p className="mt-1.5 text-[0.75rem] text-muted">{detail}</p>
    </div>
  );
}

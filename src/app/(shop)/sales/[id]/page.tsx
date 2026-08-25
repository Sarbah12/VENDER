import { and, asc, eq } from "drizzle-orm";
import { ArrowLeft, Boxes, Receipt as ReceiptIcon, Wallet } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ThermalReceipt, receiptToView } from "@/components/receipt/ThermalReceipt";
import { getDb } from "@/db/client";
import { accounts, journalEntries, journalLines, products, stockMovements } from "@/db/schema";
import { PAYMENT_LABEL } from "@/domain/accounts";
import { formatDateTime } from "@/lib/datetime";
import { formatMoney, formatQty } from "@/lib/money";
import { getShopContext } from "@/server/context";
import { getReceipt } from "@/server/receipts";
import { PrintReceiptButton } from "./PrintReceiptButton";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getShopContext();
  if (!context) return { title: "Sale" };

  const receipt = await getReceipt(context.business.id, id);
  return { title: receipt ? `Receipt ${receipt.number}` : "Sale" };
}

export default async function SaleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const context = await getShopContext();
  if (!context) redirect("/setup");

  const receipt = await getReceipt(context.business.id, id);
  if (!receipt) notFound();

  const db = await getDb();
  const currency = receipt.currencyCode;

  // The two things the sale caused. Showing them beside the receipt is the whole
  // argument of the product: one transaction, three sets of books, always in step.
  const [movements, ledger] = await Promise.all([
    db
      .select({
        product: products.name,
        unit: products.unit,
        delta: stockMovements.quantityDelta,
        balanceAfter: stockMovements.balanceAfter,
        unitCost: stockMovements.unitCost,
      })
      .from(stockMovements)
      .innerJoin(products, eq(products.id, stockMovements.productId))
      .where(and(eq(stockMovements.refType, "sale"), eq(stockMovements.refId, id))),

    db
      .select({
        code: accounts.code,
        account: accounts.name,
        debit: journalLines.debit,
        credit: journalLines.credit,
        memo: journalLines.memo,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(and(eq(journalEntries.refType, "sale"), eq(journalEntries.refId, id)))
      .orderBy(asc(accounts.code)),
  ]);

  const debitTotal = ledger.reduce((a, l) => a + l.debit, 0);
  const creditTotal = ledger.reduce((a, l) => a + l.credit, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/sales"
          className="inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold text-muted hover:text-brand"
        >
          <ArrowLeft size={15} /> All sales
        </Link>
        <PrintReceiptButton />
      </div>

      {/*
        The printable artefact. Hidden on screen — the page already shows the
        sale in a fuller layout — but it is what the print stylesheet keeps.
      */}
      <div className="hidden print:block">
        <ThermalReceipt view={receiptToView(receipt, { reprint: true })} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        {/* ── The receipt ─────────────────────────────────────────────── */}
        <section className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
            <ReceiptIcon size={16} className="text-brand" />
            <h2 className="text-[0.9375rem] font-bold tracking-tight">Receipt {receipt.number}</h2>
            <span className="ml-auto text-[0.75rem] text-muted">
              {formatDateTime(receipt.soldAt)}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-line px-5 py-4 text-[0.8125rem] sm:grid-cols-4">
            <Field label="Branch" value={receipt.branch.name} />
            <Field label="Served by" value={receipt.cashier ?? "—"} />
            <Field label="Customer" value={receipt.customer ?? "Walk-in"} />
            <Field label="Status" value={receipt.status} />
          </dl>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Qty</th>
                  <th className="num">Price</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {receipt.lines.map((line, index) => (
                  <tr key={index}>
                    <td>
                      <span className="block font-semibold">{line.name}</span>
                      <span className="block text-[0.6875rem] text-muted">
                        {line.sku}
                        {line.discountAmount > 0 &&
                          ` · less ${formatMoney(line.discountAmount, currency)}`}
                      </span>
                    </td>
                    <td className="num text-muted">
                      {formatQty(line.quantity)} {line.unit}
                    </td>
                    <td className="num text-muted">{formatMoney(line.unitPrice, currency)}</td>
                    <td className="num font-semibold">{formatMoney(line.lineTotal, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <dl className="space-y-1.5 border-t border-line bg-surface-2 px-5 py-4 text-[0.8125rem]">
            <Money label="Subtotal" value={formatMoney(receipt.subtotal, currency)} />
            {receipt.discountTotal > 0 && (
              <Money label="Discount" value={`− ${formatMoney(receipt.discountTotal, currency)}`} />
            )}
            {receipt.taxTotal > 0 && <Money label="Tax" value={formatMoney(receipt.taxTotal, currency)} />}
            <div className="flex justify-between border-t border-line pt-2">
              <dt className="font-bold">Total</dt>
              <dd className="tnum text-base font-bold">{formatMoney(receipt.total, currency)}</dd>
            </div>
            {receipt.payments.map((payment, index) => (
              <Money
                key={index}
                label={PAYMENT_LABEL[payment.method] + (payment.reference ? ` · ${payment.reference}` : "")}
                value={formatMoney(payment.amount, currency)}
                muted
              />
            ))}
            {receipt.changeGiven > 0 && (
              <Money label="Change given" value={formatMoney(receipt.changeGiven, currency)} muted />
            )}
            {receipt.balanceDue > 0 && (
              <Money
                label="Left on account"
                value={formatMoney(receipt.balanceDue, currency)}
                tone="warning"
              />
            )}
          </dl>
        </section>

        <div className="space-y-5">
          {/* ── What it did to stock ──────────────────────────────────── */}
          <section className="card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
              <Boxes size={16} className="text-brand" />
              <h2 className="text-[0.9375rem] font-bold tracking-tight">Stock this sale moved</h2>
            </div>
            {movements.length === 0 ? (
              <p className="px-5 py-8 text-center text-[0.8125rem] text-muted">
                Nothing on this sale was stock-tracked.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th className="num">Change</th>
                      <th className="num">On hand after</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((movement, index) => (
                      <tr key={index}>
                        <td className="font-semibold">{movement.product}</td>
                        <td className="num font-semibold text-danger">
                          {formatQty(Number(movement.delta))} {movement.unit}
                        </td>
                        <td className="num text-muted">
                          {formatQty(Number(movement.balanceAfter))} {movement.unit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── What it did to the books ──────────────────────────────── */}
          <section className="card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
              <Wallet size={16} className="text-brand" />
              <h2 className="text-[0.9375rem] font-bold tracking-tight">Ledger posting</h2>
              <span
                className={`chip ml-auto ${
                  debitTotal === creditTotal
                    ? "bg-positive-soft text-positive"
                    : "bg-danger-soft text-danger"
                }`}
              >
                {debitTotal === creditTotal ? "Balanced" : "Out of balance"}
              </span>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th className="num">Debit</th>
                    <th className="num">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((line, index) => (
                    <tr key={index}>
                      <td>
                        <span className="tnum mr-2 text-muted">{line.code}</span>
                        <span className="font-semibold">{line.account}</span>
                        {line.memo && (
                          <span className="block text-[0.6875rem] text-muted">{line.memo}</span>
                        )}
                      </td>
                      <td className="num">{line.debit ? formatMoney(line.debit, currency) : "—"}</td>
                      <td className="num">{line.credit ? formatMoney(line.credit, currency) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-surface-2 font-bold">
                    <td>Total</td>
                    <td className="num">{formatMoney(debitTotal, currency)}</td>
                    <td className="num">{formatMoney(creditTotal, currency)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.6875rem] font-semibold uppercase tracking-wide text-faint">{label}</dt>
      <dd className="mt-0.5 font-semibold capitalize">{value}</dd>
    </div>
  );
}

function Money({
  label,
  value,
  muted,
  tone,
}: {
  label: string;
  value: string;
  muted?: boolean;
  tone?: "warning";
}) {
  return (
    <div className="flex justify-between">
      <dt className={muted ? "text-muted" : ""}>{label}</dt>
      <dd className={`tnum font-semibold ${tone === "warning" ? "text-warning" : ""}`}>{value}</dd>
    </div>
  );
}

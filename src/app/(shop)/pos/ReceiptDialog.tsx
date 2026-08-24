"use client";

import { CheckCircle2, CloudOff, Printer } from "lucide-react";
import { useEffect, useRef } from "react";

import { formatDateTime } from "@/lib/datetime";
import { formatMoney, formatQty } from "@/lib/money";
import { PAYMENT_LABEL } from "@/domain/accounts";
import type { Receipt } from "@/server/receipts";
import type { Tender } from "./types";

type PrintLine = {
  name: string;
  unit: string;
  quantity: number;
  lineTotal: number;
  /** null for a queued sale, where the server has not priced it back yet. */
  unitPrice: number | null;
  discountAmount: number;
};

export type OfflineReceipt = {
  lines: Array<{ name: string; unit: string; quantity: number; lineTotal: number }>;
  total: number;
  tenders: Tender[];
  queuedAt: string;
};

export function ReceiptDialog({
  receipt,
  offline,
  currencyCode,
  shopName,
  onClose,
}: {
  receipt: Receipt | null;
  offline: OfflineReceipt | null;
  currencyCode: string;
  shopName: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      // Enter starts the next customer — the most common thing to do next.
      if (event.key === "Enter" || event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const change = receipt?.changeGiven ?? 0;
  const balanceDue = receipt?.balanceDue ?? 0;

  // One shape for the printed body, whether it came back from the server or is
  // still sitting in the offline queue.
  const printLines: PrintLine[] = receipt
    ? receipt.lines.map((l) => ({
        name: l.name,
        unit: l.unit,
        quantity: l.quantity,
        lineTotal: l.lineTotal,
        unitPrice: l.unitPrice,
        discountAmount: l.discountAmount,
      }))
    : offline!.lines.map((l) => ({
        name: l.name,
        unit: l.unit,
        quantity: l.quantity,
        lineTotal: l.lineTotal,
        unitPrice: null,
        discountAmount: 0,
      }));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sale complete"
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4 backdrop-blur-[2px] print:static print:bg-transparent print:p-0"
    >
      <div className="card animate-rise flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden shadow-lg print:max-h-none print:border-0 print:shadow-none">
        <div
          className={`flex shrink-0 items-center gap-3 px-5 py-4 print:hidden ${
            offline ? "bg-warning-soft" : "bg-positive-soft"
          }`}
        >
          {offline ? (
            <CloudOff size={22} className="shrink-0 text-warning" />
          ) : (
            <CheckCircle2 size={22} className="shrink-0 text-positive" />
          )}
          <div className="min-w-0">
            <p className={`text-sm font-bold ${offline ? "text-warning" : "text-positive"}`}>
              {offline ? "Saved on this till" : "Sale complete"}
            </p>
            <p className="text-xs text-muted">
              {offline
                ? "No connection — it will sync automatically and keep this time."
                : `Receipt ${receipt?.number}`}
            </p>
          </div>
          {change > 0 && (
            <div className="ml-auto text-right">
              <span className="block text-[0.625rem] font-semibold uppercase tracking-wide text-muted">
                Change
              </span>
              <span className="tnum block text-lg font-bold text-positive">
                {formatMoney(change, currencyCode)}
              </span>
            </div>
          )}
        </div>

        {/* The printable artefact. */}
        <div className="receipt scroll-slim min-h-0 flex-1 overflow-y-auto px-6 py-5 font-mono text-[0.75rem] leading-relaxed">
          <div className="text-center">
            <p className="text-sm font-bold">{receipt?.business.name ?? shopName}</p>
            {receipt && (
              <>
                <p className="text-muted">{receipt.branch.name}</p>
                {receipt.branch.address && <p className="text-muted">{receipt.branch.address}</p>}
                {receipt.branch.phone && <p className="text-muted">{receipt.branch.phone}</p>}
                {receipt.business.taxNumber && (
                  <p className="text-muted">TIN {receipt.business.taxNumber}</p>
                )}
              </>
            )}
          </div>

          <Divider />

          {receipt ? (
            <div className="flex justify-between text-muted">
              <span>{receipt.number}</span>
              <span>{formatDateTime(receipt.soldAt)}</span>
            </div>
          ) : (
            <div className="flex justify-between text-muted">
              <span>Queued</span>
              <span>{formatDateTime(offline!.queuedAt)}</span>
            </div>
          )}
          {receipt?.cashier && <div className="text-muted">Served by {receipt.cashier}</div>}
          {receipt?.customer && <div className="text-muted">Customer: {receipt.customer}</div>}

          <Divider />

          <ul>
            {printLines.map((line, index) => (
              <li key={index} className="mb-1.5">
                <div className="flex justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate">{line.name}</span>
                  <span className="tnum shrink-0">
                    {formatMoney(line.lineTotal, currencyCode)}
                  </span>
                </div>
                <div className="tnum text-muted">
                  {formatQty(line.quantity)} {line.unit}
                  {line.unitPrice !== null && ` × ${formatMoney(line.unitPrice, currencyCode)}`}
                  {line.discountAmount > 0 && (
                    <span> · less {formatMoney(line.discountAmount, currencyCode)}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <Divider />

          {receipt ? (
            <dl className="space-y-0.5">
              <Line label="Subtotal" value={formatMoney(receipt.subtotal, currencyCode)} />
              {receipt.discountTotal > 0 && (
                <Line label="Discount" value={`− ${formatMoney(receipt.discountTotal, currencyCode)}`} />
              )}
              {receipt.taxTotal > 0 && (
                <Line label="Tax" value={formatMoney(receipt.taxTotal, currencyCode)} />
              )}
              <Line label="TOTAL" value={formatMoney(receipt.total, currencyCode)} strong />
              <div className="pt-1.5" />
              {receipt.payments.map((payment, index) => (
                <Line
                  key={index}
                  label={PAYMENT_LABEL[payment.method]}
                  value={formatMoney(payment.amount, currencyCode)}
                />
              ))}
              {receipt.changeGiven > 0 && (
                <Line label="Change" value={formatMoney(receipt.changeGiven, currencyCode)} />
              )}
              {balanceDue > 0 && (
                <Line label="On account" value={formatMoney(balanceDue, currencyCode)} strong />
              )}
            </dl>
          ) : (
            <dl className="space-y-0.5">
              <Line label="TOTAL" value={formatMoney(offline!.total, currencyCode)} strong />
              {offline!.tenders.map((tender) => (
                <Line
                  key={tender.key}
                  label={PAYMENT_LABEL[tender.method]}
                  value={formatMoney(tender.amount, currencyCode)}
                />
              ))}
            </dl>
          )}

          <Divider />
          <p className="text-center text-muted">Thank you — please come again</p>
        </div>

        <div className="flex shrink-0 gap-2 border-t border-line p-4 print:hidden">
          <button type="button" onClick={() => window.print()} className="btn btn-secondary px-4">
            <Printer size={16} />
            Print
          </button>
          <button ref={closeRef} type="button" onClick={onClose} className="btn btn-primary flex-1 py-3">
            New sale
            <kbd className="rounded bg-white/20 px-1.5 py-0.5 text-[0.625rem] font-semibold">↵</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

function Divider() {
  return <div aria-hidden className="my-2.5 border-t border-dashed border-line-strong" />;
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "text-[0.8125rem] font-bold" : ""}`}>
      <dt>{label}</dt>
      <dd className="tnum">{value}</dd>
    </div>
  );
}

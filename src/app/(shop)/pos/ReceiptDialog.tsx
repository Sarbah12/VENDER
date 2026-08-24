"use client";

import { CheckCircle2, CloudOff, Printer } from "lucide-react";
import { useEffect, useRef } from "react";

import {
  ThermalReceipt,
  receiptToView,
  type ReceiptView,
} from "@/components/receipt/ThermalReceipt";
import { formatMoney } from "@/lib/money";
import type { Receipt } from "@/server/receipts";
import type { Tender } from "./types";

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
  autoPrint,
  onToggleAutoPrint,
  onClose,
}: {
  receipt: Receipt | null;
  offline: OfflineReceipt | null;
  currencyCode: string;
  shopName: string;
  autoPrint: boolean;
  onToggleAutoPrint: (value: boolean) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const printedFor = useRef<string | null>(null);

  const view: ReceiptView = receipt
    ? receiptToView(receipt)
    : {
        heading: shopName,
        number: null,
        soldAt: offline!.queuedAt,
        currencyCode,
        lines: offline!.lines.map((line) => ({
          name: line.name,
          unit: line.unit,
          quantity: line.quantity,
          lineTotal: line.lineTotal,
          unitPrice: null,
          discountAmount: 0,
        })),
        // A queued sale has not been re-priced by the server, so the till only
        // claims the total it collected — not a tax breakdown it cannot vouch for.
        subtotal: null,
        discountTotal: 0,
        taxTotal: 0,
        total: offline!.total,
        payments: offline!.tenders.map((t) => ({
          method: t.method,
          amount: t.amount,
          reference: t.reference,
        })),
        changeGiven: 0,
        balanceDue: 0,
      };

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      // Enter starts the next customer — the most common thing to do next.
      if (event.key === "Enter" || event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Most counters want paper without being asked. Guarded by a ref so a re-render
  // never sends the same receipt to the printer twice.
  const printKey = receipt?.id ?? offline?.queuedAt ?? null;
  useEffect(() => {
    if (!autoPrint || !printKey || printedFor.current === printKey) return;
    printedFor.current = printKey;
    const id = setTimeout(() => window.print(), 150);
    return () => clearTimeout(id);
  }, [autoPrint, printKey]);

  const change = receipt?.changeGiven ?? 0;

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

        <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <ThermalReceipt view={view} />
        </div>

        <div className="shrink-0 border-t border-line p-4 print:hidden">
          <label className="mb-3 flex cursor-pointer items-center gap-2 text-[0.75rem] text-muted">
            <input
              type="checkbox"
              checked={autoPrint}
              onChange={(event) => onToggleAutoPrint(event.target.checked)}
              className="size-3.5 accent-[var(--brand)]"
            />
            Print automatically after every sale
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => window.print()} className="btn btn-secondary px-4">
              <Printer size={16} />
              Print
            </button>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="btn btn-primary flex-1 py-3"
            >
              New sale
              <kbd className="rounded bg-white/20 px-1.5 py-0.5 text-[0.625rem] font-semibold">↵</kbd>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

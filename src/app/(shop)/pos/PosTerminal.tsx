"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { priceLine, totalsFor } from "@/domain/pricing";
import { roundQty } from "@/lib/money";
import {
  enqueue,
  flushQueue,
  pendingCount,
  pendingCountOnServer,
  readQueue,
  subscribeToQueue,
} from "@/lib/offlineQueue";
import type { Receipt } from "@/server/receipts";
import { checkout, type CheckoutInput } from "./actions";
import { CartPanel } from "./CartPanel";
import { PaymentDialog } from "./PaymentDialog";
import { ProductPanel } from "./ProductPanel";
import { ReceiptDialog, type OfflineReceipt } from "./ReceiptDialog";
import { Toast, type ToastMessage } from "./Toast";
import type { CartLine, PosCustomer, PosProduct, Tender } from "./types";

export function PosTerminal({
  products,
  customers,
  currencyCode,
  pricesIncludeTax,
  shopName,
  registerName,
  cashierName,
}: {
  products: PosProduct[];
  customers: PosCustomer[];
  currencyCode: string;
  pricesIncludeTax: boolean;
  shopName: string;
  registerName: string;
  cashierName: string;
}) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [offlineReceipt, setOfflineReceipt] = useState<OfflineReceipt | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  // The queue lives in localStorage, so it is read as an external store rather
  // than mirrored into state — that keeps the badge honest when another tab
  // drains it, and avoids a setState on mount.
  const queued = useSyncExternalStore(subscribeToQueue, pendingCount, pendingCountOnServer);

  const searchRef = useRef<HTMLInputElement>(null);

  /* ── Cart totals, priced with the same functions the server will use ──── */
  const priced = useMemo(
    () =>
      lines.map((line) =>
        priceLine(
          {
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discount: line.discount,
            taxRateBp: line.taxRateBp,
          },
          pricesIncludeTax,
        ),
      ),
    [lines, pricesIncludeTax],
  );
  const totals = useMemo(() => totalsFor(priced), [priced]);

  /* ── Cart operations ─────────────────────────────────────────────────── */
  const addProduct = useCallback(
    (product: PosProduct, quantity = 1) => {
      setLines((current) => {
        const existing = current.find(
          (l) => l.productId === product.id && l.unitPrice === product.sellPrice,
        );
        const alreadyInCart = existing?.quantity ?? 0;
        const wanted = roundQty(alreadyInCart + quantity);

        if (product.trackStock && !product.allowNegativeStock && wanted > product.stock) {
          setToast({
            kind: "warn",
            text:
              product.stock <= 0
                ? `${product.name} is out of stock.`
                : `Only ${product.stock} ${product.unit} of ${product.name} left.`,
          });
          return current;
        }

        if (existing) {
          return current.map((l) => (l.key === existing.key ? { ...l, quantity: wanted } : l));
        }

        return [
          ...current,
          {
            key: `${product.id}-${Date.now()}`,
            productId: product.id,
            name: product.name,
            unit: product.unit,
            unitPrice: product.sellPrice,
            quantity: roundQty(quantity),
            discount: 0,
            taxRateBp: product.taxRateBp,
            trackStock: product.trackStock,
            allowNegativeStock: product.allowNegativeStock,
            stock: product.stock,
          },
        ];
      });
    },
    [],
  );

  const setQuantity = useCallback((key: string, quantity: number) => {
    setLines((current) => {
      if (quantity <= 0) return current.filter((l) => l.key !== key);
      return current.map((l) => {
        if (l.key !== key) return l;
        const capped =
          l.trackStock && !l.allowNegativeStock ? Math.min(quantity, Math.max(l.stock, 0)) : quantity;
        if (capped < quantity) {
          setToast({ kind: "warn", text: `Only ${l.stock} ${l.unit} of ${l.name} in stock.` });
        }
        return { ...l, quantity: roundQty(capped) };
      });
    });
  }, []);

  const setDiscount = useCallback((key: string, discount: number) => {
    setLines((current) =>
      current.map((l) => (l.key === key ? { ...l, discount: Math.max(0, discount) } : l)),
    );
  }, []);

  const removeLine = useCallback((key: string) => {
    setLines((current) => current.filter((l) => l.key !== key));
  }, []);

  const clearCart = useCallback(() => {
    setLines([]);
    setCustomerId(null);
  }, []);

  /* ── Committing the sale ─────────────────────────────────────────────── */
  const buildInput = useCallback(
    (tenders: Tender[]): CheckoutInput => ({
      clientRef: crypto.randomUUID(),
      customerId,
      note: null,
      soldAt: new Date().toISOString(),
      lines: lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: l.discount,
      })),
      payments: tenders.map((t) => ({
        method: t.method,
        amount: t.amount,
        reference: t.reference,
      })),
    }),
    [lines, customerId],
  );

  const completeSale = useCallback(
    async (tenders: Tender[]) => {
      if (lines.length === 0 || busy) return;
      setBusy(true);

      const input = buildInput(tenders);
      const snapshot = { lines: [...lines], totals, tenders: [...tenders] };

      try {
        const result = await checkout(input);

        if (result.ok) {
          setReceipt(result.receipt);
          setPayOpen(false);
          clearCart();
        } else {
          setToast({ kind: "error", text: result.message });
        }
      } catch {
        // The action never reached the server. Park the sale and let the cashier
        // carry on — this is the whole point of the queue.
        enqueue(input);
        setOfflineReceipt({
          lines: snapshot.lines.map((l, i) => ({
            name: l.name,
            unit: l.unit,
            quantity: l.quantity,
            lineTotal: priced[i]?.lineTotal ?? 0,
          })),
          total: snapshot.totals.total,
          tenders: snapshot.tenders,
          queuedAt: new Date().toISOString(),
        });
        setPayOpen(false);
        clearCart();
      } finally {
        setBusy(false);
      }
    },
    [lines, busy, buildInput, totals, priced, clearCart],
  );

  /* ── Draining the offline queue ──────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    const drain = async () => {
      if (readQueue().length === 0) return;
      const outcome = await flushQueue(async (input) => {
        const result = await checkout(input);
        return { ok: result.ok, code: result.ok ? undefined : result.code };
      });
      if (cancelled) return;
      if (outcome.sent > 0) {
        setToast({
          kind: "success",
          text: `${outcome.sent} offline sale${outcome.sent === 1 ? "" : "s"} synced.`,
        });
      }
    };

    void drain();
    const onOnline = () => void drain();
    window.addEventListener("online", onOnline);
    const timer = setInterval(() => void drain(), 30_000);

    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      clearInterval(timer);
    };
  }, []);

  /* ── Keyboard: a till is driven by hands, not a mouse ─────────────────── */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (payOpen) setPayOpen(false);
        return;
      }
      if (event.key === "F2" && lines.length > 0 && !receipt && !offlineReceipt) {
        event.preventDefault();
        setPayOpen(true);
        return;
      }
      // Anything else typed outside a field belongs in the scan box, which is
      // where a barcode reader's keystrokes need to land.
      const target = event.target as HTMLElement | null;
      const typingElsewhere =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;
      if (!typingElsewhere && !payOpen && event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
        searchRef.current?.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [payOpen, lines.length, receipt, offlineReceipt]);

  const closeReceipt = () => {
    setReceipt(null);
    setOfflineReceipt(null);
    searchRef.current?.focus();
  };

  return (
    <div className="flex h-full min-h-0">
      <ProductPanel
        ref={searchRef}
        products={products}
        currencyCode={currencyCode}
        onPick={addProduct}
        onNotFound={(code) => setToast({ kind: "warn", text: `Nothing matches “${code}”.` })}
      />

      <CartPanel
        lines={lines}
        priced={priced}
        totals={totals}
        currencyCode={currencyCode}
        customers={customers}
        customerId={customerId}
        registerName={registerName}
        cashierName={cashierName}
        queued={queued}
        busy={busy}
        onCustomerChange={setCustomerId}
        onQuantityChange={setQuantity}
        onDiscountChange={setDiscount}
        onRemove={removeLine}
        onClear={clearCart}
        onPay={() => setPayOpen(true)}
      />

      {payOpen && (
        <PaymentDialog
          total={totals.total}
          currencyCode={currencyCode}
          busy={busy}
          hasCustomer={Boolean(customerId)}
          onClose={() => setPayOpen(false)}
          onConfirm={completeSale}
        />
      )}

      {(receipt || offlineReceipt) && (
        <ReceiptDialog
          receipt={receipt}
          offline={offlineReceipt}
          currencyCode={currencyCode}
          shopName={shopName}
          onClose={closeReceipt}
        />
      )}

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

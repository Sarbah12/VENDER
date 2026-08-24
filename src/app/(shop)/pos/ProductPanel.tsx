"use client";

import { Search, ScanLine } from "lucide-react";
import { useMemo, useState } from "react";

import { formatMoney, formatQty } from "@/lib/money";
import type { PosProduct } from "./types";

export function ProductPanel({
  products,
  currencyCode,
  onPick,
  onNotFound,
  ref,
}: {
  products: PosProduct[];
  currencyCode: string;
  onPick: (product: PosProduct) => void;
  onNotFound: (code: string) => void;
  ref?: React.Ref<HTMLInputElement>;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");

  const categories = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; colour: string | null; count: number }>();
    for (const product of products) {
      const id = product.categoryId ?? "none";
      const entry = seen.get(id);
      if (entry) entry.count += 1;
      else
        seen.set(id, {
          id,
          name: product.categoryName,
          colour: product.categoryColour,
          count: 1,
        });
    }
    return [...seen.values()];
  }, [products]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter((product) => {
      if (category !== "all" && (product.categoryId ?? "none") !== category) return false;
      if (!needle) return true;
      return (
        product.name.toLowerCase().includes(needle) ||
        product.sku.toLowerCase().includes(needle) ||
        (product.barcode?.includes(needle) ?? false)
      );
    });
  }, [products, query, category]);

  /**
   * A barcode reader is a keyboard that types fast and presses Enter. So Enter
   * means "resolve what I just typed": an exact barcode or SKU wins outright,
   * and a search that has narrowed to one product rings that one up.
   */
  const submitCode = () => {
    const code = query.trim();
    if (!code) return;

    const exact =
      products.find((p) => p.barcode === code) ??
      products.find((p) => p.sku.toLowerCase() === code.toLowerCase());

    if (exact) {
      onPick(exact);
      setQuery("");
      return;
    }
    if (visible.length === 1) {
      onPick(visible[0]);
      setQuery("");
      return;
    }
    if (visible.length === 0) onNotFound(code);
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-canvas" aria-label="Catalogue">
      <div className="shrink-0 border-b border-line bg-surface px-4 py-3">
        <div className="relative">
          <ScanLine
            size={18}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-brand"
          />
          <input
            ref={ref}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitCode();
              }
            }}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            aria-label="Scan a barcode or search the catalogue"
            placeholder="Scan a barcode, or search by name or SKU…"
            className="input py-3 pl-11 pr-4 text-[0.9375rem]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-semibold text-muted hover:bg-surface-3"
            >
              Clear
            </button>
          )}
        </div>

        <div className="scroll-slim -mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <CategoryPill
            active={category === "all"}
            onClick={() => setCategory("all")}
            label="All"
            count={products.length}
          />
          {categories.map((c) => (
            <CategoryPill
              key={c.id}
              active={category === c.id}
              onClick={() => setCategory(c.id)}
              label={c.name}
              count={c.count}
              colour={c.colour}
            />
          ))}
        </div>
      </div>

      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto p-4">
        {visible.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Search size={28} className="text-faint" />
            <p className="text-sm font-medium">No products match that</p>
            <p className="text-xs text-muted">Try a different name, SKU or barcode.</p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(154px,1fr))] gap-2.5">
            {visible.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                currencyCode={currencyCode}
                onPick={onPick}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function CategoryPill({
  label,
  count,
  active,
  colour,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  colour?: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[0.8125rem] font-medium transition-colors ${
        active
          ? "border-brand bg-brand text-white"
          : "border-line bg-surface-2 text-muted hover:bg-surface-3 hover:text-ink"
      }`}
    >
      {colour && (
        <span
          aria-hidden
          className="size-2 rounded-full"
          style={{ background: active ? "rgba(255,255,255,0.75)" : colour }}
        />
      )}
      {label}
      <span className={`tnum text-[0.6875rem] ${active ? "text-white/70" : "text-faint"}`}>
        {count}
      </span>
    </button>
  );
}

function ProductCard({
  product,
  currencyCode,
  onPick,
}: {
  product: PosProduct;
  currencyCode: string;
  onPick: (product: PosProduct) => void;
}) {
  const outOfStock = product.trackStock && product.stock <= 0 && !product.allowNegativeStock;
  const low = product.trackStock && product.stock > 0 && product.stock <= 5;

  return (
    <button
      type="button"
      onClick={() => onPick(product)}
      disabled={outOfStock}
      className={`card group flex h-[112px] flex-col justify-between p-3 text-left transition-all ${
        outOfStock
          ? "cursor-not-allowed opacity-55"
          : "hover:-translate-y-0.5 hover:border-brand hover:shadow-md active:translate-y-0"
      }`}
    >
      <div className="flex min-w-0 items-start gap-1.5">
        <span
          aria-hidden
          className="mt-1 size-2 shrink-0 rounded-full"
          style={{ background: product.categoryColour ?? "var(--border-strong)" }}
        />
        <span className="line-clamp-2 text-[0.8125rem] font-semibold leading-[1.3]">
          {product.name}
        </span>
      </div>

      <div className="flex items-end justify-between gap-2">
        <span className="tnum text-[0.9375rem] font-bold">
          {formatMoney(product.sellPrice, currencyCode)}
        </span>
        {product.trackStock ? (
          <span
            className={`chip tnum ${
              outOfStock
                ? "bg-danger-soft text-danger"
                : low
                  ? "bg-warning-soft text-warning"
                  : "bg-surface-3 text-muted"
            }`}
          >
            {outOfStock ? "Out" : `${formatQty(product.stock)} ${product.unit}`}
          </span>
        ) : (
          <span className="chip bg-info-soft text-info">Service</span>
        )}
      </div>
    </button>
  );
}

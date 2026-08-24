import {
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  FolderTree,
  Package,
  Receipt,
  ScanLine,
  Settings,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SalesBarChart } from "@/components/charts/SalesBarChart";
import { formatMoney, formatQty } from "@/lib/money";
import { getShopContext } from "@/server/context";
import { getDashboard } from "@/server/reports";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const context = await getShopContext();
  if (!context) redirect("/setup");

  const warehouseId = context.register?.warehouseId ?? context.warehouse.id;
  const data = await getDashboard(context.business.id, warehouseId);
  const currency = context.business.currencyCode;

  const tiles = [
    { href: "/pos", label: "Open till", value: "POS", icon: ScanLine, tone: "var(--tile-1)" },
    { href: "/products", label: "Products", value: data.counts.products, icon: Package, tone: "var(--tile-2)" },
    { href: "/sales", label: "Sales", value: data.counts.salesTotal, icon: Receipt, tone: "var(--tile-3)" },
    { href: "/inventory", label: "Stock lines", value: data.counts.products, icon: Boxes, tone: "var(--tile-4)" },
    { href: "/products/categories", label: "Categories", value: data.counts.categories, icon: FolderTree, tone: "var(--tile-5)" },
    { href: "/customers", label: "Customers", value: data.counts.customers, icon: Users, tone: "var(--tile-6)" },
    { href: "/finance", label: "Finance", value: "Ledger", icon: Wallet, tone: "var(--tile-7)" },
    { href: "/settings", label: "Settings", value: data.counts.staff, icon: Settings, tone: "var(--tile-8)" },
  ];

  return (
    <div className="space-y-5">
      {/* ── Today, in four numbers ─────────────────────────────────────── */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Takings today"
          value={formatMoney(data.today.revenue, currency)}
          detail={`${data.today.transactions} sale${data.today.transactions === 1 ? "" : "s"}`}
          accent
        />
        <Stat
          label="Gross profit today"
          value={formatMoney(data.today.profit, currency)}
          detail={
            data.today.revenue > 0
              ? `${Math.round((data.today.profit / data.today.revenue) * 100)}% margin`
              : "No sales yet"
          }
        />
        <Stat
          label="Average sale"
          value={formatMoney(data.today.averageSale, currency)}
          detail="Per transaction today"
        />
        <Stat
          label="This month"
          value={formatMoney(data.month.revenue, currency)}
          detail={`${formatMoney(data.month.profit, currency)} gross profit`}
        />
      </section>

      {/* ── Quick links ────────────────────────────────────────────────── */}
      <section className="card overflow-hidden">
        <h2 className="border-b border-line px-5 py-3.5 text-[0.9375rem] font-bold tracking-tight">
          Quick links
        </h2>
        <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3 xl:grid-cols-4">
          {tiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <Link
                key={tile.href + tile.label}
                href={tile.href}
                className="group relative flex items-center justify-between gap-3 overflow-hidden rounded-[10px] px-4 py-3.5 text-white transition-transform hover:-translate-y-0.5"
                style={{ background: tile.tone }}
              >
                <span className="min-w-0">
                  <span className="tnum block text-[1.5rem] font-bold leading-none">
                    {tile.value}
                  </span>
                  <span className="mt-1 block truncate text-[0.8125rem] text-white/85">
                    {tile.label}
                  </span>
                </span>
                <Icon
                  size={38}
                  strokeWidth={1.5}
                  className="shrink-0 text-white/35 transition-transform group-hover:scale-110"
                />
              </Link>
            );
          })}
        </div>
      </section>

      {/* ── Chart and top products ─────────────────────────────────────── */}
      <section className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3.5">
            <h2 className="text-[0.9375rem] font-bold tracking-tight">Takings, last 14 days</h2>
            <TrendingUp size={16} className="text-muted" />
          </div>
          <div className="p-5">
            <SalesBarChart data={data.series} currencyCode={currency} />
          </div>
        </div>

        <div className="card overflow-hidden">
          <h2 className="border-b border-line px-5 py-3.5 text-[0.9375rem] font-bold tracking-tight">
            Top products this month
          </h2>
          {data.topProducts.length === 0 ? (
            <Empty>Nothing sold this month yet.</Empty>
          ) : (
            <ol className="divide-y divide-[var(--border)]">
              {data.topProducts.map((product, index) => (
                <li key={product.name} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="tnum grid size-6 shrink-0 place-items-center rounded-md bg-surface-3 text-[0.6875rem] font-bold text-muted">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.8125rem] font-semibold">
                      {product.name}
                    </span>
                    <span className="tnum block text-[0.6875rem] text-muted">
                      {formatQty(product.quantity)} sold
                    </span>
                  </span>
                  <span className="tnum shrink-0 text-[0.8125rem] font-bold">
                    {formatMoney(product.revenue, currency)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {/* ── Attention and activity ─────────────────────────────────────── */}
      <section className="grid gap-5 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
            <AlertTriangle size={16} className="text-warning" />
            <h2 className="text-[0.9375rem] font-bold tracking-tight">Needs reordering</h2>
          </div>
          {data.lowStock.length === 0 ? (
            <Empty>Every product is above its reorder point.</Empty>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data.lowStock.map((item) => (
                <li key={item.name} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold">
                    {item.name}
                  </span>
                  <span
                    className={`chip tnum ${
                      item.quantity <= 0 ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning"
                    }`}
                  >
                    {formatQty(item.quantity)} {item.unit} left
                  </span>
                  <span className="tnum hidden w-20 text-right text-[0.6875rem] text-muted sm:block">
                    reorder at {formatQty(item.reorderPoint)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3.5">
            <h2 className="text-[0.9375rem] font-bold tracking-tight">Recent sales</h2>
            <Link
              href="/sales"
              className="inline-flex items-center gap-1 text-[0.75rem] font-semibold text-brand hover:underline"
            >
              All sales <ArrowUpRight size={13} />
            </Link>
          </div>
          {data.recentSales.length === 0 ? (
            <Empty>No sales recorded yet — open the till to make the first one.</Empty>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data.recentSales.map((sale) => (
                <li key={sale.id}>
                  <Link
                    href={`/sales/${sale.id}`}
                    className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="tnum block text-[0.8125rem] font-semibold">{sale.number}</span>
                      <span className="block truncate text-[0.6875rem] text-muted">
                        {formatQty(sale.items)} items
                        {sale.cashier ? ` · ${sale.cashier}` : ""}
                      </span>
                    </span>
                    <span className="tnum shrink-0 text-[0.8125rem] font-bold">
                      {formatMoney(sale.total, currency)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({
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
        className={`tnum text-[1.625rem] font-bold leading-none tracking-tight ${
          accent ? "text-brand" : ""
        }`}
      >
        {value}
      </p>
      <p className="mt-1.5 text-[0.75rem] text-muted">{detail}</p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-8 text-center text-[0.8125rem] text-muted">{children}</p>;
}

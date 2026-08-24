import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { registers, warehouses } from "@/db/schema";
import { bpToPercent } from "@/lib/money";
import { brand } from "@/lib/brand";
import { getShopContext } from "@/server/context";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const context = await getShopContext();
  if (!context) redirect("/setup");

  const db = await getDb();
  const [tills, stores] = await Promise.all([
    db
      .select()
      .from(registers)
      .where(eq(registers.businessId, context.business.id))
      .orderBy(asc(registers.name)),
    db
      .select()
      .from(warehouses)
      .where(eq(warehouses.businessId, context.business.id))
      .orderBy(asc(warehouses.name)),
  ]);

  return (
    <div className="space-y-5">
      <section className="card overflow-hidden">
        <h2 className="border-b border-line px-5 py-3.5 text-[0.9375rem] font-bold tracking-tight">
          Business
        </h2>
        <dl className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Trading name" value={context.business.name} />
          <Field label="Legal name" value={context.business.legalName ?? "—"} />
          <Field label="Tax number" value={context.business.taxNumber ?? "—"} />
          <Field label="Currency" value={context.business.currencyCode} />
          <Field label="Country" value={context.business.countryCode} />
          <Field
            label="Sales tax"
            value={`${bpToPercent(context.business.taxRateBp)}% · prices ${
              context.business.pricesIncludeTax ? "include" : "exclude"
            } tax`}
          />
        </dl>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card overflow-hidden">
          <h2 className="border-b border-line px-5 py-3.5 text-[0.9375rem] font-bold tracking-tight">
            Branches and warehouses
          </h2>
          <ul className="divide-y divide-[var(--border)]">
            <li className="px-5 py-3">
              <span className="block text-[0.875rem] font-semibold">{context.branch.name}</span>
              <span className="block text-[0.75rem] text-muted">
                {context.branch.address ?? "No address"} · {context.branch.code}
              </span>
            </li>
            {stores.map((store) => (
              <li key={store.id} className="flex items-center gap-2 px-5 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.875rem] font-semibold">{store.name}</span>
                  <span className="tnum block text-[0.75rem] text-muted">{store.code}</span>
                </span>
                {store.isDefault && (
                  <span className="chip bg-brand-soft text-brand">Sells from here</span>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="card overflow-hidden">
          <h2 className="border-b border-line px-5 py-3.5 text-[0.9375rem] font-bold tracking-tight">
            Tills
          </h2>
          <ul className="divide-y divide-[var(--border)]">
            {tills.map((till) => (
              <li key={till.id} className="flex items-center gap-2 px-5 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.875rem] font-semibold">{till.name}</span>
                  <span className="tnum block text-[0.75rem] text-muted">
                    Receipts numbered {till.receiptPrefix}-000000
                  </span>
                </span>
                {context.register?.id === till.id && (
                  <span className="chip bg-positive-soft text-positive">You are here</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card p-5">
        <h2 className="text-[0.9375rem] font-bold tracking-tight">Brand</h2>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted">
          <strong className="text-ink">{brand.name}</strong> is a working codename. The idea
          document is explicit that the name has not been chosen and must clear domain, app-store
          and trademark screening first. Every user-visible mention reads from{" "}
          <code className="rounded bg-surface-3 px-1.5 py-0.5 text-[0.75rem]">src/lib/brand.ts</code>
          , and the chrome colours from the token block in{" "}
          <code className="rounded bg-surface-3 px-1.5 py-0.5 text-[0.75rem]">globals.css</code>, so
          adopting the real identity is a two-file change rather than a rewrite.
        </p>
      </section>

      <section className="card p-5">
        <h2 className="text-[0.9375rem] font-bold tracking-tight">Still to build here</h2>
        <ul className="mt-2 space-y-2">
          {[
            "Editing any of the above, with an audit trail of who changed what.",
            "Roles and permissions — who may discount, refund, or see margin.",
            "Receipt template and printer configuration per till.",
            "Adding branches, and moving stock between their warehouses.",
          ].map((item) => (
            <li key={item} className="flex gap-2.5 text-[0.8125rem] leading-relaxed">
              <span aria-hidden className="mt-[0.4375rem] size-1.5 shrink-0 rounded-full bg-brand" />
              <span className="text-muted">{item}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.6875rem] font-semibold uppercase tracking-wide text-faint">{label}</dt>
      <dd className="mt-0.5 text-[0.875rem] font-semibold">{value}</dd>
    </div>
  );
}

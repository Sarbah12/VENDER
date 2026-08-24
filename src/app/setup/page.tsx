import { redirect } from "next/navigation";

import { Wordmark } from "@/components/Brandmark";
import { brand } from "@/lib/brand";
import { getShopContext } from "@/server/context";
import { createDemoShop } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

export const metadata = { title: "Set up" };

const INCLUDED = [
  ["Catalogue", "36 products across 6 categories, with barcodes, costs and shelf prices"],
  ["Opening stock", "Counted in and posted to the ledger as inventory, not conjured from nothing"],
  ["Staff", "An owner, a manager and a cashier, each with a till PIN"],
  ["Two tills", "Separate receipt sequences, so numbers never collide"],
  ["Chart of accounts", "14 accounts wired to the posting rules"],
];

export default async function SetupPage() {
  const context = await getShopContext();
  if (context) redirect("/");

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="card w-full max-w-xl p-8 animate-rise">
        <Wordmark name={brand.name} size={32} />

        <h1 className="mt-7 text-2xl font-bold tracking-tight">Set up your first shop</h1>
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">
          This database is empty. Create a fully stocked demo business to see the whole
          chain working — sell something and watch stock, cash and the ledger all move
          from the same transaction.
        </p>

        <ul className="mt-6 space-y-3">
          {INCLUDED.map(([title, detail]) => (
            <li key={title} className="flex gap-3">
              <span
                aria-hidden
                className="mt-[0.4375rem] size-1.5 shrink-0 rounded-full bg-brand"
              />
              <span className="text-sm leading-relaxed">
                <span className="font-semibold">{title}</span>
                <span className="text-muted"> — {detail}</span>
              </span>
            </li>
          ))}
        </ul>

        <form action={createDemoShop} className="mt-8">
          <SubmitButton className="btn btn-primary w-full py-3" pendingLabel="Creating your shop…">
            Create demo shop
          </SubmitButton>
        </form>

        <p className="mt-4 text-center text-xs text-faint">
          Everything lives in a local Postgres under <code>.data/</code>. Delete that folder
          to start over.
        </p>
      </div>
    </main>
  );
}

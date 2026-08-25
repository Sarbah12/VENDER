import { Building2, Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Wordmark } from "@/components/Brandmark";
import { brand } from "@/lib/brand";
import { ROLE_LABEL } from "@/server/authz";
import { listMemberships } from "@/server/context";
import { readSession } from "@/server/session";
import { readSignUpSession } from "@/server/signup-session";
import { chooseBusiness } from "./actions";

export const metadata = { title: "Choose a business" };
export const dynamic = "force-dynamic";

export default async function ChooseBusinessPage() {
  const session = await readSession();
  const pendingUserId = await readSignUpSession();
  const userId = session?.userId ?? pendingUserId;

  if (!userId) redirect("/sign-in");

  const businesses = await listMemberships(userId);
  if (businesses.length === 0) redirect("/setup");

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-md animate-rise">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <Wordmark name={brand.name} size={34} />
          <p className="text-sm text-muted">Which business are you working in?</p>
        </div>

        <ul className="space-y-2">
          {businesses.map((business) => (
            <li key={business.businessId}>
              <form action={chooseBusiness}>
                <input type="hidden" name="businessId" value={business.businessId} />
                <button
                  type="submit"
                  className="card flex w-full items-center gap-3 p-4 text-left transition-colors hover:border-brand"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
                    <Building2 size={19} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] font-semibold">
                      {business.businessName}
                    </span>
                    <span className="block text-[0.75rem] text-muted">
                      {ROLE_LABEL[business.role] ?? business.role}
                    </span>
                  </span>
                </button>
              </form>
            </li>
          ))}
        </ul>

        <Link
          href="/setup"
          className="btn btn-secondary mt-4 w-full py-2.5 text-[0.8125rem]"
        >
          <Plus size={15} />
          Add another business
        </Link>
      </div>
    </main>
  );
}

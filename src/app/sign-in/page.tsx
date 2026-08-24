import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { Wordmark } from "@/components/Brandmark";
import { getDb } from "@/db/client";
import { employees } from "@/db/schema";
import { brand } from "@/lib/brand";
import { getShopContext } from "@/server/context";
import { SignInForm } from "./SignInForm";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const context = await getShopContext();
  if (!context) redirect("/setup");

  const db = await getDb();
  const staff = await db
    .select({
      id: employees.id,
      name: employees.name,
      role: employees.role,
    })
    .from(employees)
    .where(eq(employees.businessId, context.business.id))
    .orderBy(asc(employees.name));

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-[26rem] animate-rise">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Wordmark name={brand.name} size={34} />
          <div>
            <p className="text-sm font-semibold">{context.business.name}</p>
            <p className="text-xs text-muted">{context.branch.name}</p>
          </div>
        </div>

        <SignInForm staff={staff} registers={context.registers.map((r) => ({ id: r.id, name: r.name }))} />

        <p className="mt-5 text-center text-xs leading-relaxed text-faint">
          Demo PINs — Ama Serwaa <span className="tnum font-semibold">1234</span>, Kojo Mensah{" "}
          <span className="tnum font-semibold">2345</span>, Efua Danso{" "}
          <span className="tnum font-semibold">3456</span>
        </p>
      </div>
    </main>
  );
}

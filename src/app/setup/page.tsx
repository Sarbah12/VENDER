import { redirect } from "next/navigation";

import { Wordmark } from "@/components/Brandmark";
import { brand } from "@/lib/brand";
import { needsSetup } from "@/server/onboarding";
import { SetupForm } from "./SetupForm";

export const metadata = { title: "Set up" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (!(await needsSetup())) redirect("/");

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="animate-rise">
        <Wordmark name={brand.name} size={34} />

        <h1 className="mt-7 text-2xl font-bold tracking-tight">Set up your business</h1>
        <p className="mt-2 max-w-xl text-[0.9375rem] leading-relaxed text-muted">
          Four short sections and you are trading. Nothing is invented for you — no sample
          products, no fake customers. Once this is done you can bring your own catalogue in from a
          spreadsheet, or add items one at a time.
        </p>

        <div className="mt-7">
          <SetupForm />
        </div>
      </div>
    </main>
  );
}

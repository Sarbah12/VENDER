import Link from "next/link";
import { redirect } from "next/navigation";

import { Wordmark } from "@/components/Brandmark";
import { brand } from "@/lib/brand";
import { getShopContext } from "@/server/context";
import { SignUpForm } from "./SignUpForm";

export const metadata = { title: "Create an account" };
export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  if (await getShopContext()) redirect("/pos");

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm animate-rise">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <Wordmark name={brand.name} size={34} />
          <p className="text-sm text-muted">
            Create your account, then set up your shop. Takes a couple of minutes.
          </p>
        </div>

        <SignUpForm />

        <p className="mt-5 text-center text-[0.8125rem] text-muted">
          Already have an account?{" "}
          <Link href="/sign-in" className="font-semibold text-brand hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";

import { Wordmark } from "@/components/Brandmark";
import { brand } from "@/lib/brand";
import { getShopContext } from "@/server/context";
import { SignInForm } from "./SignInForm";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  const { reset } = await searchParams;

  // Already signed in with a business resolved — nothing to do here.
  if (await getShopContext()) redirect("/pos");

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm animate-rise">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <Wordmark name={brand.name} size={34} />
          <p className="text-sm text-muted">{brand.tagline}</p>
        </div>

        {reset && (
          <p className="mb-4 rounded-lg bg-positive-soft px-4 py-3 text-center text-[0.8125rem] font-medium text-positive">
            Your password has been changed. Sign in with it below.
          </p>
        )}

        <SignInForm />

        <p className="mt-4 text-center text-[0.8125rem]">
          <Link href="/forgot-password" className="font-semibold text-muted hover:text-brand">
            Forgotten your password?
          </Link>
        </p>

        <p className="mt-4 text-center text-[0.8125rem] text-muted">
          New here?{" "}
          <Link href="/sign-up" className="font-semibold text-brand hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}

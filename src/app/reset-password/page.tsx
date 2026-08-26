import Link from "next/link";

import { Wordmark } from "@/components/Brandmark";
import { brand } from "@/lib/brand";
import { checkResetToken } from "@/server/auth-flows";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata = { title: "Set a new password" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;

  // Checked before the form is shown, so a dead link says so immediately rather
  // than after someone has chosen and typed a new password twice.
  const valid = token ? await checkResetToken(token) : false;

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm animate-rise">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <Wordmark name={brand.name} size={34} />
        </div>

        {valid ? (
          <ResetPasswordForm token={token} />
        ) : (
          <div className="card p-6 text-center">
            <h2 className="text-base font-bold tracking-tight">That link no longer works</h2>
            <p className="mt-2 text-[0.875rem] leading-relaxed text-muted">
              Reset links last one hour and can only be used once. Ask for a new one and it will
              work straight away.
            </p>
            <Link href="/forgot-password" className="btn btn-primary mt-5 w-full py-2.5">
              Send a new link
            </Link>
          </div>
        )}

        <p className="mt-5 text-center text-[0.8125rem] text-muted">
          <Link href="/sign-in" className="font-semibold text-brand hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

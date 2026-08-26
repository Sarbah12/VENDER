import Link from "next/link";

import { Wordmark } from "@/components/Brandmark";
import { brand } from "@/lib/brand";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata = { title: "Reset your password" };
export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm animate-rise">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <Wordmark name={brand.name} size={34} />
          <p className="text-sm text-muted">
            Enter your email and we will send you a link to set a new password.
          </p>
        </div>

        <ForgotPasswordForm />

        <p className="mt-5 text-center text-[0.8125rem] text-muted">
          <Link href="/sign-in" className="font-semibold text-brand hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

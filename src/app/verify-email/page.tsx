import { CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";

import { Wordmark } from "@/components/Brandmark";
import { brand } from "@/lib/brand";
import { verifyEmail } from "@/server/auth-flows";

export const metadata = { title: "Confirm your email" };
export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  const result = token ? await verifyEmail(token) : "invalid";

  const confirmed = result === "verified" || result === "already_verified";

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm animate-rise text-center">
        <div className="mb-7 flex justify-center">
          <Wordmark name={brand.name} size={34} />
        </div>

        <div className="card p-6">
          <span
            className={`mx-auto grid size-11 place-items-center rounded-full ${
              confirmed ? "bg-positive-soft text-positive" : "bg-danger-soft text-danger"
            }`}
          >
            {confirmed ? <CheckCircle2 size={22} /> : <XCircle size={22} />}
          </span>

          <h2 className="mt-4 text-base font-bold tracking-tight">
            {result === "verified"
              ? "Email confirmed"
              : result === "already_verified"
                ? "Already confirmed"
                : "That link no longer works"}
          </h2>

          <p className="mt-2 text-[0.875rem] leading-relaxed text-muted">
            {confirmed
              ? "Thank you — that is your address confirmed."
              : "Confirmation links last 24 hours and can only be used once. You can send yourself a fresh one from Settings."}
          </p>

          <Link href="/" className="btn btn-primary mt-5 w-full py-2.5">
            Continue
          </Link>
        </div>
      </div>
    </main>
  );
}

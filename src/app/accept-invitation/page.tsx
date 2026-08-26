import Link from "next/link";

import { Wordmark } from "@/components/Brandmark";
import { brand } from "@/lib/brand";
import { ROLE_LABEL } from "@/server/authz";
import { describeInvitation } from "@/server/invitations";
import { AcceptForm } from "./AcceptForm";

export const metadata = { title: "Accept invitation" };
export const dynamic = "force-dynamic";

export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  const invitation = token ? await describeInvitation(token) : null;

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm animate-rise">
        <div className="mb-7 flex justify-center">
          <Wordmark name={brand.name} size={34} />
        </div>

        {invitation ? (
          <>
            <div className="card mb-4 p-5 text-center">
              <p className="text-[0.9375rem] leading-relaxed">
                {invitation.invitedBy ? (
                  <>
                    <span className="font-semibold">{invitation.invitedBy}</span> has invited you to
                  </>
                ) : (
                  "You have been invited to"
                )}{" "}
                <span className="font-semibold">{invitation.businessName}</span> as a{" "}
                <span className="font-semibold">
                  {(ROLE_LABEL[invitation.role] ?? invitation.role).toLowerCase()}
                </span>
                .
              </p>
              <p className="mt-2 text-[0.75rem] text-muted">{invitation.email}</p>
            </div>

            <AcceptForm
              token={token}
              hasAccount={invitation.hasAccount}
              email={invitation.email}
            />
          </>
        ) : (
          <div className="card p-6 text-center">
            <h2 className="text-base font-bold tracking-tight">That invitation is no longer open</h2>
            <p className="mt-2 text-[0.875rem] leading-relaxed text-muted">
              Invitations last seven days and can only be used once. Ask whoever invited you to send
              another.
            </p>
            <Link href="/sign-in" className="btn btn-secondary mt-5 w-full py-2.5">
              Go to sign in
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

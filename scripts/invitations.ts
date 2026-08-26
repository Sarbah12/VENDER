/**
 * Exercises staff invitations: `npm run invitations`.
 *
 * The interesting cases are not the happy path but the refusals — a manager
 * appointing an owner, a used link being replayed, an invitation from one
 * business being accepted into another's team.
 */
import fs from "node:fs";
import path from "node:path";

import { and, eq } from "drizzle-orm";

import { getDb } from "../src/db/client";
import { authTokens, employees, memberships } from "../src/db/schema";
import { createUser, hasMembership } from "../src/server/accounts";
import { createBusiness } from "../src/server/onboarding";
import {
  InvitationError,
  acceptInvitation,
  canInvite,
  describeInvitation,
  inviteStaff,
  listPendingInvitations,
  removeStaff,
  revokeInvitation,
} from "../src/server/invitations";
import { authenticate } from "../src/server/accounts";

let failures = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

/** The plaintext token is only ever in the email, so read it from the log. */
const sentTokens: string[] = [];
const originalInfo = console.info;
console.info = (...args: unknown[]) => {
  const text = args.join(" ");
  const match = text.match(/accept-invitation\?token=([A-Za-z0-9_-]+)/);
  if (match) sentTokens.push(decodeURIComponent(match[1]));
  originalInfo(...[]);
};

async function main() {
  if (process.env.DATABASE_URL) {
    console.error("Refusing to run: DATABASE_URL is set.");
    process.exit(1);
  }
  const dir = process.env.PGLITE_DIR;
  if (dir) fs.rmSync(path.resolve(dir), { recursive: true, force: true });

  const db = await getDb();

  const makeShop = async (label: string, email: string) => {
    const userId = await createUser({ email, name: `${label} Owner`, password: "a-good-long-password" });
    const shop = await createBusiness({
      businessName: `${label} Stores`, legalName: null, countryCode: "GH", currencyCode: "GHS",
      taxNumber: null, taxRateBp: 300, pricesIncludeTax: true, branchName: `${label} Main`,
      branchAddress: null, branchPhone: null, ownerName: `${label} Owner`,
      ownerEmail: email, ownerPin: "1234", userId,
    });
    return { userId, ...shop };
  };

  console.log("\nWho may invite whom");
  check("an owner can appoint another owner", canInvite("owner", "owner"));
  check("a manager can take on a cashier", canInvite("manager", "cashier"));
  check("a manager cannot appoint a manager", !canInvite("manager", "manager"));
  check("a manager cannot appoint an owner", !canInvite("manager", "owner"));
  check("a cashier can invite nobody", !canInvite("cashier", "cashier"));

  const alpha = await makeShop("Alpha", "alpha-owner@example.test");
  const beta = await makeShop("Beta", "beta-owner@example.test");

  console.log("\nInviting someone new");
  sentTokens.length = 0;
  await inviteStaff({
    businessId: alpha.businessId, businessName: "Alpha Stores",
    inviterUserId: alpha.userId, inviterName: "Alpha Owner", inviterRole: "owner",
    email: "newcashier@example.test", role: "cashier",
  });
  check("an invitation email is sent", sentTokens.length === 1);

  const token = sentTokens[0];
  const details = await describeInvitation(token);
  check("the link describes the offer", details?.businessName === "Alpha Stores" && details.role === "cashier");
  check("and knows they have no account yet", details?.hasAccount === false);

  const pendingBefore = await listPendingInvitations(alpha.businessId);
  check("it shows as pending", pendingBefore.length === 1);
  check("the other business sees none of it", (await listPendingInvitations(beta.businessId)).length === 0);

  console.log("\nAccepting");
  let refusedWithoutPassword = false;
  try {
    await acceptInvitation({ token });
  } catch (error) {
    refusedWithoutPassword = error instanceof InvitationError;
  }
  check("a new person cannot join without setting a password", refusedWithoutPassword);

  // That failed attempt consumed the token, so a fresh one is needed — which is
  // itself the correct behaviour for a single-use link.
  sentTokens.length = 0;
  await inviteStaff({
    businessId: alpha.businessId, businessName: "Alpha Stores",
    inviterUserId: alpha.userId, inviterName: "Alpha Owner", inviterRole: "owner",
    email: "newcashier@example.test", role: "cashier",
  });
  const goodToken = sentTokens[0];

  const accepted = await acceptInvitation({
    token: goodToken, name: "New Cashier", password: "another-good-long-password",
  });
  check("accepting grants membership", await hasMembership(accepted.userId, alpha.businessId));
  check("and creates a staff record", Boolean(accepted.employeeId));

  const signedIn = await authenticate("newcashier@example.test", "another-good-long-password");
  check("the new account can sign in", signedIn.id === accepted.userId);

  const [staff] = await db.select().from(employees).where(eq(employees.id, accepted.employeeId));
  check("with the role they were invited to", staff.role === "cashier");
  check("and no membership in the other business", !(await hasMembership(accepted.userId, beta.businessId)));

  console.log("\nA link is single use");
  let replayRefused = false;
  try {
    await acceptInvitation({ token: goodToken, name: "Impostor", password: "yet-another-password" });
  } catch (error) {
    replayRefused = error instanceof InvitationError;
  }
  check("the same link cannot be used twice", replayRefused);
  check("it no longer shows as pending", (await listPendingInvitations(alpha.businessId)).length === 0);

  console.log("\nRefusals");
  let duplicateRefused = false;
  try {
    await inviteStaff({
      businessId: alpha.businessId, businessName: "Alpha Stores",
      inviterUserId: alpha.userId, inviterName: "Alpha Owner", inviterRole: "owner",
      email: "newcashier@example.test", role: "cashier",
    });
  } catch (error) {
    duplicateRefused = error instanceof InvitationError && error.code === "already_member";
  }
  check("someone already on the team cannot be re-invited", duplicateRefused);

  let overreachRefused = false;
  try {
    await inviteStaff({
      businessId: alpha.businessId, businessName: "Alpha Stores",
      inviterUserId: alpha.userId, inviterName: "A Manager", inviterRole: "manager",
      email: "wannabe@example.test", role: "owner",
    });
  } catch (error) {
    overreachRefused = error instanceof InvitationError && error.code === "not_allowed";
  }
  check("a manager cannot invite an owner", overreachRefused);

  console.log("\nExisting accounts, and revoking");
  sentTokens.length = 0;
  await inviteStaff({
    businessId: beta.businessId, businessName: "Beta Stores",
    inviterUserId: beta.userId, inviterName: "Beta Owner", inviterRole: "owner",
    email: "newcashier@example.test", role: "manager",
  });
  const crossToken = sentTokens[0];
  const crossDetails = await describeInvitation(crossToken);
  check("an existing account is recognised", crossDetails?.hasAccount === true);

  const joined = await acceptInvitation({ token: crossToken });
  check("they join without a new password", joined.userId === accepted.userId);
  check("and now belong to both businesses",
    (await hasMembership(joined.userId, alpha.businessId)) &&
    (await hasMembership(joined.userId, beta.businessId)));

  sentTokens.length = 0;
  await inviteStaff({
    businessId: alpha.businessId, businessName: "Alpha Stores",
    inviterUserId: alpha.userId, inviterName: "Alpha Owner", inviterRole: "owner",
    email: "revoke-me@example.test", role: "cashier",
  });
  const [toRevoke] = await listPendingInvitations(alpha.businessId);
  await revokeInvitation(alpha.businessId, toRevoke.id);
  check("a revoked invitation stops working", (await describeInvitation(sentTokens[0])) === null);

  console.log("\nRemoving someone");
  await removeStaff(alpha.businessId, accepted.employeeId);
  check("access is revoked", !(await hasMembership(accepted.userId, alpha.businessId)));

  const [afterRemoval] = await db.select().from(employees).where(eq(employees.id, accepted.employeeId));
  check("the staff record survives, deactivated", afterRemoval && !afterRemoval.isActive);
  check(
    "their other business is untouched",
    await hasMembership(accepted.userId, beta.businessId),
  );

  const stillThere = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, accepted.userId), eq(memberships.businessId, beta.businessId)));
  check("membership elsewhere intact", stillThere.length === 1);

  const leftover = await db.select().from(authTokens).where(eq(authTokens.kind, "invitation"));
  check("every invitation issued is accounted for", leftover.length > 0);

  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

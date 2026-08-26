"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getShopContext } from "@/server/context";
import {
  InvitationError,
  canInvite,
  inviteStaff,
  removeStaff,
  revokeInvitation,
  type StaffRole,
} from "@/server/invitations";

export type InviteState = { error?: string; message?: string };

const InviteSchema = z.object({
  email: z.email("That does not look like an email address.").max(200),
  role: z.enum(["owner", "manager", "cashier", "stock_clerk"]),
});

export async function sendInvitation(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const context = await getShopContext();
  if (!context) return { error: "Your session ended. Sign in again." };

  const parsed = InviteSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the details." };
  }

  // Checked here as well as inside inviteStaff: the role arrives from a form,
  // and a select element is not a permission check.
  if (!canInvite(context.role as StaffRole, parsed.data.role)) {
    return { error: "You cannot invite someone to that role." };
  }

  try {
    const { delivered } = await inviteStaff({
      businessId: context.business.id,
      businessName: context.business.name,
      inviterUserId: context.user.id,
      inviterName: context.user.name,
      inviterRole: context.role as StaffRole,
      email: parsed.data.email,
      role: parsed.data.role,
    });

    revalidatePath("/people");

    return {
      message: delivered
        ? `Invitation sent to ${parsed.data.email}.`
        : `Invitation created for ${parsed.data.email}, but no email provider is configured — ` +
          `the link is in the server log.`,
    };
  } catch (error) {
    if (error instanceof InvitationError) return { error: error.message };
    console.error("sendInvitation failed", error);
    return { error: "The invitation could not be sent." };
  }
}

export async function cancelInvitation(formData: FormData) {
  const context = await getShopContext();
  if (!context) return;
  if (!canInvite(context.role as StaffRole, "cashier")) return;

  const id = String(formData.get("invitationId") ?? "");
  if (id) await revokeInvitation(context.business.id, id);

  revalidatePath("/people");
}

export async function deactivateStaff(formData: FormData) {
  const context = await getShopContext();
  if (!context) return;

  const employeeId = String(formData.get("employeeId") ?? "");
  if (!employeeId) return;

  // Only an owner may remove people, and never themselves — a business with no
  // owner is one nobody can administer.
  if (context.role !== "owner") return;
  if (context.employee?.id === employeeId) return;

  await removeStaff(context.business.id, employeeId);
  revalidatePath("/people");
}

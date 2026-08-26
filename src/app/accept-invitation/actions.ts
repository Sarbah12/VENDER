"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { checkPasswordStrength } from "@/server/passwords";
import { InvitationError, acceptInvitation, describeInvitation } from "@/server/invitations";
import { startSession } from "@/server/session";

export type AcceptState = { error?: string };

const Schema = z.object({
  token: z.string().min(1),
  name: z.string().trim().max(120).optional(),
  password: z.string().optional(),
  confirm: z.string().optional(),
});

export async function accept(_prev: AcceptState, formData: FormData): Promise<AcceptState> {
  const parsed = Schema.safeParse({
    token: formData.get("token"),
    name: formData.get("name") ?? undefined,
    password: formData.get("password") ?? undefined,
    confirm: formData.get("confirm") ?? undefined,
  });

  if (!parsed.success) return { error: "Check the details and try again." };

  const { token, name, password, confirm } = parsed.data;

  // Read it first so we know whether an account is being created here, and can
  // demand a password only when one is actually needed.
  const details = await describeInvitation(token);
  if (!details) {
    return { error: "That invitation has expired or has already been used." };
  }

  if (!details.hasAccount) {
    if (!name) return { error: "Enter your name." };
    if (!password) return { error: "Choose a password." };
    if (password !== confirm) return { error: "The two passwords do not match." };

    const weak = checkPasswordStrength(password, [name, details.email.split("@")[0]]);
    if (weak) return { error: weak };
  }

  let result;
  try {
    result = await acceptInvitation({ token, name, password });
  } catch (error) {
    if (error instanceof InvitationError) return { error: error.message };
    console.error("acceptInvitation failed", error);
    return { error: "The invitation could not be accepted." };
  }

  await startSession({
    userId: result.userId,
    businessId: result.businessId,
    employeeId: result.employeeId,
  });

  redirect("/pos");
}

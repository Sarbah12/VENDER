import "server-only";

import { brand } from "@/lib/brand";

/**
 * Sending email, without committing to a provider.
 *
 * With no RESEND_API_KEY the message is written to the server log, link and
 * all. That is deliberate: verification and password reset are finished
 * features that work end to end in development, and adopting a provider later
 * is one environment variable rather than a rewrite.
 *
 * It is also why nothing here throws on failure. An account must still be
 * created if the welcome email bounces, and a reset must not reveal whether an
 * address exists by failing differently.
 */
export type Email = {
  to: string;
  subject: string;
  /** Plain text. Deliverability is better and every client renders it. */
  text: string;
};

export type SendResult = { delivered: boolean; reason?: string };

function fromAddress(): string {
  return process.env.EMAIL_FROM ?? `${brand.name} <onboarding@resend.dev>`;
}

export async function sendEmail(email: Email): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    // The whole message, so a developer can follow the link out of the log.
    console.info(
      [
        "",
        "─".repeat(72),
        `EMAIL (not sent — no RESEND_API_KEY set)`,
        `To:      ${email.to}`,
        `Subject: ${email.subject}`,
        "─".repeat(72),
        email.text,
        "─".repeat(72),
        "",
      ].join("\n"),
    );
    return { delivered: false, reason: "no_provider" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [email.to],
        subject: email.subject,
        text: email.text,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error(`Email to ${email.to} rejected (${response.status})`, detail.slice(0, 300));
      return { delivered: false, reason: `provider_${response.status}` };
    }

    return { delivered: true };
  } catch (error) {
    // Never let a mail outage take down a signup or a sign-in.
    console.error("Email send failed", error);
    return { delivered: false, reason: "network" };
  }
}

/** The address the app is reachable at, for links inside emails. */
export function appUrl(path = ""): string {
  const base =
    process.env.APP_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:4310");

  return `${base.replace(/\/$/, "")}${path}`;
}

export function verificationEmail(name: string, link: string): Omit<Email, "to"> {
  return {
    subject: `Confirm your email for ${brand.name}`,
    text: [
      `Hello ${name},`,
      "",
      `Confirm your email address to finish setting up your ${brand.name} account:`,
      "",
      link,
      "",
      "The link is good for 24 hours. If you did not create an account, you can ignore this.",
    ].join("\n"),
  };
}

export function passwordResetEmail(name: string, link: string): Omit<Email, "to"> {
  return {
    subject: `Reset your ${brand.name} password`,
    text: [
      `Hello ${name},`,
      "",
      "Someone asked to reset the password on this account. If it was you, use this link:",
      "",
      link,
      "",
      "It is good for one hour and can only be used once.",
      "",
      "If it was not you, nothing has changed and you can ignore this. Your password",
      "stays as it is until the link above is used.",
    ].join("\n"),
  };
}

export function invitationEmail(
  inviterName: string,
  businessName: string,
  link: string,
): Omit<Email, "to"> {
  return {
    subject: `${inviterName} has invited you to ${businessName}`,
    text: [
      `${inviterName} has invited you to join ${businessName} on ${brand.name}.`,
      "",
      "Accept the invitation and set your password here:",
      "",
      link,
      "",
      "The link is good for 7 days.",
    ].join("\n"),
  };
}

import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * The gap between creating an account and creating a business.
 *
 * A normal session must always name a tenant — that is what every query is
 * scoped to. Rather than allow a session with a null business and make every
 * consumer defend against it, this is a separate, short-lived cookie that only
 * says "this account exists and is mid-signup". It grants access to exactly one
 * thing: the create-a-business step.
 */
const COOKIE = "vender_signup";
const MAX_AGE_SECONDS = 60 * 30;

type Payload = { userId: string; issuedAt: number };

function secret(): string {
  const configured = process.env.SESSION_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set in production.");
  }
  return "dev-only-insecure-secret";
}

const sign = (body: string) => createHmac("sha256", secret()).update(body).digest("base64url");

export async function startSignUpSession(userId: string): Promise<void> {
  const body = Buffer.from(
    JSON.stringify({ userId, issuedAt: Math.floor(Date.now() / 1000) } satisfies Payload),
  ).toString("base64url");

  const jar = await cookies();
  jar.set(COOKIE, `${body}.${sign(body)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function readSignUpSession(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;

  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Payload;
    if (typeof payload.userId !== "string") return null;
    if (Date.now() / 1000 - payload.issuedAt > MAX_AGE_SECONDS) return null;
    return payload.userId;
  } catch {
    return null;
  }
}

export async function endSignUpSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

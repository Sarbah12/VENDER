import "server-only";

import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";

// promisify picks the overload without options, which is the one we cannot use —
// the cost parameters are the whole point here.
const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options?: ScryptOptions,
) => Promise<Buffer>;

/**
 * Account passwords — a different job from till PINs, and tuned differently.
 *
 * A PIN has ten thousand possibilities and is protected mainly by being
 * unreachable from outside the shop. A password guards an account anyone on the
 * internet can attempt, so the cost parameters here are deliberately heavy:
 * N=2^16 with r=8 is roughly 64MB and ~100ms per attempt, which is unnoticeable
 * on a login and ruinous for an attacker working through a leaked table.
 *
 * The hash carries its own parameters, so raising the cost later does not
 * invalidate existing passwords — they verify at the cost they were made with,
 * and can be re-hashed on next sign-in.
 */
const PARAMS = { N: 2 ** 16, r: 8, p: 1, keyLength: 64, maxmem: 128 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password.normalize("NFKC"), salt, PARAMS.keyLength, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    maxmem: PARAMS.maxmem,
  })) as Buffer;

  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;

  const expected = Buffer.from(hashB64, "base64");

  try {
    const derived = (await scryptAsync(
      password.normalize("NFKC"),
      Buffer.from(saltB64, "base64"),
      expected.length,
      { N: Number(n), r: Number(r), p: Number(p), maxmem: PARAMS.maxmem },
    )) as Buffer;

    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    // Malformed parameters in the stored hash — treat as a failed verification
    // rather than letting it throw into the sign-in path.
    return false;
  }
}

/**
 * Minimum standards, kept few and meaningful.
 *
 * Length does far more for a password than a symbol requirement, which mostly
 * produces "Password1!" — so the rule is twelve characters and a check against
 * the handful of choices that are guessed first.
 */
const OBVIOUS = new Set([
  "password",
  "password1",
  "password123",
  "123456789012",
  "qwertyuiop",
  "letmein12345",
  "administrator",
  "iloveyou1234",
]);

export function checkPasswordStrength(password: string, context: string[] = []): string | null {
  if (password.length < 12) return "Use at least 12 characters — length matters more than symbols.";
  if (password.length > 200) return "That is longer than 200 characters.";

  const lowered = password.toLowerCase();
  if (OBVIOUS.has(lowered)) return "That is one of the first passwords anyone tries.";
  if (/^(.)\1+$/.test(password)) return "That is a single character repeated.";

  // A password containing the email or business name is the first thing guessed
  // by someone who already knows which account they are attacking.
  for (const hint of context) {
    const cleaned = hint.trim().toLowerCase();
    if (cleaned.length >= 4 && lowered.includes(cleaned)) {
      return "Do not put your name, email or business name in the password.";
    }
  }

  return null;
}

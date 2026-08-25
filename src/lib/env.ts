/**
 * Checks a connection string is actually filled in.
 *
 * The template ships with `[YOUR-PASSWORD]` and `[YOUR-REGION]` in it, and a URL
 * still carrying those parses as garbage — "Invalid URL" tells you nothing about
 * what to do. This turns the most common setup mistake into an instruction.
 */
export type UrlProblem = { ok: false; message: string } | { ok: true };

export function checkDatabaseUrl(url: string | undefined, variable: string): UrlProblem {
  if (!url || url.trim() === "") {
    return { ok: false, message: `${variable} is empty. Fill it in in .env.local.` };
  }

  const placeholder = url.match(/\[[A-Z-]+\]/);
  if (placeholder) {
    return {
      ok: false,
      message:
        `${variable} still contains the placeholder ${placeholder[0]}.\n` +
        "Replace it with the real value from Supabase → Connect → Direct → Connection string.",
    };
  }

  if (!/^postgres(ql)?:\/\//.test(url)) {
    return {
      ok: false,
      message: `${variable} does not look like a Postgres URL — it should start with postgresql://`,
    };
  }

  // A password containing a literal @ leaves two of them before the host.
  // Node's URL parser quietly takes the last one and carries on; the Postgres
  // driver splits on the first and ends up with a nonsense hostname. Neither
  // tells you what is wrong, so catch it here.
  const authority = url.slice(url.indexOf("://") + 3).split("/")[0];
  const at = authority.split("@").length - 1;
  if (at > 1) {
    return {
      ok: false,
      message:
        `${variable} has more than one "@" before the host, which usually means the password\n` +
        "contains one. Percent-encode it (@ becomes %40), or reset the database password to\n" +
        "something without @ : / ? or # in it.",
    };
  }

  try {
    const parsed = new URL(url);
    if (!parsed.password) {
      return { ok: false, message: `${variable} has no password in it.` };
    }
    // Supabase's pooled endpoints authenticate as postgres.PROJECT_REF; plain
    // "postgres" against a pooler fails with an opaque "Tenant or user not found".
    if (parsed.hostname.includes("pooler.supabase") && parsed.username === "postgres") {
      return {
        ok: false,
        message:
          `${variable} uses "postgres" as the username, but pooled Supabase connections need\n` +
          `"postgres.YOUR-PROJECT-REF". Copy the URL exactly as the dashboard shows it.`,
      };
    }
  } catch {
    return {
      ok: false,
      message:
        `${variable} could not be parsed as a URL. If your password contains @ : / or ?,\n` +
        "it has to be percent-encoded — or reset it to something without those characters.",
    };
  }

  return { ok: true };
}

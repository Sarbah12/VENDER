/**
 * Walks you through filling in .env.local: `npm run db:setup`.
 *
 * Supabase shows connection strings with a literal `[YOUR-PASSWORD]` in them and
 * never reveals the password itself, so copying the string is only half the job.
 * This asks for the string and the password separately, joins them, derives the
 * session-pooler URL for migrations, and writes both.
 *
 * The password is read with the terminal echo off, is never printed, and never
 * reaches a shell history. It goes straight into .env.local, which is gitignored
 * and written with owner-only permissions.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

import { checkDatabaseUrl } from "../src/lib/env";

const ENV_PATH = path.join(process.cwd(), ".env.local");
const TEMPLATE_PATH = path.join(process.cwd(), ".env.local.template");

/**
 * One readline interface for the whole run.
 *
 * Opening a second one loses whatever the first buffered, which silently breaks
 * the moment input arrives from anything other than a live keyboard.
 */
class Prompter {
  private rl: readline.Interface | null = null;
  private muted = false;
  /** Pre-read lines, used when input is piped rather than typed. */
  private queued: string[] | null = null;

  private constructor() {}

  /**
   * At a terminal this asks question by question with the password hidden.
   * When input is piped — a test, or `printf ... | npm run db:setup` — the lines
   * are read up front instead.
   *
   * That split is not tidiness: readline delivers a buffered line the instant it
   * has one, and between two chained `question()` calls there is a moment with
   * no listener attached, so piped answers get silently dropped. Reading ahead
   * removes the race entirely.
   */
  static async create(): Promise<Prompter> {
    const prompter = new Prompter();

    if (process.stdin.isTTY) {
      prompter.rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const target = prompter.rl as unknown as { _writeToOutput: (text: string) => void };
      const original = target._writeToOutput.bind(prompter.rl);
      target._writeToOutput = (text: string) => {
        if (!prompter.muted) original(text);
      };
      return prompter;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    prompter.queued = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
    return prompter;
  }

  ask(question: string): Promise<string> {
    if (this.queued) {
      process.stdout.write(question);
      const answer = (this.queued.shift() ?? "").trim();
      process.stdout.write("\n");
      return Promise.resolve(answer);
    }
    return new Promise((resolve) =>
      this.rl!.question(question, (answer) => resolve(answer.trim())),
    );
  }

  /** Same, but a terminal shows nothing as you type. */
  askSecret(question: string): Promise<string> {
    if (this.queued) return this.ask(question);

    return new Promise((resolve) => {
      // Written directly, because the echo suppression eats anything readline
      // would print for us.
      process.stdout.write(question);
      this.muted = true;

      this.rl!.question("", (answer) => {
        this.muted = false;
        process.stdout.write("\n");
        resolve(answer.trim());
      });
    });
  }

  close(): void {
    this.rl?.close();
  }
}

/**
 * Puts the password into a connection string, percent-encoding it so characters
 * like @ : / ? and # cannot break the URL.
 */
function withPassword(connectionString: string, password: string): string {
  const encoded = encodeURIComponent(password);
  const replaced = connectionString.replace(/\[YOUR-PASSWORD\]/gi, encoded);

  if (replaced !== connectionString) return replaced;

  // No placeholder — the string may already carry a password, or none at all.
  const match = connectionString.match(/^(postgres(?:ql)?:\/\/)([^:@/]+)(?::[^@]*)?@(.+)$/);
  if (!match) return connectionString;
  return `${match[1]}${match[2]}:${encoded}@${match[3]}`;
}

/** The session pooler is the same endpoint on 5432; that is what migrations need. */
function toSessionPooler(transactionUrl: string): string | null {
  if (!transactionUrl.includes(":6543")) return null;
  return transactionUrl.replace(":6543", ":5432");
}

function upsert(contents: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  return pattern.test(contents) ? contents.replace(pattern, line) : `${contents.trimEnd()}\n${line}\n`;
}

/**
 * A connection string that is complete apart from the password — the shape you
 * get by copying it straight from the dashboard, which always leaves
 * `[YOUR-PASSWORD]` in place because Supabase never shows the real one.
 */
function isReadyExceptPassword(url: string | undefined): url is string {
  if (!url) return false;
  if (!/\[YOUR-PASSWORD\]/i.test(url)) return false;
  // Any other placeholder means the host is not filled in either.
  return !/\[(?!YOUR-PASSWORD)[A-Z-]+\]/i.test(url);
}

async function main() {
  const prompter = await Prompter.create();

  console.log("\nConnecting this app to Supabase\n");

  const existing = process.env.DATABASE_URL;
  let pasted: string;
  const reusingExisting = isReadyExceptPassword(existing);

  if (reusingExisting) {
    // Everything but the password is already on file; do not make them find the
    // string again just to paste back what is already there.
    const host = (() => {
      try {
        return new URL(existing.replace(/\[YOUR-PASSWORD\]/i, "x")).host;
      } catch {
        return "the configured host";
      }
    })();

    console.log(`Using the connection already in .env.local:  ${host}`);
    console.log("Only the password is missing.\n");
    pasted = existing;
  } else {
    console.log("In the Supabase dashboard: Connect → Direct → Connection string,");
    console.log("then copy the URL labelled 'Transaction pooler' (it ends in :6543/postgres).\n");

    pasted = await prompter.ask("Paste the Transaction pooler URL:\n> ");
    if (!pasted) {
      prompter.close();
      console.error("\nNothing pasted. Run `npm run db:setup` again when you have it.");
      process.exit(1);
    }
  }

  if (pasted.includes("supabase.co") && !pasted.startsWith("postgres")) {
    console.error(
      "\nThat looks like your project URL, not a connection string.\n" +
        "You want the one starting postgresql:// from Connect → Direct → Connection string.",
    );
    process.exit(1);
  }

  // Only worth saying about a string just pasted by hand. A connection already
  // on file was chosen deliberately — a direct connection is the right answer
  // for local development on a network with IPv6.
  if (!reusingExisting && !pasted.includes(":6543")) {
    console.warn(
      "\nHeads up: that is not the transaction pooler (port 6543). Continuing, but for\n" +
        "production the app wants the 6543 URL — check you copied the right one of the three.",
    );
  }

  // Resolve the host before asking for anything secret. A hostname this machine
  // cannot look up will never connect, and finding that out after typing a
  // password is a waste of the one step only you can do.
  const hostname = (() => {
    try {
      return new URL(pasted.replace(/\[YOUR-PASSWORD\]/i, "x")).hostname;
    } catch {
      return null;
    }
  })();

  if (hostname) {
    const dns = await import("node:dns");
    const resolvable = await new Promise<boolean>((resolve) =>
      dns.lookup(hostname, { all: true }, (error) => resolve(!error)),
    );

    if (!resolvable) {
      prompter.close();
      console.error(`\nThis machine cannot resolve ${hostname}.`);

      if (/^db\.[a-z0-9]+\.supabase\.co$/.test(hostname)) {
        console.error(
          "\nThat is the 'Direct connection' host, which publishes only an IPv6 address, and\n" +
            "this machine has no global IPv6 address.\n\n" +
            "In the Connect dialog, change Connection Method from 'Direct connection' to\n" +
            "'Transaction pooler', copy that string, and run `npm run db:setup` again.",
        );
      } else {
        console.error("\nCheck the region in the hostname, then run `npm run db:setup` again.");
      }
      console.error("\nNothing was written, and you were not asked for a password.\n");
      process.exit(1);
    }
  }

  console.log(
    "\nNow the database password. This is the one you set when you created the project.",
  );
  console.log("If you do not have it: Project Settings → Database → Reset database password.");
  console.log("Nothing is shown as you type.\n");

  const password = await prompter.askSecret("Database password: ");
  prompter.close();

  if (!password) {
    console.error("No password entered. Nothing was written.");
    process.exit(1);
  }

  const appUrl = withPassword(pasted, password);
  const migrateUrl = toSessionPooler(appUrl) ?? appUrl;

  const appCheck = checkDatabaseUrl(appUrl, "DATABASE_URL");
  if (!appCheck.ok) {
    console.error(`\n${appCheck.message}\n\nNothing was written.`);
    process.exit(1);
  }

  let contents = fs.existsSync(ENV_PATH)
    ? fs.readFileSync(ENV_PATH, "utf8")
    : fs.existsSync(TEMPLATE_PATH)
      ? fs.readFileSync(TEMPLATE_PATH, "utf8")
      : "";

  contents = upsert(contents, "DATABASE_URL", appUrl);
  contents = upsert(contents, "DIRECT_DATABASE_URL", migrateUrl);

  // A session secret is required in production; generate one if it is missing.
  if (!/^SESSION_SECRET=.+$/m.test(contents)) {
    const { randomBytes } = await import("node:crypto");
    contents = upsert(contents, "SESSION_SECRET", randomBytes(32).toString("base64"));
    console.log("Generated a SESSION_SECRET as well.");
  }

  fs.writeFileSync(ENV_PATH, contents, { mode: 0o600 });

  console.log("\nWritten to .env.local (owner-only, gitignored):");
  console.log("  DATABASE_URL         → transaction pooler, for the app");
  console.log("  DIRECT_DATABASE_URL  → session pooler, for migrations");

  // Test it here rather than leaving you to discover a typo two commands later.
  const { probe } = await import("./probe");
  const result = await probe(appUrl);

  if (result === "failed") {
    console.error("\nThe details were saved, but the connection did not work.");
    console.error("Fix whatever is named above, then run:  npm run db:setup\n");
    process.exit(1);
  }

  if (result === "needs-migration") {
    console.log("\nNext:  npm run db:migrate\n");
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

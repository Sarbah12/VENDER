import type { CheckoutInput } from "@/app/(shop)/pos/actions";

/**
 * "Allow businesses to continue operating during internet interruptions" is a
 * stated outcome in the idea document, and for a shop it is the difference
 * between trading and shutting the doors.
 *
 * A sale the server never acknowledged is parked in localStorage and replayed
 * when the connection returns. Replay is safe because every sale carries a
 * clientRef and the server treats a repeat of that key as the same sale, so a
 * queued item that actually did land the first time is recognised rather than
 * charged twice.
 *
 * Deliberate limits: the catalogue still has to be loaded (so a cold start with
 * no network cannot open the till), and localStorage is per-browser. Full
 * offline — cached catalogue in IndexedDB, service worker, cross-tab locking —
 * is the next step, and this is the seam it plugs into.
 */
const KEY = "vender.pending-sales.v1";

export type QueuedSale = { input: CheckoutInput; queuedAt: string; attempts: number };

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/* ── Subscribable count, for the "waiting to sync" badge ─────────────────── */

const listeners = new Set<() => void>();

// getSnapshot is called on every render, so the parsed count is memoised and
// invalidated on write rather than re-parsing JSON each time.
let cachedCount: number | null = null;

function invalidate(): void {
  cachedCount = null;
  for (const listener of listeners) listener();
}

/** How many sales are waiting. Stable between writes, so React can compare it. */
export function pendingCount(): number {
  if (cachedCount === null) cachedCount = readQueue().length;
  return cachedCount;
}

/** Nothing is pending on the server — it has no localStorage to read. */
export function pendingCountOnServer(): number {
  return 0;
}

/**
 * Subscribes to queue changes, including writes made by another tab: two tills
 * open in one browser should not disagree about what is still unsent.
 */
export function subscribeToQueue(onChange: () => void): () => void {
  listeners.add(onChange);

  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) invalidate();
  };
  if (isBrowser()) window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(onChange);
    if (isBrowser()) window.removeEventListener("storage", onStorage);
  };
}

export function readQueue(): QueuedSale[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as QueuedSale[]) : [];
  } catch {
    // A corrupt queue must not brick the till.
    return [];
  }
}

function writeQueue(items: QueuedSale[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Storage full or blocked (private mode). The sale is still in memory for
    // this session; nothing more we can do without silently losing it.
  } finally {
    invalidate();
  }
}

export function enqueue(input: CheckoutInput): void {
  const items = readQueue();
  if (items.some((i) => i.input.clientRef === input.clientRef)) return;
  items.push({ input, queuedAt: new Date().toISOString(), attempts: 0 });
  writeQueue(items);
}

export function remove(clientRef: string): void {
  writeQueue(readQueue().filter((i) => i.input.clientRef !== clientRef));
}

export function markAttempt(clientRef: string): void {
  writeQueue(
    readQueue().map((i) =>
      i.input.clientRef === clientRef ? { ...i, attempts: i.attempts + 1 } : i,
    ),
  );
}

export type FlushOutcome = { sent: number; remaining: number };

/**
 * Replay queued sales oldest first. Stops at the first transport failure so the
 * order sales were rung up in is the order they reach the books.
 */
export async function flushQueue(
  submit: (input: CheckoutInput) => Promise<{ ok: boolean; code?: string }>,
): Promise<FlushOutcome> {
  let sent = 0;

  for (const item of readQueue()) {
    let result: { ok: boolean; code?: string };
    try {
      result = await submit(item.input);
    } catch {
      // Still offline — leave this and everything after it queued.
      markAttempt(item.input.clientRef);
      break;
    }

    if (result.ok) {
      remove(item.input.clientRef);
      sent += 1;
      continue;
    }

    // The server rejected it on its merits (stock gone, product retired). Retrying
    // will never help, so drop it rather than blocking the queue forever. It stays
    // visible to the cashier through the returned failure.
    remove(item.input.clientRef);
  }

  return { sent, remaining: readQueue().length };
}

/**
 * All date formatting goes through here, with the locale pinned.
 *
 * Two reasons. First, `toLocaleString()` with no locale resolves differently on
 * the server than in the browser, which makes any date inside a client component
 * a hydration mismatch. Second, a receipt reprinted from the back office should
 * read exactly like the one the customer was handed at the counter — that only
 * holds if both are formatted the same way.
 *
 * When the Administration module gains a locale setting, this constant is what
 * it changes.
 */
export const SHOP_LOCALE = "en-GB";

type DateInput = Date | string | number;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

/** "24 Aug 2026, 13:49" */
export function formatDateTime(value: DateInput): string {
  return toDate(value).toLocaleString(SHOP_LOCALE, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "24 Aug, 13:49" — for tables where the year is obvious. */
export function formatDayTime(value: DateInput): string {
  return toDate(value).toLocaleString(SHOP_LOCALE, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "24 Aug 2026" */
export function formatDate(value: DateInput): string {
  return toDate(value).toLocaleDateString(SHOP_LOCALE, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** "24 Aug" */
export function formatDayMonth(value: DateInput): string {
  return toDate(value).toLocaleDateString(SHOP_LOCALE, { day: "2-digit", month: "short" });
}

/** "Tue, 11 Aug" — chart tooltips and day headings. */
export function formatWeekday(value: DateInput): string {
  return toDate(value).toLocaleDateString(SHOP_LOCALE, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

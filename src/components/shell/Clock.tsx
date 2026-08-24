"use client";

import { useSyncExternalStore } from "react";

import { SHOP_LOCALE } from "@/lib/datetime";

const DATE = new Intl.DateTimeFormat(SHOP_LOCALE, { month: "long", year: "numeric" });
const TIME = new Intl.DateTimeFormat(SHOP_LOCALE, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

const TICK_MS = 30_000;

function subscribe(onChange: () => void): () => void {
  const id = setInterval(onChange, TICK_MS);
  return () => clearInterval(id);
}

// Snapshot is the minute bucket, not the Date itself: a new Date on every render
// would never compare equal and would re-render forever.
const getSnapshot = () => Math.floor(Date.now() / TICK_MS);

// The server has no clock the till should trust, so it renders a placeholder and
// the real time appears once the browser takes over. Formatting a clock during
// SSR is a guaranteed hydration mismatch.
const getServerSnapshot = () => null;

export function Clock() {
  const tick = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (tick === null) return <span className="inline-block h-4 w-52" aria-hidden />;

  const now = new Date();
  return (
    <time dateTime={now.toISOString()} className="tnum text-[0.8125rem] text-white/80">
      {ordinal(now.getDate())} {DATE.format(now)} {TIME.format(now).toUpperCase()}
    </time>
  );
}

function ordinal(day: number): string {
  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
        ? "nd"
        : day % 10 === 3 && day !== 13
          ? "rd"
          : "th";
  return `${day}${suffix}`;
}

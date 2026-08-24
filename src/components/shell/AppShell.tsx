"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, ChevronRight, LogOut, Maximize2, Menu, Store } from "lucide-react";
import { useState } from "react";

import { Brandmark } from "@/components/Brandmark";
import { Clock } from "./Clock";
import { Sidebar } from "./Sidebar";
import { activeItem } from "@/lib/nav";

export type ShellUser = { name: string; role: string; initials: string };
export type ShellShop = { business: string; branch: string; register: string | null };

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  cashier: "Cashier",
  stock_clerk: "Stock clerk",
};

export function AppShell({
  brandName,
  user,
  shop,
  signOut,
  children,
}: {
  brandName: string;
  user: ShellUser;
  shop: ShellShop;
  signOut: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const current = activeItem(pathname);

  // The till is a full-bleed working surface; every other module is a document
  // page with a title bar and breadcrumb above it.
  const isTerminal = pathname.startsWith("/pos");

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[54px] shrink-0 items-stretch bg-[var(--nav-bg-top)] text-white">
        <Link
          href="/dashboard"
          className={`flex shrink-0 items-center gap-2.5 bg-brand px-5 transition-[width] duration-200 ${
            collapsed ? "w-[68px] justify-center px-0" : "w-[232px]"
          }`}
        >
          <Brandmark size={24} />
          {!collapsed && (
            <span className="truncate text-[0.9375rem] font-bold tracking-tight">{brandName}</span>
          )}
        </Link>

        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!collapsed}
          className="grid w-12 place-items-center text-white/75 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Menu size={19} />
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
          <span className="hidden items-center gap-1.5 rounded-md bg-white/10 px-2.5 py-1 text-[0.75rem] font-medium text-white/85 sm:inline-flex">
            <Store size={13} />
            <span className="truncate">{shop.business}</span>
            <ChevronRight size={12} className="text-white/40" />
            <span className="truncate text-white/60">{shop.branch}</span>
          </span>
        </div>

        <div className="flex items-center gap-1 pr-2">
          <div className="hidden px-3 lg:block">
            <Clock />
          </div>
          {shop.register && (
            <span className="mr-1 hidden rounded-md bg-white/10 px-2.5 py-1 text-[0.75rem] font-semibold text-white/85 md:inline-block">
              {shop.register}
            </span>
          )}
          <IconButton label="Notifications" badge={0}>
            <Bell size={17} />
          </IconButton>
          <IconButton label="Full screen" onClick={() => toggleFullscreen()}>
            <Maximize2 size={16} />
          </IconButton>

          <div className="ml-1 flex items-center gap-2.5 border-l border-white/15 pl-3">
            <span className="grid size-8 place-items-center rounded-full bg-white/15 text-[0.75rem] font-bold">
              {user.initials}
            </span>
            <span className="hidden leading-tight sm:block">
              <span className="block text-[0.8125rem] font-semibold">{user.name}</span>
              <span className="block text-[0.6875rem] text-white/55">
                {ROLE_LABEL[user.role] ?? user.role}
              </span>
            </span>
            <form action={signOut}>
              <button
                type="submit"
                title="Sign out"
                aria-label="Sign out"
                className="grid size-8 place-items-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              >
                <LogOut size={16} />
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar collapsed={collapsed} />

        <main className="scroll-slim min-w-0 flex-1 overflow-y-auto">
          {isTerminal ? (
            children
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-6 py-4">
                <h1 className="text-[1.375rem] font-semibold tracking-tight">
                  {current?.label ?? "Overview"}
                </h1>
                <nav aria-label="Breadcrumb">
                  <ol className="flex items-center gap-1.5 text-[0.8125rem] text-muted">
                    <li>
                      <Link href="/dashboard" className="hover:text-brand">
                        Home
                      </Link>
                    </li>
                    <li aria-hidden className="text-faint">
                      /
                    </li>
                    <li className="font-medium text-ink">{current?.label ?? "Overview"}</li>
                  </ol>
                </nav>
              </div>
              <div className="p-6">{children}</div>
              <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface px-6 py-3.5 text-[0.75rem] text-muted">
                <span>
                  © {new Date().getFullYear()} {brandName}. Working name — brand pending.
                </span>
                <span className="tnum">v0.1.0</span>
              </footer>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function IconButton({
  children,
  label,
  badge,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  badge?: number;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="relative hidden size-9 place-items-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white sm:grid"
    >
      {children}
      {badge ? (
        <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-brand px-1 text-[0.625rem] font-bold leading-4">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => {});
}

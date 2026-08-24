"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { NAV, type NavItem } from "@/lib/nav";

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Modules"
      className={`scroll-slim shrink-0 overflow-y-auto overflow-x-hidden bg-[var(--nav-bg)] pb-8 transition-[width] duration-200 ${
        collapsed ? "w-[68px]" : "w-[232px]"
      }`}
    >
      <ul className="py-2">
        {NAV.map((item) => (
          <SidebarRow key={item.href} item={item} pathname={pathname} collapsed={collapsed} />
        ))}
      </ul>
    </nav>
  );
}

function SidebarRow({
  item,
  pathname,
  collapsed,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
}) {
  const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const childActive = item.children?.some((c) => c.href === pathname) ?? false;
  const [open, setOpen] = useState(isActive);

  const Icon = item.icon;
  const showChildren = Boolean(item.children?.length) && !collapsed;

  return (
    <li>
      <div className="relative">
        {(isActive || childActive) && (
          <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-brand" />
        )}
        <Link
          href={item.href}
          title={collapsed ? item.label : undefined}
          aria-current={pathname === item.href ? "page" : undefined}
          onClick={(event) => {
            // On a parent row the chevron toggles; the label still navigates.
            if (showChildren && !open) {
              event.preventDefault();
              setOpen(true);
            }
          }}
          className={`flex items-center gap-3 px-[22px] py-[11px] text-[0.8125rem] transition-colors ${
            isActive
              ? "bg-[var(--nav-bg-active)] text-white"
              : "text-[var(--nav-fg)] hover:bg-[var(--nav-bg-hover)] hover:text-white"
          } ${collapsed ? "justify-center px-0" : ""}`}
        >
          <Icon size={17} strokeWidth={2} className="shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 truncate">{item.label}</span>
              {!item.built && !item.children && (
                <span className="rounded bg-white/10 px-1.5 py-px text-[0.625rem] font-semibold uppercase tracking-wide text-white/50">
                  Soon
                </span>
              )}
              {showChildren && (
                <ChevronDown
                  size={14}
                  className={`shrink-0 transition-transform ${open ? "rotate-180" : "-rotate-90"}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpen((v) => !v);
                  }}
                />
              )}
            </>
          )}
        </Link>
      </div>

      {showChildren && open && (
        <ul className="bg-[var(--nav-bg-sub)] py-1">
          {item.children!.map((child) => (
            <li key={child.href}>
              <Link
                href={child.href}
                aria-current={pathname === child.href ? "page" : undefined}
                className={`flex items-center gap-2.5 py-2 pl-[34px] pr-4 text-[0.8125rem] transition-colors ${
                  pathname === child.href
                    ? "text-white"
                    : "text-[var(--nav-fg)] hover:text-white"
                }`}
              >
                <span
                  aria-hidden
                  className={`size-1.5 shrink-0 rounded-full ${
                    pathname === child.href ? "bg-brand" : "bg-white/25"
                  }`}
                />
                <span className="flex-1 truncate">{child.label}</span>
                {!child.built && (
                  <span className="text-[0.625rem] font-semibold uppercase tracking-wide text-white/35">
                    Soon
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Boxes,
  LayoutDashboard,
  Package,
  ScanLine,
  Settings,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
} from "lucide-react";

export type NavChild = { label: string; href: string; built?: boolean };

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  children?: NavChild[];
  built?: boolean;
};

/**
 * The whole product surface, not just the parts that are finished.
 *
 * The idea document's point is that this is one connected system rather than a
 * POS with add-ons, and a navigation that only lists today's build hides that.
 * Modules still to come route to a placeholder that says what will live there,
 * which is more honest than a dead link and more useful than hiding them.
 */
export const NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, built: true },
  { label: "POS", href: "/pos", icon: ScanLine, built: true },
  {
    label: "Products",
    href: "/products",
    icon: Package,
    built: true,
    children: [
      { label: "All products", href: "/products", built: true },
      { label: "Categories", href: "/products/categories", built: true },
      { label: "Stock levels", href: "/inventory", built: true },
    ],
  },
  {
    label: "Sales",
    href: "/sales",
    icon: ShoppingCart,
    built: true,
    children: [
      { label: "All sales", href: "/sales", built: true },
      { label: "Customers", href: "/customers", built: true },
    ],
  },
  {
    label: "Inventory",
    href: "/inventory",
    icon: Boxes,
    built: true,
    children: [
      { label: "Stock on hand", href: "/inventory", built: true },
      { label: "Stock movements", href: "/inventory/movements", built: true },
    ],
  },
  {
    label: "Purchasing",
    href: "/purchasing",
    icon: Truck,
    children: [
      { label: "Purchase orders", href: "/purchasing" },
      { label: "Suppliers", href: "/purchasing/suppliers", built: true },
    ],
  },
  {
    label: "Finance",
    href: "/finance",
    icon: Wallet,
    built: true,
    children: [
      { label: "Trial balance", href: "/finance", built: true },
      { label: "Journal", href: "/finance/journal", built: true },
    ],
  },
  { label: "Reports", href: "/reports", icon: BarChart3 },
  { label: "People", href: "/people", icon: Users, built: true },
  { label: "Settings", href: "/settings", icon: Settings, built: true },
];

/** Longest-prefix match, so /sales/abc still lights up "Sales". */
export function activeItem(pathname: string): NavItem | undefined {
  return [...NAV]
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

/**
 * The product name has NOT been chosen yet (see IDEA DOCUMENTATION, section 05/06).
 * "Vender" is a working codename only. Every user-visible mention of the brand
 * reads from here, so adopting the real name is a one-line change in this file
 * plus the `metadata` in src/app/layout.tsx.
 */
export const brand = {
  /** Working codename. Replace once the name clears domain/app-store/trademark screening. */
  name: "Vender",
  tagline: "A business operating system that starts at the counter.",
  /** Product family, per the brand-architecture table in the idea doc. */
  modules: {
    pos: "POS",
    sales: "Sales",
    inventory: "Inventory",
    purchasing: "Purchasing",
    finance: "Finance",
    analytics: "Analytics",
    admin: "Administration",
  },
} as const;

# Vender — working name

A business operating system that starts at the counter.

This is the first build of the platform described in `IDEA DOCUMENTATION.pdf`: a
POS that is not a silo, growing into sales, inventory, purchasing, finance,
analytics and administration.

> **The name is not chosen.** "Vender" is a codename. The idea document is
> explicit that the final name must clear domain, app-store, company and
> trademark screening first, and must not lock the company into the POS category.
> Every user-visible mention reads from `src/lib/brand.ts`; the chrome colours
> live in one token block at the top of `src/app/globals.css`. Adopting the real
> identity is a two-file change.

## Running it

```bash
npm install && npm run db:seed && npm run dev
```

Then open http://localhost:4310 and sign in with a demo PIN:

| Who | Role | PIN |
| --- | --- | --- |
| Ama Serwaa | Owner | 1234 |
| Kojo Mensah | Manager | 2345 |
| Efua Danso | Cashier | 3456 |

No database to install. With no `DATABASE_URL` the app runs an embedded Postgres
(PGlite) out of `.data/` — real Postgres, no server. Set `DATABASE_URL` and the
same schema, migrations and queries run against hosted Postgres (Supabase,
Railway, RDS) instead; nothing above `src/db/client.ts` knows the difference.

```bash
npm run dev        # dev server on :4310
npm run db:seed    # create the demo shop (idempotent)
npm run db:reset   # wipe .data and re-seed
npm test           # pricing and settlement unit tests
npm run smoke      # end-to-end check of the sale transaction
npm run typecheck
```

## The one idea this is built around

> *A transaction should never exist in isolation. A sale should automatically
> connect sales, inventory, payment, accounting and analytics.*
> — IDEA DOCUMENTATION, §01

That is enforced in exactly one place, `recordSale()` in `src/server/sales.ts`.
A single database transaction writes:

1. the sale and its lines, with **price and name snapshots** so a receipt
   reprinted next year still reads as it was sold;
2. the tenders, with change resolved against cash only;
3. **stock movements** and the running stock levels, refusing to oversell;
4. a **balanced double-entry journal** — cash/MoMo/receivable debited, revenue
   and tax payable credited, cost of goods moved out of inventory;
5. the customer's account balance, if anything was left unpaid.

Either all of that lands or none of it does. There is no path in the product
that sells stock without also moving inventory and posting to the ledger, which
is why `/finance` can show a trial balance nobody typed in, and why
`/sales/[id]` can show the receipt, the stock it moved, and the ledger entry it
posted side by side.

## Decisions worth knowing

**Money is integer minor units, everywhere.** Pesewas, not floats. Tax and
discount rates are integer basis points. `src/lib/money.ts` owns the rounding,
which is half-away-from-zero — the convention a cashier expects, not banker's
rounding. `allocate()` splits a total without losing or inventing a pesewa.

**Both tax regimes.** `pricesIncludeTax` on the business switches between
tax-inclusive shelf pricing (Ghana, UK, EU) and tax-added-at-the-till (US).
`src/domain/pricing.ts` is pure and tested either way.

**Multi-tenant and multi-branch from the first row.** Every business-owned table
carries `business_id`, stock lives per warehouse, and receipt numbers are minted
per till from a counter row rather than `max()+1`. Retrofitting any of that is
the most expensive mistake this kind of product can make.

**The till re-prices on the server.** The cart's arithmetic is a suggestion;
`checkout()` recomputes every line from the catalogue. A tampered or stale cart
cannot decide what the shop gets paid.

**Offline is a real path, not a promise.** Every sale carries a client-generated
`clientRef` with a unique index behind it. If the server is unreachable the sale
is parked in `localStorage`, the cashier keeps trading, and it replays when the
connection returns — safely, because a repeat of that key returns the original
sale instead of charging twice. Limits are documented in
`src/lib/offlineQueue.ts`: the catalogue must already be loaded, so a cold start
with no network cannot open the till. Caching the catalogue in IndexedDB behind
a service worker is the next step, and this is the seam it plugs into.

## What is built

| Module | State |
| --- | --- |
| POS | Working — scan/search, cart, split tenders, change, on-account sales, receipt, offline queue |
| Sales | Working — history, and a per-sale view showing the stock and ledger it caused |
| Products / Categories | Working — read-only catalogue with cost, price, margin, stock |
| Inventory | Working — stock on hand, valuation, and the full movement ledger |
| Customers | Working — accounts, lifetime spend, balances owed |
| Finance | Working — trial balance and journal, derived entirely from transactions |
| People / Settings | Working — read-only |
| Purchasing | Not built — routes explain what will live there |
| Reports | Not built |

Editing is deliberately not built yet. Everything so far exists to prove the
transaction spine; CRUD screens on top of a correct spine are straightforward,
whereas a spine retrofitted under CRUD screens is not.

## Honest gaps

- **Till PINs are not account authentication.** Four digits, scrypt-hashed,
  rate-limited per employee in process memory. Good enough to attribute a shift,
  not to protect an account. Real auth belongs to Administration, and the
  rate limiter needs to move out of memory before running on more than one node.
- **No authorisation model.** Any signed-in employee can reach any module. Roles
  exist in the schema and are not yet enforced.
- **Refunds are modelled, not implemented.** `sale_lines.quantity_refunded` and
  the `refund` movement reason are there; nothing writes them yet.
- **Register sessions** (open float, Z-report, drawer variance) have tables but
  no UI, so sales are not yet attached to a shift.
- **Day boundaries use server local time.** Fine for one shop, wrong for a chain
  across time zones.
- **Purchasing does not yet post to Accounts Payable**, so supplier balances stay
  at zero and inventory only ever goes down after the opening stock take.

## Layout

```
src/
  app/
    (shop)/          the signed-in shell — every module
      pos/           the till: terminal, cart, payment, receipt, checkout action
    setup/           first-run: create the demo shop
    sign-in/         PIN pad
  components/        shell (sidebar, top bar), chart, shared bits
  db/                schema, client, seed
  domain/            pure business rules: pricing, chart of accounts (+ tests)
  lib/               money, dates, brand, nav, offline queue
  server/            everything that touches the database or the session
drizzle/             generated SQL migrations
scripts/             seed and smoke-test entry points
```

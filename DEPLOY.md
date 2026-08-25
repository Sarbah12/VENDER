# Hosting this

The app is a standard Next.js server plus a Postgres database. Nothing about it
is tied to a particular host: the only decisions are *where the database lives*
and *where the server runs*.

The database is the part that matters. A POS holds the only record of what was
sold and what is on the shelf — losing it is losing the business's books. So
choose the database for **backups and recovery first**, and the app host second.

---

## The short answer

| If you want… | Use |
| --- | --- |
| The safest default | **Supabase** (database) + **Vercel** (app) |
| One bill, one dashboard, least setup | **Railway** (both) |
| Lowest latency for West/Southern Africa | **Fly.io** in `jnb`, with Supabase or Neon for the database |
| Cheapest at scale, you handle ops | **Hetzner** or **DigitalOcean** VPS + Docker |

If you have no strong opinion: **Supabase + Vercel.** Supabase is managed
Postgres with automated backups, point-in-time recovery on paid plans, a SQL
editor, and a connection pooler. Vercel deploys a Next.js app from a Git push
with no configuration. You already know Railway from RydeChain, and it is a
perfectly good second choice if you would rather keep one platform.

---

## Option 1 — Supabase + Vercel (recommended)

### Connecting this app to Supabase

**Ignore the "Framework → Next.js" tab in the Connect dialog.** It installs
`@supabase/supabase-js` and `@supabase/ssr` and hands you a publishable key.
This app needs none of that — it speaks Postgres directly through Drizzle, with
its own schema, its own migrations and its own session cookie. Supabase is being
used purely as a well-run Postgres.

The tab you want is **Connect → Direct → Connection string**. Copy two URLs
from it:

| Supabase calls it | Port | Goes in | Why |
| --- | --- | --- | --- |
| **Transaction pooler** | `6543` | `DATABASE_URL` | What the app uses. Handles many short-lived connections; prepared statements are disabled automatically because backends rotate between statements. |
| **Session pooler** | `5432` | `DIRECT_DATABASE_URL` | What migrations use. Holds one backend for the whole connection, so DDL works — and it reaches Supabase over IPv4. |

Both pooled URLs use `postgres.PROJECT_REF` as the username, not plain
`postgres`. Getting that wrong produces `Tenant or user not found`.

> **Why not "Direct connection"?** On the free plan that host resolves to IPv6
> only. If your network or host is IPv4 — most are — it fails with `ENETUNREACH`.
> The session pooler does the same job over IPv4.

### Steps

```bash
cp .env.local.template .env.local
# fill in the two passwords and SESSION_SECRET, then:
openssl rand -base64 32     # paste the output as SESSION_SECRET

npm run db:ping             # confirms it connects; prints no credentials
npm run db:migrate          # creates the schema
npm run dev                 # visit /setup to create your business
```

`db:ping` reports what it found and names the likely cause if it fails. It never
prints the connection string.

### The data API is closed, deliberately

Supabase serves the `public` schema over HTTP through PostgREST, and grants the
`anon` and `authenticated` roles access to tables created there by default. The
anon key is meant to be public — it ships inside client code. Left alone, that
would make every row in this database readable and writable by anyone who knows
the project URL: `employees.pin_hash`, every sale, every customer.

Migration `0001_secure_rls` closes it, and is applied by `npm run db:migrate`
along with everything else:

- **Row-level security is enabled on all 22 tables, with no policies.** PostgREST
  connects as `anon`, which then matches no rows and can write nothing.
- **Grants are revoked** from `anon` and `authenticated`, including default
  privileges for tables created later.

The app is unaffected because it connects straight to Postgres as the role that
*owns* these tables, and an owner bypasses RLS unless `FORCE ROW LEVEL SECURITY`
is set. The full smoke suite passes against a database with RLS on, which is what
proves it.

`npm run db:ping` reports the state of both every time you run it, so a table
added later without protection shows up rather than sitting there quietly. If you
ever add a table by hand, re-run `npm run db:migrate` to bring it under the same
rule.

> This is worth understanding rather than just accepting: if you later decide to
> use Supabase's client libraries for something, you will need to write explicit
> RLS policies for whatever you expose. The default here is "closed", and that is
> the right default for a system of record.

### Two switches worth flipping in Database Settings

Both are off by default and cost nothing:

- **Enforce SSL on incoming connections.** The app already connects with TLS, but
  this rejects anything that does not, so a misconfigured client cannot quietly
  send credentials in the clear.
- **Connection logging** (*Log connections* / *Log disconnections*). Cheap, and
  the first thing you will want if you ever need to work out who connected when.

**Network restrictions** are also there, and tempting — but leave them alone if
you deploy to Vercel or Fly, whose outbound addresses are dynamic. They are only
practical from a fixed IP.

### Free plan: two things to fix before a real shop uses this

Your project is on the free plan with `nano` compute, and the dashboard shows
**"Last backup: No backups"**. Both matter for a till:

- **Free projects pause after about a week of inactivity.** A paused database is
  a till that will not open. Fine while you are building; not acceptable once a
  shop depends on it.
- **No point-in-time recovery on free.** The database holds the only record of
  what was sold and what is on the shelf.

The Pro plan (about $25/month) removes the pausing and adds daily backups with
retention. If you would rather stay on free for now, take your own dumps — see
*Backups* below — and treat the pause as a known risk.

`nano` compute is genuinely fine to start; a single shop will not trouble it.

### Latency is the thing to watch

Measured from Accra against a Supabase project in `eu-west-1`:

| | |
| --- | --- |
| First connection (TLS + pooler handshake) | ~2,200ms |
| Every query after that | **~197ms** |

That number is the distance, not the database — Postgres answers in single-digit
milliseconds; the rest is the round trip to Ireland. It has one blunt
consequence: **the count of queries a page makes is its load time.** Six
sequential queries is 1.2 seconds before anything renders.

So `getShopContext()` — which runs before every page — deliberately gathers the
membership, business, branch, warehouse, tills and employee in **one** query
using sub-selects, rather than six readable ones. That is the single biggest
performance decision in the app, and the reason to be wary of adding an
innocent-looking `await db.select(...)` to a hot path.

`vercel.json` pins functions to `dub1` (Dublin) for the same reason. Without it
Vercel defaults to Washington DC, putting the Atlantic between every query and
the database. **If you move the Supabase project to another region, change that
line to match** — the two should always be neighbours.

### App (Vercel)

1. Push this repository to GitHub and import it on Vercel.
2. Add the same three environment variables: `DATABASE_URL`,
   `DIRECT_DATABASE_URL`, `SESSION_SECRET`.
3. Set the build command to `npm run db:migrate && npm run build`, so every
   deploy applies pending migrations before the new version serves traffic.

Vercel runs each request in a short-lived instance, so the app opens **one**
connection per instance and disables prepared statements on the transaction
pooler — both handled in `src/db/client.ts`, nothing to configure.

---

## Option 2 — Railway (app and database together)

1. New project → **Add PostgreSQL**.
2. **Deploy from GitHub repo** for the app. Railway detects the `Dockerfile`.
3. In the app service, reference the database with
   `DATABASE_URL=${{Postgres.DATABASE_URL}}`, and add `SESSION_SECRET`.
4. Set the deploy (pre-start) command to `npm run db:migrate`.

Simplest to reason about, and one bill. Two things to know: Railway's Postgres
backups need to be configured — do not assume they exist — and there is no
African region, so expect ~150–250ms from Accra to the nearest EU region.

---

## Option 3 — Fly.io, closest to Ghana

Fly has a Johannesburg region (`jnb`), which is the nearest major host to West
Africa and a real improvement over EU round-trips for a busy counter.

```bash
fly launch --region jnb --no-deploy
fly secrets set SESSION_SECRET=... DATABASE_URL=... DIRECT_DATABASE_URL=...
fly deploy
```

Run the app on Fly and keep the **database on Supabase or Neon**. Fly's own
Postgres is an unmanaged app you are responsible for backing up, which is the
wrong trade for a system of record.

---

## Option 4 — Your own server

A €5–10/month Hetzner or DigitalOcean box runs this comfortably for a single
business, and you can put it wherever you like.

```bash
docker build -t vender .
docker run -d --restart=always -p 3000:3000 \
  -e DATABASE_URL=... -e DIRECT_DATABASE_URL=... -e SESSION_SECRET=... \
  vender
```

Put Caddy or nginx in front for TLS, use a **managed** Postgres rather than one
in a container on the same box, and set up `pg_dump` to off-site storage. This is
the cheapest option and the one with the most work attached; take it only if you
are willing to own the backups.

---

## What "plenty of items" actually costs

Postgres does not care about a large catalogue — a few hundred thousand products
is unremarkable. The parts that were built for it:

- **The till loads a slice, not the catalogue.** Under ~1,500 products it holds
  everything in memory so browsing and searching are instant. Above that it
  loads 300 for browsing and queries the database as the cashier types
  (`POS_FULL_LOAD_LIMIT` in `src/app/(shop)/pos/page.tsx`).
- **Scanning is an indexed exact-match lookup**, so it stays instant at any size
  and never degrades into a fuzzy search that could ring up the wrong item.
- **The product list pages server-side**, 50 rows at a time, with search done in
  the database.
- **Summary figures are database aggregates**, not sums over rows fetched into
  the app.

Text search uses `ILIKE '%term%'`, which is a sequential scan. With a `LIMIT` on
the end that is genuinely fine into the tens of thousands. If a catalogue grows
past that, add a trigram index and the query planner will use it:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX products_name_trgm ON products USING gin (name gin_trgm_ops);
```

---

## Backups

Not optional. The offline queue protects you from a flaky connection; nothing
protects you from a lost database except a backup you have restored at least once.

- **Supabase / Neon**: daily backups are automatic; enable PITR on a paid plan.
- **Railway / your own box**: schedule it yourself.

```bash
pg_dump "$DIRECT_DATABASE_URL" --format=custom --file=vender-$(date +%F).dump
```

Restore into a scratch database and open the app against it once, so you know
the backup works before you need it.

---

## Before you go live

- [ ] `SESSION_SECRET` set to a random 32-byte value. The app refuses to start
      in production without it.
- [ ] `DATABASE_URL` is the **pooled** URL; `DIRECT_DATABASE_URL` is the direct one.
- [ ] `npm run db:migrate` runs as part of the deploy.
- [ ] `/api/health` wired to the host's health check and to an uptime monitor.
- [ ] Backups scheduled, and one restore rehearsed.
- [ ] HTTPS everywhere — session cookies are marked `secure` in production and
      will not survive plain HTTP.
- [ ] Visit `/setup` once to create the real business, then change the owner PIN
      from anything you used while testing.

## Known gaps that matter in production

These are real and worth knowing before you put a shop on this:

- **Till PINs are not account authentication.** Four digits, scrypt-hashed and
  rate-limited, are enough to attribute a shift, not to protect an account.
- **The PIN rate limiter lives in process memory**, so it resets on deploy and
  does not work across multiple instances. Move it to Postgres or Redis before
  running more than one instance.
- **No password reset, no audit UI, no per-branch access control.**
- **Refunds are modelled in the schema but not implemented.**
- **Day boundaries use the server's local time**, which is wrong for a chain
  spanning time zones.

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

**Database (Supabase)**

1. Create a project. Pick the region closest to your shops — check the current
   region list when you create it; Supabase has European and African regions,
   and the closest one to Ghana will beat a US one noticeably.
2. Set a strong database password and save it.
3. From *Project Settings → Database*, copy two connection strings:
   - the **Transaction pooler** URL (port `6543`) → this is `DATABASE_URL`
   - the **Direct connection** URL (port `5432`) → this is `DIRECT_DATABASE_URL`
4. Turn on **Point-in-Time Recovery** if you are on a paid plan. On the free
   plan, take your own periodic `pg_dump` — see *Backups* below.

You do not need Supabase Auth, Storage, or its client libraries. This app talks
to Postgres directly with its own schema and its own session handling; Supabase
is being used purely as a well-run Postgres.

**App (Vercel)**

1. Push this repository to GitHub and import it on Vercel.
2. Add environment variables: `DATABASE_URL`, `DIRECT_DATABASE_URL`,
   `SESSION_SECRET` (generate with `openssl rand -base64 32`).
3. Set the build command to `npm run db:migrate && npm run build` so each deploy
   applies pending migrations before the new version serves traffic.

Vercel runs each request in a short-lived instance, so the app opens **one**
connection per instance and turns off prepared statements when it detects a
pooler — both handled automatically in `src/db/client.ts`. Use the pooled URL
for the app and the direct URL only for migrations; a transaction pooler cannot
run the DDL that migrations need.

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

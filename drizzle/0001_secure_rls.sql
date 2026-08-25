-- Lock the tables against Supabase's HTTP data API.
--
-- Supabase runs PostgREST over the `public` schema and, by default, grants the
-- `anon` and `authenticated` roles access to tables created there. The anon key
-- is published in client code by design, so without this migration every row in
-- this database — employees.pin_hash, every sale, every customer — is readable
-- and writable by anyone who knows the project URL.
--
-- This app never uses that API. It connects straight to Postgres as the role
-- that owns these tables, and a table's owner bypasses row-level security
-- unless FORCE ROW LEVEL SECURITY is set. So enabling RLS with no policies
-- shuts the HTTP door completely while leaving the app untouched.
--
-- Safe on non-Supabase Postgres: the role checks below simply find nothing.

-- 1. Enable RLS on every table in the public schema.
--    Written as a loop so a table added later cannot be missed by a hand-edited
--    list; `npm run db:ping` reports any table that ends up without it.
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target.relname);
  END LOOP;
END $$;
--> statement-breakpoint

-- 2. Take away the grants as well, so the API cannot even see the tables.
--    RLS alone is enough; this makes the intent explicit and survives someone
--    later adding a permissive policy by accident.
DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', api_role);
      EXECUTE format('REVOKE USAGE ON SCHEMA public FROM %I', api_role);
      -- And for anything created from here on.
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', api_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', api_role
      );
    END IF;
  END LOOP;
END $$;

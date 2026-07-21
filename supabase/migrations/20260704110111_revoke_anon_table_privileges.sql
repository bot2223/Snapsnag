-- The app never queries tables as `anon` — all data access happens after
-- sign-in, under the `authenticated` role (see auth-context.tsx / RLS design
-- in has_active_access()). Supabase grants full CRUD to anon on every new
-- public table by default; RLS was already blocking real access, but the
-- leftover grants let unauthenticated requests get a 200 + empty array
-- instead of a permission error, which lets table names be enumerated.
-- Revoking removes that signal and the unnecessary blast radius.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

-- Nothing in this app truncates a table via the API; TRUNCATE bypasses RLS
-- and per-row triggers entirely, so authenticated shouldn't hold it either.
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM authenticated;

-- Make sure future tables don't silently regain anon access.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;

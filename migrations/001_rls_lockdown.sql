-- =====================================================================
-- Fiberspot — Phase 1.1: RLS lockdown + author tracking + rate limiting
--
-- ⚠️  ORDER OF OPERATIONS — READ BEFORE RUNNING
--
-- Do NOT run this until the Vercel edge functions in /api/spots/* are
-- deployed and the client is calling them (Phase 1.3). Once you run
-- this, all direct writes from the browser are blocked at the RLS
-- level, and the only writers are the edge functions (which use the
-- SUPABASE_SERVICE_ROLE_KEY and bypass RLS).
--
-- If you run this too early, the app will silently fail to save spots
-- and speedtests until the edge functions ship.
--
-- Run this in: Supabase Dashboard → SQL Editor → New query → paste → Run
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Ensure base tables exist
--
-- `spots` is created by initial setup (see schema.sql). `speed_tiles`
-- is referenced by the app but may not be populated yet — create the
-- table if missing so the policies below can attach to it.
-- ---------------------------------------------------------------------

create table if not exists speed_tiles (
  quadkey     text primary key,
  avg_d_kbps  float not null,
  avg_u_kbps  float not null,
  avg_lat_ms  float not null,
  tests       int  not null,
  devices     int  not null
);

-- Add author_id to spots. Used by edge functions to attach ownership
-- when an authenticated user creates a spot. Legacy spots stay NULL →
-- no one owns them, so future "edit my spot" features won't apply.
alter table spots
  add column if not exists author_id uuid references auth.users(id) on delete set null;

create index if not exists spots_author_id_idx on spots(author_id);


-- ---------------------------------------------------------------------
-- 2. Drop the old wide-open policies on `spots` and `speed_tiles`
-- ---------------------------------------------------------------------

drop policy if exists "Public read"   on spots;
drop policy if exists "Public insert" on spots;
drop policy if exists "Public update" on spots;

drop policy if exists "Public read tiles"   on speed_tiles;
drop policy if exists "Public insert tiles" on speed_tiles;


-- ---------------------------------------------------------------------
-- 3. New policies — public read only, all writes blocked from anon and
-- authenticated. The service_role key bypasses RLS, so edge functions
-- can still write.
-- ---------------------------------------------------------------------

create policy "spots_select_public"
  on spots for select
  using (true);

create policy "speed_tiles_select_public"
  on speed_tiles for select
  using (true);

-- No insert/update/delete policies on either table.
-- RLS denies by default → only service_role can write.


-- ---------------------------------------------------------------------
-- 4. Rate limit event log
--
-- Edge functions append a row per write attempt and count recent rows
-- per IP (and per user_id if authenticated) to throttle abuse.
-- Kept simple — no separate counter table, no Redis. Prune via cron
-- or inside the edge function.
-- ---------------------------------------------------------------------

create table if not exists rate_limit_events (
  id          bigint generated always as identity primary key,
  ip          text,
  user_id     uuid references auth.users(id) on delete set null,
  action      text not null,        -- 'create_spot' | 'submit_speedtest'
  created_at  timestamptz not null default now()
);

create index if not exists rate_limit_events_ip_action_idx
  on rate_limit_events(ip, action, created_at desc);

create index if not exists rate_limit_events_user_action_idx
  on rate_limit_events(user_id, action, created_at desc);

alter table rate_limit_events enable row level security;
-- No policies = no client access. Only service_role.


-- ---------------------------------------------------------------------
-- 5. Sanity: confirm RLS is enabled on every public table
-- ---------------------------------------------------------------------

alter table spots             enable row level security;
alter table speed_tiles       enable row level security;
alter table rate_limit_events enable row level security;

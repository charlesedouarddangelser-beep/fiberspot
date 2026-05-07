-- =====================================================================
-- Fiberspot — Phase 2.A: speed_tests history + trigger-based averages
--
-- Replaces the "overwrite avg_* on each test" pattern with a real history
-- table. Each speedtest becomes a row in `speed_tests`; an after-insert
-- trigger recomputes spots.avg_* and spots.last_tested_at.
--
-- Existing spots keep their current avg_* values (legacy point-in-time);
-- new tests recompute via the trigger from `speed_tests` only. Old single
-- "average" values eventually fade out as real history accumulates.
--
-- ⚠️  ORDER OF OPERATIONS
-- Run this BEFORE the new edge function code is live, or the next
-- speedtest from the deployed app will fail because the table doesn't
-- exist. Coordinate the deploy: edge function code waits for this SQL.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. speed_tests table — append-only history of every measurement
-- ---------------------------------------------------------------------

create table if not exists speed_tests (
  id          bigint generated always as identity primary key,
  spot_id     uuid not null references spots(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  download    numeric not null,
  upload      numeric not null,
  ping        numeric not null,
  lat         double precision,
  lng         double precision,
  created_at  timestamptz not null default now()
);

create index if not exists speed_tests_spot_id_created_at_idx
  on speed_tests(spot_id, created_at desc);

-- RLS: public read for charts, all writes via service-role only.
alter table speed_tests enable row level security;

drop policy if exists speed_tests_select_public on speed_tests;
create policy speed_tests_select_public
  on speed_tests for select
  using (true);


-- ---------------------------------------------------------------------
-- 2. Trigger: recompute spots.avg_* + last_tested_at from speed_tests
-- ---------------------------------------------------------------------

create or replace function recompute_spot_avgs() returns trigger
language plpgsql as $$
begin
  update spots
     set avg_download = sub.avg_d,
         avg_upload   = sub.avg_u,
         avg_ping     = sub.avg_p,
         last_tested_at = sub.last_test
    from (
      select avg(download)   as avg_d,
             avg(upload)     as avg_u,
             avg(ping)       as avg_p,
             max(created_at) as last_test
        from speed_tests
       where spot_id = new.spot_id
    ) sub
   where spots.id = new.spot_id;
  return new;
end;
$$;

drop trigger if exists speed_tests_after_insert on speed_tests;
create trigger speed_tests_after_insert
  after insert on speed_tests
  for each row execute function recompute_spot_avgs();

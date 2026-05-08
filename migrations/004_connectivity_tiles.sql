-- =====================================================================
-- Fiberspot — Phase 5: Arcep FTTH coverage tiles
--
-- Stores Arcep's "Liste des locaux raccordables au THD fixe" aggregated
-- per quadkey at zoom 14 (~600m × 600m). Each tile records how many
-- addresses are FTTH-eligible vs total, plus the most-deployed
-- operator. The client looks up a spot's tile and renders a "Zone
-- fibre — X%" badge so users see the authoritative baseline alongside
-- the community-measured speeds.
--
-- Public read; writes only via service-role (handled by the ingestion
-- script in scripts/ingest-arcep.mjs).
-- =====================================================================

create table if not exists connectivity_tiles (
  quadkey            text primary key,           -- zoom-14 quadkey
  ftth_locaux        int  not null default 0,    -- locals raccordables FTTH
  total_locaux       int  not null,              -- total addresses in tile
  dominant_operator  text,                       -- "Orange" / "SFR" / etc.
  updated_at         timestamptz not null default now()
);

create index if not exists connectivity_tiles_updated_at_idx
  on connectivity_tiles(updated_at desc);

alter table connectivity_tiles enable row level security;

drop policy if exists connectivity_tiles_select_public on connectivity_tiles;
create policy connectivity_tiles_select_public
  on connectivity_tiles for select
  using (true);

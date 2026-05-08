-- =====================================================================
-- Fiberspot — Phase 5: Arcep FTTH coverage by commune
--
-- Stores the per-commune deployment rates from Arcep's quarterly
-- "Relevé géographique des déploiements FttH". The release is a
-- ~6.3 MB CSV covering every French commune (34,920 rows), so we key
-- on INSEE_COM and look up a spot's commune via api-adresse.data.gouv.fr
-- reverse-geocoding (free, no auth).
--
-- Public read; writes only via service-role (handled by the ingestion
-- script in scripts/ingest-arcep.mjs).
-- =====================================================================

create table if not exists connectivity_communes (
  insee_com               text primary key,             -- INSEE commune code
  commune_name            text not null,
  insee_dep               text,
  insee_reg               text,
  locaux_total            int,                          -- locaux_commune
  locaux_ftth             int,                          -- IPE_commune
  taux_deploiement        numeric,                      -- 0..1
  operateur_majoritaire   text,                         -- oi_majo (NULL when unknown)
  zonage                  text,                         -- "ZTD" / "ZMD" / "RIP" / etc.
  updated_at              timestamptz not null default now()
);

create index if not exists connectivity_communes_dep_idx
  on connectivity_communes(insee_dep);

alter table connectivity_communes enable row level security;

drop policy if exists connectivity_communes_select_public on connectivity_communes;
create policy connectivity_communes_select_public
  on connectivity_communes for select
  using (true);

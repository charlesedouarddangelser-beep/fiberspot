-- =====================================================================
-- Fiberspot — Phase 5: Wi-Fi network name + password on spots
--
-- Both fields are nullable: many spots are open networks or unknown.
-- Anyone with SELECT on spots (public, by design) can read these — the
-- whole point of Fiberspot is community sharing of Wi-Fi access. Users
-- adding a spot should only enter passwords that are publicly known
-- (printed on the wall, on a receipt, etc.).
-- =====================================================================

alter table spots
  add column if not exists wifi_ssid     text,
  add column if not exists wifi_password text;

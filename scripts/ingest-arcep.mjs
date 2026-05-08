/**
 * Ingest Arcep FTTH availability into connectivity_tiles.
 *
 * Arcep publishes the quarterly "Liste des locaux raccordables au THD
 * fixe" on data.gouv.fr — a per-département CSV listing every address
 * eligible for FTTH plus the deploying operator. We aggregate by
 * quadkey at zoom 14 (~600m × 600m) so each Fiberspot lookup boils
 * down to a single primary-key fetch.
 *
 * Usage:
 *   # ingest a single file
 *   npm run import-arcep -- /path/to/file.csv
 *
 *   # ingest a whole directory (e.g. an unzipped quarterly archive)
 *   npm run import-arcep -- /path/to/arcep_q4_2025/
 *
 * Required env vars (in .env):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import duckdb from "duckdb";
import { readdirSync, statSync } from "node:fs";
import { resolve, join, extname } from "node:path";

// ---------- Config ----------

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env. Add them to .env (un-prefixed)."
  );
  process.exit(1);
}

const inputArg = process.argv[2];
if (!inputArg) {
  console.error("Usage: npm run import-arcep -- <path-to-csv-or-directory>");
  process.exit(1);
}

const inputPath = resolve(inputArg);
let inputStat;
try {
  inputStat = statSync(inputPath);
} catch {
  console.error(`Path not found: ${inputPath}`);
  process.exit(1);
}

const csvFiles = inputStat.isDirectory()
  ? readdirSync(inputPath)
      .filter((f) => extname(f).toLowerCase() === ".csv")
      .map((f) => join(inputPath, f))
  : [inputPath];

if (csvFiles.length === 0) {
  console.error("No CSV files found.");
  process.exit(1);
}

console.log(`Ingesting ${csvFiles.length} CSV file(s)`);

// ---------- DuckDB pipeline ----------
//
// Arcep CSV columns vary across quarters but typically include:
//   coord_lat / coord_lon (or latitude / longitude)
//   statut_immeuble / statut_deploiement / etc.
//   operateur_immeuble / operateur_principal
//
// We let DuckDB sniff the schema, then alias the most common variants
// in the SELECT below. Add more aliases here as needed.

const db = new duckdb.Database(":memory:");
const conn = db.connect();
const run = (sql) =>
  new Promise((resolve, reject) => {
    conn.exec(sql, (err) => (err ? reject(err) : resolve()));
  });
const all = (sql) =>
  new Promise((resolve, reject) => {
    conn.all(sql, (err, rows) => (err ? reject(err) : resolve(rows)));
  });

// ---------- Quadkey z=14 helper ----------
//
// Bing tile system. Identical math to the speed_tiles import, just at
// a coarser zoom (14 instead of 16) so each tile is ~600m wide.

function latLngToQuadkey(lat, lng, zoom) {
  let qk = "";
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const pixelX = ((lng + 180) / 360) * 256 * Math.pow(2, zoom);
  const pixelY =
    (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) *
    256 *
    Math.pow(2, zoom);
  const tileX = Math.floor(pixelX / 256);
  const tileY = Math.floor(pixelY / 256);
  for (let i = zoom; i > 0; i--) {
    let digit = 0;
    const mask = 1 << (i - 1);
    if ((tileX & mask) !== 0) digit += 1;
    if ((tileY & mask) !== 0) digit += 2;
    qk += digit.toString();
  }
  return qk;
}

// ---------- Process ----------

console.log("Reading CSV(s) into DuckDB…");
const t0 = Date.now();

const fileList = csvFiles.map((f) => `'${f.replace(/'/g, "''")}'`).join(", ");

await run(`
  CREATE TABLE arcep_raw AS
  SELECT *
  FROM read_csv_auto([${fileList}], union_by_name=true, ignore_errors=true);
`);

const cols = await all(`SELECT column_name FROM information_schema.columns WHERE table_name = 'arcep_raw';`);
const colNames = cols.map((c) => c.column_name.toLowerCase());

const pickCol = (...candidates) => {
  for (const c of candidates) {
    const found = colNames.find((n) => n === c.toLowerCase() || n.includes(c.toLowerCase()));
    if (found) return found;
  }
  return null;
};

const latCol = pickCol("coord_lat", "latitude", "lat");
const lngCol = pickCol("coord_lon", "longitude", "lng", "lon");
const statusCol = pickCol("statut_immeuble", "statut_deploiement", "etat_immeuble", "statut");
const operatorCol = pickCol("operateur_immeuble", "operateur_principal", "operateur");

if (!latCol || !lngCol) {
  console.error(`Could not find lat/lng columns in CSV. Available columns:\n${colNames.join(", ")}`);
  process.exit(1);
}

console.log(
  `  lat col   : ${latCol}\n  lng col   : ${lngCol}\n  status col: ${statusCol ?? "(none — assuming all FTTH)"}\n  op col    : ${operatorCol ?? "(none)"}`
);

// We treat any row whose status looks like "raccordable" / "deployé" /
// "mis en service" as FTTH-available. The exact wording varies by
// year, so the LIKE list errs on the inclusive side.
const ftthExpr = statusCol
  ? `LOWER(CAST(${statusCol} AS VARCHAR)) IN
      ('raccordable', 'deployé', 'déployé', 'mis en service', 'service ouvert',
       'point de mutualisation', 'pm installé')
     OR LOWER(CAST(${statusCol} AS VARCHAR)) LIKE '%racc%'
     OR LOWER(CAST(${statusCol} AS VARCHAR)) LIKE '%service%'`
  : "TRUE";

console.log("Aggregating by quadkey z=14…");
const rows = await all(`
  WITH typed AS (
    SELECT
      CAST(${latCol} AS DOUBLE) AS lat,
      CAST(${lngCol} AS DOUBLE) AS lng,
      ${ftthExpr} AS is_ftth,
      ${operatorCol ? `CAST(${operatorCol} AS VARCHAR)` : "NULL"} AS op
    FROM arcep_raw
    WHERE ${latCol} IS NOT NULL AND ${lngCol} IS NOT NULL
  )
  SELECT
    lat,
    lng,
    is_ftth,
    op
  FROM typed;
`);

console.log(`Got ${rows.length.toLocaleString()} rows from CSV. Bucketing in JS…`);

// Bucket into quadkeys client-side (DuckDB doesn't have a native
// quadkey function and pulling the math into SQL adds friction).
const buckets = new Map();
for (const r of rows) {
  if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue;
  const qk = latLngToQuadkey(r.lat, r.lng, 14);
  let b = buckets.get(qk);
  if (!b) {
    b = { ftth: 0, total: 0, opCounts: new Map() };
    buckets.set(qk, b);
  }
  b.total += 1;
  if (r.is_ftth) b.ftth += 1;
  if (r.op) {
    b.opCounts.set(r.op, (b.opCounts.get(r.op) ?? 0) + 1);
  }
}

const tiles = [];
for (const [qk, b] of buckets) {
  let dominant = null;
  let maxCount = 0;
  for (const [op, count] of b.opCounts) {
    if (count > maxCount) {
      dominant = op;
      maxCount = count;
    }
  }
  tiles.push({
    quadkey: qk,
    ftth_locaux: b.ftth,
    total_locaux: b.total,
    dominant_operator: dominant,
  });
}

console.log(
  `Aggregated into ${tiles.length.toLocaleString()} tiles in ${((Date.now() - t0) / 1000).toFixed(1)}s.`
);

// ---------- Insert ----------

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const BATCH = 5000;
let inserted = 0;
const t1 = Date.now();

for (let i = 0; i < tiles.length; i += BATCH) {
  const chunk = tiles.slice(i, i + BATCH);
  const { error } = await supabase
    .from("connectivity_tiles")
    .upsert(chunk, { onConflict: "quadkey" });
  if (error) {
    console.error(`\nBatch ${i}-${i + chunk.length} failed:`, error);
    process.exit(1);
  }
  inserted += chunk.length;
  process.stdout.write(`\rInserted ${inserted.toLocaleString()} / ${tiles.length.toLocaleString()}`);
}

console.log(
  `\n✅ Done in ${((Date.now() - t1) / 1000).toFixed(1)}s. Each spot now has a fibre baseline available via connectivity_tiles.`
);
process.exit(0);

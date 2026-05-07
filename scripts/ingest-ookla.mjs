/**
 * Ingest Ookla Open Data fixed-broadband performance tiles into Supabase
 * speed_tiles. Pulls a quarterly Parquet file straight from Ookla's S3
 * bucket, filters down to a bounding box (default: metropolitan France),
 * and upserts in batches via the service-role key.
 *
 *   npm run import-ookla
 *   OOKLA_QUARTER=2024-Q3 npm run import-ookla
 *   OOKLA_BBOX="-5.5,41,10,52" npm run import-ookla
 *
 * Required env vars (in .env or shell):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   (NEVER VITE_-prefixed, server only)
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import duckdb from "duckdb";

// ---------- Config ----------

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env. Add them to .env (un-prefixed)."
  );
  process.exit(1);
}

// Ookla publishes quarterly. Default to 2024-Q4 (definitely live);
// override via OOKLA_QUARTER=YYYY-QN.
const QUARTER = process.env.OOKLA_QUARTER ?? "2024-Q4";
const m = /^(\d{4})-Q([1-4])$/.exec(QUARTER);
if (!m) {
  console.error(`Bad OOKLA_QUARTER "${QUARTER}". Expected YYYY-QN, e.g. 2024-Q4`);
  process.exit(1);
}
const year = m[1];
const qNum = parseInt(m[2]);
const month = String((qNum - 1) * 3 + 1).padStart(2, "0");
const URL = `https://ookla-open-data.s3.amazonaws.com/parquet/performance/type=fixed/year=${year}/quarter=${qNum}/${year}-${month}-01_performance_fixed_tiles.parquet`;

// Bounding box: lng_min, lat_min, lng_max, lat_max. Default = mainland
// France with a generous margin (covers Corsica too).
const bboxRaw = process.env.OOKLA_BBOX ?? "-5.5,41,10,52";
const [west, south, east, north] = bboxRaw.split(",").map(Number);
if ([west, south, east, north].some((v) => !Number.isFinite(v))) {
  console.error(`Bad OOKLA_BBOX "${bboxRaw}". Expected lng_min,lat_min,lng_max,lat_max`);
  process.exit(1);
}

console.log(`Source : ${URL}`);
console.log(`BBox   : [${west}, ${south}] → [${east}, ${north}]`);

// ---------- Query parquet via DuckDB ----------

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

console.log("Loading DuckDB extensions (httpfs, spatial)…");
await run("INSTALL httpfs; LOAD httpfs;");
await run("INSTALL spatial; LOAD spatial;");

console.log("Streaming parquet from S3 and filtering to bbox… (~1–2 min)");
const t0 = Date.now();
const rows = await all(`
  SELECT
    quadkey,
    CAST(avg_d_kbps AS DOUBLE) AS avg_d_kbps,
    CAST(avg_u_kbps AS DOUBLE) AS avg_u_kbps,
    CAST(avg_lat_ms AS DOUBLE) AS avg_lat_ms,
    CAST(tests       AS INTEGER) AS tests,
    CAST(devices     AS INTEGER) AS devices
  FROM read_parquet('${URL}')
  WHERE ST_Intersects(
    ST_GeomFromText(tile),
    ST_MakeEnvelope(${west}, ${south}, ${east}, ${north})
  )
`);
console.log(
  `Got ${rows.length.toLocaleString()} tiles in ${((Date.now() - t0) / 1000).toFixed(1)}s.`
);

if (rows.length === 0) {
  console.log("Nothing to insert. Done.");
  process.exit(0);
}

// ---------- Insert into Supabase ----------

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const BATCH = 5000;
let inserted = 0;
const t1 = Date.now();

for (let i = 0; i < rows.length; i += BATCH) {
  const chunk = rows.slice(i, i + BATCH);
  const { error } = await supabase
    .from("speed_tiles")
    .upsert(chunk, { onConflict: "quadkey" });
  if (error) {
    console.error(`\nBatch ${i}-${i + chunk.length} failed:`, error);
    process.exit(1);
  }
  inserted += chunk.length;
  process.stdout.write(`\rInserted ${inserted.toLocaleString()} / ${rows.length.toLocaleString()}`);
}

console.log(
  `\n✅ Done in ${((Date.now() - t1) / 1000).toFixed(1)}s. Refresh Fiberspot — every untested spot now has an Ookla estimate.`
);
process.exit(0);

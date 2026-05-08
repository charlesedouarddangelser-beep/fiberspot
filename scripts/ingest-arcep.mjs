/**
 * Ingest Arcep FTTH per-commune coverage into connectivity_communes.
 *
 * Source: Arcep "Relevé géographique des déploiements FttH"
 *   https://www.data.gouv.fr/datasets/le-marche-du-haut-et-tres-haut-debit-fixe-deploiements/
 *
 * The CSV is ~6.3 MB, ~35k rows (one per French commune), with semicolon
 * delimiters and French decimals. We parse it with DuckDB, normalise
 * the numeric columns, and upsert into Supabase via the service-role
 * key.
 *
 * Usage:
 *   npm run import-arcep -- /path/to/releve-geographique-donnees-2026-03.csv
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import duckdb from "duckdb";
import { resolve } from "node:path";
import { existsSync, statSync } from "node:fs";

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
  console.error("Usage: npm run import-arcep -- <path-to-csv>");
  process.exit(1);
}

const inputPath = resolve(inputArg);
if (!existsSync(inputPath) || !statSync(inputPath).isFile()) {
  console.error(`File not found: ${inputPath}`);
  process.exit(1);
}

console.log(`Reading ${inputPath}…`);

const db = new duckdb.Database(":memory:");
const conn = db.connect();
const all = (sql) =>
  new Promise((resolve, reject) => {
    conn.all(sql, (err, rows) => (err ? reject(err) : resolve(rows)));
  });

// Arcep CSV uses ';' delimiters and ',' decimal separators (French
// convention). DuckDB handles both with the right options.
const sql = `
  SELECT
    CAST(INSEE_COM AS VARCHAR)                                    AS insee_com,
    CAST(commune AS VARCHAR)                                      AS commune_name,
    CAST(INSEE_DEP AS VARCHAR)                                    AS insee_dep,
    CAST(INSEE_REG AS VARCHAR)                                    AS insee_reg,
    TRY_CAST(REPLACE(CAST(locaux_commune AS VARCHAR), ',', '.') AS DOUBLE) AS locaux_total,
    TRY_CAST(IPE_commune AS INTEGER)                              AS locaux_ftth,
    TRY_CAST(REPLACE(CAST(taux_depl_commune AS VARCHAR), ',', '.') AS DOUBLE) AS taux_deploiement,
    NULLIF(CAST(oi_majo AS VARCHAR), 'NA')                        AS operateur_majoritaire,
    NULLIF(CAST(zonage AS VARCHAR), 'NA')                         AS zonage
  FROM read_csv_auto(
    '${inputPath.replace(/'/g, "''")}',
    delim=';',
    header=true,
    ignore_errors=true,
    union_by_name=true
  )
  WHERE INSEE_COM IS NOT NULL;
`;

const t0 = Date.now();
const rows = await all(sql);
console.log(
  `Parsed ${rows.length.toLocaleString()} communes in ${((Date.now() - t0) / 1000).toFixed(1)}s.`
);

if (rows.length === 0) {
  console.log("Nothing to insert. Check the CSV format.");
  process.exit(0);
}

// Round locaux_total down — Arcep occasionally reports as decimals
// (rare, but the CSV uses scientific notation like 1,26362000000000e+05).
const cleaned = rows.map((r) => ({
  insee_com: r.insee_com,
  commune_name: r.commune_name,
  insee_dep: r.insee_dep,
  insee_reg: r.insee_reg,
  locaux_total:
    typeof r.locaux_total === "number" && Number.isFinite(r.locaux_total)
      ? Math.round(r.locaux_total)
      : null,
  locaux_ftth:
    typeof r.locaux_ftth === "number" && Number.isFinite(r.locaux_ftth)
      ? r.locaux_ftth
      : null,
  taux_deploiement:
    typeof r.taux_deploiement === "number" && Number.isFinite(r.taux_deploiement)
      ? r.taux_deploiement
      : null,
  operateur_majoritaire: r.operateur_majoritaire,
  zonage: r.zonage,
}));

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const BATCH = 1000;
let inserted = 0;
const t1 = Date.now();

for (let i = 0; i < cleaned.length; i += BATCH) {
  const chunk = cleaned.slice(i, i + BATCH);
  const { error } = await supabase
    .from("connectivity_communes")
    .upsert(chunk, { onConflict: "insee_com" });
  if (error) {
    console.error(`\nBatch ${i}-${i + chunk.length} failed:`, error);
    process.exit(1);
  }
  inserted += chunk.length;
  process.stdout.write(`\rInserted ${inserted.toLocaleString()} / ${cleaned.length.toLocaleString()}`);
}

console.log(
  `\n✅ Done in ${((Date.now() - t1) / 1000).toFixed(1)}s. Spots in France can now show their commune's FTTH coverage.`
);
process.exit(0);

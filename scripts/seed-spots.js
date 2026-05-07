import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://foajexacobpegqwskjvx.supabase.co";
const SUPABASE_KEY = "sb_publishable_aULydIupUZU4JqLON6r-8w_mIfluVqz";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

const CITIES = [
  { name: "London", bbox: "51.28,-0.51,51.69,0.33" },
  { name: "Paris", bbox: "48.81,2.22,48.90,2.47" },
  { name: "Ibiza", bbox: "38.85,1.18,39.05,1.62" },
];

function buildQuery(bbox) {
  return `
[out:json][timeout:60];
(
  node["amenity"="cafe"]["internet_access"="wlan"](${bbox});
  node["amenity"="restaurant"]["internet_access"="wlan"](${bbox});
);
out body;
`;
}

function typeFromTags(tags) {
  if (tags.amenity === "cafe") return "Cafe";
  if (tags.amenity === "restaurant") return "Restaurant";
  return "Other";
}

function buildAddress(tags) {
  const parts = [tags["addr:housenumber"], tags["addr:street"], tags["addr:city"]].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

async function fetchCity(city) {
  const query = buildQuery(city.bbox);
  console.log(`Fetching spots in ${city.name}...`);
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`Overpass error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  console.log(`  Found ${data.elements.length} nodes in ${city.name}`);
  return data.elements;
}

async function main() {
  const allSpots = [];

  for (let ci = 0; ci < CITIES.length; ci++) {
    if (ci > 0) await new Promise((r) => setTimeout(r, 15000));
    const city = CITIES[ci];
    const nodes = await fetchCity(city);
    for (const node of nodes) {
      const name = node.tags?.name;
      if (!name) continue;
      allSpots.push({
        name,
        type: typeFromTags(node.tags),
        address: buildAddress(node.tags),
        lat: node.lat,
        lng: node.lon,
        avg_download: null,
        avg_upload: null,
        avg_ping: null,
        tags: ["wifi"],
      });
    }
  }

  console.log(`\nInserting ${allSpots.length} spots into Supabase...`);

  // Insert in batches of 100
  for (let i = 0; i < allSpots.length; i += 100) {
    const batch = allSpots.slice(i, i + 100);
    const { error } = await supabase.from("spots").insert(batch);
    if (error) {
      console.error(`  Batch ${i}-${i + batch.length} failed:`, error.message);
    } else {
      console.log(`  Inserted batch ${i + 1}-${i + batch.length}`);
    }
  }

  console.log("Done!");
}

main().catch(console.error);

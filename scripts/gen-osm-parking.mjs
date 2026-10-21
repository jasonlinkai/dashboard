// Builds public/data/osm-parking.json: every public car park mapped in OpenStreetMap in Taiwan,
// so the parking search doesn't depend on the (often overloaded) public Overpass servers at
// request time. Re-run now and then:
//   node scripts/gen-osm-parking.mjs            (downloads from Overpass)
//   node scripts/gen-osm-parking.mjs raw.json   (uses a saved Overpass JSON answer)
// Data © OpenStreetMap contributors, ODbL 1.0; the output file stays under the ODbL.

import { readFileSync, writeFileSync } from "node:fs";

const QUERY = '[out:json][timeout:300];area["ISO3166-1"="TW"][admin_level=2]->.a;nwr(area.a)[amenity=parking];out center tags;';
const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

async function download() {
  for (const url of MIRRORS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "User-Agent": "TaiwanDashboard/1.0 (+https://dashboard.jasonlinkai.workers.dev)" },
        body: new URLSearchParams({ data: QUERY }),
        signal: AbortSignal.timeout(330_000),
      });
      if (res.ok) return await res.json();
      console.error(url, res.status);
    } catch (e) {
      console.error(url, e.message);
    }
  }
  throw new Error("all Overpass mirrors failed; try again later");
}

const raw = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], "utf8")) : await download();

const KINDS = ["", "underground", "surface", "multi-storey", "rooftop", "street_side", "lane", "carports"];
const lots = [];
for (const el of raw.elements ?? []) {
  const t = el.tags ?? {};
  if (["private", "no", "permit", "delivery"].includes(t.access)) continue; // not for the public
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (typeof lat !== "number" || typeof lon !== "number") continue;
  const addr = [t["addr:city"], t["addr:district"], t["addr:street"], t["addr:housenumber"] && `${t["addr:housenumber"]}號`]
    .filter(Boolean)
    .join("")
    .replace(/號號$/, "號");
  // Compact rows: [lat, lon, name, kind, capacity, fee, customersOnly, osmId, address, hours, operator, charge]
  lots.push([
    Math.round(lat * 1e5) / 1e5,
    Math.round(lon * 1e5) / 1e5,
    t.name ?? t["name:zh"] ?? "",
    Math.max(0, KINDS.indexOf(t.parking ?? "")),
    Number(t.capacity) > 0 ? Number(t.capacity) : 0,
    t.fee === "yes" ? 1 : t.fee === "no" ? 2 : 0,
    t.access === "customers" ? 1 : 0,
    `${el.type[0]}${el.id}`,
    addr,
    t.opening_hours ?? "",
    t.operator ?? "",
    t.charge ?? "",
  ]);
}
// Sorted by latitude so the server can binary-search the band around a point.
lots.sort((a, b) => a[0] - b[0]);
const out = {
  source: "© OpenStreetMap contributors, ODbL 1.0",
  osmTime: raw.osm3s?.timestamp_osm_base ?? null,
  kinds: KINDS,
  lots,
};
writeFileSync(new URL("../public/data/osm-parking.json", import.meta.url), JSON.stringify(out));
console.log(`${lots.length} car parks, OSM data as of ${out.osmTime}`);

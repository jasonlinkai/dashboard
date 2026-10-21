// Car parks TDX doesn't have: New Taipei's own open data (TDX has no New Taipei car park list),
// and OpenStreetMap everywhere (locations only: no live spaces, rarely a rate).

import { cached } from "./util";

export interface ExtraLot {
  id: string;
  name: string;
  lat: number;
  lon: number;
  address: string;
  fare: string;
  desc: string;
  /** Total car spaces, when known. */
  total: number | null;
  note?: string;
}

// ---------- New Taipei (data.ntpc.gov.tw, 政府資料開放授權條款) ----------

const NTPC = "https://data.ntpc.gov.tw/api/datasets";
const NTPC_LOTS = "B1464EF0-9C7C-4A6F-ABF7-6BDF32847E68"; // 新北市路外公共停車場資訊
const NTPC_LIVE = "e09b35a5-a738-48cc-b0f5-570b67ad9c78"; // 新北市公有路外停車場即時賸餘車位數 (every 3 min)

async function ntpcAll(dataset: string): Promise<any[]> {
  const all: any[] = [];
  for (let page = 0; page < 10; page++) {
    const res = await fetch(`${NTPC}/${dataset}/json?page=${page}&size=1000`);
    if (!res.ok) throw new Error(`新北市開放資料 ${res.status}`);
    const rows = (await res.json()) as any[];
    if (!Array.isArray(rows)) throw new Error("新北市開放資料格式錯誤");
    all.push(...rows);
    if (rows.length < 1000) break;
  }
  return all;
}

/** TWD97 / TM2 zone 121 (EPSG:3826, what Taiwan's agencies publish) → WGS84 latitude/longitude. */
export function twd97ToWgs84(x: number, y: number): { lat: number; lon: number } {
  const a = 6378137;
  const f = 1 / 298.257222101;
  const b = a * (1 - f);
  const e2 = (a * a - b * b) / (a * a);
  const ep2 = e2 / (1 - e2);
  const k0 = 0.9999;
  const lon0 = (121 * Math.PI) / 180;
  x -= 250000;
  const mu = y / k0 / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const fp =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const C1 = ep2 * Math.cos(fp) ** 2;
  const T1 = Math.tan(fp) ** 2;
  const R1 = (a * (1 - e2)) / (1 - e2 * Math.sin(fp) ** 2) ** 1.5;
  const N1 = a / Math.sqrt(1 - e2 * Math.sin(fp) ** 2);
  const D = x / (N1 * k0);
  const lat =
    fp -
    ((N1 * Math.tan(fp)) / R1) *
      (D ** 2 / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * ep2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * ep2 - 3 * C1 ** 2) * D ** 6) / 720);
  const lon =
    lon0 + (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * ep2 + 24 * T1 ** 2) * D ** 5) / 120) / Math.cos(fp);
  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
}

/** New Taipei's car parks; the list changes rarely, so once a day. */
export function ntpcLots(): Promise<ExtraLot[]> {
  return cached("ntpc-lots", 86400, async () =>
    (await ntpcAll(NTPC_LOTS)).flatMap((r): ExtraLot[] => {
      const x = Number(r.TW97X);
      const y = Number(r.TW97Y);
      if (!(x > 100000 && y > 2000000)) return [];
      const { lat, lon } = twd97ToWgs84(x, y);
      const area = String(r.AREA ?? "").trim();
      let address = String(r.ADDRESS ?? "").trim();
      if (address && !address.startsWith("新北市")) address = `新北市${address.startsWith(area) ? "" : area}${address}`;
      const total = Number(r.TOTALCAR);
      const hours = String(r.SERVICETIME ?? "").trim();
      return [
        {
          id: `NTPC:${r.ID}`,
          name: String(r.NAME ?? "").trim() || "停車場",
          lat,
          lon,
          address,
          // "小型車計時80元;小型車月租8000元;" → one item per line
          fare: String(r.PAYEX ?? "")
            .split(/[;；]/)
            .map((s) => s.trim())
            .filter(Boolean)
            .join("\n"),
          desc: [String(r.SUMMARY ?? "").trim(), total > 0 ? `小型車 ${total} 格` : "", hours ? `開放時間 ${hours}` : ""]
            .filter(Boolean)
            .join("，"),
          total: total > 0 ? total : null,
        },
      ];
    }),
  );
}

/**
 * Free car spaces by car park id. The dataset has no per-car-park report time, only "updated
 * every 3 minutes", so the time we fetched it is all we can say (the page says so).
 */
export function ntpcLive(): Promise<{ fetchedAt: string; byId: Record<string, number | null> }> {
  return cached("ntpc-live", 180, async () => {
    const byId: Record<string, number | null> = {};
    for (const r of await ntpcAll(NTPC_LIVE)) {
      const n = Number(r.AVAILABLECAR);
      byId[`NTPC:${r.ID}`] = Number.isFinite(n) && n >= 0 ? n : null; // -9 = no live data
    }
    return { fetchedAt: new Date().toISOString(), byId };
  });
}

// ---------- OpenStreetMap (ODbL) ----------

// A snapshot of every public car park in OSM, made by scripts/gen-osm-parking.mjs and served as
// a static asset: the public Overpass servers are often overloaded, and asking them on every
// search would also go against their fair-use policy.
const KIND: Record<string, string> = {
  underground: "地下停車場",
  surface: "平面停車場",
  "multi-storey": "立體停車場",
  rooftop: "屋頂停車場",
  street_side: "路邊停車區",
  lane: "路邊停車格",
  carports: "車棚",
};

type OsmRow = [number, number, string, number, number, number, number, string, string, string, string, string];
interface OsmData {
  osmTime: string | null;
  kinds: string[];
  lots: OsmRow[]; // sorted by latitude
}
let osm: { data: OsmData; loaded: number } | null = null;

async function osmData(assets: Fetcher, origin: string): Promise<OsmData> {
  if (osm && Date.now() - osm.loaded < 86400_000) return osm.data;
  const res = await assets.fetch(new Request(new URL("/data/osm-parking.json", origin)));
  if (!res.ok) throw new Error(`OpenStreetMap 停車場資料 ${res.status}`);
  osm = { data: (await res.json()) as OsmData, loaded: Date.now() };
  return osm.data;
}

/** Car parks in OSM within `radius` metres of a point (rough box; the caller measures exactly). */
export async function osmLots(assets: Fetcher, origin: string, lat: number, lon: number, radius: number): Promise<{ lots: ExtraLot[]; osmTime: string | null }> {
  const data = await osmData(assets, origin);
  const dLat = radius / 111_000 + 0.0005;
  const dLon = dLat / Math.cos((lat * Math.PI) / 180);
  // Binary search the first row at the box's south edge.
  let lo = 0;
  let hi = data.lots.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (data.lots[mid][0] < lat - dLat) lo = mid + 1;
    else hi = mid;
  }
  const lots: ExtraLot[] = [];
  for (let i = lo; i < data.lots.length && data.lots[i][0] <= lat + dLat; i++) {
    const [pLat, pLon, name, kind, cap, fee, customers, id, address, hours, operator, charge] = data.lots[i];
    if (Math.abs(pLon - lon) > dLon) continue;
    lots.push({
      id: `OSM:${id}`,
      name: name.trim() || "停車場（未命名）",
      lat: pLat,
      lon: pLon,
      address,
      fare: fee === 2 ? "免費（OpenStreetMap 標示）" : charge ? `${charge}（OpenStreetMap 標示）` : fee === 1 ? "收費（金額未提供）" : "",
      desc: [KIND[data.kinds[kind]] ?? "", cap ? `約 ${cap} 格` : "", operator ? `經營：${operator}` : "", hours ? `開放時間 ${hours}` : ""]
        .filter(Boolean)
        .join("，"),
      total: cap || null,
      note: customers ? "限顧客使用" : undefined,
    });
  }
  return { lots, osmTime: data.osmTime };
}

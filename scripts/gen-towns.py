# Usage (from the project root, needs CWA_API_KEY in .dev.vars): python3 scripts/gen-towns.py
# Builds src/data/towns.json: every township with a CWA weather station, its CWA town-forecast ID,
# and a representative coordinate (manned station if any, else the mean of automatic stations).
import json, re, urllib.request, statistics
env = dict(l.strip().split("=", 1) for l in open(".dev.vars") if "=" in l and not l.startswith("#"))
def js(url):
    t = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=60).read().decode("utf-8")
    t = t[t.index("=") + 1:].strip().rstrip(";")
    t = re.sub(r"'", '"', t)
    return json.loads(re.sub(r",\s*([\]}])", r"\1", t))
counties = js("https://www.cwa.gov.tw/Data/js/info/Info_County.js")
towns = js("https://www.cwa.gov.tw/Data/js/info/Info_Town.js")
county_order = [c["Name"]["C"] for c in counties]
tid = {}
for c in counties:
    for t in towns.get(c["ID"], []):
        tid[(c["Name"]["C"], t["Name"]["C"])] = t["ID"]
coords = {}
for ds, manned in [("O-A0003-001", True), ("O-A0001-001", False)]:
    d = json.load(urllib.request.urlopen(f"https://opendata.cwa.gov.tw/api/v1/rest/datastore/{ds}?Authorization={env['CWA_API_KEY']}&format=JSON", timeout=60))
    for s in d["records"]["Station"]:
        g = s["GeoInfo"]; key = (g["CountyName"], g["TownName"])
        w = next(c for c in g["Coordinates"] if c["CoordinateName"] == "WGS84")
        coords.setdefault(key, {"manned": [], "auto": []})["manned" if manned else "auto"].append((float(w["StationLatitude"]), float(w["StationLongitude"])))
out, missing = [], []
for (county, town), c in coords.items():
    if (county, town) not in tid: missing.append((county, town)); continue
    pts = c["manned"] or c["auto"]
    out.append({"county": county, "town": town, "townId": tid[(county, town)],
                "latitude": round(statistics.mean(p[0] for p in pts), 4), "longitude": round(statistics.mean(p[1] for p in pts), 4)})
out.sort(key=lambda t: (county_order.index(t["county"]) if t["county"] in county_order else 99, t["townId"]))
json.dump(out, open("src/data/towns.json", "w"), ensure_ascii=False, separators=(",", ":"))
print(len(out), "towns;", len(tid), "in CWA list; no TID for:", missing)
print([t for t in out if t["town"] in ("汐止區", "南港區", "內湖區", "中正區") and t["county"] in ("臺北市", "新北市")])

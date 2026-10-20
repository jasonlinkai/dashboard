# Usage (from the project root, needs CWA_API_KEY in .dev.vars): python3 scripts/gen-towns.py
# Builds src/data/towns.json: every township in Taiwan (all 368), with its CWA town-forecast ID and
# the coordinates CWA itself uses for that township (township forecast datasets F-D0047-001…085).
import json, re, urllib.parse, urllib.request

env = dict(l.strip().split("=", 1) for l in open(".dev.vars") if "=" in l and not l.startswith("#"))


def js(url):
    t = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=60).read().decode("utf-8")
    t = t[t.index("=") + 1:].strip().rstrip(";")
    t = re.sub(r"'", '"', t)
    return json.loads(re.sub(r",\s*([\]}])", r"\1", t))


counties = js("https://www.cwa.gov.tw/Data/js/info/Info_County.js")
towns = js("https://www.cwa.gov.tw/Data/js/info/Info_Town.js")
county_order = [c["Name"]["C"] for c in counties]
tid = {(c["Name"]["C"], t["Name"]["C"]): t["ID"] for c in counties for t in towns.get(c["ID"], [])}

out, missing = [], []
temp = urllib.parse.quote("溫度")
for n in range(1, 87, 4):  # one 3-day township forecast dataset per county
    url = f"https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-{n:03d}?Authorization={env['CWA_API_KEY']}&format=JSON&ElementName={temp}"
    block = json.load(urllib.request.urlopen(url, timeout=60))["records"]["Locations"][0]
    county = block["LocationsName"]
    for loc in block["Location"]:
        key = (county, loc["LocationName"])
        if key not in tid:
            missing.append(key)
            continue
        out.append({"county": county, "town": key[1], "townId": tid[key],
                    "latitude": round(float(loc["Latitude"]), 4), "longitude": round(float(loc["Longitude"]), 4)})

out.sort(key=lambda t: (county_order.index(t["county"]) if t["county"] in county_order else 99, t["townId"]))
json.dump(out, open("src/data/towns.json", "w"), ensure_ascii=False, separators=(",", ":"))
print(len(out), "towns;", len(tid), "in CWA town list; without a forecast ID:", missing)

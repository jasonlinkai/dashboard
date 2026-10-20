// City bus areas TDX covers (its City codes), shared by the Worker and the settings screen.
// Intercity coaches (公路客運) use a different TDX API and aren't included.

export const BUS_CITY_LIST = [
  ["Taipei", "臺北市"],
  ["NewTaipei", "新北市"],
  ["Keelung", "基隆市"],
  ["Taoyuan", "桃園市"],
  ["Hsinchu", "新竹市"],
  ["HsinchuCounty", "新竹縣"],
  ["MiaoliCounty", "苗栗縣"],
  ["Taichung", "臺中市"],
  ["ChanghuaCounty", "彰化縣"],
  ["NantouCounty", "南投縣"],
  ["YunlinCounty", "雲林縣"],
  ["Chiayi", "嘉義市"],
  ["ChiayiCounty", "嘉義縣"],
  ["Tainan", "臺南市"],
  ["Kaohsiung", "高雄市"],
  ["PingtungCounty", "屏東縣"],
  ["YilanCounty", "宜蘭縣"],
  ["HualienCounty", "花蓮縣"],
  ["TaitungCounty", "臺東縣"],
  ["PenghuCounty", "澎湖縣"],
  ["KinmenCounty", "金門縣"],
  ["LienchiangCounty", "連江縣"],
] as const;

export type BusCity = (typeof BUS_CITY_LIST)[number][0];
export const BUS_CITY_NAME = new Map<string, string>(BUS_CITY_LIST);
export const isBusCity = (c: unknown): c is BusCity => typeof c === "string" && BUS_CITY_NAME.has(c);

/** Each city is one more TDX call a minute for the arrivals, so keep it to a few. */
export const MAX_BUS_CITIES = 3;

/** One trip of a route, for picking a stop: direction, where it ends, and its stops in order. */
export interface BusTrip {
  direction: number;
  subRoute: string;
  stops: string[];
}

export interface BusRouteInfo {
  name: string;
  from: string;
  to: string;
}

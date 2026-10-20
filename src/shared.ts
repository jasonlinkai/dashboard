// Types shared by the Worker (API) and the React app.

export interface Quote {
  symbol: string;
  price: number;
  previousClose: number | null;
  marketTime: number; // unix ms of the last trade
  marketOpen: boolean | null; // inside today's regular session per Yahoo; null = unknown
  points: number[]; // intraday closes for the sparkline
}

export interface NewsItem {
  title: string;
  source: string;
  link: string;
  published: number | null; // unix ms
}

/** A result of the market symbol search (settings screen). */
export interface SymbolHit {
  symbol: string;
  name: string;
  /** Where it trades / what it is, e.g. 台灣上市 2317, NASDAQ・股票, 常用. */
  where: string;
}

export interface BusArrival {
  city?: string; // TDX city code (older servers didn't send it)
  route: string;
  routeId: string; // also the 5284 (大台北公車) route page id
  stop: string; // stop name as TDX spells it
  direction: number; // 0 = 去程, 1 = 返程
  headsign: string; // e.g. "往 捷運昆陽站"
  toward: string | null; // set when the config asks for buses heading toward a given stop
  estimateSec: number | null; // seconds until arrival, measured at `asOf`
  asOf: number; // unix ms when TDX computed the estimate; the client counts down from here
  status: string | null; // 尚未發車 / 末班車已過 …; null while the bus is on its way
  lastBus: boolean; // this is the day's last bus
}

export interface BusResponse {
  configured: boolean;
  arrivals: BusArrival[];
  notFound: string[]; // "route:stop" pairs that matched no stop
}

export interface TrainDeparture {
  trainNo: string;
  type: string; // 區間 / 區間快
  departure: string; // HH:mm leaving the boarding station (e.g. 汐科), not where the train starts
  arrival: string; // HH:mm at the destination
  endingStation: string;
  delayMin: number | null; // null = no live data
  cancelled: boolean; // 停駛 per the station live board (RunningStatus 2)
  platform: string | null; // from the live board; null when not listed
}

export interface TrainResponse {
  configured: boolean;
  from: string;
  to: string;
  trains: TrainDeparture[];
  /** 臺鐵 service alerts other than 全線營運正常; null = couldn't be fetched (so unknown). */
  alerts: string[] | null;
}

/** One CWA weather-station observation; -99 style sentinels are mapped to null. */
export interface Observation {
  station: string;
  county: string;
  town: string;
  time: number; // unix ms
  temperature: number | null;
  humidity: number | null;
  weather: string | null;
  high: number | null;
  low: number | null;
}

export interface ObservationResponse {
  configured: boolean;
  observations: Observation[];
}

// ---------- Parking ----------

/** A place from the geocoder (address or landmark). */
export interface GeoHit {
  name: string;
  address: string;
  lat: number;
  lon: number;
}

/** Free / total spaces of one kind; total is null when the source doesn't say. */
export type SpaceCount = { available: number; total: number | null } | null;

export interface ParkingLot {
  id: string;
  city: string; // TDX city code
  name: string;
  lat: number;
  lon: number;
  address: string;
  /** TDX's Description, e.g. 「平面型停車場，小型車20格」 */
  description: string;
  /** The rate exactly as published ("" = not provided). */
  fare: string;
  /** Read from `fare` when its wording is clear; null = can't tell (always show `fare` too). */
  fareEstimate: import("./parking-fare").FareEstimate | null;
  /** Straight-line distance from the search point, metres. */
  distance: number;
  /**
   * ok: the live feed has this car park. none: it isn't in the live feed (no live spaces).
   * unavailable: the live feed couldn't be fetched right now.
   */
  live: "ok" | "none" | "unavailable";
  car: SpaceCount;
  scooter: SpaceCount;
  /** Free spaces with no breakdown by vehicle type. */
  spaces: SpaceCount;
  serviceStatus: number | null;
  /** When the car park reported its count (ISO). */
  liveTime: string | null;
}

export interface ParkingResponse {
  center: { lat: number; lon: number };
  radius: number;
  cities: {
    city: string;
    name: string;
    /** empty: TDX has no car park list for this city (e.g. 新北市 at the time of writing). */
    lots: "ok" | "empty" | "error";
    /** none: TDX has no live spaces for this city at all. */
    live: "ok" | "none" | "error";
    liveTime: string | null;
    error?: string;
  }[];
  lots: ParkingLot[];
}

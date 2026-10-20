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

export interface BusArrival {
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

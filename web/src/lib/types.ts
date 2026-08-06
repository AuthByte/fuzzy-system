export type LogAction =
  | "placed"
  | "broken"
  | "ignited"
  | "exploded"
  | "opened"
  | "killed"
  | "hit"
  | "picked"
  | "dropped"
  | "took"
  | "put";

export type LogEvent = {
  id?: number | string;
  time: string;
  time_ms: number;
  player: string;
  action: LogAction;
  block: string;
  location: { x: number; y: number; z: number };
  dimension: string;
  count?: number;
  states?: Record<string, string | number | boolean>;
  source?: string;
};

export type LogFilters = {
  player?: string;
  action?: string;
  dimension?: string;
  block?: string;
  from?: number;
  to?: number;
  x?: number;
  y?: number;
  z?: number;
  radius?: number;
  limit?: number;
  offset?: number;
};

export type QueryResult = {
  total: number;
  limit: number;
  offset: number;
  items: LogEvent[];
};

export type Stats = {
  total: number;
  placed: number;
  broken: number;
  ignited: number;
  exploded: number;
  opened: number;
  killed: number;
  hit: number;
  picked: number;
  dropped: number;
  took: number;
  put: number;
  players: number;
  topPlayers24h: { player: string; c: number }[];
  activityByHour: { hour: string; count: number }[];
};

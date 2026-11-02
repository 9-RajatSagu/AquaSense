export type Latest = {
  level_pct: number | null;
  distance_cm: number | null;
  water_cm: number | null;
  volume_ml: number | null;
  pump_on: boolean | null;
  locked: boolean | null;
  sensor_ok: boolean | null;
};

export type DeviceSettings = {
  capacity_litres: number;
  low_alert_pct: number;
  offline_after_s: number;
  start_pct: number;
  stop_pct: number;
};

export type Device = {
  device_id: string;
  name: string;
  role: "owner" | "member" | null;
  online: boolean;
  last_seen: string | null;
  latest: Latest;
  settings: DeviceSettings;
};

export type ReadingPoint = { t: string; level_pct: number; pump_on: boolean };

export type DayStat = {
  date: string;
  filled_pct: number;
  consumed_pct: number;
  pump_minutes: number;
};

export type Analytics = {
  days: DayStat[];
  summary: {
    readings: number;
    min_pct: number | null;
    max_pct: number | null;
    avg_pct: number | null;
  };
};

export type EventRow = {
  id: number;
  created_at: string;
  kind: string;
  detail: string | null;
  level_pct: number | null;
};

export type Command = {
  id: number;
  action: "pump_on" | "pump_off";
  status: "pending" | "sent" | "done" | "failed" | "expired";
  note: string | null;
  created_at: string;
  finished_at: string | null;
  mine: boolean;
};

export type Member = {
  user_id: string;
  email: string;
  role: "owner" | "member";
  is_me: boolean;
};

export type Summary = {
  last_fill_started: string | null;
  last_fill_ended: string | null;
  last_low_level: string | null;
  pump_minutes_today: number;
};

export type Latest = {
  level_pct: number | null;
  distance_cm: number | null;
  water_cm: number | null;
  volume_ml: number | null;
  pump_on: boolean | null;
  locked: boolean | null;
};

export type DeviceSettings = {
  capacity_litres: number;
  low_alert_pct: number;
  offline_after_s: number;
};

export type Device = {
  device_id: string;
  name: string;
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

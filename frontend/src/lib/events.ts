export type Tone = "ok" | "warn" | "bad" | "info";

const LABELS: Record<string, string> = {
  pump_started: "Pump started",
  pump_stopped: "Pump stopped",
  pump_locked: "Safety stop",
  sudden_drop: "Sudden level drop",
  low_level: "Low level",
  device_online: "Device online",
};

const TONES: Record<string, Tone> = {
  pump_started: "info",
  pump_stopped: "ok",
  pump_locked: "bad",
  sudden_drop: "bad",
  low_level: "warn",
  device_online: "ok",
};

export function eventLabel(kind: string): string {
  return LABELS[kind] ?? kind.replace(/_/g, " ");
}

export function eventTone(kind: string): Tone {
  return TONES[kind] ?? "info";
}

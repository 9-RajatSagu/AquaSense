import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, errorMessage } from "../lib/api";
import type { Device } from "../lib/types";

type DevicesState = {
  devices: Device[];
  selected: Device | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  select: (id: string) => void;
};

const STORAGE_KEY = "aquasense.device";
const POLL_MS = 5000;

const DevicesContext = createContext<DevicesState | null>(null);

function readStoredId(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function DevicesProvider({ children }: { children: ReactNode }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedId, setSelectedId] = useState(readStoredId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const result = await api<{ devices: Device[] }>("/api/devices");
      setDevices(result.devices);
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Storage can be blocked. The choice then lasts for this visit only.
    }
  }, []);

  const selected = useMemo(
    () => devices.find((d) => d.device_id === selectedId) ?? devices[0] ?? null,
    [devices, selectedId],
  );

  const value = useMemo(
    () => ({ devices, selected, loading, error, refresh, select }),
    [devices, selected, loading, error, refresh, select],
  );

  return <DevicesContext.Provider value={value}>{children}</DevicesContext.Provider>;
}

export function useDevices(): DevicesState {
  const ctx = useContext(DevicesContext);
  if (!ctx) throw new Error("useDevices must be used inside DevicesProvider.");
  return ctx;
}

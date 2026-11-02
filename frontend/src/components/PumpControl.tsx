import { useEffect, useRef, useState } from "react";
import { useDevices } from "./DevicesContext";
import { Notice } from "./Ui";
import { api, errorMessage } from "../lib/api";
import type { Command, Device } from "../lib/types";

type Status = { tone: "info" | "ok" | "warn" | "bad"; text: string };

const FULL_BLOCK_PCT = 97;

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

export default function PumpControl({ device }: { device: Device }) {
  const { refresh } = useDevices();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const { latest, online } = device;
  const running = latest.pump_on === true;
  const locked = latest.locked === true;
  const full = (latest.level_pct ?? 0) >= FULL_BLOCK_PCT;

  let startBlock = "";
  if (!online) startBlock = "The device is offline.";
  else if (latest.sensor_ok === false) startBlock = "The level sensor has an error.";
  else if (locked) startBlock = "The safety lock is on. Press Stop to clear it.";
  else if (running) startBlock = "The pump is already running.";
  else if (full) startBlock = "The tank is already full.";

  let stopBlock = "";
  if (!online) stopBlock = "The device is offline.";
  else if (!running && !locked) stopBlock = "The pump is already off.";

  async function run(action: "pump_on" | "pump_off") {
    const deviceId = encodeURIComponent(device.device_id);
    setBusy(true);
    setStatus({ tone: "info", text: "Sent. Waiting for the device to confirm." });
    try {
      const created = await api<{ command: Command }>(`/api/devices/${deviceId}/commands`, {
        method: "POST",
        body: { action },
      });
      const commandId = created.command.id;
      const deadline = Date.now() + 45000;

      while (alive.current && Date.now() < deadline) {
        await sleep(1500);
        const list = await api<{ commands: Command[] }>(`/api/devices/${deviceId}/commands?limit=5`);
        const found = list.commands.find((c) => c.id === commandId);
        if (!found) continue;

        if (found.status === "done") {
          if (alive.current) {
            setStatus({
              tone: "ok",
              text: action === "pump_on" ? "Confirmed by the device: the pump started." : "Confirmed by the device: the pump stopped.",
            });
          }
          await refresh();
          return;
        }
        if (found.status === "failed") {
          if (alive.current) setStatus({ tone: "bad", text: `The device did not do it. ${found.note ?? ""}`.trim() });
          await refresh();
          return;
        }
        if (found.status === "expired") {
          if (alive.current) setStatus({ tone: "warn", text: "The device did not respond in time. Nothing was changed." });
          return;
        }
      }
      if (alive.current) setStatus({ tone: "warn", text: "No confirmation yet. Check the pump state before you try again." });
    } catch (err) {
      if (alive.current) setStatus({ tone: "bad", text: errorMessage(err) });
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <div className="pump-control">
      <div className="pump-buttons">
        <button type="button" className="btn btn-primary" disabled={busy || startBlock !== ""} onClick={() => void run("pump_on")}>
          Start pump
        </button>
        <button type="button" className="btn btn-danger" disabled={busy || stopBlock !== ""} onClick={() => void run("pump_off")}>
          Stop pump
        </button>
      </div>
      {!busy && (startBlock !== "" || stopBlock !== "") && (
        <p className="muted-text small">
          {startBlock !== "" && <span>Start: {startBlock} </span>}
          {stopBlock !== "" && <span>Stop: {stopBlock}</span>}
        </p>
      )}
      {status && <Notice tone={status.tone}>{status.text}</Notice>}
      <p className="muted-text small">
        Commands go to the device, which checks its own safety rules first. This page shows success only after the device confirms. After Stop,
        automatic filling stays paused for 10 minutes.
      </p>
    </div>
  );
}

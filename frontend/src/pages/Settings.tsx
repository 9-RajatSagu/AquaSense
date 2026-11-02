import { useState, type FormEvent } from "react";
import { useDevices } from "../components/DevicesContext";
import { EmptyState, Notice, PageHeading } from "../components/Ui";
import { api, errorMessage } from "../lib/api";
import { Link } from "../lib/router";
import { supabase } from "../lib/supabase";
import type { Device } from "../lib/types";

function DeviceSettingsForm({ device, onSaved }: { device: Device; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(device.name);
  const [capacity, setCapacity] = useState(String(device.settings.capacity_litres));
  const [low, setLow] = useState(String(device.settings.low_alert_pct));
  const [minutes, setMinutes] = useState(String(Math.round(device.settings.offline_after_s / 60)));
  const [startPct, setStartPct] = useState(String(device.settings.start_pct));
  const [stopPct, setStopPct] = useState(String(device.settings.stop_pct));
  const isOwner = device.role === "owner";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const capacityNum = Number(capacity);
  const lowNum = Number(low);
  const minutesNum = Number(minutes);
  const startNum = Number(startPct);
  const stopNum = Number(stopPct);
  const valid =
    name.trim().length > 0 &&
    name.trim().length <= 40 &&
    capacity !== "" && Number.isFinite(capacityNum) && capacityNum > 0 && capacityNum <= 100000 &&
    low !== "" && Number.isFinite(lowNum) && lowNum >= 0 && lowNum <= 100 &&
    minutes !== "" && Number.isInteger(minutesNum) && minutesNum >= 1 && minutesNum <= 1440 &&
    startPct !== "" && Number.isFinite(startNum) && startNum >= 5 && startNum <= 90 &&
    stopPct !== "" && Number.isFinite(stopNum) && stopNum >= 20 && stopNum <= 100 &&
    startNum + 10 <= stopNum;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || !isOwner) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await api(`/api/devices/${encodeURIComponent(device.device_id)}/settings`, {
        method: "PUT",
        body: {
          name: name.trim(),
          capacity_litres: capacityNum,
          low_alert_pct: lowNum,
          offline_after_s: minutesNum * 60,
          start_pct: startNum,
          stop_pct: stopNum,
        },
      });
      await onSaved();
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel form" onSubmit={save}>
      <div className="panel-heading">
        <div>
          <h2>Device settings</h2>
          <p>{device.device_id}</p>
        </div>
      </div>

      {!isOwner && <Notice tone="info">Only the owner of this device can change its settings.</Notice>}
      <fieldset className="fieldset" disabled={!isOwner}>
      <label className="field">
        <span>Device name</span>
        <input type="text" maxLength={40} value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} required />
      </label>

      <label className="field">
        <span>Tank capacity shown (litres)</span>
        <input type="number" inputMode="decimal" min={1} max={100000} step="any" value={capacity} onChange={(e) => { setCapacity(e.target.value); setSaved(false); }} required />
        <small>
          The level in percent comes from the sensor. This number turns it into litres. For a small demo container you can enter a larger tank,
          for example 600, and the page shows it as a 600 L tank.
        </small>
      </label>

      <label className="field">
        <span>Low level alert (%)</span>
        <input type="number" inputMode="decimal" min={0} max={100} step="any" value={low} onChange={(e) => { setLow(e.target.value); setSaved(false); }} required />
        <small>A low level event is recorded when the level falls below this value.</small>
      </label>

      <label className="field">
        <span>Mark device offline after (minutes)</span>
        <input type="number" inputMode="numeric" min={1} max={1440} step={1} value={minutes} onChange={(e) => { setMinutes(e.target.value); setSaved(false); }} required />
        <small>The device sends data every few seconds. Use at least 2 minutes to avoid false offline states.</small>
      </label>

      <label className="field">
        <span>Start filling at or below (%)</span>
        <input type="number" inputMode="decimal" min={5} max={90} step="any" value={startPct} onChange={(e) => { setStartPct(e.target.value); setSaved(false); }} required />
        <small>The pump starts by itself when the level falls to this value.</small>
      </label>

      <label className="field">
        <span>Stop filling at or above (%)</span>
        <input type="number" inputMode="decimal" min={20} max={100} step="any" value={stopPct} onChange={(e) => { setStopPct(e.target.value); setSaved(false); }} required />
        <small>The pump stops at this value. It must be at least 10% above the start level. The device uses the new values within a few seconds.</small>
      </label>
      </fieldset>

      {error && <Notice tone="bad">{error}</Notice>}
      {saved && <Notice tone="ok">Settings saved.</Notice>}

      <div>
        <button className="btn btn-primary" type="submit" disabled={busy || !valid || !isOwner}>
          {busy ? "Saving" : "Save settings"}
        </button>
      </div>
      <p className="muted-text small">
        The device keeps the last start and stop levels it received, so automatic filling continues if the internet is lost. Tank height and the
        full-level distance are set in the ESP32 sketch.
      </p>
    </form>
  );
}

export default function Settings({ email }: { email: string }) {
  const { selected, loading, refresh } = useDevices();
  const [accountError, setAccountError] = useState("");
  const [busy, setBusy] = useState(false);

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) setAccountError(error.message);
  }

  async function deleteAccount() {
    const ok = window.confirm(
      "Delete your account? Devices that only you use are deleted with all their readings. Other accounts keep any devices they share with you. This cannot be undone.",
    );
    if (!ok) return;
    setBusy(true);
    setAccountError("");
    try {
      await api("/api/account", { method: "DELETE" });
      await supabase.auth.signOut();
    } catch (err) {
      setAccountError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeading eyebrow="Configuration" title="Settings" description="Tank display, alerts and your account." />

      {loading && !selected && <p className="loading">Loading</p>}
      {!loading && !selected && (
        <section className="panel">
          <EmptyState
            title="No device to configure"
            description="Add a device first, then its settings appear here."
            action={<Link to="/devices" className="btn btn-primary">Add a device</Link>}
          />
        </section>
      )}
      {selected && <DeviceSettingsForm key={selected.device_id} device={selected} onSaved={refresh} />}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Account</h2>
            <p>{email}</p>
          </div>
        </div>
        {accountError && <Notice tone="bad">{accountError}</Notice>}
        <div className="button-row">
          <button type="button" className="btn btn-secondary" onClick={() => void signOut()}>
            Sign out
          </button>
          <button type="button" className="btn btn-danger" onClick={() => void deleteAccount()} disabled={busy}>
            {busy ? "Deleting" : "Delete account"}
          </button>
        </div>
        <p className="muted-text small">
          Read how your data is handled in the <Link to="/privacy" className="text-link">Privacy Policy</Link> and the{" "}
          <Link to="/terms" className="text-link">Terms</Link>.
        </p>
      </section>
    </>
  );
}

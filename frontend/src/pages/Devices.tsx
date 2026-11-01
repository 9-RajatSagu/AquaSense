import { useState, type FormEvent } from "react";
import { useDevices } from "../components/DevicesContext";
import { Notice, PageHeading, StatusTag } from "../components/Ui";
import { API_BASE, api, errorMessage } from "../lib/api";
import { timeAgo } from "../lib/format";
import type { Device } from "../lib/types";

type Mode = "new" | "link";

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="copy-field">
      <span className="copy-label">{label}</span>
      <div className="copy-row">
        <code>{value}</code>
        <button type="button" className="btn btn-secondary btn-small" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export default function Devices() {
  const { devices, selected, select, refresh } = useDevices();
  const [mode, setMode] = useState<Mode>("new");
  const [name, setName] = useState("");
  const [linkId, setLinkId] = useState("");
  const [linkKey, setLinkKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ device: Device; key: string } | null>(null);
  const [linked, setLinked] = useState("");

  async function createDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setLinked("");
    try {
      const result = await api<{ device: Device; device_key: string }>("/api/devices", { method: "POST", body: { name: name.trim() } });
      setCreated({ device: result.device, key: result.device_key });
      setName("");
      select(result.device.device_id);
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function linkDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setCreated(null);
    try {
      const result = await api<{ device: Device }>("/api/devices/link", {
        method: "POST",
        body: { device_id: linkId.trim(), device_key: linkKey.trim() },
      });
      setLinked(result.device.name);
      setLinkId("");
      setLinkKey("");
      select(result.device.device_id);
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeDevice(device: Device) {
    const ok = window.confirm(
      `Remove "${device.name}" from your account? Other accounts keep access. If no account uses it, its data is deleted.`,
    );
    if (!ok) return;
    setError("");
    try {
      await api(`/api/devices/${encodeURIComponent(device.device_id)}`, { method: "DELETE" });
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="Hardware"
        title="Devices"
        description="Each ESP32 has its own Device ID and key. Several accounts can watch the same device."
      />

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Your devices</h2>
            <p>{devices.length === 0 ? "None added yet" : `${devices.length} on this account`}</p>
          </div>
        </div>
        {devices.length > 0 && (
          <ul className="device-list">
            {devices.map((device) => (
              <li key={device.device_id}>
                <div className="device-main">
                  <strong>{device.name}</strong>
                  <code>{device.device_id}</code>
                  <span className="muted-text small">Last data: {timeAgo(device.last_seen)}</span>
                </div>
                <StatusTag online={device.online} />
                <div className="device-actions">
                  {selected?.device_id === device.device_id ? (
                    <span className="muted-text small">Showing now</span>
                  ) : (
                    <button type="button" className="btn btn-secondary btn-small" onClick={() => select(device.device_id)}>
                      Show
                    </button>
                  )}
                  <button type="button" className="btn btn-danger btn-small" onClick={() => void removeDevice(device)}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="segmented" role="group" aria-label="Add a device">
          <button type="button" className={mode === "new" ? "is-active" : ""} aria-pressed={mode === "new"} onClick={() => { setMode("new"); setError(""); }}>
            New device
          </button>
          <button type="button" className={mode === "link" ? "is-active" : ""} aria-pressed={mode === "link"} onClick={() => { setMode("link"); setError(""); }}>
            Link existing device
          </button>
        </div>

        {error && <Notice tone="bad">{error}</Notice>}

        {mode === "new" && (
          <form className="form" onSubmit={createDevice}>
            <p className="body-text">
              Creates a Device ID and a secret key for a new ESP32. The key is shown once, so copy both values into the sketch straight away.
            </p>
            <label className="field">
              <span>Device name</span>
              <input type="text" maxLength={40} placeholder="Home tank" value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <div>
              <button className="btn btn-primary" type="submit" disabled={busy || name.trim() === ""}>
                {busy ? "Creating" : "Create device"}
              </button>
            </div>
          </form>
        )}

        {mode === "link" && (
          <form className="form" onSubmit={linkDevice}>
            <p className="body-text">
              Already set up on another account? Enter that device&apos;s ID and key to watch the same tank from this account. Both accounts see the same data.
            </p>
            <label className="field">
              <span>Device ID</span>
              <input type="text" placeholder="AQ-XXXX-XXXX" value={linkId} onChange={(e) => setLinkId(e.target.value)} autoCapitalize="characters" spellCheck={false} required />
            </label>
            <label className="field">
              <span>Device key</span>
              <input type="password" value={linkKey} onChange={(e) => setLinkKey(e.target.value)} autoComplete="off" required />
            </label>
            <div>
              <button className="btn btn-primary" type="submit" disabled={busy || linkId.trim() === "" || linkKey.trim() === ""}>
                {busy ? "Linking" : "Link device"}
              </button>
            </div>
          </form>
        )}

        {linked && <Notice tone="ok">{linked} is now on your account.</Notice>}

        {created && (
          <div className="created">
            <Notice tone="warn">Copy the key now. It is not stored in readable form and cannot be shown again.</Notice>
            <CopyField label="Device ID" value={created.device.device_id} />
            <CopyField label="Device key" value={created.key} />
            <CopyField label="Server address" value={API_BASE} />
            <p className="body-text">
              In the Arduino sketch set <code>DEVICE_ID</code>, <code>DEVICE_KEY</code> and <code>SERVER_URL</code> to these values, upload it,
              and this device shows as online within a few seconds.
            </p>
          </div>
        )}
      </section>
    </>
  );
}

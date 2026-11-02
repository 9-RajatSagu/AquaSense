import { useState, type FormEvent } from "react";
import CopyField from "../components/CopyField";
import { useDevices } from "../components/DevicesContext";
import MembersPanel from "../components/MembersPanel";
import { Notice, PageHeading, StatusTag } from "../components/Ui";
import { API_BASE, api, errorMessage } from "../lib/api";
import { timeAgo } from "../lib/format";
import type { Device } from "../lib/types";

type Mode = "new" | "join";

export default function Devices() {
  const { devices, selected, select, refresh } = useDevices();
  const [mode, setMode] = useState<Mode>("new");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ device: Device; key: string } | null>(null);
  const [joined, setJoined] = useState("");
  const [openPeople, setOpenPeople] = useState("");

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
    setJoined("");
  }

  async function createDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setJoined("");
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

  async function joinDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setCreated(null);
    try {
      const result = await api<{ device: Device }>("/api/invites/redeem", { method: "POST", body: { code: code.trim() } });
      setJoined(result.device.name);
      setCode("");
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
        description="Each ESP32 has its own Device ID and key. Share a tank with other accounts using a one-time invite code."
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
                  <span className="muted-text small">
                    {device.role === "owner" ? "Owner" : "Member"} · Last data: {timeAgo(device.last_seen)}
                  </span>
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
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    aria-expanded={openPeople === device.device_id}
                    onClick={() => setOpenPeople(openPeople === device.device_id ? "" : device.device_id)}
                  >
                    People
                  </button>
                  <button type="button" className="btn btn-danger btn-small" onClick={() => void removeDevice(device)}>
                    Remove
                  </button>
                </div>
                {openPeople === device.device_id && (
                  <div className="device-people">
                    <MembersPanel device={device} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="segmented" role="group" aria-label="Add a device">
          <button type="button" className={mode === "new" ? "is-active" : ""} aria-pressed={mode === "new"} onClick={() => switchMode("new")}>
            New device
          </button>
          <button type="button" className={mode === "join" ? "is-active" : ""} aria-pressed={mode === "join"} onClick={() => switchMode("join")}>
            Join with code
          </button>
        </div>

        {error && <Notice tone="bad">{error}</Notice>}

        {mode === "new" && (
          <form className="form" onSubmit={createDevice}>
            <p className="body-text">
              Creates a Device ID and a secret key for a new ESP32. The key is shown once, so copy both values into the sketch straight away.
              You become the owner of this device.
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

        {mode === "join" && (
          <form className="form" onSubmit={joinDevice}>
            <p className="body-text">
              Ask the owner of a tank for an invite code. It works once and expires after 24 hours. You then see the same tank and can control the
              pump from your own account. The device key is never shared.
            </p>
            <label className="field">
              <span>Invite code</span>
              <input type="text" placeholder="XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" spellCheck={false} autoComplete="off" required />
            </label>
            <div>
              <button className="btn btn-primary" type="submit" disabled={busy || code.trim() === ""}>
                {busy ? "Joining" : "Join device"}
              </button>
            </div>
          </form>
        )}

        {joined && <Notice tone="ok">{joined} is now on your account.</Notice>}

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

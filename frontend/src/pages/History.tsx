import { useEffect, useState } from "react";
import { useDevices } from "../components/DevicesContext";
import { EmptyState, Notice, PageHeading } from "../components/Ui";
import { api, errorMessage } from "../lib/api";
import { eventLabel, eventTone } from "../lib/events";
import { formatDateTime, formatNumber } from "../lib/format";
import type { EventRow } from "../lib/types";

export default function History() {
  const { selected, loading } = useDevices();
  const deviceId = selected?.device_id ?? "";

  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [error, setError] = useState("");
  const [when, setWhen] = useState("");
  const [around, setAround] = useState<string | null>(null);

  useEffect(() => {
    if (!deviceId) return;
    const id: string = deviceId;
    let cancelled = false;

    async function load() {
      const query = around ? `?limit=200&minutes=30&around=${encodeURIComponent(around)}` : "?limit=100";
      try {
        const result = await api<{ events: EventRow[] }>(`/api/devices/${encodeURIComponent(id)}/events${query}`);
        if (!cancelled) {
          setEvents(result.events);
          setError("");
        }
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [deviceId, around]);

  function search() {
    const date = new Date(when);
    if (when === "" || Number.isNaN(date.getTime())) return;
    setEvents(null);
    setAround(date.toISOString());
  }

  function clear() {
    setWhen("");
    setEvents(null);
    setAround(null);
  }

  if (loading && !selected) return <p className="loading">Loading</p>;

  if (!selected) {
    return (
      <>
        <PageHeading eyebrow="System records" title="History" description="Pump sessions, alerts and device events." />
        <section className="panel">
          <EmptyState title="No device selected" description="Add a device on the Devices page to see its events here." />
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeading eyebrow="System records" title="History" description={`Pump sessions, alerts and device events for ${selected.name}.`} />

      <section className="panel">
        <div className="search-row">
          <label className="field">
            <span>Search around a time</span>
            <input type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} />
          </label>
          <div className="search-actions">
            <button type="button" className="btn btn-primary" onClick={search} disabled={when === ""}>
              Search 30 minutes either side
            </button>
            {around && (
              <button type="button" className="btn btn-secondary" onClick={clear}>
                Show latest
              </button>
            )}
          </div>
        </div>

        {error && <Notice tone="bad">{error}</Notice>}
        {events === null && !error && <p className="loading">Loading events</p>}

        {events !== null && events.length === 0 && (
          <EmptyState
            title={around ? "No events in that window" : "No events yet"}
            description={around ? "Try a different time, or show the latest events." : "Pump starts, stops, low levels and sudden drops will be listed here."}
          />
        )}

        {events !== null && events.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Event</th>
                  <th>Details</th>
                  <th className="num">Level</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td className="nowrap">{formatDateTime(event.created_at)}</td>
                    <td className="nowrap">
                      <span className={`marker marker-${eventTone(event.kind)}`} aria-hidden="true" />
                      {eventLabel(event.kind)}
                    </td>
                    <td>{event.detail ?? ""}</td>
                    <td className="num">{event.level_pct !== null ? `${formatNumber(event.level_pct, 0)}%` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

import { useEffect, useState } from "react";
import { useDevices } from "../components/DevicesContext";
import PumpControl from "../components/PumpControl";
import { EmptyState, MetricCard, Notice, PageHeading, StatusTag } from "../components/Ui";
import { api } from "../lib/api";
import { eventLabel, eventTone } from "../lib/events";
import { formatDateTime, formatNumber, levelToLitres, timeAgo } from "../lib/format";
import { Link } from "../lib/router";
import type { EventRow, Summary } from "../lib/types";

export default function Overview() {
  const { selected, loading, error } = useDevices();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const deviceId = selected?.device_id ?? "";

  useEffect(() => {
    if (!deviceId) return;
    const id: string = deviceId;
    let cancelled = false;

    async function load() {
      try {
        const result = await api<{ events: EventRow[] }>(`/api/devices/${encodeURIComponent(id)}/events?limit=5`);
        if (!cancelled) setEvents(result.events);
      } catch {
        // Keep showing the last events if a refresh fails.
      }
      try {
        const offset = -new Date().getTimezoneOffset();
        const info = await api<Summary>(`/api/devices/${encodeURIComponent(id)}/summary?tz_offset_minutes=${offset}`);
        if (!cancelled) setSummary(info);
      } catch {
        // Keep showing the last summary if a refresh fails.
      }
    }

    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [deviceId]);

  if (loading && !selected) return <p className="loading">Loading your devices</p>;

  if (!selected) {
    return (
      <>
        <PageHeading eyebrow="Water monitoring" title="Overview" description="Live level and pump state for your tank." />
        {error && <Notice tone="bad">{error}</Notice>}
        <section className="panel">
          <EmptyState
            title="No device yet"
            description="Add your ESP32 to see its tank level here. You get a Device ID and a key to put in the sketch."
            action={
              <Link to="/devices" className="btn btn-primary">
                Add a device
              </Link>
            }
          />
        </section>
      </>
    );
  }

  const { latest, settings } = selected;
  const level = latest.level_pct;
  const hasData = level !== null;
  const pct = level ?? 0;
  const litres = hasData ? levelToLitres(pct, settings.capacity_litres) : null;
  const isLow = selected.online && hasData && pct < settings.low_alert_pct;

  let pumpText = "Unknown";
  let pumpNote = "No data from the device";
  if (hasData && selected.online) {
    if (latest.locked) {
      pumpText = "Stopped";
      pumpNote = "Safety timer stopped the pump";
    } else if (latest.pump_on) {
      pumpText = "Running";
      pumpNote = "Filling the tank";
    } else {
      pumpText = "Idle";
      pumpNote = "Waiting for a low level";
    }
  } else if (hasData) {
    pumpNote = "Device is offline";
  }

  return (
    <>
      <PageHeading
        eyebrow="Water monitoring"
        title={selected.name}
        description={`Device ${selected.device_id}`}
        aside={<StatusTag online={selected.online} />}
      />

      {!selected.online && (
        <Notice tone="warn">
          {hasData
            ? `No data since ${timeAgo(selected.last_seen)}. Check the power and Wi-Fi of the device. Values below are the last ones received.`
            : "This device has not sent any data yet. Put the Device ID and key in the sketch, upload it and make sure the ESP32 is on Wi-Fi."}
        </Notice>
      )}
      {isLow && <Notice tone="warn">The level is below your alert of {formatNumber(settings.low_alert_pct, 0)}%.</Notice>}

      <section className="metrics-grid">
        <MetricCard label="Water level" value={hasData ? formatNumber(pct, 0) : "--"} unit={hasData ? "%" : ""} note={hasData ? "Of usable tank height" : "Waiting for a reading"} />
        <MetricCard label="Volume" value={litres !== null ? formatNumber(litres, 0) : "--"} unit={litres !== null ? "L" : ""} note={`Of ${formatNumber(settings.capacity_litres, 0)} L capacity`} />
        <MetricCard label="Pump" value={pumpText} note={pumpNote} />
        <MetricCard label="Last update" value={timeAgo(selected.last_seen)} note="From the device" />
      </section>

      <section className="overview-grid">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <h2>Tank</h2>
              <p>Current storage level</p>
            </div>
          </div>
          <div className="tank-content">
            <div className="tank" role="img" aria-label={hasData ? `Tank is ${formatNumber(pct, 0)} percent full` : "No water level data"}>
              <div className={`tank-fill${isLow ? " is-low" : ""}`} style={{ height: `${hasData ? pct : 0}%` }} />
              {[75, 50, 25].map((mark) => (
                <span key={mark} className="tank-mark" style={{ bottom: `${mark}%` }}>
                  {mark}
                </span>
              ))}
            </div>
            <div className="tank-details">
              <div className="detail-row">
                <span>Volume</span>
                <strong>{litres !== null ? `${formatNumber(litres, 0)} L` : "--"}</strong>
              </div>
              <div className="detail-row">
                <span>Water height</span>
                <strong>{latest.water_cm !== null ? `${formatNumber(latest.water_cm)} cm` : "--"}</strong>
              </div>
              <div className="detail-row">
                <span>Sensor to water</span>
                <strong>{latest.distance_cm !== null ? `${formatNumber(latest.distance_cm)} cm` : "--"}</strong>
              </div>
              <div className="detail-row">
                <span>Measured water</span>
                <strong>{latest.volume_ml !== null ? `${formatNumber(latest.volume_ml, 0)} mL` : "--"}</strong>
              </div>
              <div className="detail-row">
                <span>Low level alert</span>
                <strong>{formatNumber(settings.low_alert_pct, 0)}%</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <div>
              <h2>Pump</h2>
              <p>Automatic, with manual control</p>
            </div>
            <span className={`tag ${latest.pump_on && selected.online ? "tag-ok" : "tag-off"}`}>{pumpText}</span>
          </div>
          <p className="body-text">
            The device starts the pump at {formatNumber(settings.start_pct, 0)}% and stops it at {formatNumber(settings.stop_pct, 0)}%. A safety
            timer stops a run that takes too long.
          </p>
          <PumpControl device={selected} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Tank activity</h2>
            <p>From the device records</p>
          </div>
        </div>
        <div className="detail-row">
          <span>Last fill started</span>
          <strong>{summary?.last_fill_started ? formatDateTime(summary.last_fill_started) : "No record yet"}</strong>
        </div>
        <div className="detail-row">
          <span>Last fill finished</span>
          <strong>{summary?.last_fill_ended ? formatDateTime(summary.last_fill_ended) : "No record yet"}</strong>
        </div>
        <div className="detail-row">
          <span>Last time the level was low</span>
          <strong>{summary?.last_low_level ? formatDateTime(summary.last_low_level) : "No record yet"}</strong>
        </div>
        <div className="detail-row">
          <span>Pump running today</span>
          <strong>{summary ? `${formatNumber(summary.pump_minutes_today, 0)} min` : "--"}</strong>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Recent activity</h2>
            <p>Latest events from this device</p>
          </div>
          <Link to="/history" className="text-link">
            View history
          </Link>
        </div>
        {events.length === 0 ? (
          <EmptyState title="No events yet" description="Pump starts, stops, low levels and sudden drops will be listed here." />
        ) : (
          <ul className="event-list">
            {events.map((event) => (
              <li key={event.id}>
                <span className={`marker marker-${eventTone(event.kind)}`} aria-hidden="true" />
                <div>
                  <strong>{eventLabel(event.kind)}</strong>
                  {event.detail && <p>{event.detail}</p>}
                </div>
                <time dateTime={event.created_at}>{formatDateTime(event.created_at)}</time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

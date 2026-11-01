import { useEffect, useMemo, useState } from "react";
import BarChart, { type BarGroup } from "../components/BarChart";
import { useDevices } from "../components/DevicesContext";
import LineChart, { type Band, type ChartPoint } from "../components/LineChart";
import { EmptyState, MetricCard, Notice, PageHeading } from "../components/Ui";
import { api, errorMessage } from "../lib/api";
import { formatClock, formatDateTime, formatDay, formatNumber, levelToLitres, niceCeil } from "../lib/format";
import type { Analytics as AnalyticsData, ReadingPoint } from "../lib/types";

const RANGES = [
  { label: "6 hours", hours: 6 },
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 168 },
];
const DAY_OPTIONS = [7, 14, 30];

export default function Analytics() {
  const { selected, loading } = useDevices();
  const deviceId = selected?.device_id ?? "";
  const capacity = selected?.settings.capacity_litres ?? 0;

  const [hours, setHours] = useState(24);
  const [days, setDays] = useState(7);
  const [readings, setReadings] = useState<ReadingPoint[] | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [readingsError, setReadingsError] = useState("");
  const [analyticsError, setAnalyticsError] = useState("");

  useEffect(() => {
    if (!deviceId) return;
    const id: string = deviceId;
    let cancelled = false;

    async function load() {
      try {
        const result = await api<{ points: ReadingPoint[] }>(`/api/devices/${encodeURIComponent(id)}/readings?hours=${hours}`);
        if (!cancelled) {
          setReadings(result.points);
          setReadingsError("");
        }
      } catch (err) {
        if (!cancelled) setReadingsError(errorMessage(err));
      }
    }

    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [deviceId, hours]);

  useEffect(() => {
    if (!deviceId) return;
    const id: string = deviceId;
    let cancelled = false;
    const offset = -new Date().getTimezoneOffset();

    async function load() {
      try {
        const result = await api<AnalyticsData>(`/api/devices/${encodeURIComponent(id)}/analytics?days=${days}&tz_offset_minutes=${offset}`);
        if (!cancelled) {
          setAnalytics(result);
          setAnalyticsError("");
        }
      } catch (err) {
        if (!cancelled) setAnalyticsError(errorMessage(err));
      }
    }

    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [deviceId, days]);

  const chartPoints = useMemo<ChartPoint[]>(
    () => (readings ?? []).map((r) => ({ x: Date.parse(r.t), y: r.level_pct })),
    [readings],
  );

  const bands = useMemo<Band[]>(() => {
    const out: Band[] = [];
    let start: number | null = null;
    let last = 0;
    for (const r of readings ?? []) {
      const x = Date.parse(r.t);
      if (r.pump_on) {
        if (start === null) start = x;
        last = x;
      } else if (start !== null) {
        out.push({ from: start, to: last });
        start = null;
      }
    }
    if (start !== null) out.push({ from: start, to: last });
    return out;
  }, [readings]);

  const groups = useMemo<BarGroup[]>(
    () =>
      (analytics?.days ?? []).map((d) => ({
        label: formatDay(new Date(`${d.date}T00:00:00`).getTime()),
        values: [levelToLitres(d.filled_pct, capacity), levelToLitres(d.consumed_pct, capacity)],
      })),
    [analytics, capacity],
  );

  if (loading && !selected) return <p className="loading">Loading</p>;

  if (!selected) {
    return (
      <>
        <PageHeading eyebrow="Trends and usage" title="Analytics" description="Water level, filling and estimated usage." />
        <section className="panel">
          <EmptyState title="No device selected" description="Add a device on the Devices page to see its history here." />
        </section>
      </>
    );
  }

  const maxBar = Math.max(0, ...groups.flatMap((g) => g.values));
  const barMax = niceCeil(maxBar);
  const totalFilled = groups.reduce((sum, g) => sum + g.values[0], 0);
  const totalConsumed = groups.reduce((sum, g) => sum + g.values[1], 0);
  const pumpMinutes = (analytics?.days ?? []).reduce((sum, d) => sum + d.pump_minutes, 0);
  const summary = analytics?.summary;
  const liters = (v: number) => `${formatNumber(v, 0)} L`;

  return (
    <>
      <PageHeading eyebrow="Trends and usage" title="Analytics" description={`Level history and estimated usage for ${selected.name}.`} />

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Water level over time</h2>
            <p>Average level per interval</p>
          </div>
          <div className="segmented" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button key={r.hours} type="button" className={hours === r.hours ? "is-active" : ""} aria-pressed={hours === r.hours} onClick={() => setHours(r.hours)}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        {readingsError && <Notice tone="bad">{readingsError}</Notice>}
        {readings === null && !readingsError && <p className="loading">Loading readings</p>}
        {readings !== null && chartPoints.length < 2 && (
          <EmptyState title="Not enough readings yet" description="The chart appears after the device has stored at least two readings in this range." />
        )}
        {chartPoints.length >= 2 && (
          <>
            <LineChart
              points={chartPoints}
              yMin={0}
              yMax={100}
              yTicks={[0, 25, 50, 75, 100]}
              formatY={(v) => `${v}%`}
              formatX={hours <= 24 ? formatClock : formatDay}
              formatTip={(p) => `${formatDateTime(new Date(p.x).toISOString())}: ${formatNumber(p.y, 0)}% (${liters(levelToLitres(p.y, capacity))})`}
              bands={bands}
              label="Water level over time"
            />
            <div className="legend">
              <span>
                <i className="swatch swatch-blue" /> Water level
              </span>
              <span>
                <i className="swatch swatch-band" /> Pump running
              </span>
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Water activity</h2>
            <p>Estimated litres filled and used per day</p>
          </div>
          <div className="segmented" role="group" aria-label="Number of days">
            {DAY_OPTIONS.map((d) => (
              <button key={d} type="button" className={days === d ? "is-active" : ""} aria-pressed={days === d} onClick={() => setDays(d)}>
                {d} days
              </button>
            ))}
          </div>
        </div>
        {analyticsError && <Notice tone="bad">{analyticsError}</Notice>}
        {analytics === null && !analyticsError && <p className="loading">Loading</p>}
        {analytics !== null && maxBar === 0 && (
          <EmptyState title="No filling or usage recorded" description="Daily bars appear after the level has risen or fallen by at least 3% in this period." />
        )}
        {analytics !== null && maxBar > 0 && (
          <>
            <div className="legend">
              <span>
                <i className="swatch swatch-blue" /> Filled
              </span>
              <span>
                <i className="swatch swatch-clay" /> Used
              </span>
            </div>
            <BarChart
              groups={groups}
              colors={["var(--blue)", "var(--clay)"]}
              yMax={barMax}
              yTicks={[0, barMax / 4, barMax / 2, (barMax * 3) / 4, barMax]}
              formatY={(v) => formatNumber(v, barMax < 10 ? 1 : 0)}
              formatTip={(g) => `${g.label}: filled ${liters(g.values[0])}, used ${liters(g.values[1])}`}
              label="Estimated litres filled and used per day"
            />
          </>
        )}
        <p className="muted-text small">
          These are estimates from level changes, scaled to your tank capacity of {formatNumber(capacity, 0)} L. Changes smaller than 3% are ignored
          to filter out ripples on the water surface.
        </p>
      </section>

      <section className="metrics-grid">
        <MetricCard label={`Lowest level (${days} d)`} value={summary?.min_pct != null ? formatNumber(summary.min_pct, 0) : "--"} unit={summary?.min_pct != null ? "%" : ""} note="From stored readings" />
        <MetricCard label={`Average level (${days} d)`} value={summary?.avg_pct != null ? formatNumber(summary.avg_pct, 0) : "--"} unit={summary?.avg_pct != null ? "%" : ""} note="From stored readings" />
        <MetricCard label={`Filled (${days} d)`} value={formatNumber(totalFilled, 0)} unit="L" note="Estimated" />
        <MetricCard label={`Pump run time (${days} d)`} value={formatNumber(pumpMinutes, 0)} unit="min" note={`Used ${formatNumber(totalConsumed, 0)} L`} />
      </section>
    </>
  );
}

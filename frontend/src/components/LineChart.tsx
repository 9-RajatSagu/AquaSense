import { useState, type PointerEvent } from "react";
import { useWidth } from "./useWidth";

export type ChartPoint = { x: number; y: number };
export type Band = { from: number; to: number };

type Props = {
  points: ChartPoint[];
  yMin: number;
  yMax: number;
  yTicks: number[];
  formatY: (value: number) => string;
  formatX: (ms: number) => string;
  formatTip: (point: ChartPoint) => string;
  bands?: Band[];
  height?: number;
  label: string;
};

const M = { l: 44, r: 12, t: 12, b: 28 };

export default function LineChart({ points, yMin, yMax, yTicks, formatY, formatX, formatTip, bands = [], height = 260, label }: Props) {
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<number | null>(null);

  const innerW = width - M.l - M.r;
  const innerH = height - M.t - M.b;
  const xMin = points[0].x;
  const xMax = points[points.length - 1].x > xMin ? points[points.length - 1].x : xMin + 1;

  const sx = (x: number) => M.l + ((x - xMin) / (xMax - xMin)) * innerW;
  const sy = (y: number) => M.t + (1 - (y - yMin) / (yMax - yMin)) * innerH;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(" ");
  const baseY = M.t + innerH;
  const area = `${line} L${sx(points[points.length - 1].x).toFixed(1)} ${baseY} L${sx(points[0].x).toFixed(1)} ${baseY} Z`;

  const tickCount = width < 420 ? 3 : 5;
  const xTicks = Array.from({ length: tickCount }, (_, i) => xMin + ((xMax - xMin) * i) / (tickCount - 1));

  function onMove(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const target = xMin + ((event.clientX - rect.left - M.l) / innerW) * (xMax - xMin);
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dist = Math.abs(points[i].x - target);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    setHover(best);
  }

  const active = hover !== null ? points[hover] : null;
  const activeX = active ? sx(active.x) : 0;

  return (
    <div className="chart" ref={ref}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={label}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={M.l} x2={width - M.r} y1={sy(tick)} y2={sy(tick)} className="chart-grid" />
            <text x={M.l - 8} y={sy(tick) + 4} textAnchor="end" className="chart-text">
              {formatY(tick)}
            </text>
          </g>
        ))}
        {bands.map((band, i) => (
          <rect
            key={i}
            x={sx(band.from)}
            y={M.t}
            width={Math.max(2, sx(band.to) - sx(band.from))}
            height={innerH}
            className="chart-band"
          />
        ))}
        <path d={area} className="chart-area" />
        <path d={line} className="chart-line" />
        {xTicks.map((tick, i) => (
          <text
            key={i}
            x={sx(tick)}
            y={height - 8}
            textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
            className="chart-text"
          >
            {formatX(tick)}
          </text>
        ))}
        {active && (
          <g>
            <line x1={activeX} x2={activeX} y1={M.t} y2={baseY} className="chart-cursor" />
            <circle cx={activeX} cy={sy(active.y)} r="4" className="chart-dot" />
          </g>
        )}
      </svg>
      {active && (
        <div className="chart-tip" style={{ left: activeX, transform: activeX > width / 2 ? "translateX(calc(-100% - 10px))" : "translateX(10px)" }}>
          {formatTip(active)}
        </div>
      )}
    </div>
  );
}

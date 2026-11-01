import { useState, type PointerEvent } from "react";
import { useWidth } from "./useWidth";

export type BarGroup = { label: string; values: number[] };

type Props = {
  groups: BarGroup[];
  colors: string[];
  yMax: number;
  yTicks: number[];
  formatY: (value: number) => string;
  formatTip: (group: BarGroup) => string;
  height?: number;
  label: string;
};

const M = { l: 44, r: 8, t: 12, b: 28 };

export default function BarChart({ groups, colors, yMax, yTicks, formatY, formatTip, height = 240, label }: Props) {
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<number | null>(null);

  const innerW = width - M.l - M.r;
  const innerH = height - M.t - M.b;
  const groupW = innerW / groups.length;
  const seriesCount = colors.length;
  const barW = Math.min(22, (groupW * 0.72) / seriesCount);
  const sy = (y: number) => M.t + (1 - y / yMax) * innerH;
  const labelEvery = Math.max(1, Math.ceil(groups.length / Math.max(1, Math.floor(innerW / 52))));

  function onMove(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const index = Math.floor((event.clientX - rect.left - M.l) / groupW);
    setHover(index >= 0 && index < groups.length ? index : null);
  }

  const active = hover !== null ? groups[hover] : null;
  const activeX = hover !== null ? M.l + groupW * hover + groupW / 2 : 0;

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
        {hover !== null && (
          <rect x={M.l + groupW * hover} y={M.t} width={groupW} height={innerH} className="chart-band" />
        )}
        {groups.map((group, gi) => {
          const cx = M.l + groupW * gi + groupW / 2;
          const start = cx - (barW * seriesCount) / 2;
          return (
            <g key={gi}>
              {group.values.map((value, si) => {
                const h = Math.max(0, (value / yMax) * innerH);
                return (
                  <rect
                    key={si}
                    x={start + barW * si}
                    y={M.t + innerH - h}
                    width={Math.max(1, barW - 2)}
                    height={h}
                    fill={colors[si]}
                  />
                );
              })}
              {gi % labelEvery === 0 && (
                <text x={cx} y={height - 8} textAnchor="middle" className="chart-text">
                  {group.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {active && (
        <div className="chart-tip" style={{ left: activeX, transform: activeX > width / 2 ? "translateX(calc(-100% - 10px))" : "translateX(10px)" }}>
          {formatTip(active)}
        </div>
      )}
    </div>
  );
}

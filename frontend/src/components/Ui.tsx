import type { ReactNode } from "react";

export function PageHeading({ eyebrow, title, description, aside }: { eyebrow: string; title: string; description: string; aside?: ReactNode }) {
  return (
    <section className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {aside}
    </section>
  );
}

export function MetricCard({ label, value, unit, note }: { label: string; value: string; unit?: string; note: string }) {
  return (
    <article className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">
        {value}
        {unit && <span>{unit}</span>}
      </div>
      <div className="metric-note">{note}</div>
    </article>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-state-line" />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "bad" | "ok"; children: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === "bad" ? "alert" : undefined}>
      {children}
    </div>
  );
}

export function StatusTag({ online }: { online: boolean }) {
  return (
    <span className={`tag ${online ? "tag-ok" : "tag-off"}`}>
      <span className="tag-dot" aria-hidden="true" />
      {online ? "Online" : "Offline"}
    </span>
  );
}

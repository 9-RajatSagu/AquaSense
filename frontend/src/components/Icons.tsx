import type { ReactNode } from "react";

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function IconOverview() {
  return (
    <Svg>
      <rect x="3" y="3" width="7.5" height="7.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" />
    </Svg>
  );
}

export function IconAnalytics() {
  return (
    <Svg>
      <path d="M3 3v18h18" />
      <path d="M7 15l4-4 3 3 5-6" />
    </Svg>
  );
}

export function IconHistory() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  );
}

export function IconDevices() {
  return (
    <Svg>
      <rect x="6" y="6" width="12" height="12" />
      <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
    </Svg>
  );
}

export function IconSettings() {
  return (
    <Svg>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </Svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="10" fill="#014BAA" />
      <path d="M32 12c0 0-14 15.5-14 26a14 14 0 0 0 28 0C46 27.5 32 12 32 12z" fill="#F8F3F0" />
      <path d="M24.5 38.5a7.5 7.5 0 0 0 7 7" fill="none" stroke="#014BAA" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

import { useState } from "react";

export default function CopyField({ label, value }: { label: string; value: string }) {
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

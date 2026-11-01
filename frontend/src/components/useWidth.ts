import { useEffect, useRef, useState } from "react";

export function useWidth(min = 240) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next) setWidth(Math.max(min, Math.floor(next)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [min]);

  return { ref, width };
}

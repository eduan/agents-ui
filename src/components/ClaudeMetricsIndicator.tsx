import React, { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { buildClaudeMetricsDisplay, type ClaudeMetrics } from "../claudeMetrics";

const CLAUDE_METRICS_REFRESH_MS = 3_000;

function sameMetrics(a: ClaudeMetrics | null, b: ClaudeMetrics | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (Object.keys(a) as (keyof ClaudeMetrics)[]).every((key) => a[key] === b[key]);
}

export const ClaudeMetricsIndicator = React.memo(function ClaudeMetricsIndicator(props: {
  hydrated: boolean;
  terminalId: string | null;
}) {
  const { hydrated, terminalId } = props;
  const [metrics, setMetrics] = useState<ClaudeMetrics | null>(null);

  useEffect(() => {
    setMetrics(null);
    if (!hydrated || !terminalId) return;

    let cancelled = false;
    let inFlight = false;
    let interval: number | null = null;

    const refresh = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const next = await invoke<ClaudeMetrics | null>("claude_session_metrics", { terminalId });
        if (!cancelled) setMetrics((prev) => (sameMetrics(prev, next) ? prev : next));
      } catch {
        if (!cancelled) setMetrics(null);
      } finally {
        inFlight = false;
      }
    };

    // Same App Nap rule as the system health poll: only while visible.
    const startPolling = () => {
      if (interval !== null) return;
      void refresh();
      interval = window.setInterval(() => void refresh(), CLAUDE_METRICS_REFRESH_MS);
    };
    const stopPolling = () => {
      if (interval !== null) {
        window.clearInterval(interval);
        interval = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") startPolling();
      else stopPolling();
    };

    if (document.visibilityState === "visible") startPolling();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hydrated, terminalId]);

  const items = useMemo(() => buildClaudeMetricsDisplay(metrics), [metrics]);
  if (items.length === 0) return null;
  return (
    <span className="systemHealthStats claudeMetricsStats" aria-label="Claude session metrics">
      {items.map((item) => (
        <span key={item.key} className="systemHealthItem" title={item.title}>
          <span className="systemHealthLabel">{item.label}</span>
          <span className={`systemHealthValue${item.key === "status" ? ` claudeStatus-${metrics?.status ?? ""}` : ""}`}>
            {item.value}
          </span>
        </span>
      ))}
    </span>
  );
});

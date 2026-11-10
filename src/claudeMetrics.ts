export type ClaudeMetrics = {
  sessionId: string;
  status: string | null;
  model: string | null;
  contextTokens: number;
  contextWindow: number;
  totalTokens: number;
  turns: number;
  memoryBytes: number | null;
};

export type ClaudeMetricsItem = { key: string; label: string; value: string; title: string };

const STATUS_LABELS: Record<string, string> = { busy: "Working", idle: "Idle" };

function trimZero(value: string): string {
  return value.endsWith(".0") ? value.slice(0, -2) : value;
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${trimZero((tokens / 1_000_000).toFixed(1))}M`;
  if (tokens >= 1_000) return `${trimZero((tokens / 1_000).toFixed(1))}k`;
  return String(tokens);
}

function formatMemory(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${trimZero((mb / 1024).toFixed(1))}G` : `${Math.round(mb)}M`;
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.charAt(0).toUpperCase() + status.slice(1);
}

export function buildClaudeMetricsDisplay(metrics: ClaudeMetrics | null): ClaudeMetricsItem[] {
  if (!metrics) return [];
  const items: ClaudeMetricsItem[] = [];
  if (metrics.status) {
    items.push({ key: "status", label: "CLAUDE", value: statusLabel(metrics.status), title: `Claude session ${metrics.sessionId}` });
  }
  if (metrics.model) {
    items.push({ key: "model", label: "MODEL", value: metrics.model.replace(/^claude-/, ""), title: metrics.model });
  }
  const percent = metrics.contextWindow > 0 ? Math.min(100, Math.round((metrics.contextTokens / metrics.contextWindow) * 100)) : 0;
  items.push({
    key: "context",
    label: "CTX",
    value: `${percent}%`,
    title: `Context: ${metrics.contextTokens.toLocaleString("en-US")} of ${metrics.contextWindow.toLocaleString("en-US")} tokens`,
  });
  items.push({
    key: "tokens",
    label: "TOK",
    value: formatTokenCount(metrics.totalTokens),
    title: `${metrics.totalTokens.toLocaleString("en-US")} tokens this conversation (input + cache writes + output)`,
  });
  if (metrics.memoryBytes != null) {
    items.push({ key: "memory", label: "MEM", value: formatMemory(metrics.memoryBytes), title: "Resident memory of the Claude process" });
  }
  items.push({ key: "turns", label: "TURN", value: String(metrics.turns), title: `${metrics.turns} prompts in this conversation` });
  return items;
}

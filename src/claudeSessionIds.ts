// Terminal session id → id of the Claude Code conversation running in it.
export type ClaudeSessionIds = Readonly<Record<string, string>>;

export function claudeSessionPrefix(sessionId: string): string {
  return sessionId.slice(0, 6);
}

export function sameClaudeSessionIds(a: ClaudeSessionIds, b: ClaudeSessionIds): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

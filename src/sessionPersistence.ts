type SavedSession = { persistId: string; createdAt: number };

// Saved sessions that aren't live yet (still restoring, or failed to restore)
// stay in the state file, so quitting mid-restore or one failed restore
// doesn't drop them for good.
export function withUnrestoredSessions<T extends SavedSession>(live: T[], unrestored: T[]): T[] {
  if (unrestored.length === 0) return live;
  const liveIds = new Set(live.map((session) => session.persistId));
  const pending = unrestored.filter((session) => !liveIds.has(session.persistId));
  if (pending.length === 0) return live;
  return [...live, ...pending].sort((a, b) => a.createdAt - b.createdAt);
}

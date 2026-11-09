export type TerminalGrids = Readonly<Record<string, readonly string[]>>;
export type PersistedGridsV1 = { schemaVersion: 1; grids: Record<string, string[]> };

export const TERMINAL_GRIDS_STORAGE_KEY = "agents-ui-terminal-grids-v1";

const NO_IDS: readonly string[] = [];

export function gridOf(grids: TerminalGrids, projectId: string): readonly string[] {
  return grids[projectId] ?? NO_IDS;
}

export function openInGrid(
  grids: TerminalGrids,
  projectId: string,
  currentId: string,
  sessionId: string,
): TerminalGrids {
  const existing = grids[projectId];
  if (existing) {
    if (existing.includes(sessionId)) return grids;
    return { ...grids, [projectId]: [...existing, sessionId] };
  }
  if (currentId === sessionId) return grids;
  return { ...grids, [projectId]: [currentId, sessionId] };
}

function withMembers(grids: TerminalGrids, keep: (id: string) => boolean): TerminalGrids {
  let changed = false;
  const next: Record<string, readonly string[]> = {};
  for (const [projectId, ids] of Object.entries(grids)) {
    const kept = ids.filter(keep);
    if (kept.length !== ids.length) changed = true;
    if (kept.length >= 2) next[projectId] = kept.length === ids.length ? ids : kept;
    else if (ids.length >= 2 || kept.length !== ids.length) changed = true;
  }
  return changed ? next : grids;
}

export function removeFromGrids(grids: TerminalGrids, sessionId: string): TerminalGrids {
  return withMembers(grids, (id) => id !== sessionId);
}

export function pruneGrids(grids: TerminalGrids, liveIds: ReadonlySet<string>): TerminalGrids {
  return withMembers(grids, (id) => liveIds.has(id));
}

export function closeGrid(grids: TerminalGrids, projectId: string): TerminalGrids {
  if (!(projectId in grids)) return grids;
  const { [projectId]: _closed, ...rest } = grids;
  return rest;
}

export function neighborInGrid(ids: readonly string[], sessionId: string): string | null {
  const index = ids.indexOf(sessionId);
  if (index < 0) return null;
  return ids[index + 1] ?? ids[index - 1] ?? null;
}

export function visibleSessionIds(gridIds: readonly string[], activeId: string | null): readonly string[] {
  if (gridIds.length >= 2) return gridIds;
  return activeId ? [activeId] : NO_IDS;
}

export function cycleInGrid(ids: readonly string[], currentId: string, delta: 1 | -1): string | null {
  if (ids.length === 0) return null;
  const index = ids.indexOf(currentId);
  if (index < 0) return ids[delta === 1 ? 0 : ids.length - 1];
  return ids[(index + delta + ids.length) % ids.length];
}

export function toPersistedGrids(
  grids: TerminalGrids,
  persistIdOf: (id: string) => string | undefined,
): PersistedGridsV1 {
  const out: Record<string, string[]> = {};
  for (const [projectId, ids] of Object.entries(grids)) {
    const mapped = ids.flatMap((id) => persistIdOf(id) ?? []);
    if (mapped.length >= 2) out[projectId] = mapped;
  }
  return { schemaVersion: 1, grids: out };
}

export function fromPersistedGrids(
  stored: PersistedGridsV1,
  idOfPersistId: (pid: string) => string | undefined,
): TerminalGrids {
  const out: Record<string, readonly string[]> = {};
  for (const [projectId, pids] of Object.entries(stored.grids)) {
    const mapped = pids.flatMap((pid) => idOfPersistId(pid) ?? []);
    if (mapped.length >= 2) out[projectId] = mapped;
  }
  return out;
}

export function parseStoredGrids(raw: string | null): PersistedGridsV1 {
  const empty: PersistedGridsV1 = { schemaVersion: 1, grids: {} };
  if (!raw) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (typeof parsed !== "object" || parsed === null) return empty;
  const { schemaVersion, grids } = parsed as { schemaVersion?: unknown; grids?: unknown };
  if (schemaVersion !== 1 || typeof grids !== "object" || grids === null) return empty;
  const out: Record<string, string[]> = {};
  for (const [projectId, ids] of Object.entries(grids)) {
    if (Array.isArray(ids) && ids.every((id) => typeof id === "string")) out[projectId] = ids;
  }
  return { schemaVersion: 1, grids: out };
}

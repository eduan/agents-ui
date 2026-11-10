export const DEFAULT_SIDEBAR_WIDTH = 270;
export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 600;

export function clampSidebarWidth(width: number): number {
  return Math.round(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width)));
}

export function parseStoredSidebarWidth(raw: string | null): number {
  const parsed = Number.parseFloat(raw ?? "");
  return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : DEFAULT_SIDEBAR_WIDTH;
}

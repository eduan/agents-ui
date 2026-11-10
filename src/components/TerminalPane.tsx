import React from "react";
import SessionTerminal, { type PendingDataBuffer, type TerminalRegistry } from "../SessionTerminal";
import { shortenPathSmart } from "../pathDisplay";
import { TerminalSearchBar } from "./TerminalSearchBar";
import { computeGridLayout, type GridCell } from "../gridLayout";

type UiTheme =
  | "dawn"
  | "sepia"
  | "ember"
  | "slate"
  | "midnight"
  | "cobalt"
  | "neon"
  | "forest"
  | "matrix"
  | "synthwave"
  | "quantum";

export type TerminalPaneSession = {
  id: string;
  projectId: string;
  persistent: boolean;
  name: string;
  cwd: string | null;
  color: string | null;
  exited?: boolean;
  closing?: boolean;
  connectionState?: "connected" | "reconnecting" | "disconnected";
};

type TerminalPaneProps = {
  sessions: TerminalPaneSession[];
  activeId: string | null;
  activeProjectId: string;
  uiTheme: UiTheme;
  gridSessionIds: readonly string[];
  onFocusSession: (id: string) => void;
  onRemoveFromGrid: (id: string) => void;
  onCwdChange: (id: string, cwd: string) => void;
  onCommandChange: (id: string, commandLine: string, source?: "osc" | "osc133" | "input") => void;
  onSessionResize: (id: string, size: { cols: number; rows: number }) => void;
  onSessionTransportError: (id: string, operation: "write" | "resize", errorMessage: string) => void;
  registry: React.MutableRefObject<TerminalRegistry>;
  pendingData: React.MutableRefObject<PendingDataBuffer>;
  onRegistryChanged: () => void;
  searchOpenSessions: Set<string>;
  onSearchClose: (sessionId: string) => void;
};

type SessionSearchState = { query: string; caseSensitive: boolean };

const SPLIT_HEADER_HEIGHT = 26;
const GRID_CELL_GAP_PX = 2;
const EMPTY_SEARCH: SessionSearchState = { query: "", caseSensitive: false };

function gridEdge(fraction: number): string {
  return fraction <= 1e-6 ? "0" : `calc(${fraction * 100}% + ${GRID_CELL_GAP_PX}px)`;
}

// All four insets are set explicitly: WebKit doesn't let inline longhands reliably override the stylesheet `inset: 0`.
function gridCellStyle(cell: GridCell): React.CSSProperties {
  return {
    top: gridEdge(cell.top),
    left: gridEdge(cell.left),
    right: gridEdge(1 - cell.left - cell.width),
    bottom: gridEdge(1 - cell.top - cell.height),
    paddingTop: SPLIT_HEADER_HEIGHT,
  };
}

// Focusing the cell refocuses xterm, which would steal focus from these controls.
function isCellControl(target: EventTarget): boolean {
  return target instanceof Element && target.closest(".splitPaneHeaderClose, .terminalSearchBar") !== null;
}

function TerminalPaneImpl({
  sessions,
  activeId,
  activeProjectId,
  uiTheme,
  gridSessionIds,
  onFocusSession,
  onRemoveFromGrid,
  onCwdChange,
  onCommandChange,
  onSessionResize,
  onSessionTransportError,
  registry,
  pendingData,
  onRegistryChanged,
  searchOpenSessions,
  onSearchClose,
}: TerminalPaneProps) {
  const paneRef = React.useRef<HTMLDivElement | null>(null);
  const prevVisibleKeyRef = React.useRef<string | null>(null);
  const [paneSize, setPaneSize] = React.useState({ width: 0, height: 0 });
  const [searchBySession, setSearchBySession] = React.useState<Record<string, SessionSearchState>>({});

  React.useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect;
      if (!rect) return;
      setPaneSize((prev) =>
        prev.width === rect.width && prev.height === rect.height ? prev : { width: rect.width, height: rect.height },
      );
    });
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);

  const visibleId = React.useMemo(() => {
    const activeSession = activeId ? (sessions.find((s) => s.id === activeId) ?? null) : null;
    if (activeSession && activeSession.projectId === activeProjectId) return activeId;

    const fallback =
      sessions.find((s) => s.projectId === activeProjectId && !s.closing)?.id ??
      sessions.find((s) => s.projectId === activeProjectId)?.id ??
      null;
    return fallback;
  }, [activeId, activeProjectId, sessions]);

  const gridIds = React.useMemo(() => {
    if (gridSessionIds.length < 2) return [];
    const mounted = new Set(sessions.map((s) => s.id));
    const ids = gridSessionIds.filter((id) => mounted.has(id));
    return ids.length >= 2 ? ids : [];
  }, [gridSessionIds, sessions]);
  const isGrid = gridIds.length >= 2;

  const visibleIds = React.useMemo<readonly string[]>(
    () => (isGrid ? gridIds : visibleId ? [visibleId] : []),
    [gridIds, isGrid, visibleId],
  );

  const cellStyleById = React.useMemo(() => {
    const out = new Map<string, React.CSSProperties>();
    if (!isGrid) return out;
    const cells = computeGridLayout(visibleIds.length, paneSize.width, paneSize.height);
    visibleIds.forEach((id, index) => out.set(id, gridCellStyle(cells[index])));
    return out;
  }, [isGrid, paneSize.height, paneSize.width, visibleIds]);

  React.useEffect(() => {
    setSearchBySession((prev) => {
      const keys = Object.keys(prev);
      if (keys.every((id) => searchOpenSessions.has(id))) return prev;
      const next: Record<string, SessionSearchState> = {};
      for (const id of keys) if (searchOpenSessions.has(id)) next[id] = prev[id];
      return next;
    });
  }, [searchOpenSessions]);

  const updateSearch = React.useCallback((id: string, patch: Partial<SessionSearchState>) => {
    setSearchBySession((prev) => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY_SEARCH), ...patch } }));
  }, []);

  // Eagerly toggle visibility via direct DOM before React's commit phase.
  React.useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;

    const visibleKey = visibleIds.join("\n");
    if (visibleKey === prevVisibleKeyRef.current) return;
    prevVisibleKeyRef.current = visibleKey;

    const visible = new Set(visibleIds);
    const containers = pane.querySelectorAll<HTMLElement>("[data-session-id]");
    for (const el of containers) {
      const sessionId = el.dataset.sessionId;
      if (!sessionId) continue;
      if (visible.has(sessionId)) {
        el.classList.remove("terminalHidden");
      } else {
        el.classList.add("terminalHidden");
      }
    }
  }, [visibleIds]);

  const focusCell = React.useCallback(
    (id: string, target: EventTarget) => {
      if (id === activeId || isCellControl(target)) return;
      onFocusSession(id);
    },
    [activeId, onFocusSession],
  );

  return (
    <div className="terminalPane" aria-label="Terminal" ref={paneRef}>
      {sessions.map((session) => {
        const isVisible = visibleIds.includes(session.id);
        const cellStyle = cellStyleById.get(session.id);
        const inGrid = cellStyle !== undefined;
        const isFocusedCell = inGrid && session.id === activeId;
        const showSearch = isVisible && searchOpenSessions.has(session.id);
        const searchAddon = showSearch ? registry.current.get(session.id)?.search ?? null : null;
        const search = searchBySession[session.id] ?? EMPTY_SEARCH;
        const className = [
          "terminalContainer",
          isVisible ? "" : "terminalHidden",
          inGrid ? "terminalGridCell" : "",
          isFocusedCell ? "terminalGridCellFocused" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <div
            key={session.id}
            data-session-id={session.id}
            className={className}
            style={cellStyle}
            onPointerDownCapture={inGrid ? (e) => focusCell(session.id, e.target) : undefined}
            onFocusCapture={inGrid ? (e) => focusCell(session.id, e.target) : undefined}
          >
            {inGrid && (
              <div
                className="splitPaneHeader"
                style={session.color ? { "--split-header-color": session.color } as React.CSSProperties : undefined}
              >
                <span className="splitPaneHeaderTitle">{session.name}</span>
                {session.cwd && (
                  <span className="splitPaneHeaderPath">{shortenPathSmart(session.cwd, 40)}</span>
                )}
                <button
                  className="splitPaneHeaderClose"
                  onClick={() => onRemoveFromGrid(session.id)}
                  title="Remove from split"
                >
                  ×
                </button>
              </div>
            )}
            {searchAddon && (
              <TerminalSearchBar
                searchAddon={searchAddon}
                uiTheme={uiTheme}
                query={search.query}
                onQueryChange={(query) => updateSearch(session.id, { query })}
                caseSensitive={search.caseSensitive}
                onCaseSensitiveChange={(caseSensitive) => updateSearch(session.id, { caseSensitive })}
                onClose={() => onSearchClose(session.id)}
                autoFocus={session.id === activeId}
              />
            )}
            <SessionTerminal
              id={session.id}
              uiTheme={uiTheme}
              active={isVisible}
              shouldFocus={session.id === activeId}
              readOnly={Boolean(
                session.exited ||
                  session.closing ||
                  session.connectionState === "reconnecting" ||
                  session.connectionState === "disconnected",
              )}
              persistent={session.persistent}
              onCwdChange={onCwdChange}
              onCommandChange={onCommandChange}
              onResize={onSessionResize}
              onTransportError={onSessionTransportError}
              registry={registry}
              pendingData={pendingData}
              onRegistryChanged={onRegistryChanged}
            />
          </div>
        );
      })}
    </div>
  );
}

export const TerminalPane = React.memo(TerminalPaneImpl);

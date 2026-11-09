# Split grid: unlimited terminals side by side

## Problem
The split view shows at most 2 sessions (`SplitView {aId, bId, direction, ratio}`). The user runs several Claude Code sessions in parallel and wants to watch more of them at once. The current split also gets in the way:
- Clicking any session in the sidebar exits the split.
- Focusing pane B swaps it into the left/top position, because the primary pane is always `activeId`.
- Clicking into a pane doesn't make it the active session, so ⌘-shortcuts and the status bar can target a different session than the one you type into.
- Saved pairs pile up in a sidebar "Split views" list the user doesn't use.

## Decision

### Model
- One **grid** per project: `TerminalGrid { projectId, sessionIds: string[] }`. The order is the order sessions were added.
- The grid is **open** when it has 2 or more sessions. Below that it doesn't exist: the project shows one session as it does today.
- The session with focus in the grid is the app's `activeId`. There is no separate focus field.
- Grids are persisted per project in `localStorage` (`agents-ui-terminal-grids-v1`), so switching projects or restarting the app brings the grid back.
- *(Builder's call)* Members are stored by `persistId`, because runtime `session.id` values are regenerated on every launch. This is the same approach as `agents-ui-active-session-by-project-v1`.
- *(Builder's call)* Members are pruned only after the startup restore has finished. Members not restored yet keep their place, and members that failed to restore are dropped. A grid left with fewer than 2 sessions is then discarded.
- The old `agents-ui-split-views-v1` data is not migrated, and the key is removed on first load.

### Layout
- An automatic grid of equal-sized cells, with no limit on count and no draggable dividers. Columns and rows are derived from the cell count and the pane's aspect ratio:
  - The column count is the one (1…n, rows = ⌈n / cols⌉) whose full-row cell aspect ratio (width ÷ height) is closest to 1.6, compared on a log scale. Ties go to fewer rows.
  - On a 16:9 pane this gives: 2 → side by side, 3 → 2 + 1, 4 → 2×2, 5 or 6 → 3×2.
- When the last row is short, its cells widen to fill the row, so 3 sessions are 2 on top and 1 full-width below.
- Cells keep the existing per-pane header: name, shortened cwd, and ×.
- The focused cell is visibly highlighted.
- Positions never change because of focus. Cells move only when a session is added or removed.

### Interactions
- **Start a grid:** the session context menu shows "Open in split" for any session not shown in the current view. It creates the grid `[current session, clicked session]` and focuses the clicked one. This replaces "Split right" and "Split down".
  - *(Builder's call)* With a grid already open, "Open in split" appends the session, exactly like a sidebar click. Both use the same transition.
- **Add while open:** clicking a session in the sidebar that isn't in the grid appends it and focuses it. Clicking a session that is already in the grid only focuses it.
- **Focus by clicking a cell:** pointerdown or focus inside a cell makes that session `activeId`, so shortcuts, find, the status bar and recording follow the cell you're in.
- **Remove one:** the × in a cell header takes that session out of the grid without closing it. If 1 session remains, the grid closes and that session is shown alone.
- **Close split:** a "Close split" button, shown only while a grid is open, in the top bar next to the project and session title, plus a command palette entry with the same name. It empties the grid and leaves the focused session shown alone. Every session keeps running and stays in the sidebar.
- **Replace all:** the session context menu shows "Open alone" while a grid is open. It empties the grid and shows only the clicked session, which keeps running like the rest.
- **Other projects:** clicking a session of another project switches to that project and shows its own grid, if it has one, with the clicked session focused and added. Grids never mix projects.
- **A session leaving:** when a session closes, exits and gets cleaned up, or moves to another project, it is removed from every grid, with the usual fewer-than-2 rule.
- *(Builder's call)* **Other ways the active session changes, while a grid is open in that project.** One central rule keeps the active session and the visible cells in sync:
  - If the new active session is in the same project but not in the grid (a new session created, `sessions.activate` or `ui.activate_session`, tray recents), it is appended.
  - If it belongs to another project, the project switches, as for a sidebar click.
  - Ctrl+Tab and Ctrl+Shift+Tab (`ui.navigate_session`) cycle focus through the grid's members only.
  - When the focused member closes, focus moves to the neighboring member, never to a non-member.

### Find
- *(Builder's call)* ⌘F opens find in the **focused cell only**, with the query per cell. Escape closes the find bar of the focused cell. The shared two-pane search state goes away.

### Code-level calls
- The grid add, remove, focus and close transitions and the layout computation are pure functions with unit tests (`node --test`, as in `tests/`).
- One helper returns the **visible session IDs**: the grid members when a grid is open, otherwise `[activeId]`. It is used by:
  - output flushing (`flushQueuedOutput` full-flushes visible sessions);
  - exited-session auto-cleanup, which must skip visible sessions.
- The 4 duplicated primary+secondary find blocks (`resolveVisibleTerminalSearchTargets`, the app-menu find, `handleSearchClose`) collapse to "the focused session", per the Find decision.
- `TerminalPane` lays out N visible containers from the layout function. Each grid member is `active` (it fits its own cell), and only `activeId` gets `shouldFocus`.

## Alternatives considered
- **Tmux/iTerm-style manual splits (right/down per pane):** rejected by the user in favor of the automatic grid.
- **A single row of panes:** unusable past 3 or 4 sessions.
- **Keeping saved split views:** the user doesn't use them, and one grid per project covers the need.

## Contracts
- **Removed:** the sidebar "Split views" section; the bridge methods `split_views.list/create/update/close` and their `split_views.*` state events; the `agents-ui-split-views-v1` storage.
- **Changed** *(builder's call)*:
  - `sessions.split {sessionId}` applies the same transition as a sidebar click with a grid open: it switches project if needed, appends the session (or starts the grid with the current session) and focuses it. It returns `{projectId, splitSessionIds}`.
  - `sessions.unsplit {}` closes the active project's grid and returns the same shape.
  - Both emit one event, `split.changed {projectId, sessionIds}`, which replaces `split_views.created/updated/closed`.
  - `ui.state` reports `splitSessionIds: string[]` instead of `activeSplitViewId`.
  - The method lists in `src-tauri/src/api_types.rs` are updated to match.
- **Added:** the `localStorage` key `agents-ui-terminal-grids-v1`.
- **Docs:** README and CHANGELOG sections on split views are rewritten.

## Rollout & risk
- Risk is High: it touches terminal layout and focus, removes bridge methods, and drops stored split views.
- Many visible xterm instances each render live output. There is no hard cap, by the user's choice. If performance suffers with many cells, we revisit it then.
- To roll back, revert the commit. Grids live only in their own `localStorage` key, so a revert leaves `state-v1.json` untouched.

## Acceptance criteria
1. "Open in split" on a session creates a 2-cell grid with the current and the clicked session, and the clicked one has focus.
2. With a grid open, clicking a sidebar session not in it adds a cell, and the layout follows the grid rules (3 → 2+1, 4 → 2×2, 6 → 3×2 on a 16:9 pane).
3. Clicking a sidebar session already in the grid only focuses it. No cell moves.
4. Clicking inside a cell makes it the active session: ⌘F opens find only in that cell and the status bar names it.
5. The × in a cell header removes only that session. With 1 left, the grid closes and the session stays shown.
6. "Close split" returns to the focused session alone, and every former member is still running in the sidebar.
7. "Open alone" from the context menu returns to only the clicked session, and the others are still running in the sidebar.
8. Each project keeps its own grid across project switches and app restarts.
9. Closing, auto-cleaning or moving a session removes it from its grid.
10. The "Split views" sidebar section is gone, and the `split_views.*` bridge methods no longer exist.
11. With a grid open, creating a new session in that project adds it as a cell, and Ctrl+Tab moves focus only between cells.

# Resizable sidebar

## Problem
The sidebar was fixed at 270px, so long session and project names were cut off ("CHK-2322/shopify…"), and people with wide screens couldn't give it more room.

## Decision
- A drag handle on the sidebar's right edge sets its width, between 200px and 600px.
- The width is kept per machine (`localStorage`, `agents-ui-sidebar-width-v1`) and restored on launch. Saved values out of range are clamped, and invalid ones fall back to 270px.
- Double-clicking the handle resets the width to the default (270px).
- The collapsed rail is unchanged and ignores the saved width. Expanding the sidebar again brings the saved width back.
- During a drag the width is written straight to the element, and state is set once on release. Terminals refit through their existing ResizeObserver.

## Alternatives considered
- Reusing the workspace resize state machine (`beginWorkspaceResize`): it is built around the editor, tree and agent panels inside the workspace row. A self-contained pointer handler on the sidebar is smaller and independent.
- Persisting the width in `state-v1.json`: the width is a per-machine view preference, like the collapsed flag, which already lives in `localStorage`.

## Contracts
None. The only addition is the new `localStorage` key `agents-ui-sidebar-width-v1`.

## Rollout & risk
Frontend only. If something goes wrong, delete the key or double-click the handle to get back to 270px. To roll back, revert the commit.

## Acceptance criteria
1. Dragging the right edge resizes the sidebar live, stopping at 200px and 600px.
2. The width survives an app restart.
3. Double-click on the handle returns the sidebar to 270px.
4. A missing, invalid or out-of-range saved width loads as 270px or as the nearest limit.
5. Collapsing and expanding the sidebar keeps the chosen width.

Criteria 3 and 4 are covered by `tests/sidebarWidth.test.ts`. Criteria 1, 2 and 5 are checked by hand in the app.

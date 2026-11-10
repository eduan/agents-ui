export type GridCell = { left: number; top: number; width: number; height: number };

export const GRID_TARGET_CELL_ASPECT = 1.6;

const FALLBACK_WIDTH = 16;
const FALLBACK_HEIGHT = 9;
const TIE_EPSILON = 1e-9;

function bestColumnCount(count: number, paneWidth: number, paneHeight: number): number {
  let bestCols = 1;
  let bestScore = Infinity;
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const aspect = paneWidth / cols / (paneHeight / rows);
    const score = Math.abs(Math.log(aspect / GRID_TARGET_CELL_ASPECT));
    if (score <= bestScore + TIE_EPSILON) {
      bestScore = Math.min(score, bestScore);
      bestCols = cols;
    }
  }
  return bestCols;
}

export function computeGridLayout(count: number, paneWidth: number, paneHeight: number): GridCell[] {
  if (count <= 0) return [];
  const validPane = paneWidth > 0 && paneHeight > 0;
  const w = validPane ? paneWidth : FALLBACK_WIDTH;
  const h = validPane ? paneHeight : FALLBACK_HEIGHT;
  const cols = bestColumnCount(count, w, h);
  const rows = Math.ceil(count / cols);
  const cells: GridCell[] = [];
  for (let r = 0; r < rows; r++) {
    const inRow = r === rows - 1 ? count - cols * (rows - 1) : cols;
    for (let c = 0; c < inRow; c++) {
      cells.push({ left: c / inRow, top: r / rows, width: 1 / inRow, height: 1 / rows });
    }
  }
  return cells;
}

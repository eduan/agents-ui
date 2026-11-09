import { test } from "node:test";
import assert from "node:assert/strict";
import { computeGridLayout } from "../src/gridLayout.ts";
import type { GridCell } from "../src/gridLayout.ts";

const EPS = 1e-9;

function rowsOf(cells: GridCell[]): number[] {
  const counts = new Map<number, number>();
  for (const c of cells) counts.set(c.top, (counts.get(c.top) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n);
}

test("computeGridLayout_TwoOn16by9_SideBySide", () => {
  assert.deepEqual(rowsOf(computeGridLayout(2, 1600, 900)), [2]);
});

test("computeGridLayout_ThreeOn16by9_TwoPlusOneFullWidth", () => {
  const cells = computeGridLayout(3, 1600, 900);
  assert.deepEqual(rowsOf(cells), [2, 1]);
  assert.equal(cells[2].width, 1);
});

test("computeGridLayout_FourOn16by9_TwoByTwo", () => {
  assert.deepEqual(rowsOf(computeGridLayout(4, 1600, 900)), [2, 2]);
});

test("computeGridLayout_FiveOn16by9_ThreePlusTwo", () => {
  const cells = computeGridLayout(5, 1600, 900);
  assert.deepEqual(rowsOf(cells), [3, 2]);
  assert.equal(cells[3].width, 0.5);
  assert.equal(cells[4].width, 0.5);
});

test("computeGridLayout_SixOn16by9_ThreeByTwo", () => {
  assert.deepEqual(rowsOf(computeGridLayout(6, 1600, 900)), [3, 3]);
});

test("computeGridLayout_TwoOnPortrait_Stacked", () => {
  assert.deepEqual(rowsOf(computeGridLayout(2, 800, 1200)), [1, 1]);
});

test("computeGridLayout_AnyCount_CellsTileThePaneExactly", () => {
  for (let n = 1; n <= 12; n++) {
    const cells = computeGridLayout(n, 1600, 900);
    assert.equal(cells.length, n);
    const area = cells.reduce((s, c) => s + c.width * c.height, 0);
    assert.ok(Math.abs(area - 1) < EPS, `n=${n} area=${area}`);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = cells[i];
        const b = cells[j];
        const overlapW = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
        const overlapH = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
        assert.ok(overlapW <= EPS || overlapH <= EPS, `n=${n} cells ${i},${j} overlap`);
      }
    }
  }
});

test("computeGridLayout_ZeroOrOne_SingleFullCellOrNone", () => {
  assert.deepEqual(computeGridLayout(0, 1600, 900), []);
  assert.deepEqual(computeGridLayout(1, 1600, 900), [{ left: 0, top: 0, width: 1, height: 1 }]);
});

test("computeGridLayout_NonPositivePane_TreatedAs16by9", () => {
  assert.deepEqual(rowsOf(computeGridLayout(4, 0, 0)), [2, 2]);
});

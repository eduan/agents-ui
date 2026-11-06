import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  clampSidebarWidth,
  parseStoredSidebarWidth,
} from "../src/sidebarWidth.ts";

test("clampSidebarWidth_WithinRange_KeepsWidthRounded", () => {
  assert.equal(clampSidebarWidth(321.6), 322);
});

test("clampSidebarWidth_BelowMinimum_StopsAtMinimum", () => {
  assert.equal(clampSidebarWidth(MIN_SIDEBAR_WIDTH - 50), MIN_SIDEBAR_WIDTH);
});

test("clampSidebarWidth_AboveMaximum_StopsAtMaximum", () => {
  assert.equal(clampSidebarWidth(MAX_SIDEBAR_WIDTH + 50), MAX_SIDEBAR_WIDTH);
});

test("parseStoredSidebarWidth_SavedWidth_RestoresIt", () => {
  assert.equal(parseStoredSidebarWidth("380"), 380);
});

test("parseStoredSidebarWidth_NothingSavedOrGarbage_UsesDefault", () => {
  for (const raw of [null, "", "wide", "NaN"]) {
    assert.equal(parseStoredSidebarWidth(raw), DEFAULT_SIDEBAR_WIDTH, `raw=${raw}`);
  }
});

test("parseStoredSidebarWidth_SavedOutOfRange_ClampsIt", () => {
  assert.equal(parseStoredSidebarWidth("5000"), MAX_SIDEBAR_WIDTH);
});

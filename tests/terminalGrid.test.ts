import { test } from "node:test";
import assert from "node:assert/strict";
import {
  closeGrid,
  cycleInGrid,
  fromPersistedGrids,
  gridOf,
  neighborInGrid,
  openInGrid,
  parseStoredGrids,
  pruneGrids,
  removeFromGrids,
  toPersistedGrids,
  visibleSessionIds,
} from "../src/terminalGrid.ts";

test("openInGrid_NoGrid_StartsWithCurrentThenClicked", () => {
  assert.deepEqual(gridOf(openInGrid({}, "p", "a", "b"), "p"), ["a", "b"]);
});

test("openInGrid_GridOpen_AppendsAtEnd", () => {
  const result = openInGrid({ p: ["a", "b"] }, "p", "a", "c");
  assert.deepEqual(gridOf(result, "p"), ["a", "b", "c"]);
});

test("openInGrid_SessionAlreadyInGrid_ReturnsSameObject", () => {
  const g = { p: ["a", "b"] };
  assert.equal(openInGrid(g, "p", "a", "b"), g);
});

test("openInGrid_ClickedIsCurrentWithoutGrid_NoGrid", () => {
  assert.deepEqual(openInGrid({}, "p", "a", "a"), {});
});

test("gridOf_NoGrid_ReturnsEmpty", () => {
  assert.deepEqual(gridOf({}, "p"), []);
});

test("removeFromGrids_ThreeMembers_KeepsOthersInOrder", () => {
  const result = removeFromGrids({ p: ["a", "b", "c"] }, "b");
  assert.deepEqual(result, { p: ["a", "c"] });
});

test("removeFromGrids_TwoMembers_DeletesGrid", () => {
  assert.deepEqual(removeFromGrids({ p: ["a", "b"] }, "a"), {});
});

test("removeFromGrids_NotMember_ReturnsSameObject", () => {
  const g = { p: ["a", "b"] };
  assert.equal(removeFromGrids(g, "z"), g);
});

test("closeGrid_OtherProjects_StaysIntact", () => {
  const result = closeGrid({ p: ["a", "b"], q: ["c", "d"] }, "p");
  assert.deepEqual(result, { q: ["c", "d"] });
});

test("closeGrid_NoGrid_ReturnsSameObject", () => {
  const g = { q: ["c", "d"] };
  assert.equal(closeGrid(g, "p"), g);
});

test("neighborInGrid_Middle_ReturnsNext", () => {
  assert.equal(neighborInGrid(["a", "b", "c"], "b"), "c");
});

test("neighborInGrid_Last_ReturnsPrevious", () => {
  assert.equal(neighborInGrid(["a", "b", "c"], "c"), "b");
});

test("neighborInGrid_NotMember_ReturnsNull", () => {
  assert.equal(neighborInGrid(["a", "b"], "z"), null);
});

test("neighborInGrid_OnlyMember_ReturnsNull", () => {
  assert.equal(neighborInGrid(["a"], "a"), null);
});

test("cycleInGrid_Forward_WrapsToFirst", () => {
  assert.equal(cycleInGrid(["a", "b", "c"], "c", 1), "a");
});

test("cycleInGrid_Backward_WrapsToLast", () => {
  assert.equal(cycleInGrid(["a", "b", "c"], "a", -1), "c");
});

test("cycleInGrid_Empty_ReturnsNull", () => {
  assert.equal(cycleInGrid([], "a", 1), null);
});

test("pruneGrids_DeadMembers_RemovedAndSmallGridsDropped", () => {
  const result = pruneGrids(
    { p: ["a", "b", "c"], q: ["d", "e"] },
    new Set(["a", "c", "d"]),
  );
  assert.deepEqual(result, { p: ["a", "c"] });
});

test("pruneGrids_AllLive_ReturnsSameObject", () => {
  const g = { p: ["a", "b"] };
  assert.equal(pruneGrids(g, new Set(["a", "b"])), g);
});

test("persistedGrids_RoundTrip_UsesPersistIds", () => {
  const runtime = { p: ["r1", "r2"] };
  const toPid: Record<string, string> = { r1: "P1", r2: "P2" };
  const toRuntime: Record<string, string> = { P1: "r1", P2: "r2" };

  const stored = toPersistedGrids(runtime, (id) => toPid[id]);

  assert.deepEqual(stored.grids.p, ["P1", "P2"]);
  assert.deepEqual(fromPersistedGrids(stored, (pid) => toRuntime[pid]), runtime);
});

test("toPersistedGrids_MemberWithoutPersistId_LeftOut", () => {
  const stored = toPersistedGrids({ p: ["r1", "r2", "r3"] }, (id) => (id === "r3" ? undefined : id));
  assert.deepEqual(stored.grids.p, ["r1", "r2"]);
});

test("fromPersistedGrids_UnknownPersistIds_LeftOutWithoutThrowing", () => {
  const stored = { schemaVersion: 1 as const, grids: { p: ["P1", "gone"], q: ["P1", "P2", "gone"] } };
  const known: Record<string, string> = { P1: "r1", P2: "r2" };

  const result = fromPersistedGrids(stored, (pid) => known[pid]);

  assert.deepEqual(result, { q: ["r1", "r2"] });
});

test("parseStoredGrids_GarbageOrWrongVersion_ReturnsEmpty", () => {
  const empty = { schemaVersion: 1, grids: {} };
  assert.deepEqual(parseStoredGrids(null), empty);
  assert.deepEqual(parseStoredGrids("x"), empty);
  assert.deepEqual(parseStoredGrids('{"schemaVersion":2,"grids":{}}'), empty);
});

test("parseStoredGrids_ValidPayload_ReturnsGrids", () => {
  const raw = JSON.stringify({ schemaVersion: 1, grids: { p: ["a", "b"], bad: "x", worse: [1, 2] } });
  assert.deepEqual(parseStoredGrids(raw), { schemaVersion: 1, grids: { p: ["a", "b"] } });
});

test("visibleSessionIds_GridOpen_ReturnsMembersInOrder", () => {
  const members = ["a", "b", "c"];
  assert.equal(visibleSessionIds(members, "b"), members);
});

test("visibleSessionIds_NoGrid_ReturnsActiveOnly", () => {
  assert.deepEqual(visibleSessionIds([], "a"), ["a"]);
});

test("visibleSessionIds_NoGridNoActive_ReturnsEmpty", () => {
  assert.deepEqual(visibleSessionIds([], null), []);
});

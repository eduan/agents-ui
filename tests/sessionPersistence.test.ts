import { test } from "node:test";
import assert from "node:assert/strict";
import { withUnrestoredSessions } from "../src/sessionPersistence.ts";

const saved = (persistId: string, createdAt: number) => ({ persistId, createdAt, name: persistId });

test("withUnrestoredSessions_RestartMidRestore_KeepsSessionsNotYetRestored", () => {
  const live = [saved("a", 1)];
  const unrestored = [saved("b", 2), saved("c", 3)];

  const result = withUnrestoredSessions(live, unrestored);

  assert.deepEqual(result.map((s) => s.persistId), ["a", "b", "c"]);
});

test("withUnrestoredSessions_SessionFailedToRestore_StaysInSavedOrder", () => {
  const live = [saved("a", 1), saved("c", 3)];
  const unrestored = [saved("b", 2)];

  const result = withUnrestoredSessions(live, unrestored);

  assert.deepEqual(result.map((s) => s.persistId), ["a", "b", "c"]);
});

test("withUnrestoredSessions_SessionAlreadyLive_PrefersLiveCopy", () => {
  const liveA = { ...saved("a", 1), name: "renamed" };
  const result = withUnrestoredSessions([liveA], [saved("a", 1)]);

  assert.deepEqual(result, [liveA]);
});

test("withUnrestoredSessions_NothingUnrestored_ReturnsLiveListUnchanged", () => {
  const live = [saved("a", 1)];

  assert.equal(withUnrestoredSessions(live, []), live);
});

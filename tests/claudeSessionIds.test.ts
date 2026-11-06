import { test } from "node:test";
import assert from "node:assert/strict";
import { claudeSessionPrefix, sameClaudeSessionIds } from "../src/claudeSessionIds.ts";

test("claudeSessionPrefix_FullSessionId_ShowsFirstSixCharacters", () => {
  assert.equal(claudeSessionPrefix("cfc0ee05-e766-41bf-ab43-893edaacd0e7"), "cfc0ee");
});

test("claudeSessionPrefix_DaemonJobId_ShowsSamePrefixAsItsSession", () => {
  assert.equal(claudeSessionPrefix("d03e89b3"), claudeSessionPrefix("d03e89b3-4ae6-43a8-97d9-7a320a1ad5e9"));
});

test("sameClaudeSessionIds_IdenticalLookups_AreSame", () => {
  assert.equal(sameClaudeSessionIds({ a: "x", b: "y" }, { b: "y", a: "x" }), true);
});

test("sameClaudeSessionIds_ChangedAddedOrRemovedTerminal_AreDifferent", () => {
  assert.equal(sameClaudeSessionIds({ a: "x" }, { a: "z" }), false);
  assert.equal(sameClaudeSessionIds({ a: "x" }, { a: "x", b: "y" }), false);
  assert.equal(sameClaudeSessionIds({ a: "x", b: "y" }, { a: "x" }), false);
});

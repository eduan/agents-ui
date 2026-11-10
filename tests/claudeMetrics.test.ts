import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClaudeMetricsDisplay, formatTokenCount, type ClaudeMetrics } from "../src/claudeMetrics.ts";

const metrics = (overrides: Partial<ClaudeMetrics> = {}): ClaudeMetrics => ({
  sessionId: "cfc0ee05-e766-41bf-ab43-893edaacd0e7",
  status: "busy",
  model: "claude-opus-5-5",
  contextTokens: 437_242,
  contextWindow: 1_000_000,
  totalTokens: 2_003_376,
  turns: 47,
  memoryBytes: 122 * 1024 * 1024,
  ...overrides,
});

const valueOf = (m: ClaudeMetrics, key: string) => buildClaudeMetricsDisplay(m).find((i) => i.key === key)?.value;

test("buildClaudeMetricsDisplay_RunningConversation_ShowsAllItemsInOrder", () => {
  const items = buildClaudeMetricsDisplay(metrics());
  assert.deepEqual(
    items.map((i) => [i.label, i.value]),
    [
      ["CLAUDE", "Working"],
      ["MODEL", "opus-5-5"],
      ["CTX", "44%"],
      ["TOK", "2M"],
      ["MEM", "122M"],
      ["TURN", "47"],
    ],
  );
});

test("buildClaudeMetricsDisplay_StatusValues_MapToLabels", () => {
  assert.equal(valueOf(metrics({ status: "idle" }), "status"), "Idle");
  assert.equal(valueOf(metrics({ status: "waiting" }), "status"), "Waiting");
  assert.equal(valueOf(metrics({ status: null }), "status"), undefined);
});

test("buildClaudeMetricsDisplay_MissingModelOrMemory_SkipsThoseItems", () => {
  const keys = buildClaudeMetricsDisplay(metrics({ model: null, memoryBytes: null })).map((i) => i.key);
  assert.deepEqual(keys, ["status", "context", "tokens", "turns"]);
});

test("buildClaudeMetricsDisplay_NoMetrics_ShowsNothing", () => {
  assert.deepEqual(buildClaudeMetricsDisplay(null), []);
});

test("buildClaudeMetricsDisplay_ContextOverWindow_CapsAt100", () => {
  assert.equal(valueOf(metrics({ contextTokens: 1_200_000 }), "context"), "100%");
});

test("buildClaudeMetricsDisplay_ContextItem_TitleHasExactNumbers", () => {
  const item = buildClaudeMetricsDisplay(metrics()).find((i) => i.key === "context");
  assert.equal(item?.title, "Context: 437,242 of 1,000,000 tokens");
});

test("formatTokenCount_Ranges_UseCompactUnits", () => {
  assert.equal(formatTokenCount(0), "0");
  assert.equal(formatTokenCount(950), "950");
  assert.equal(formatTokenCount(84_213), "84.2k");
  assert.equal(formatTokenCount(120_000), "120k");
  assert.equal(formatTokenCount(1_234_567), "1.2M");
});

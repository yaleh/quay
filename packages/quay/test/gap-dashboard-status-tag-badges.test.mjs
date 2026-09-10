// @test-group product
// gap-dashboard-status-tag-badges — the .tag soft-badge components existed in webui-modernist.css
// but were consumed by zero pages. Wire them onto the two dashboard status words that were bare
// inline color text, and pin the mapping per state:
//   goalCard    fresh → tag-positive, stale → tag-accent, NOT-EVALUATED → tag-neutral
//   fan-in cell landed → tag-positive, red → tag-accent, unknown outcome → tag-neutral,
//               failing step tag → tag-neutral
// Each assertion names the EXACT class for a specific state value (not merely "contains a tag"),
// so a wrong mapping fails rather than passing on the shared `tag ` prefix.
//
// Run (scoped): node --test packages/quay/test/gap-dashboard-status-tag-badges.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderGoalCard } from "../src/serve-dashboard.ts";
import { renderFanInCardFromRecords } from "../src/serve-dashboard.ts";
import { renderFanInCell } from "../src/serve-task.ts";

// ── renderGoalCard fixtures (renderGoalCard reads id/title/status/kind/goal/evidence) ────────────
function goal(id, { title = `${id} title` } = {}) {
  return { id, title, status: "active", kind: "goal", goal: undefined, evidence: undefined, supersedes: [], supersededBy: [], body: "" };
}
function ac(id, goalId, evidence) {
  return { id, title: `${id} title`, status: "achieved", kind: "criterion", goal: goalId, criterion: "exit 0", expect: "", origin: "test", evidence, supersedes: [], supersededBy: [], body: "" };
}

const NOW = Date.parse("2026-09-09T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const STALE_MS = 7 * DAY;

test("AC2 — renderGoalCard maps fresh → tag-positive", () => {
  const html = renderGoalCard(
    [goal("GOAL-001"), ac("AC-1", "GOAL-001", { at: new Date(NOW - DAY).toISOString() })],
    { cap: 3, staleMs: STALE_MS, nowMs: NOW },
  );
  assert.ok(html.includes('<span class="tag tag-positive" style="flex:none">fresh</span>'), `fresh renders tag-positive (got: ${html})`);
});

test("AC2 — renderGoalCard maps stale → tag-accent", () => {
  const html = renderGoalCard(
    [goal("GOAL-001"), ac("AC-1", "GOAL-001", { at: new Date(NOW - 8 * DAY).toISOString() })],
    { cap: 3, staleMs: STALE_MS, nowMs: NOW },
  );
  assert.ok(html.includes('<span class="tag tag-accent" style="flex:none">stale</span>'), `stale renders tag-accent (got: ${html})`);
});

test("AC2 — renderGoalCard maps NOT-EVALUATED → tag-neutral", () => {
  const html = renderGoalCard([goal("GOAL-002")], { cap: 3, staleMs: STALE_MS, nowMs: NOW });
  assert.ok(html.includes('<span class="tag tag-neutral" style="flex:none">NOT-EVALUATED</span>'), `NOT-EVALUATED renders tag-neutral (got: ${html})`);
});

test("AC2 — renderGoalCard no longer emits the bare inline color style for the state word", () => {
  const html = renderGoalCard([goal("GOAL-002")], { cap: 3, staleMs: STALE_MS, nowMs: NOW });
  assert.doesNotMatch(html, /color:var\(--color-(positive|accent|neutral)-[0-9]+\);font-weight:700/, "state word is a class-based badge, not inline color text");
});

// ── renderFanInCell / card fixtures ──────────────────────────────────────────────────────────────
function mfi(outcome, { step = null } = {}) {
  return {
    outcome,
    step,
    reason: null,
    lockHoldSecs: 4,
    lockAcquireEpoch: 100,
    lockReleaseEpoch: 104,
    suiteFinishedEpoch: null,
    suiteOutcome: null,
    suitePid: null,
    landedSha: null,
    fanInLog: null,
  };
}
function rec(task, mechanical_fan_in) {
  return { ts: null, task, mechanical_fan_in };
}

test("AC3 — renderFanInCell maps landed → tag-positive", () => {
  const cell = renderFanInCell("task-1", rec("task-1", mfi("landed")), { showReason: false });
  assert.ok(cell.includes('<span class="tag tag-positive">landed</span>'), `landed cell uses tag-positive (got: ${cell})`);
});

test("AC3 — renderFanInCell maps red → tag-accent and step → tag-neutral", () => {
  const cell = renderFanInCell("task-1", rec("task-1", mfi("red", { step: "suite" })), { showReason: false });
  assert.ok(cell.includes('<span class="tag tag-accent">red</span>'), `red cell uses tag-accent (got: ${cell})`);
  assert.ok(cell.includes('<span class="tag tag-neutral">step suite</span>'), `step tag uses tag-neutral (got: ${cell})`);
});

test("AC3 — renderFanInCell maps unknown outcome → tag-neutral", () => {
  const cell = renderFanInCell("task-1", rec("task-1", mfi("deferred")), { showReason: false });
  assert.ok(cell.includes('<span class="tag tag-neutral">deferred</span>'), `unknown outcome uses tag-neutral (got: ${cell})`);
});

test("AC3 — fan-in card renders landed/red rows with tag-positive/tag-accent", () => {
  const html = renderFanInCardFromRecords(
    [rec("task-land", mfi("landed")), rec("task-red", mfi("red", { step: "suite" }))],
    { hours: 3, nowMs: NOW },
  );
  assert.ok(html.includes('<span class="tag tag-positive">landed</span>'), "card landed row uses tag-positive");
  assert.ok(html.includes('<span class="tag tag-accent">red</span>'), "card red row uses tag-accent");
});

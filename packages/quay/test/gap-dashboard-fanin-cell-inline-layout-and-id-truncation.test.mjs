// @test-group product
// gap-dashboard-fanin-cell-inline-layout-and-id-truncation — fan-in 卡字段改单行内联排版 + 任务 id
//   单行省略号（收窄纵向堆叠）:
//   renderFanInCell（serve-task.ts）默认用 `<br>` 硬换行把每个字段各占一行，dashboard 的 fan-in 概览卡
//   复用该函数后 5 条记录纵向堆到 7-9 行。本任务给 `opts` 加 `layout: "inline"` 开关：inline 时字段用
//   " · " 拼成同一行，默认 "stacked" 保持 /task/<id> Runs 表格现状不变。dashboard 调用点
//   （renderFanInCardFromRecords, serve-dashboard.ts）改传 layout:"inline"，并给任务 id 的 <a> 加
//   overflow:hidden;text-overflow:ellipsis;white-space:nowrap + title（hover 看完整 id）。
//   本测试断言【具体拼接字符串 / 具体样式属性】，而非布尔存在性检查（gap-dashboard-fanin-monospace-ids
//   与 gap-dashboard-status-tag-badges 的先例手法）。
//
// Run (scoped): node --test packages/quay/test/gap-dashboard-fanin-cell-inline-layout-and-id-truncation.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderFanInCell } from "../src/serve-task.ts";
import { renderFanInCardFromRecords } from "../src/serve-dashboard.ts";

/** The exact monospace stack shared with serve-dashboard.ts:1008 / serve-system.ts:140. */
const MONO_STACK = "font-family:ui-monospace,monospace";

/** A minimal WorkerOutcomeRecord whose mechanical_fan_in carries every field the cell renders, so the
 *  inline test can assert the FULL concatenated string (outcome/lock/suite/sha/view·download). */
function fanInRecord(overrides = {}) {
  return {
    ts: null,
    task: "gap-x",
    selector_reason: null,
    exit_code: null,
    signal: null,
    wall_clock_ms: null,
    final_state: null,
    failure_reason: null,
    started_at: null,
    ended_at: null,
    worker_pid: null,
    run_id: null,
    in_flight_count: null,
    timed_out: null,
    session_id: null,
    mechanical_fan_in: {
      outcome: "landed",
      step: null,
      reason: null,
      lockHoldSecs: 332,
      lockAcquireEpoch: 1000,
      lockReleaseEpoch: 1332,
      suiteFinishedEpoch: null,
      suiteOutcome: "done",
      suitePid: null,
      landedSha: "36384f5abcdef0123",
      fanInLog: "fan-in-gap-x-abc.log",
      ...overrides,
    },
  };
}

const PART_LANDED = '<span class="tag tag-positive">landed</span>';
const PART_LOCK = `<span style="${MONO_STACK}">lock 332s</span>`;
const PART_SUITE = "suite done";
const PART_SHA = `<span style="${MONO_STACK}">sha <code>36384f5</code></span>`;
const PART_LINKS =
  '<a href="/fan-in-log/gap-x/fan-in-gap-x-abc.log">view</a> · <a href="/fan-in-log/gap-x/fan-in-gap-x-abc.log/download">download</a>';

test('AC1: layout:"inline" joins every field with " · " and emits no <br> — full concrete string', () => {
  const html = renderFanInCell("gap-x", fanInRecord(), { showReason: false, layout: "inline" });
  const expected = [PART_LANDED, PART_LOCK, PART_SUITE, PART_SHA, PART_LINKS].join(" · ");
  assert.equal(html, expected, `inline cell must be the exact " · "-joined string, got: ${html}`);
  assert.ok(!html.includes("<br>"), `inline cell must not contain <br>, got: ${html}`);
});

test('AC1: layout:"inline" carries no reason span (showReason:false unchanged), and no reason field means no reason part', () => {
  const html = renderFanInCell("gap-x", fanInRecord(), { showReason: false, layout: "inline" });
  assert.ok(!html.includes("font-size:0.75rem"), `reason span must be absent when showReason:false, got: ${html}`);
});

test('AC2: default (no layout) output is byte-identical to the pre-change <br>-joined string', () => {
  const html = renderFanInCell("gap-x", fanInRecord(), { showReason: false });
  const expected = [PART_LANDED, PART_LOCK, PART_SUITE, PART_SHA, PART_LINKS].join("<br>");
  assert.equal(html, expected, `default cell must remain <br>-separated, got: ${html}`);
});

test('AC2: layout:"stacked" is byte-identical to the default (no layout) output', () => {
  const defaultHtml = renderFanInCell("gap-x", fanInRecord(), { showReason: false });
  const stackedHtml = renderFanInCell("gap-x", fanInRecord(), { showReason: false, layout: "stacked" });
  assert.equal(stackedHtml, defaultHtml, `stacked must equal default, got: ${stackedHtml}`);
});

// ── renderFanInCardFromRecords fixtures (reuse the shape from gap-dashboard-status-tag-badges) ──
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

const LONG_ID = "gap-dashboard-fanin-cell-inline-layout-and-id-truncation-very-long-task-id-sample";
assert.ok(LONG_ID.length >= 60, `fixture id must be 60+ chars (got ${LONG_ID.length})`);

test("AC3: card renders the task id <a> with text-overflow:ellipsis + the matching title attribute", () => {
  const html = renderFanInCardFromRecords([rec(LONG_ID, mfi("landed"))], { hours: 3, nowMs: Date.parse("2026-09-09T00:00:00.000Z") });
  // Specific: the <a> carries the three-property ellipsis combo AND a title attr equal to the raw id.
  assert.ok(
    html.includes(`href="/task/${LONG_ID}" title="${LONG_ID}" style="color:var(--color-text);text-decoration:none;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"`),
    `id <a> must carry the ellipsis combo + title, got: ${html}`,
  );
});

test("AC3: card still calls renderFanInCell with layout:inline — no <br> between fields in the row", () => {
  const html = renderFanInCardFromRecords(
    [rec("task-inline", { ...mfi("landed"), lockHoldSecs: 7, suiteOutcome: "done", landedSha: "1234567890abcdef", fanInLog: "fan-in-task-inline.log" })],
    { hours: 3, nowMs: Date.parse("2026-09-09T00:00:00.000Z") },
  );
  assert.ok(html.includes(`<span style="${MONO_STACK}">lock 7s</span>`), "lock field still renders inline");
  assert.ok(!html.includes("<br>"), `card fan-in row must be inline (no <br>), got: ${html}`);
});

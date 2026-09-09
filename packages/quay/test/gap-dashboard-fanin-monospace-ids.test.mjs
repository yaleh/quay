// @test-group product
// gap-dashboard-fanin-monospace-ids — fan-in 卡的 sha/lock 数值套等宽字体（一致性缺口）:
//   renderFanInCell（serve-task.ts）渲染的 `lock <Ns>` 与 `sha <hash>` 是 git hash / 耗时数据，
//   应与「最近提交」卡（serve-dashboard.ts:1008）和系统资源卡（serve-system.ts:140）用同一个
//   font-family 栈 `ui-monospace,monospace`，而不是和正文同字体（Archivo 变宽）。
//   本测试断言 renderFanInCell 对含这两个字段的记录输出【具体字体样式字符串】，而非布尔存在性检查。
//
// Run (scoped): node --test packages/quay/test/gap-dashboard-fanin-monospace-ids.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderFanInCell } from "../src/serve-task.ts";

/** The exact monospace stack shared with serve-dashboard.ts:1008 / serve-system.ts:140. */
const MONO_STACK = "font-family:ui-monospace,monospace";

/** A minimal WorkerOutcomeRecord whose mechanical_fan_in carries the two data fields this task styles.
 *  All other fields null — renderFanInCell reads them null-tolerantly (absent-field contract). */
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
      suiteOutcome: null,
      suitePid: null,
      landedSha: "36384f5abcdef0123",
      fanInLog: null,
      ...overrides,
    },
  };
}

test("AC1: lock <Ns> renders inside a ui-monospace,monospace span with the concrete value", () => {
  const html = renderFanInCell("gap-x", fanInRecord(), {});
  // Specific, not boolean: the exact span string wrapping the exact value must appear.
  assert.ok(
    html.includes(`<span style="${MONO_STACK}">lock 332s</span>`),
    `lock 332s must be wrapped in a ${MONO_STACK} span, got: ${html}`,
  );
});

test("AC1: sha <hash> renders inside a ui-monospace,monospace span with the 7-char truncated hash", () => {
  const html = renderFanInCell("gap-x", fanInRecord(), {});
  // Specific: sha is truncated to 7 chars and wrapped, with the <code> inner preserved.
  assert.ok(
    html.includes(`<span style="${MONO_STACK}">sha <code>36384f5</code></span>`),
    `sha <code>36384f5</code> must be wrapped in a ${MONO_STACK} span, got: ${html}`,
  );
});

test("AC2: other fields render unchanged — outcome + suite + view/download links are not monospace-wrapped", () => {
  const record = fanInRecord({
    suiteOutcome: "done",
    fanInLog: "fan-in-gap-x-abc.log",
  });
  const html = renderFanInCell("gap-x", record, {});
  // outcome still renders (landed tag badge — gap-dashboard-status-tag-badges; the merged
  // renderFanInCell renders the outcome as a .tag span, not a bare <strong>)
  assert.ok(html.includes(`<span class="tag tag-positive">landed</span>`), "landed outcome still renders");
  // suite still renders WITHOUT a monospace span (not a hash/duration — unchanged behavior)
  assert.ok(html.includes("suite done"), "suite outcome still renders");
  assert.ok(!html.includes(`<span style="${MONO_STACK}">suite`), "suite is not monospace-wrapped");
  // view/download links still render
  assert.ok(html.includes(`/fan-in-log/gap-x/fan-in-gap-x-abc.log">view</a>`), "view link still renders");
  assert.ok(html.includes(`/fan-in-log/gap-x/fan-in-gap-x-abc.log/download">download</a>`), "download link still renders");
});

test("AC1/DoD: absent lockHoldSecs/landedSha render no monospace span (absent-field contract, never a fake)", () => {
  const html = renderFanInCell("gap-x", fanInRecord({ lockHoldSecs: null, landedSha: null }), {});
  assert.ok(!html.includes(MONO_STACK), `no ${MONO_STACK} span when both fields are absent, got: ${html}`);
});

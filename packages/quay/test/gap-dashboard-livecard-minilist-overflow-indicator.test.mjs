// @test-group product
// gap-dashboard-livecard-minilist-overflow-indicator — 循环脉搏卡 mini-list 的硬编码 slice(0, 3) 截断
// 与卡片头部「在飞 N / 上限 M」（真实值）脱节：甘特图已有 "+N 更多" overflow badge 惯用法，mini-list
// 缺的正是同一个惯用法的文字版。本文件补上 renderLiveCard 的 "+N 更多 →" 溢出提示行：
//   AC1 — 在飞 > 3 时输出含 `+${N-3} 更多`，对 N=5（→+2）与 N=4（→+1）分别断言精确数字。
//   AC2 — 在飞 ≤ 3 时输出不含「更多」字样（覆盖 N=3 边界；空态 N=0 也不含）。
//   AC3 — 既有 mini-list 本体渲染逻辑不被替换（任务 id 锚点仍在，slice(0,3) 仍只列前 3 条）。
//
// Run (scoped): node --test packages/quay/test/gap-dashboard-livecard-minilist-overflow-indicator.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderLiveCard } from "../src/serve-dashboard.ts";

const NOW_MS = 1_700_000_000_000;

/** N 个互不重叠 startedAtMs 的 implementing 在飞任务，喂给 renderLiveCard 的最小合法形状。 */
function inFlight(n) {
  return Array.from({ length: n }, (_, i) => ({
    taskId: `T-${i + 1}`,
    phase: "implementing",
    startedAtMs: NOW_MS - (n - i) * 60_000,
  }));
}

function liveWith(n) {
  return { status: "ok", liveState: "running", concurrencyCap: 5, inFlight: inFlight(n) };
}

test("AC1: in-flight 5 → renderLiveCard emits +2 更多 (N-3 exact number)", () => {
  const html = renderLiveCard(liveWith(5), NOW_MS);
  assert.ok(html.includes("+2 更多"), "the overflow hint carries the exact +2 count");
});

test("AC1: in-flight 4 → renderLiveCard emits +1 更多 (N-3 exact number)", () => {
  const html = renderLiveCard(liveWith(4), NOW_MS);
  assert.ok(html.includes("+1 更多"), "the overflow hint carries the exact +1 count");
});

test("AC2: in-flight 3 (boundary) → no 更多 in the card", () => {
  const html = renderLiveCard(liveWith(3), NOW_MS);
  assert.ok(!html.includes("更多"), "≤3 in-flight must NOT emit a 更多 hint");
});

test("AC2: in-flight 0 (empty state) → no 更多 and no mini-list", () => {
  const html = renderLiveCard(liveWith(0), NOW_MS);
  assert.ok(!html.includes("更多"), "empty state emits no 更多 hint");
  assert.ok(!html.includes('href="/task/'), "empty state renders no mini-list task anchors");
});

test("AC3: mini-list body is appended-to, not replaced — task anchors still render for the first 3", () => {
  const html = renderLiveCard(liveWith(5), NOW_MS);
  // The slice(0,3) cap is untouched: exactly the first 3 task ids appear as anchors.
  assert.ok(html.includes('href="/task/T-1"'), "first in-flight task anchor present");
  assert.ok(html.includes('href="/task/T-2"'), "second in-flight task anchor present");
  assert.ok(html.includes('href="/task/T-3"'), "third in-flight task anchor present");
  assert.ok(!html.includes('href="/task/T-4"'), "4th in-flight task is truncated out of the mini-list");
  assert.ok(!html.includes('href="/task/T-5"'), "5th in-flight task is truncated out of the mini-list");
  // The hint links to /live (same target as the card's 查看 Live → footer).
  assert.ok(html.includes('href="/live"'), "the overflow hint links to /live");
});

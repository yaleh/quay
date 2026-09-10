// @test-group product
// gap-dashboard-goal-card-ac-progress-bar — renderGoalCard 每条 active goal 行在「AC 达成 x/y」
// 旁加一条 mini 进度条（复用 renderTaskCard bar() 的 `width:{pct}%` 分段条手法，无新组件/依赖）。
//
// 达成比例 achieved/acs.length 原本已算出、只以纯文本呈现；本任务只补可视化：一个固定高度
// 容器 + `width:{pct}%` 填充 div，pct 与 achieved/total 正比；acs.length === 0 时不渲染进度条
//（避免除零产生 NaN/Infinity 宽度），纯文本「AC 达成 x/y」仍保留供纯文本/无障碍场景可读。
//
// 测试：
//   AC1 — 已知 achieved/total 组合 ⇒ 渲染出可断言的具名宽度百分比（不是布尔存在性检查）。
//   AC1 — 0 达成但分母非 0 ⇒ 宽度 0.0%（进度条渲染为 0%，不是消失）。
//   AC2 — 0 分母（acs.length === 0）⇒ 无 NaN/Infinity 宽度、无进度条，纯文本仍可读。
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderGoalCard } from "../src/serve-dashboard.ts";

// ── fixtures (renderGoalCard 只读 id/title/status/kind/goal/evidence) ─────────────────────────────

function goal(id, { status = "active", kind = "goal", title = `${id} title` } = {}) {
  return { id, title, status, kind, goal: undefined, evidence: undefined, supersedes: [], supersededBy: [], body: "" };
}

function ac(id, goalId, status = "active") {
  return { id, title: `${id} title`, status, kind: "criterion", goal: goalId, criterion: "exit 0", expect: "", origin: "test", evidence: undefined, supersedes: [], supersededBy: [], body: "" };
}

const NOW = Date.parse("2026-09-06T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

/** Extract the progress-bar fill width percentage ("66.7") from the rendered card, or null when no
 *  bar is present. Anchored to the fill's own style (width:{pct}%;height:100%;background:positive)
 *  so a bare width:100% container never matches. */
function progressBarWidthPct(html) {
  const m = html.match(/width:(\d+\.\d+)%;height:100%;background:var\(--color-positive-700\)/);
  return m ? m[1] : null;
}

test("AC1: progress bar width is proportional to achieved/total — specific % asserted", () => {
  const goals = [
    goal("GOAL-001"),
    ac("AC-1", "GOAL-001", "achieved"),
    ac("AC-2", "GOAL-001", "achieved"),
    ac("AC-3", "GOAL-001", "active"),
  ];
  const html = renderGoalCard(goals, { cap: 3, staleMs: 7 * DAY, nowMs: NOW });

  assert.match(html, /AC 达成 2\/3/, "original plain-text x/y is retained (bar is a supplement)");
  assert.equal(progressBarWidthPct(html), "66.7", "fill width = 2/3 → 66.7% (specific value, not boolean)");
  assert.match(html, /background:var\(--color-positive-700\)/, "fill reuses the positive token — no new hex colour");
});

test("AC1: zero achieved with non-zero denominator renders 0.0% (bar present, not missing)", () => {
  const html = renderGoalCard(
    [goal("GOAL-001"), ac("AC-1", "GOAL-001", "active"), ac("AC-2", "GOAL-001", "active")],
    { cap: 3, staleMs: 7 * DAY, nowMs: NOW },
  );
  assert.equal(progressBarWidthPct(html), "0.0", "0 achieved of 2 → 0.0% width");
});

test("AC2: acs.length === 0 renders no bar and no NaN/Infinity width", () => {
  const html = renderGoalCard([goal("GOAL-001")], { cap: 3, staleMs: 7 * DAY, nowMs: NOW });
  assert.match(html, /AC 达成 0\/0/, "plain text still readable when the goal has zero ACs");
  assert.equal(progressBarWidthPct(html), null, "no progress bar when the denominator is 0");
  assert.doesNotMatch(html, /NaN|Infinity/, "no NaN/Infinity width leaks into the HTML");
});

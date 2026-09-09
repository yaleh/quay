// @test-group engine
// goal011-ac-shortcircuit-false-negative-recurrence.test.mjs — GOAL-011 退出条件③（AC-221）：
// 「2026-09-07 已实证的那类事故（ABI 勾满 AC，worktree 副本看不到，exited-not-landed 重派）在实现
// 落地后的窗口内实测发生次数为 0」。
//
// 读的是生产载体本身（.quay/worker-outcome.jsonl，经 mainCheckoutRoot() 定位）——⛔ 不用 fixture
// 冒充生产（硬规则「推论三」：只能被 fixture 满足的判据不是测量）。窗口下界同 AC-220：
// gap-store-commit-propagation-field-aware 落地提交 bdbdb368d（2026-09-09T11:28:11Z）。
//
// 判据形状（诚实的那一半）：`acShortCircuitVerdict` 短路时统一写 `failure_reason` 前缀
// "AC 未全勾"（worker-driver.ts 的短路分支），这个前缀底下混着两类彼此不可从文本区分的情形——
//   (a) 假阴性——本 AC 要防的那类事故：AC 其实已经在 develop ref 或 worktree 任务分支上全勾，只是
//       短路判据当时只读了其中一侧，把另一侧的陈旧误判成"没勾"；
//   (b) 真阴性——worker 真的没做完，AC 本来就没全勾，短路属于设计意图内的正确拦截。
// 字段级并集读（AC-218）落地后，(a) 在结构上不应再发生——但本判据无法从 failure_reason 文本本身
// 区分 (a)/(b)，所以采用保守判法：落地后【任何】"AC 未全勾"短路事件都算「需要人工核对一次」，
// 判据要求该窗口内出现次数为 0；一旦真实出现（worker 确实没做完的正常情形），需要人工翻一次那条
// 记录背后的 develop ref / worktree 任务体，确认不是 (a) 复发，再决定是否要把这条判据换成更精细的
// 区分逻辑——而不是放宽阈值让它悄悄通过。
//
// 三态处理同 AC-220：node:test 退出码是唯一信号通道，无法区分的情形一律 fail-closed，不放行。
//
// Run: node --no-warnings --experimental-strip-types --test plugin/test/goal011-ac-shortcircuit-false-negative-recurrence.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { mainCheckoutRoot } from "../scripts/repo-root.ts";

const LANDING_SHA = "bdbdb368d";
const LANDING_CUTOFF = "2026-09-09T11:28:11Z";

const SHORTCIRCUIT_PATTERN = /^AC 未全勾/;

function readWorkerOutcomeLines() {
  const root = mainCheckoutRoot();
  const p = path.join(root, ".quay", "worker-outcome.jsonl");
  if (!fs.existsSync(p)) return [];
  const text = fs.readFileSync(p, "utf8");
  const out = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // append-only 载体偶发半写行，跳过而非整体判失败。
    }
  }
  return out;
}

function isShortCircuit(rec) {
  return typeof rec.failure_reason === "string" && SHORTCIRCUIT_PATTERN.test(rec.failure_reason);
}

// ── 负控制（硬规则②：先证明正则认得出真实发生过的短路事件）─────────────────────────────
// 2026-09-07 事故本身、以及此后未修复期间的重复实例，都应该在落地前的历史里能查到——
// 若这里命中 0 条，说明判据的正则/字段名已经偏离生产载体的实际形状，不能信任它在落地后的 0 计数。

test("负控制：SHORTCIRCUIT_PATTERN 命中至少一条落地前的历史短路样本（判据本身没坏）", () => {
  const records = readWorkerOutcomeLines();
  const preLanding = records.filter((r) => r.ts && r.ts < LANDING_CUTOFF && isShortCircuit(r));
  assert.ok(
    preLanding.length > 0,
    `期望在 ${LANDING_CUTOFF} 之前的生产记录里能找到至少一条 "AC 未全勾" 短路样本,实际 0 条——` +
      "先确认字段名/正则是否仍匹配 worker-driver.ts 当前写法,而不是直接相信『事故是 0 次』"
  );
});

// ── 主判据：落地后窗口内「AC 未全勾」短路事件实测发生次数为 0 ──────────────────────────

test(
  `落地(${LANDING_SHA} / ${LANDING_CUTOFF})后 "AC 未全勾" 短路事件实测发生次数为 0`,
  () => {
    const records = readWorkerOutcomeLines();
    const postLanding = records.filter(
      (r) => typeof r.ts === "string" && r.ts >= LANDING_CUTOFF && isShortCircuit(r)
    );
    assert.equal(
      postLanding.length,
      0,
      `落地后出现 ${postLanding.length} 条 "AC 未全勾" 短路事件(任务: ` +
        `${postLanding.map((r) => r.task).join(", ")})——本判据无法从 failure_reason 文本本身区分` +
        "这是 2026-09-07 那类假阴性复发,还是 worker 真没做完的正常拦截(见文件头注)。" +
        "两种情形都先判 fail,人工核对对应 develop ref / worktree 任务体的 AC 勾选状态后再判定。"
    );
  }
);

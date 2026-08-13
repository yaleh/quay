// @test-group engine
// mechanism-vitality-check.test.mjs — gap-crystallization-five-directions ①②③④ 零调用 triage 机件。
// Covers:
//   ① invalidationGateViolations — 缺失效前提 = 入口闸拒绝; 显式「无可测前提」= 合规。
//   ②a isZeroCallPast / cadence3xMs — 按机件声明周期分档 (非统一天数), 零调用 > 3× 周期 → 待表态。
//   ②b pendingDeclarationList 携带全历史证据 (callCountAll) — 表态须回看全历史。
//   ②c isLegalRetirementReason — 退休须给「理由失效/已被取代」, 拒绝「最近没用」。
//   ②d dispositionFor — 默认处置「待观察」不是「退休」。
//   ③ lastReaffirmedStaleList — 超 N 天未触及 → 待重新确认。
//   CLI — 对真实仓库 --check 出口 0 且 失效前提入口闸 PASS; --selftest 全绿。
//
// Run:
//   scripts/test.sh plugin/test/mechanism-vitality-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  invalidationGateViolations,
  cadence3xMs,
  cadenceBands,
  isZeroCallPast,
  pendingDeclarationList,
  lastReaffirmedStaleList,
  isLegalRetirementReason,
  dispositionFor,
} from "../scripts/mechanism-vitality-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin/scripts/mechanism-vitality-check.ts");

const NOW = Date.parse("2026-08-10T00:00:00Z");
const DAY = 24 * 3600 * 1000;

function mk(o) {
  return {
    file: "x.ts",
    question: "",
    ships: true,
    cadence: "每轮",
    invalidation: "无可测前提，靠周期复核",
    lastReaffirmed: "2026-08-10",
    matching: "position",
    lastTouchTs: null,
    callCountAll: 0,
    referencedNow: false,
    ...o,
  };
}

// ── ① 失效前提入口闸 ────────────────────────────────────────────────────────────────────────────────
test("① invalidation gate — missing field is a violation; explicit marker / testable precondition are compliant", () => {
  assert.equal(invalidationGateViolations([mk({ invalidation: null })]).length, 1);
  assert.equal(invalidationGateViolations([mk({ invalidation: "" })]).length, 1);
  assert.equal(invalidationGateViolations([mk({ invalidation: "无可测前提，靠周期复核" })]).length, 0);
  assert.equal(invalidationGateViolations([mk({ invalidation: "失效前提：X；若 Y 则不适用" })]).length, 0);
});

// ── ②a cadence 分档 (非统一天数) ────────────────────────────────────────────────────────────────────
test("②a cadence — 3× window is per-declared-cadence, never a uniform day count", () => {
  assert.equal(cadence3xMs("每轮"), 3 * DAY, "每轮 → 3 天");
  assert.equal(cadence3xMs("每红窗"), 3 * DAY, "每红窗 → 3 天");
  assert.equal(cadence3xMs("每里程碑"), 42 * DAY, "每里程碑 → 42 天");
  assert.equal(cadence3xMs("冷启动"), 30 * DAY, "冷启动 → 30 天");
  assert.equal(cadence3xMs("按需"), 90 * DAY, "按需 → 90 天");
});

test("②a zero-call — gated by the mechanism's own cadence, not a uniform 3-day rule", () => {
  const old = NOW - 10 * DAY; // 10 days untouched
  const recent = NOW - 1 * DAY; // 1 day ago
  // 每轮 (3×=3天): 10 天未触及 → 待表态; 1 天前 → 不。
  assert.equal(isZeroCallPast(mk({ cadence: "每轮", lastTouchTs: old }), NOW), true);
  assert.equal(isZeroCallPast(mk({ cadence: "每轮", lastTouchTs: recent }), NOW), false);
  // 每里程碑 (3×=42天) / 按需 (3×=90天): 同一个 10 天未触及 → 不待表态 (这就是「非统一天数」的负控制)。
  assert.equal(isZeroCallPast(mk({ cadence: "每里程碑", lastTouchTs: old }), NOW), false);
  assert.equal(isZeroCallPast(mk({ cadence: "按需", lastTouchTs: old }), NOW), false);
  // 被引用 → 永不零调用; 新建未提交文件 (lastTouch null) → 不是休眠。
  assert.equal(isZeroCallPast(mk({ cadence: "每轮", lastTouchTs: old, referencedNow: true }), NOW), false);
  assert.equal(isZeroCallPast(mk({ cadence: "每轮", lastTouchTs: null }), NOW), false);
  // 未声明 cadence / not-shipped → 不参与。
  assert.equal(isZeroCallPast(mk({ cadence: null, lastTouchTs: old }), NOW), false);
  assert.equal(isZeroCallPast(mk({ ships: false, lastTouchTs: old }), NOW), false);
});

test("②a cadence bands enumerate members per band (枚举式, 不是布尔)", () => {
  const bands = cadenceBands([
    mk({ file: "a.sh", cadence: "每轮" }),
    mk({ file: "b.ts", cadence: "按需" }),
    mk({ file: "c.sh", cadence: "每轮" }),
    mk({ file: "d.sh", ships: false, cadence: "每轮" }), // not-shipped excluded
  ]);
  assert.equal(bands["每轮"].length, 2, "a + c in 每轮");
  assert.equal(bands["按需"].length, 1, "b in 按需");
  assert.equal(bands["每轮"].includes("d.sh"), false, "not-shipped excluded from bands");
});

// ── ②b 全历史表态: 待表态清单携带全历史证据 ─────────────────────────────────────────────────────────
test("②b pending list carries full-history evidence (callCountAll) — 表态须回看全历史", () => {
  // 注入的全历史证据是合成 fixture（随 mk() 传入，非活仓库读数）——断言相对该 fixture 自身
  // （相对断言），不依赖活仓库 git 历史，故随仓库增长不会漂移（gap-tests-assert-live-repo-state-break-idempotency AC1）。
  const injectedFullHistoryCount = 47;
  const pending = pendingDeclarationList(
    [mk({ file: "ancient.ts", cadence: "每轮", lastTouchTs: NOW - 10 * DAY, callCountAll: injectedFullHistoryCount })],
    NOW,
  );
  assert.equal(pending.length, 1);
  assert.equal(
    pending[0].callCountAll,
    injectedFullHistoryCount,
    "待表态条目携带注入的全历史证据字段 (fixture 相对断言, 非活仓库字面量)",
  );
});

// ── ②c/②d 退休规则 ────────────────────────────────────────────────────────────────────────────────
test("②c retirement reason — 最近没用 is ILLEGAL; 理由失效/已被取代 are legal", () => {
  assert.equal(isLegalRetirementReason("最近没用"), false, "「最近没用」不能是唯一退休理由 (人硬修正)");
  assert.equal(isLegalRetirementReason("失效前提已不成立 (理由失效)"), true);
  assert.equal(isLegalRetirementReason("已被 send-keys-reliable 取代"), true);
  assert.equal(isLegalRetirementReason("superseded by ruling F"), true);
});

test("②d default disposition — 待观察, never 退休 (retirement needs reason/replacement evidence)", () => {
  assert.equal(dispositionFor(mk({})), "待观察");
  assert.equal(dispositionFor(mk({ ships: false })), "not-shipped");
  assert.equal(dispositionFor(mk({})).includes("退休"), false);
});

// ── ③ last-reaffirmed 超期 → 待重新确认 ────────────────────────────────────────────────────────────
test("③ last-reaffirmed — stale after N days untouched; fresh stamp or recent git touch keeps it green", () => {
  const staleLr = NOW - 45 * DAY;
  // 45 天前盖章且无 git 触及 → 待重新确认。
  assert.equal(lastReaffirmedStaleList([mk({ lastReaffirmed: "2026-06-26", lastTouchTs: staleLr })], NOW).length, 1);
  // 今日章 → 不。
  assert.equal(lastReaffirmedStaleList([mk({ lastReaffirmed: "2026-08-10", lastTouchTs: NOW - 1 * DAY })], NOW).length, 0);
  // 章很老但 git 有窗口内触及 → 不 (被调用/检查/复核触及过)。
  assert.equal(lastReaffirmedStaleList([mk({ lastReaffirmed: "2026-06-26", lastTouchTs: NOW - 1 * DAY })], NOW).length, 0);
  // 未盖章 (null) → 不参与待重新确认。
  assert.equal(lastReaffirmedStaleList([mk({ lastReaffirmed: null })], NOW).length, 0);
});

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────
test("CLI --selftest is green", () => {
  const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, "--selftest"], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `selftest must exit 0:\n${r.stdout}${r.stderr}`);
});

test("CLI --check against the real repo — 失效前提入口闸 PASS, cadence 分档 + 全历史表态 + 退休规则输出", () => {
  const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, "--check"], {
    encoding: "utf8",
    cwd: REPO_ROOT,
  });
  assert.equal(r.status, 0, `--check must exit 0 (observation lists are not failures):\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /失效前提入口闸 \(①\): PASS/, "① invalidation gate PASS");
  assert.match(r.stdout, /cadence 分档 \(②a/, "②a cadence bands printed");
  assert.match(r.stdout, /零调用全历史表态 \(②b/, "②b full-history 表态 printed");
  assert.match(r.stdout, /退休规则 \(②c\/②d\): PASS/, "②c/②d retirement rule printed");
});

test("CLI --check --json is machine-readable and carries the four evidence surfaces", () => {
  const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, "--check", "--json"], {
    encoding: "utf8",
    cwd: REPO_ROOT,
  });
  assert.equal(r.status, 0, `--check --json must exit 0:\n${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.invalidation_gate.ok, true, "invalidation gate ok");
  assert.ok(Array.isArray(out.pending_declaration));
  assert.ok(Array.isArray(out.pending_reaffirm));
  assert.ok(out.cadence_bands["每轮"], "cadence band 每轮 present");
  assert.ok(out.retirement_rule.ok, true);
});

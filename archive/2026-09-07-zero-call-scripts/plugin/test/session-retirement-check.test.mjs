// @test-group engine
// session-retirement-check.test.mjs — AC149-1 会话退役语义断言的 RED/GREEN 测试
// (plugin/scripts/session-retirement-check.ts, gap-ac149-session-retirement-no-dual-source-no-throughput-collapse).
//
// Criterion (manager-phase-goal.md ### AC149):
//   AC149-1（真停）: outer / inner 会话停止；执行核文档按 AC135/AC141/B9 的同一套写法标退役
//   （删除线 + 指针 + 边界条件）。取假：会话停了而文档仍写「每轮必跑」⇒ 假。
//
// Covered here:
//   - RED (NOT-RETIRED): a retired doc with the retirement banner stripped ⇒ runCheck red.
//   - RED (STILL-LIVE): a doc that still carries a live 「并行对照期」 claim ⇒ runCheck red (the B9 drift).
//   - GREEN: the REAL repo corpus ⇒ ok (both cores carry the banner, neither carries a live claim).
//
// Run:
//   scripts/test.sh plugin/test/session-retirement-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCheck, norm, hasMarker, REGISTRY } from "../scripts/session-retirement-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const RETIRED_OUTER = "当前状态：已退役（AC149，2026-08-28）。outer 会话停止，本核不再每轮执行。\n";
const RETIRED_INNER = "当前状态：已退役（AC149，2026-08-28）。inner 会话停止，本核不再每轮执行。\n";
const LIVE_OUTER = "当前状态:并行对照期。锚仍指向 orchestrator-loop-tick.md。每轮两份都跑。\n";

function makeRoot(outer, inner) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "src-"));
  fs.mkdirSync(path.join(tmp, "orchestration"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "orchestration/orchestrator-tick-core.md"), outer);
  fs.writeFileSync(path.join(tmp, "orchestration/fast-mode-tick-core.md"), inner);
  return tmp;
}

// ── RED (NOT-RETIRED): a retired doc with the banner stripped must redden the checker ──────────────
test("RED (NOT-RETIRED): a core doc with the retirement banner stripped reddens runCheck", () => {
  const tmp = makeRoot("orphaned content, no banner\n", RETIRED_INNER);
  try {
    const { ok, issues } = runCheck(tmp);
    assert.equal(ok, false, "a doc with no retirement banner must make the checker RED");
    assert.ok(issues.some((i) => i.includes("outer") && i.includes("NOT-RETIRED")),
      `expected a NOT-RETIRED issue for outer, got: ${issues.join(" | ")}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── RED (STILL-LIVE): a doc still claiming 「并行对照期」 must redden the checker ───────────────────
test("RED (STILL-LIVE): a core doc still carrying a live claim reddens runCheck (the B9 drift)", () => {
  const tmp = makeRoot(`${LIVE_OUTER}${RETIRED_OUTER}`, RETIRED_INNER);
  try {
    const { ok, issues } = runCheck(tmp);
    assert.equal(ok, false);
    assert.ok(issues.some((i) => i.includes("outer") && i.includes("STILL-LIVE")),
      `expected a STILL-LIVE issue for outer, got: ${issues.join(" | ")}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── GREEN: the real repo corpus — both cores carry the banner, neither carries a live claim ────────
test("GREEN: real corpus — both retired cores carry the banner and no live claim", () => {
  const { ok, issues } = runCheck(REPO_ROOT);
  assert.equal(ok, true, `real corpus must be GREEN; issues: ${issues.join(" | ")}`);
});

// ── GREEN: the registry covers exactly outer + inner, each with retired + live markers ─────────────
test("GREEN: registry covers outer and inner with ≥1 retired marker and ≥1 live marker each", () => {
  const bySession = new Map(REGISTRY.map((e) => [e.session, e]));
  assert.ok(bySession.has("outer") && bySession.has("inner"), "registry must cover outer + inner");
  for (const e of REGISTRY) {
    assert.ok(e.retiredMarkers.length >= 1, `${e.session} must declare retired markers`);
    assert.ok(e.liveMarkers.length >= 1, `${e.session} must declare live markers (the drift shape to forbid)`);
  }
});

// ── GREEN: norm() collapses whitespace so multi-line banners match ─────────────────────────────────
test("GREEN: norm() collapses whitespace and strips backticks", () => {
  assert.equal(norm("a  b\nc"), "a b c");
  assert.equal(norm("当前状态：已退役（AC149，2026-08-28）。\n本核不再每轮执行"), "当前状态：已退役（AC149，2026-08-28）。 本核不再每轮执行");
  assert.equal(hasMarker(RETIRED_OUTER, "当前状态：已退役（AC149"), true);
  assert.equal(hasMarker(LIVE_OUTER, "当前状态：已退役（AC149"), false);
});

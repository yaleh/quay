// @test-group engine
// dual-source-check.test.mjs — AC149-3 双真相源判定的 RED/GREEN 测试
// (plugin/scripts/dual-source-check.ts, gap-ac149-session-retirement-no-dual-source-no-throughput-collapse).
//
// Criterion (manager-phase-goal.md ### AC149):
//   AC149-3（无双真相源）: 停机后不存在任何「两个执行者做同一件事」的路径。取假：任一职责同时有
//   driver 路径与人工/会话路径且都在用 ⇒ 假。
//
// Covered here:
//   - RED (DUAL-SOURCE): a session doc with the retirement annotation stripped ⇒ runCheck red
//     (the session path is no longer documented as retired ⇒ two executors for one responsibility).
//   - RED (EXECUTOR-MISSING): the driver file absent ⇒ runCheck red (no single live executor).
//   - GREEN: the REAL repo corpus ⇒ ok (every responsibility has its driver + a retired session path).
//
// Run:
//   scripts/test.sh plugin/test/dual-source-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCheck, norm, hasMarker, REGISTRY } from "../scripts/dual-source-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// ── RED (DUAL-SOURCE): a session path not documented as retired must redden the checker ─────────────
test("RED (DUAL-SOURCE): a session doc with the retirement annotation stripped reddens runCheck", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsc-"));
  try {
    fs.mkdirSync(path.join(tmp, "plugin", "scripts"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "orchestration"), { recursive: true });
    // Real driver files, but the session docs are stripped of their retirement annotations.
    for (const e of REGISTRY) {
      const real = fs.readFileSync(path.join(REPO_ROOT, e.executor), "utf8");
      fs.writeFileSync(path.join(tmp, e.executor), real);
      fs.writeFileSync(path.join(tmp, e.sessionDoc), "no retirement annotation here\n");
    }
    const { ok, issues } = runCheck(tmp);
    assert.equal(ok, false);
    assert.ok(issues.some((i) => i.includes("DUAL-SOURCE")),
      `expected a DUAL-SOURCE issue, got: ${issues.join(" | ")}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── RED (EXECUTOR-MISSING): the driver file absent must redden the checker ─────────────────────────
test("RED (EXECUTOR-MISSING): a missing driver file reddens runCheck (no single live executor)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsc2-"));
  try {
    fs.mkdirSync(path.join(tmp, "orchestration"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "plugin", "scripts"), { recursive: true });
    for (const e of REGISTRY) {
      const realDoc = fs.readFileSync(path.join(REPO_ROOT, e.sessionDoc), "utf8");
      fs.writeFileSync(path.join(tmp, e.sessionDoc), realDoc);
      // Executor files are NOT copied ⇒ all EXECUTOR-MISSING.
    }
    const { ok, issues } = runCheck(tmp);
    assert.equal(ok, false);
    assert.ok(issues.some((i) => i.includes("EXECUTOR-MISSING")),
      `expected an EXECUTOR-MISSING issue, got: ${issues.join(" | ")}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── GREEN: the real repo corpus — every responsibility has a single live executor ──────────────────
test("GREEN: real corpus — every responsibility has its driver and a retired session path", () => {
  const { ok, issues } = runCheck(REPO_ROOT);
  assert.equal(ok, true, `real corpus must be GREEN; issues: ${issues.join(" | ")}`);
});

// ── GREEN: registry entries are well-formed (name + executor + sessionDoc + ≥1 retired marker) ─────
test("GREEN: registry entries are well-formed", () => {
  assert.ok(REGISTRY.length >= 1);
  for (const e of REGISTRY) {
    assert.ok(e.name && e.executor && e.sessionDoc, `${e.name} must name executor + sessionDoc`);
    assert.ok(e.retiredMarkers.length >= 1, `${e.name} must declare ≥1 retired marker`);
  }
});

// ── GREEN: norm() collapses whitespace and strips backticks ────────────────────────────────────────
test("GREEN: norm() collapses whitespace and strips backticks", () => {
  assert.equal(norm("a  b\nc"), "a b c");
  assert.equal(norm("已驱动化 `plugin/scripts/outer-driver.ts`（AC143）"), "已驱动化 plugin/scripts/outer-driver.ts（AC143）");
  assert.equal(hasMarker("晋升由 promotion-driver 承接", "晋升由 promotion-driver 承接"), true);
});

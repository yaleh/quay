// @test-group engine
// checker-driver-result-ratchet-check.test.mjs — gap-b4-checker-reuse-driver-result (B4): the
// checker-side reuse of driver-result.ts's DriverResult<T> (SPEC-methodology-layer-architecture §2.3a).
//
// Covers (AC1/AC2/AC3 of the task):
//   AC3 — the semantic mapping DriverResult.verified/failed/not-evaluated ↔ checker pass/fail/
//         not-evaluated is field-level and tested (driverResultToExit: verified→0 · failed→1 ·
//         not-evaluated→2). ⛔ no mapping ⇒ 假.
//   AC1 — the adoption ratchet: real repo's adoptedChecker count ≥ 3 (0 → k), REQUIRED_ADOPTERS
//         all adopt, missing = []. ⛔ still 0 adoption ⇒ 假.
//   AC2 — negative control both directions:
//         (a) deleting ONE checker's driver-result import (checker-io bridge) makes the ratchet RED
//             and the third-state source collapse (importsDriverResult ⇒ false) — "删 import → 红";
//         (b) importsDriverResult is position-matched: a comment/string mention is NOT adoption.
//
// Run:
//   node --no-warnings --experimental-strip-types --test plugin/test/checker-driver-result-ratchet-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  REQUIRED_ADOPTERS,
  MIN_ADOPTED_CHECKERS,
  importsDriverResult,
  enumerateAdopters,
  checkRatchet,
} from "../scripts/checker-driver-result-ratchet-check.ts";
import { driverResultToExit, verified, notEvaluated, failed } from "../scripts/checker-io.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "checker-driver-result-ratchet-check.ts");

// ── AC3：语义映射（字段级对照 + 测试）──────────────────────────────────────────────────────────────

test("AC3: driverResultToExit maps verified→0 · failed→1 · not-evaluated→2 (field-level)", () => {
  assert.equal(driverResultToExit(verified("x", "by")), 0, "verified ↔ PASS ↔ exit 0");
  assert.equal(driverResultToExit(failed("x")), 1, "failed ↔ FAIL ↔ exit 1");
  assert.equal(driverResultToExit(notEvaluated("x")), 2, "not-evaluated ↔ NOT-EVALUATED ↔ exit 2");
});

test("AC3: not-evaluated is a DIFFERENT shape from verified and failed (硬规则 3b, not conflated)", () => {
  const n = notEvaluated("读不到输入");
  assert.equal(n.state, "not-evaluated");
  assert.ok("reason" in n && !("value" in n) && !("verifiedBy" in n), "not-evaluated 与 verified/failed 不同形");
});

// ── AC1：采纳数 0 → k（k≥3），真实仓库 ──────────────────────────────────────────────────────────────

test("AC1: real repo — REQUIRED_ADOPTERS all adopt + adoptedCheckers ≥ 3 (0 → k)", () => {
  const r = checkRatchet(REPO_ROOT);
  assert.equal(r.state, "verified", `expected verified, got ${r.state}: ${JSON.stringify(r)}`);
  const { adoptedCheckers, missing, required, minAdoptedCheckers } = r.value;
  assert.deepEqual(missing, [], "no REQUIRED_ADOPTERS may regress (棘轮只增不减)");
  assert.ok(adoptedCheckers.length >= 3, `adopted checker count must be ≥ 3, got ${adoptedCheckers.length}`);
  assert.equal(minAdoptedCheckers, REQUIRED_ADOPTERS.length, "floor = pinned list length");
  for (const req of REQUIRED_ADOPTERS) {
    assert.ok(adoptedCheckers.includes(req), `REQUIRED_ADOPTERS ${req} must adopt DriverResult`);
  }
});

// ── AC2 负控制：删 import ⇒ 塌回二值 ⇒ 红 ───────────────────────────────────────────────────────────

/** 造一个最小 temp 树：plugin/scripts/ 下放 driver-result.ts + checker-io.ts + 4 个 checker（ratchet 只读源码，不执行）。 */
function buildTempScriptsTree() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b4-ratchet-"));
  const dst = path.join(tmp, "plugin", "scripts");
  fs.mkdirSync(dst, { recursive: true });
  for (const f of ["driver-result.ts", "checker-io.ts", ...REQUIRED_ADOPTERS]) {
    fs.copyFileSync(path.join(REPO_ROOT, "plugin", "scripts", f), path.join(dst, f));
  }
  return tmp;
}

test("AC2: buildTempScriptsTree is a minimal tree where the ratchet is verified (control baseline)", () => {
  const tmp = buildTempScriptsTree();
  try {
    const r = checkRatchet(tmp);
    assert.equal(r.state, "verified", `baseline temp tree should verify, got ${r.state}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC2 negative control: deleting ONE checker's import makes the ratchet RED (collapse to binary)", () => {
  const tmp = buildTempScriptsTree();
  try {
    const oa = path.join(tmp, "plugin", "scripts", "outer-anchor-check.ts");
    let src = fs.readFileSync(oa, "utf8");
    const before = src;
    // 删掉 checker 对 driver-result 词表的 import（value + type 两行都含 `from "./checker-io.ts"`）。
    src = src.replace(/import \{ verified, notEvaluated, failed, driverResultToExit \} from "\.\/checker-io\.ts";\n/, "");
    src = src.replace(/import type \{ DriverResult \} from "\.\/checker-io\.ts";\n/, "");
    assert.notEqual(src, before, "the import lines must have been removed (else the negative control is vacuous)");
    fs.writeFileSync(oa, src);

    // 第三态来源塌回：该 checker 源码里不再有 driver-result 词表的 import。
    assert.equal(importsDriverResult(fs.readFileSync(oa, "utf8")), false, "third-state source collapsed");

    const r = checkRatchet(tmp);
    assert.equal(r.state, "failed", `ratchet must RED after the import is deleted, got ${r.state}`);
    assert.ok(r.reason.includes("outer-anchor-check.ts"), `reason must name the regressed checker: ${r.reason}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC2 negative control: deleting a NON-required checker's import does NOT red (ratchet is the pinned list, not all checkers)", () => {
  // 一个不在钉住清单里的 checker（如 checker-driver-result-ratchet-check.ts 自身）不采纳不会红——
  // 棘轮只钉住 REQUIRED_ADOPTERS，证明「只增不减」是钉住清单语义，不是全仓强制（B4 示范 4 个）。
  const tmp = buildTempScriptsTree();
  try {
    // 额外放一个「新 checker」不采纳 driver-result —— 它不在钉住清单里，ratchet 仍 verified。
    fs.writeFileSync(path.join(tmp, "plugin", "scripts", "brand-new-check.ts"), '// a brand-new checker that does not yet adopt\nimport fs from "node:fs";\n');
    const r = checkRatchet(tmp);
    assert.equal(r.state, "verified", "a non-required checker not adopting does NOT red (out of scope)");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── importsDriverResult：按位置不按关键词 ───────────────────────────────────────────────────────────

test("importsDriverResult: real import is adoption; comment/string mention is NOT (position-matched)", () => {
  assert.equal(importsDriverResult('import { verified } from "./checker-io.ts";\n'), true);
  assert.equal(importsDriverResult('import { verifyIndependently } from "./driver-result.ts";\n'), true);
  assert.equal(importsDriverResult('// adopt: import { x } from "./checker-io.ts";\n'), false, "comment mention must not count");
  assert.equal(importsDriverResult('const s = "from \\"./checker-io.ts\\"";\n'), false, "string mention must not count");
});

// ── enumerateAdopters 的 not-evaluated 分支（读不到输入 ⇒ 独立取值）────────────────────────────────

test("enumerateAdopters returns null when plugin/scripts is unreadable (⇒ not-evaluated, not pass)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b4-none-"));
  try {
    const r = checkRatchet(tmp); // 无 plugin/scripts 目录
    assert.equal(r.state, "not-evaluated", "missing plugin/scripts must be not-evaluated (读不到输入 ≠ 合格)");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── CLI 冒烟（真实入口，非仅 import 判定函数）───────────────────────────────────────────────────────

test("CLI: real repo exits 0 (verified) with --json carrying adoptedCheckers ≥ 3", () => {
  const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", REPO_ROOT, "--json"], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
  const json = JSON.parse(r.stdout);
  assert.equal(json.state, "verified");
  assert.equal(json.ok, true);
  assert.ok(json.adoptedCheckers >= 3, `adoptedCheckers ≥ 3, got ${json.adoptedCheckers}`);
});

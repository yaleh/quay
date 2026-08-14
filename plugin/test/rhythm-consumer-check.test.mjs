// @test-group lowconc
// rhythm-consumer-check.test.mjs — AC73 节奏栏消费检测 (判据1/2/3 gate + 判据4 report),
// plugin/scripts/rhythm-consumer-check.ts. Negative-control fixtures prove the checker can go RED
// on exactly the real samples the task names (D2, 不构造 — the mechanisms and their pre-fix catalog
// states), and that it passes on the live repo after the wiring:
//
//   RED  判据1: a non-按需 mechanism with NO call site anywhere (fan-in-ff-protocol-check.ts
//        replayed in its pre-fix zero-caller state)
//   RED  判据2: a 按需 mechanism with NO CONSUMER row (fan-in-ff-protocol-check.ts /
//        fan-in-ff-executor-check.ts replayed in their pre-fix 「按需」+无谁按 states)
//   RED  判据3: a --no-block checker with NO CONSUMER row (tick-core-drift-check replayed in its
//        pre-fix 已接线但无消费方 state)
//   RED  判据4: a task whose ## Touches declares ONE execution-core copy
//   PASS live repo after wiring: --check exits 0 (判据1/2/3 all satisfied; 判据4 report-only)
//
// Run:
//   scripts/test.sh plugin/test/rhythm-consumer-check.test.mjs
//   node --test plugin/test/rhythm-consumer-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  judgeNonOnDemand,
  judgeOnDemandConsumer,
  judgeNoBlockConsumer,
  judgeDualCopyTouches,
  extractNoBlockCheckers,
  KNOWN_UNWIRED,
} from "../scripts/rhythm-consumer-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "rhythm-consumer-check.ts");

function runChecker(args) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, ...args], { encoding: "utf8" });
}

// ── 判据1: non-按需 must have a call site ───────────────────────────────────────────────────────────

test("判据1 — a non-按需 mechanism with no call site anywhere is RED (fan-in-ff-protocol-check pre-fix state)", () => {
  // fan-in-ff-protocol-check.ts BEFORE the wiring: 每轮 cadence with zero callers (test.sh=0,
  // tick-cores=0, no import/loop/skill reference) and not baselined → the disease. Must be RED.
  const v = judgeNonOnDemand({
    file: "fan-in-ff-protocol-check.ts",
    strictHits: [],
    broadHits: [],
    baselined: false,
  });
  assert.equal(v.ok, false);
  assert.equal(v.kind, "unwired");
  assert.equal(v.evaluated, true);
});

test("判据1 — strict call site (test.sh) → wired", () => {
  const v = judgeNonOnDemand({ file: "x.ts", strictHits: ["scripts/test.sh"], broadHits: [], baselined: false });
  assert.equal(v.ok, true);
  assert.equal(v.kind, "wired-strict");
});

test("判据1 — wired elsewhere (imported by a sibling script) → wired", () => {
  const v = judgeNonOnDemand({ file: "x.ts", strictHits: [], broadHits: ["plugin/scripts/parent.ts"], baselined: false });
  assert.equal(v.ok, true);
  assert.equal(v.kind, "wired-broad");
});

test("判据1 — KNOWN_UNWIRED baseline is reported as known-gap, not red", () => {
  const v = judgeNonOnDemand({ file: "mechanism-vitality-check.ts", strictHits: [], broadHits: [], baselined: true });
  assert.equal(v.ok, true);
  assert.equal(v.kind, "known-gap");
  assert.ok(KNOWN_UNWIRED["mechanism-vitality-check.ts"], "the baseline carries a reason");
});

test("判据1 — the KNOWN_UNWIRED baseline names the 21 pre-existing zero-call gaps", () => {
  // The baseline is the enumerated list of pre-existing non-按需 zero-call mechanisms (measured
  // 2026-08-14). It must not silently grow — a NEW mechanism that is neither wired nor baselined
  // is RED. Sanity: the two fan-in checkers are NOT baselined (they must be caught).
  assert.equal(Object.keys(KNOWN_UNWIRED).length, 21);
  assert.equal("fan-in-ff-protocol-check.ts" in KNOWN_UNWIRED, false);
  assert.equal("fan-in-ff-executor-check.ts" in KNOWN_UNWIRED, false);
});

// ── 判据2: 按需 must declare who presses it ─────────────────────────────────────────────────────────

test("判据2 — a 按需 mechanism with NO CONSUMER row is RED (fan-in-ff-executor-check pre-fix state)", () => {
  // fan-in-ff-executor-check.ts (AC67): catalog cadence 「按需」 with no 「谁按」 — nobody presses a
  // protocol checker at the moment of violation ⇒ structurally unable to go red. Must be RED.
  const v = judgeOnDemandConsumer(null);
  assert.equal(v.ok, false);
  assert.match(v.reason, /按需/);
});

test("判据2 — 按需 with an empty CONSUMER row is RED", () => {
  assert.equal(judgeOnDemandConsumer("   ").ok, false);
});

test("判据2 — 按需 with a CONSUMER row declaring the presser is ok", () => {
  const v = judgeOnDemandConsumer("谁按：manager 在 AC62 收口复核时按；条件=要判 fan-in 协议");
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
});

// ── 判据3: --no-block must declare who reads the output ─────────────────────────────────────────────

test("判据3 — a --no-block checker with NO CONSUMER row is RED (tick-core-drift-check pre-fix state)", () => {
  // tick-core-drift-check (tick-core-static-check.ts --check-drift --no-block): wired but muted —
  // "reported" and "not reported" are indistinguishable downstream. Must be RED without a consumer.
  const v = judgeNoBlockConsumer(null);
  assert.equal(v.ok, false);
  assert.match(v.reason, /--no-block/);
});

test("判据3 — --no-block with a CONSUMER row is ok", () => {
  const v = judgeNoBlockConsumer("消费方：manager 每轮读 tick-core-drift 报告据此动作");
  assert.equal(v.ok, true);
});

test("判据3 — extractNoBlockCheckers finds the 3 --no-block run_checker invocations in the live test.sh", () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "scripts", "test.sh"), "utf8");
  const nbs = extractNoBlockCheckers(src);
  const byName = new Map(nbs.map((n) => [n.name, n.script]));
  assert.equal(byName.get("task-contract-check"), "task-contract-check.ts");
  assert.equal(byName.get("task-ac-carryover-check"), "task-ac-carryover-check.ts");
  assert.equal(byName.get("tick-core-drift-check"), "tick-core-static-check.ts");
  assert.equal(nbs.length, 3, `expected exactly 3 --no-block checkers, got ${JSON.stringify(nbs)}`);
});

// ── 判据4: execution-core Touches must declare BOTH copies ──────────────────────────────────────────

test("判据4 — a task touching ONE execution-core copy is RED (single-copy Touches)", () => {
  const v = judgeDualCopyTouches(["- orchestration/fast-mode-tick-core.md", "- plugin/scripts/x.ts"]);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.equal(v.single.length, 1);
  assert.equal(v.single[0].name, "fast-mode");
});

test("判据4 — both copies declared is ok (pairs counted)", () => {
  const v = judgeDualCopyTouches([
    "- orchestration/fast-mode-tick-core.md",
    "- plugin/loop/fast-mode-tick-core.md",
    "- plugin/scripts/x.ts",
  ]);
  assert.equal(v.ok, true);
  assert.equal(v.pairs, 1);
});

test("判据4 — no execution-core touch is NOT-EVALUATED (never conflated with green)", () => {
  const v = judgeDualCopyTouches(["- plugin/scripts/x.ts"]);
  assert.equal(v.evaluated, false);
});

// ── Integration: the live repo passes after the wiring ──────────────────────────────────────────────

test("--check exits 0 on the live repo after the wiring (判据1/2/3 satisfied; 判据4 report-only)", () => {
  const r = runChecker(["--check", "--root", REPO_ROOT]);
  assert.equal(r.status, 0, `live rhythm-consumer-check must pass:\n${r.stdout}\n${r.stderr}`);
  const out = JSON.parse(runChecker(["--check", "--json", "--root", REPO_ROOT]).stdout);
  assert.equal(out.ok, true);
  const c1 = out.checks.find((c) => c.check === "判据1-non-按需-call-site");
  const c2 = out.checks.find((c) => c.check === "判据2-按需-consumer");
  const c3 = out.checks.find((c) => c.check === "判据3-no-block-consumer");
  assert.ok(c1 && c1.ok, "判据1 passes on the live repo");
  assert.ok(c2 && c2.ok, "判据2 passes on the live repo");
  assert.ok(c3 && c3.ok, "判据3 passes on the live repo");
});

test("--help exits 0 with usage on stdout", () => {
  const r = runChecker(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /rhythm-consumer-check/);
});

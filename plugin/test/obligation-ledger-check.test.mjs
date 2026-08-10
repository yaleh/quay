// @test-group engine
// obligation-ledger-check.test.mjs — the top-level audit of gap-obligation-ledger-mechanization.
//
// Tests the obligation-ledger-check static checker: it mechanically verifies the ledger's integrity
// invariants — (1) obligation ids are DERIVED (same condition ⇒ same id), (2) age is monotonic across
// consecutive live rounds, (3) each round's recorded canClose equals the recomputed value (a round with
// a live undischarged obligation CANNOT be recorded canClose:true — 强行闭轮). Absent ledger ⇒ fail-open.
//
// Run: scripts/test.sh plugin/test/obligation-ledger-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { checkLedger } from "../scripts/obligation-ledger-check.ts";
import { makeTmpDir } from "./helpers/tmp-workspace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const CHECKER = path.join(repoRoot, "plugin/scripts/obligation-ledger-check.ts");

function runChecker(ledger) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, "--ledger", ledger], {
    encoding: "utf8",
  });
}

function round(round, obligations, canClose) {
  return {
    _kind: "round",
    round,
    obligations,
    oldest: null,
    ladder: { escalate: false, oldest_age: 1, threshold: 3 },
    canClose,
    at: "t",
  };
}

function obligation(id, key, opts = {}) {
  return {
    id,
    key,
    condition: `义务 ${key}`,
    source: "fixture",
    semantic: false,
    live: true,
    reading: "r",
    first_true_at: opts.firstTrueAt ?? 1,
    ticks_true: opts.ticks ?? 1,
    discharged_at: opts.dischargedAt ?? null,
    discharged_by: opts.dischargedBy ?? null,
    defer_reason: opts.deferReason ?? null,
    unblock_condition: opts.unblockCondition ?? null,
  };
}

// ── GREEN: correct ledger ────────────────────────────────────────────────────────────────────────────
test("checkLedger: a correct two-round ledger passes all invariants", () => {
  const rounds = [
    round(1, [obligation("OB-X", "X", { ticks: 1 })], false), // live + undischarged ⇒ canClose:false correct
    round(2, [obligation("OB-X", "X", { ticks: 2 })], false), // age monotonic 1 → 2, still undischarged
  ];
  const res = checkLedger(ledgerFrom(rounds));
  assert.equal(res.ok, true, res.violations.join("; "));
  assert.equal(res.roundCount, 2);
  assert.deepEqual(res.violations, []);
});

test("checkLedger: a ledger with NO round records is fail-open", () => {
  const res = checkLedger(ledgerFrom([]));
  assert.equal(res.ok, true);
  assert.equal(res.roundCount, 0);
});

// ── RED: the three defect families ──────────────────────────────────────────────────────────────────
test("checkLedger: a hand-written (non-derived) obligation id is a violation (obligation_set_derived=1)", () => {
  const rounds = [round(1, [obligation("OB-HANDWRITTEN", "X", { ticks: 1 })], false)];
  const res = checkLedger(ledgerFrom(rounds));
  assert.equal(res.ok, false);
  assert.ok(res.violations.some((v) => v.includes("OB-HANDWRITTEN") && v.includes("OB-X")));
});

test("checkLedger: 强行闭轮 — recorded canClose:true with a live undischarged obligation is a violation", () => {
  const rounds = [round(1, [obligation("OB-X", "X", { ticks: 1 })], true)]; // canClose:true is WRONG
  const res = checkLedger(ledgerFrom(rounds));
  assert.equal(res.ok, false);
  assert.ok(res.violations.some((v) => v.includes("canClose=true") && v.includes("recomputed=false")));
});

test("checkLedger: age dropping or jumping across consecutive live rounds is a violation (band)", () => {
  const rounds = [
    round(1, [obligation("OB-X", "X", { ticks: 2 })], false),
    round(2, [obligation("OB-X", "X", { ticks: 1 })], false), // age dropped while live
  ];
  const res = checkLedger(ledgerFrom(rounds));
  assert.equal(res.ok, false);
  assert.ok(res.violations.some((v) => v.includes("went 2 (round 1) → 1 (round 2)")));
});

// ── CLI: absent ledger is fail-open (exit 0) ────────────────────────────────────────────────────────
test("CLI: an absent ledger exits 0 (fail-open — mechanism not yet adopted)", () => {
  const tmp = makeTmpDir("oblig-check-");
  const res = runChecker(path.join(tmp, "does-not-exist.jsonl"));
  assert.equal(res.status, 0);
  assert.match(res.stdout, /no ledger/);
});

function ledgerFrom(rounds) {
  const tmp = makeTmpDir("oblig-check-");
  const file = path.join(tmp, "ledger.jsonl");
  if (rounds.length === 0) {
    fs.writeFileSync(file, "", "utf8");
  } else {
    fs.writeFileSync(file, rounds.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  }
  return file;
}

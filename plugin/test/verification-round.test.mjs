// @test-group engine
// verification-round.test.mjs — AC5: the verification-round carries the DERIVED obligation set, and a
// round with an undischarged/undeferred live obligation CANNOT close (gap-obligation-ledger-mechanization).
//
// The first applicable object of the obligation ledger is the outer's verification round. This file
// pins the integration contract: `obligation-ledger.ts --report` produces the obligation set that
// belongs to a round (keyed by round number, the same numbering verification-round.jsonl uses), and
// `--round-close-check` is the gate that refuses to close a round carrying an undischarged obligation
// — 未处置/未显式 defer ⇒ 不能闭轮, the same shape as the inner DoD gate.
//
// Run: scripts/test.sh plugin/test/verification-round.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { makeTmpDir } from "./helpers/tmp-workspace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const LEDGER = path.join(repoRoot, "plugin/scripts/obligation-ledger.ts");

function runLedger(args) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", LEDGER, ...args], { encoding: "utf8" });
}

test("AC5: a round record carries the derived obligation set; an undischarged live obligation refuses close", () => {
  const tmp = makeTmpDir("vr-oblig-");
  const ledger = path.join(tmp, "obligation-ledger.jsonl");
  const gens = path.join(tmp, "gens.jsonl");
  const readings = path.join(tmp, "readings.jsonl");
  fs.writeFileSync(gens, JSON.stringify({ key: "X", condition: "义务 X", source: "fixture", semantic: false }) + "\n", "utf8");
  fs.writeFileSync(readings, JSON.stringify({ key: "X", live: true, reading: "live" }) + "\n", "utf8");

  // --report derives the round record: it CARRIES the obligation set (id, age, canClose).
  const rep = runLedger(["--report", "--round", "7", "--readings", readings, "--generators", gens, "--ledger", ledger]);
  assert.equal(rep.status, 1); // cannot close — undischarged live obligation
  const report = JSON.parse(rep.stdout);
  assert.equal(report.round, 7);
  assert.equal(report.canClose, false);
  assert.equal(report.obligations.length, 1);
  const ob = report.obligations[0];
  assert.equal(ob.id, "OB-X");
  assert.equal(ob.live, true);
  assert.equal(ob.discharged_at, null);
  assert.equal(ob.defer_reason, null);

  // The gate agrees: a verification round carrying this obligation set cannot close.
  const close = runLedger(["--round-close-check", "--ledger", ledger]);
  assert.equal(close.status, 1);
  assert.match(close.stdout.trim(), /^CANNOT-CLOSE/);
});

test("AC5: the same round CAN close once the obligation is explicitly deferred (reason + unblock)", () => {
  const tmp = makeTmpDir("vr-oblig-");
  const ledger = path.join(tmp, "obligation-ledger.jsonl");
  const gens = path.join(tmp, "gens.jsonl");
  const readings = path.join(tmp, "readings.jsonl");
  fs.writeFileSync(gens, JSON.stringify({ key: "X", condition: "义务 X", source: "fixture", semantic: false }) + "\n", "utf8");
  fs.writeFileSync(readings, JSON.stringify({ key: "X", live: true, reading: "live" }) + "\n", "utf8");
  runLedger(["--report", "--round", "7", "--readings", readings, "--generators", gens, "--ledger", ledger]);

  const def = runLedger(["--defer", "OB-X", "--reason", "阻塞在人的裁定", "--unblock", "人裁定", "--ledger", ledger]);
  assert.equal(def.status, 0);
  const close = runLedger(["--round-close-check", "--ledger", ledger]);
  assert.equal(close.status, 0);
  assert.match(close.stdout.trim(), /^CAN-CLOSE/);
});

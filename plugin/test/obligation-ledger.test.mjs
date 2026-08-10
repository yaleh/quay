// @test-group engine
// obligation-ledger.test.mjs — gap-obligation-ledger-mechanization (AC2-AC5 + the Contract).
//
// The obligation ledger engine: obligations become first-class objects DERIVED from a generator
// registry + readings (not author-written), age is negative feedback (skip ⇒ next round the skipped
// obligation ranks first), the escalation ladder hangs on the OLDEST UNDISCHARGED obligation's age
// (not content), and a round with an undischarged / undeferred live obligation CANNOT close
// (round_cannot_close_with_undischarged = 1, same shape as the inner DoD gate).
//
// Run: scripts/test.sh plugin/test/obligation-ledger.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  deriveObligations,
  undischargedByAgeDesc,
  ladderVerdict,
  canCloseRound,
  DEFAULT_GENERATORS,
} from "../scripts/obligation-ledger.ts";
import { validateDischargeVerdict, deriveObligationId as agentDeriveId } from "../scripts/obligation-discharge-agent.ts";
import { makeTmpDir } from "./helpers/tmp-workspace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const LEDGER = path.join(repoRoot, "plugin/scripts/obligation-ledger.ts");

function runLedger(args) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", LEDGER, ...args], { encoding: "utf8" });
}

/** One fixture generator registry line, JSONL. */
function fixtureGens(keys) {
  return keys
    .map((k) => JSON.stringify({ key: k, condition: `义务 ${k}`, source: "fixture", semantic: false }))
    .join("\n") + "\n";
}

function roundHistory(round, obligations, canClose = false) {
  return { _kind: "round", round, obligations, oldest: null, ladder: { escalate: false, oldest_age: 1, threshold: 3 }, canClose, at: "" };
}

// ── AC2: 义务一等对象 + 推导义务集（同一条件两轮同一 id；漏写即漏记）────────────────────────────
test("AC2: deriveObligationId is deterministic — same condition ⇒ same id, everywhere", () => {
  assert.equal(agentDeriveId("SLOT"), "OB-SLOT");
  assert.equal(agentDeriveId("SLOT"), agentDeriveId("slot")); // case-insensitive, slugged
  assert.equal(agentDeriveId("SLOT"), "OB-SLOT"); // the same derivation in the agent module
  assert.equal(agentDeriveId("pool"), "OB-POOL");
});

test("AC2: the derived obligation set materializes the registry, not the author's cherry-pick", () => {
  const gens = DEFAULT_GENERATORS.filter((g) => g.key === "SLOT" || g.key === "POOL");
  const round1 = deriveObligations(
    gens,
    [
      { key: "SLOT", live: true, reading: "in_flight=0 cap=5 recommended=2" },
      { key: "POOL", live: true, reading: "pool=12 floor=16" },
    ],
    [],
    1,
  );
  assert.equal(round1.obligations.length, 2);
  assert.deepEqual(round1.missingReadings, []);

  // Same two conditions in round 2 ⇒ the SAME two ids (obligation_set_derived = 1).
  const round2 = deriveObligations(
    gens,
    [
      { key: "SLOT", live: true, reading: "in_flight=1 cap=5 recommended=1" },
      { key: "POOL", live: true, reading: "pool=11 floor=16" },
    ],
    [roundHistory(1, round1.obligations)],
    2,
  );
  assert.deepEqual(round2.obligations.map((o) => o.id), ["OB-SLOT", "OB-POOL"]);
  // Age continuity: both live in both rounds ⇒ ticks_true increments 1 → 2.
  assert.deepEqual(round2.obligations.map((o) => o.ticks_true), [2, 2]);
});

test("AC2: a generator with NO reading is recorded 未查 (live:null), not silently dropped — 漏写即漏记", () => {
  const gens = DEFAULT_GENERATORS.filter((g) => g.key === "SLOT" || g.key === "POOL");
  // Only SLOT's reading is supplied — POOL's is MISSING.
  const r = deriveObligations(gens, [{ key: "SLOT", live: true, reading: "in_flight=0 cap=5" }], [], 1);
  assert.deepEqual(r.missingReadings, ["POOL"]);
  const pool = r.obligations.find((o) => o.id === "OB-POOL");
  assert.equal(pool.live, null);
  assert.equal(pool.reading, "MISSING-READING");
  // 未查 is fail-closed: it BLOCKS round-close.
  assert.equal(canCloseRound(r.obligations).canClose, false);
});

// ── AC3: 年龄负反馈（处置顺序按年龄不按成本；跳过 ⇒ 下一轮更靠前）───────────────────────────────
test("AC3: undischargedByAgeDesc sorts by age desc, oldest first — skip makes the old one MORE prominent", () => {
  const customGens = [
    { key: "OLD", condition: "老义务（很早 live）", source: "fixture", semantic: false },
    { key: "NEW", condition: "新义务", source: "fixture", semantic: false },
  ];
  const round1 = deriveObligations(customGens, [{ key: "OLD", live: true, reading: "r1" }], [], 1);
  assert.deepEqual(round1.missingReadings, ["NEW"]); // NEW not read in round 1

  const round2 = deriveObligations(
    customGens,
    [
      { key: "OLD", live: true, reading: "r2 skipped again" },
      { key: "NEW", live: true, reading: "r2 new" },
    ],
    [roundHistory(1, round1.obligations)],
    2,
  );
  const sorted = undischargedByAgeDesc(round2.obligations);
  assert.equal(sorted[0].id, "OB-OLD"); // the skipped old obligation ranks FIRST
  assert.equal(sorted[0].ticks_true, 2); // and its age grew: 1 → 2
  assert.equal(sorted[1].id, "OB-NEW");
  assert.equal(sorted[1].ticks_true, 1);
});

test("AC3: age is monotonic across rounds for a continuously-live obligation (band: 跳过 ⇒ 下一轮更靠前)", () => {
  const customGens = [{ key: "X", condition: "义务 X", source: "fixture", semantic: false }];
  const r1 = deriveObligations(customGens, [{ key: "X", live: true, reading: "r1" }], [], 1);
  const h1 = [roundHistory(1, r1.obligations)];
  const r2 = deriveObligations(customGens, [{ key: "X", live: true, reading: "r2" }], h1, 2);
  const h2 = [...h1, roundHistory(2, r2.obligations)];
  const r3 = deriveObligations(customGens, [{ key: "X", live: true, reading: "r3" }], h2, 3);
  assert.deepEqual([r1.obligations[0].ticks_true, r2.obligations[0].ticks_true, r3.obligations[0].ticks_true], [1, 2, 3]);
  // Oldest-visible age strictly grows: 1 → 2 → 3.
  assert.equal(ladderVerdict(r3.obligations, 3).oldest_age, 3);
});

// ── AC4: 升级阶梯挂最老未处置义务的年龄（不挂内容）──────────────────────────────────────────────
test("AC4: ladder escalates iff the OLDEST UNDISCHARGED obligation's age >= threshold — content is irrelevant", () => {
  const customGens = [
    { key: "OLD", condition: "老义务", source: "fixture", semantic: false },
    { key: "YOUNG", condition: "年轻义务", source: "fixture", semantic: false },
  ];
  const r1 = deriveObligations(customGens, [{ key: "OLD", live: true, reading: "r1" }], [], 1);
  const h1 = [roundHistory(1, r1.obligations)];
  const r2 = deriveObligations(
    customGens,
    [
      { key: "OLD", live: true, reading: "r2" },
      { key: "YOUNG", live: true, reading: "r2" },
    ],
    h1,
    2,
  );
  // Oldest undischarged = OLD (age 2). Threshold 2 ⇒ escalate; threshold 3 ⇒ not.
  const at2 = ladderVerdict(r2.obligations, 2);
  const at3 = ladderVerdict(r2.obligations, 3);
  assert.equal(at2.escalate, true);
  assert.equal(at2.oldest.id, "OB-OLD");
  assert.equal(at3.escalate, false);
  // The ladder keys on AGE, never on content: OLD (age 2) is always the anchor, not the young one.
  assert.equal(ladderVerdict(r2.obligations, 1).oldest.id, "OB-OLD");
});

// ── AC5: 不满足不能收（未处置 / 未显式 defer ⇒ 不能闭轮）───────────────────────────────────────
test("AC5: a live undischarged undeferred obligation BLOCKS round-close — forced close is rejected", () => {
  const customGens = [{ key: "X", condition: "义务 X", source: "fixture", semantic: false }];
  const r = deriveObligations(customGens, [{ key: "X", live: true, reading: "live" }], [], 1);
  const { canClose, blocking } = canCloseRound(r.obligations);
  assert.equal(canClose, false);
  assert.deepEqual(blocking.map((o) => o.id), ["OB-X"]);
});

test("AC5: an explicit defer (reason + unblock condition) unblocks round-close", () => {
  const customGens = [{ key: "X", condition: "义务 X", source: "fixture", semantic: false }];
  const r = deriveObligations(customGens, [{ key: "X", live: true, reading: "live" }], [], 1);
  const obligations = r.obligations.map((o) => ({ ...o, defer_reason: "阻塞在人对生产闸形式的裁定", unblock_condition: "人裁定生产闸形式" }));
  assert.equal(canCloseRound(obligations).canClose, true);
});

test("AC5: the discharge verdict schema is fail-closed — a silent-skip verdict is rejected", () => {
  // discharged:false WITHOUT defer fields = a silent skip renamed as a verdict ⇒ REJECTED.
  const bad = validateDischargeVerdict({ id: "OB-X", discharged: false });
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.ok(bad.errors.some((e) => e.startsWith("defer_reason")));
    assert.ok(bad.errors.some((e) => e.startsWith("unblock_condition")));
  }
  // A proper defer passes.
  assert.equal(
    validateDischargeVerdict({ id: "OB-X", discharged: false, defer_reason: "外部阻塞", unblock_condition: "阻塞解除" }).ok,
    true,
  );
  // A discharge requires who + why.
  assert.equal(validateDischargeVerdict({ id: "OB-X", discharged: true }).ok, false);
  assert.equal(
    validateDischargeVerdict({ id: "OB-X", discharged: true, discharged_by: "outer", discharge_reason: "已按年龄优先处置" }).ok,
    true,
  );
});

// ── Contract: --report two rounds + --oldest + --round-close-check ──────────────────────────────────
test("Contract: --oldest prints '<id> <age>'; skip ⇒ age monotonic 1 → 2 and STILL first; defer unblocks close", () => {
  const tmp = makeTmpDir("oblig-ledger-");
  const ledger = path.join(tmp, "ledger.jsonl");
  const gens = path.join(tmp, "gens.jsonl");
  const readings = path.join(tmp, "readings.jsonl");
  fs.writeFileSync(gens, fixtureGens(["OLD"]), "utf8");
  fs.writeFileSync(readings, JSON.stringify({ key: "OLD", live: true, reading: "r1" }) + "\n", "utf8");
  let res = runLedger(["--report", "--round", "1", "--readings", readings, "--generators", gens, "--ledger", ledger]);
  assert.equal(res.status, 1); // round 1 cannot close (OB-OLD live + undischarged)
  assert.match(runLedger(["--oldest", "--ledger", ledger]).stdout.trim(), /^OB-OLD 1$/);

  // Round 2: OLD still live, skipped ⇒ age 2 ⇒ --oldest shows it aged AND still first.
  fs.writeFileSync(readings, JSON.stringify({ key: "OLD", live: true, reading: "r2 skipped" }) + "\n", "utf8");
  res = runLedger(["--report", "--round", "2", "--readings", readings, "--generators", gens, "--ledger", ledger]);
  assert.equal(res.status, 1); // still cannot close — the skipped obligation is MORE prominent, not less
  assert.match(runLedger(["--oldest", "--ledger", ledger]).stdout.trim(), /^OB-OLD 2$/); // band: age 1 → 2

  // Explicit defer unblocks: round-close-check passes.
  const def = runLedger(["--defer", "OB-OLD", "--reason", "阻塞在人的裁定", "--unblock", "人裁定", "--ledger", ledger]);
  assert.equal(def.status, 0);
  assert.match(def.stdout.trim(), /"_kind":"defer"/);
  const close = runLedger(["--round-close-check", "--ledger", ledger]);
  assert.equal(close.status, 0);
  assert.match(close.stdout.trim(), /^CAN-CLOSE/);
});

test("Contract: undischarged + forced close ⇒ rejected (exit 1); a discharge lets the round close", () => {
  const tmp = makeTmpDir("oblig-ledger-");
  const ledger = path.join(tmp, "ledger.jsonl");
  const gens = path.join(tmp, "gens.jsonl");
  const readings = path.join(tmp, "readings.jsonl");
  fs.writeFileSync(gens, fixtureGens(["X"]), "utf8");
  fs.writeFileSync(readings, JSON.stringify({ key: "X", live: true, reading: "live" }) + "\n", "utf8");
  const rep = runLedger(["--report", "--round", "1", "--readings", readings, "--generators", gens, "--ledger", ledger]);
  assert.equal(rep.status, 1); // rejected: cannot close with undischarged
  const close = runLedger(["--round-close-check", "--ledger", ledger]);
  assert.equal(close.status, 1); // round-close-check agrees
  assert.match(close.stdout.trim(), /^CANNOT-CLOSE/);

  // Handle it → round closes.
  const dis = runLedger(["--discharge", "OB-X", "--by", "outer", "--reason", "已处置", "--ledger", ledger]);
  assert.equal(dis.status, 0);
  assert.equal(runLedger(["--round-close-check", "--ledger", ledger]).status, 0);
});

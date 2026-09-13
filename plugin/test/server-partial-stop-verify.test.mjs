// @test-group engine
// GOAL-017 / AC-254 — the PRODUCER's judgment, exercised through its REAL functions.
//
// WHAT THIS FILE DEFENDS. `plugin/scripts/server-partial-stop-verify.ts` writes AC-254's carrier.
// A producer that can be satisfied by a fixture proves the record CAN be produced, never that one
// HAS been (硬规则 4 推论三) — the production-run evidence for that lives in the task file, not
// here. What belongs HERE is the other half: **can this producer produce a NON-qualifying record?**
// Every branch below is a way the record could be emitted while observing nothing:
//
//   (a) 空转        web was already unreachable BEFORE the stop  ⇒ "unreachable after" is vacuous
//   (b) 整体停机    the host pid changed / the host is dead      ⇒ that is a whole-process
//                                                                   replacement, not a partial stop
//   (c) 不同 run    before/after taken from different run_ids    ⇒ the driver restarted and the
//                                                                   round was re-counted from 1
//   (d) 零推进      the round did not advance                    ⇒ measured, and the answer is "no"
//   (e) 类型        round written as a STRING                    ⇒ the criterion's isinstance(b,int)
//                                                                   makes it structurally disqualifying
//
// (d) and the NOT-EVALUATED branches must be DIFFERENT verdicts — folding them together is 硬规则
// 3b's failure mode ("I measured and nothing happened" vs "I could not measure").
//
// The criterion itself is RE-RUN here (its own `criterion:` block, verbatim, via bash) against a
// synthesized workspace: once accepting a positive record, once REJECTING the string-round copy.
// That pair is the mechanical proof that the type conversion in `parseRoundRecord` is load-bearing
// rather than decorative.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

import {
  AC_ID,
  CARRIER_REL,
  KIND_NAMES,
  buildRecord,
  isIsoInstant,
  parseRoundRecord,
  roundCarrierMap,
  roundCarrierName,
} from "../scripts/server-partial-stop-verify.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────

/** A valid before/after pair: every kind on ONE run_id, every round strictly advanced. */
function readings(overrides = {}) {
  const base = {
    hostPidBefore: 4242,
    hostPidAfter: 4242,
    hostAliveAfter: true,
    webReachableBefore: true,
    webReachableAfter: false,
    controlReachableAfter: true,
    at: "2026-09-13T17:00:00.000Z",
    before: KIND_NAMES.map((kind, i) => ({ kind, carrier: `.quay/${kind}-round.jsonl`, runId: `run-${kind}`, round: 100 + i, roundRawType: "string", ts: "2026-09-13T16:59:00.000Z" })),
    after: KIND_NAMES.map((kind, i) => ({ kind, carrier: `.quay/${kind}-round.jsonl`, runId: `run-${kind}`, round: 101 + i, roundRawType: "string", ts: "2026-09-13T17:01:00.000Z" })),
    stoppedVia: "quay server stop --only web",
    stoppedArgv: ["node", "quay.ts", "server", "stop", "--only", "web"],
    stoppedExit: 0,
    stoppedStdout: "{}",
  };
  return { ...base, ...overrides };
}

/** Locate `goals/AC-254-*.md` and return its `criterion:` block, dedented — the criterion is a
 *  SHELL snippet (`python3 - <<'P' … P`), so it is run with bash exactly as the AC says. */
function criterionSource() {
  const dir = path.join(REPO_ROOT, "goals");
  const file = fs.readdirSync(dir).find((n) => n.startsWith("AC-254-"));
  assert.ok(file, "the AC-254 criterion file exists");
  const lines = fs.readFileSync(path.join(dir, file), "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith("criterion: |-"));
  assert.ok(start >= 0, "the file carries a `criterion: |-` block");
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === "") {
      body.push("");
      continue;
    }
    if (!/^\s/.test(l)) break; // the next top-level frontmatter key
    body.push(l);
  }
  const indents = body.filter((l) => l.trim() !== "").map((l) => l.match(/^\s*/)[0].length);
  const cut = Math.min(...indents);
  return body.map((l) => l.slice(cut)).join("\n");
}

/** Run the criterion verbatim in `ws` and return { code, stderr }. */
function runCriterion(ws) {
  const r = spawnSync("bash", ["-c", criterionSource()], { cwd: ws, encoding: "utf8" });
  return { code: r.status, stderr: r.stderr ?? "", stdout: r.stdout ?? "" };
}

/** A workspace carrying `record` + the six round carriers, all written AFTER the record's `at`. */
function makeCriterionWorkspace(record) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "ac254-criterion-"));
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(ws, CARRIER_REL), JSON.stringify(record) + "\n");
  const map = roundCarrierMap();
  const after = Date.parse(record.at) / 1000 + 5; // strictly after `at`
  for (const kind of KIND_NAMES) {
    const p = path.join(ws, ".quay", map[kind]);
    fs.writeFileSync(p, JSON.stringify({ ts: record.at, round: "1", run_id: "r" }) + "\n");
    fs.utimesSync(p, after, after);
  }
  return ws;
}

// ── the record the criterion actually reads ─────────────────────────────────────────────────────

test("AC-254 — the positive control goes through the REAL buildRecord and its record satisfies the criterion verbatim", (t) => {
  const built = buildRecord(readings());
  assert.equal(built.ok, true, `expected OK, got ${built.verdict}: ${built.reason}`);
  const rec = built.record;
  assert.equal(rec.ac, AC_ID, "ac is the criterion's literal id");
  assert.equal(rec.stopped_service, "web");
  assert.equal(rec.web_reachable_after, false, "JSON false — a string 'false' would be `is not False` in python");
  assert.equal(typeof rec.web_reachable_after, "boolean");
  assert.ok(isIsoInstant(rec.at), "at is ISO-8601");
  assert.deepEqual(Object.keys(rec.driver_round_before_by_kind).sort(), [...KIND_NAMES].sort(), "ALL six kinds (⛔ not ≥1)");
  assert.deepEqual(Object.keys(rec.driver_round_after_by_kind).sort(), [...KIND_NAMES].sort());
  for (const k of KIND_NAMES) {
    assert.equal(Number.isInteger(rec.driver_round_before_by_kind[k]), true, `${k}: before is an INT`);
    assert.equal(Number.isInteger(rec.driver_round_after_by_kind[k]), true, `${k}: after is an INT`);
    assert.ok(rec.driver_round_after_by_kind[k] > rec.driver_round_before_by_kind[k], `${k}: after > before`);
  }

  const ws = makeCriterionWorkspace(rec);
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  const run = runCriterion(ws);
  assert.equal(run.code, 0, `the criterion accepts the produced record (stderr: ${run.stderr})`);
});

test("AC-254 (e) TYPE control — the SAME record with `round` written as a STRING is REJECTED by the criterion", (t) => {
  const rec = buildRecord(readings()).record;
  const stringy = {
    ...rec,
    driver_round_after_by_kind: Object.fromEntries(Object.entries(rec.driver_round_after_by_kind).map(([k, v]) => [k, String(v)])),
  };
  const ws = makeCriterionWorkspace(stringy);
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  const run = runCriterion(ws);
  assert.equal(run.code, 1, `the criterion rejects string rounds (exit 1 = no qualifying record); stderr: ${run.stderr}`);
  assert.match(run.stderr, /no qualifying record/, "and it says so — not a silent pass");

  // …and the producer's OWN judgment refuses the same input one step earlier, with a distinct verdict.
  const typed = buildRecord(readings({ after: readings().after.map((a) => ({ ...a, round: String(a.round) })) }));
  assert.equal(typed.ok, false);
  assert.equal(typed.verdict, "TYPE-INVALID", "the producer's verdict is TYPE-INVALID, not NO-PROGRESS");
});

// ── the negative controls, one per way the record could observe nothing ─────────────────────────

test("AC-254 (a) 空转 control — web unreachable BEFORE the stop ⇒ NOT-EVALUATED, never a record", () => {
  const r = buildRecord(readings({ webReachableBefore: false }));
  assert.equal(r.ok, false);
  assert.equal(r.verdict, "NOT-EVALUATED");
  assert.match(r.reason, /BEFORE/);
  assert.equal(r.record, undefined, "zero record on refusal");
});

test("AC-254 (b) 整体停机 control — a changed / dead host pid is HOST-CHANGED, distinguishable from a partial stop", () => {
  const changed = buildRecord(readings({ hostPidAfter: 9999 }));
  assert.equal(changed.verdict, "HOST-CHANGED");
  // The SIGKILL case: the carrier FILE still names the old pid, so the pid comparison alone passes —
  // `hostAliveAfter` is what catches it. This is the control that keeps "stop --only web" from being
  // indistinguishable from "kill the host".
  const dead = buildRecord(readings({ hostAliveAfter: false }));
  assert.equal(dead.verdict, "HOST-CHANGED");
  assert.match(dead.reason, /NOT alive/);
  // …and control going down with it is its own verdict (that IS "波及其他服务").
  const ctl = buildRecord(readings({ controlReachableAfter: false }));
  assert.equal(ctl.verdict, "CONTROL-DOWN");
  // A web face that is still up means nothing was stopped.
  assert.equal(buildRecord(readings({ webReachableAfter: true })).verdict, "WEB-STILL-UP");
});

test("AC-254 (c) 不同 run control — an after reading from another run_id is RUN-MISMATCH", () => {
  const before = readings().before;
  const after = readings().after.map((a, i) => (i === 2 ? { ...a, runId: "some-other-run" } : a));
  const r = buildRecord(readings({ before, after }));
  assert.equal(r.ok, false);
  assert.equal(r.verdict, "RUN-MISMATCH");
  assert.match(r.reason, /restart/i);
});

test("AC-254 (d) 零推进 control — no advance is NO-PROGRESS, whose verdict differs from NOT-EVALUATED", () => {
  const before = readings().before;
  const after = readings().after.map((a, i) => (i === 1 ? { ...a, round: before[i].round } : a));
  const r = buildRecord(readings({ before, after }));
  assert.equal(r.ok, false);
  assert.equal(r.verdict, "NO-PROGRESS");
  assert.notEqual(r.verdict, "NOT-EVALUATED", "«测了没推进» and «没测成» must not share a value (硬规则 3b)");

  // A missing kind is NOT-EVALUATED — the opposite direction, and it must not be NO-PROGRESS.
  const partial = buildRecord(readings({ after: readings().after.slice(0, 5) }));
  assert.equal(partial.verdict, "NOT-EVALUATED");

  // A non-ISO `at` would make the criterion exit 3 — the producer must refuse it, not emit it.
  assert.equal(buildRecord(readings({ at: "not-a-date" })).verdict, "NOT-EVALUATED");
});

// ── the reading layer: the string→int conversion is load-bearing, and the kind set is DERIVED ────

test("AC-254 — parseRoundRecord converts the carrier's STRING round to an int, keeping the raw type visible", () => {
  const line = JSON.stringify({ ts: "2026-09-13T16:15:44.543Z", round: "2499", run_id: "wk-prod-1789139008" });
  const r = parseRoundRecord(line, "ts");
  assert.equal(r.round, 2499);
  assert.equal(typeof r.round, "number");
  assert.equal(Number.isInteger(r.round), true);
  assert.equal(r.roundRawType, "string", "the pre-conversion type is part of the reading, not discarded");
  assert.equal(r.runId, "wk-prod-1789139008");
  assert.equal(r.ts, "2026-09-13T16:15:44.543Z");

  // Unreadable lines are null (⇒ NOT-EVALUATED upstream), never a fabricated 0.
  assert.equal(parseRoundRecord("not json", "ts"), null);
  assert.equal(parseRoundRecord(JSON.stringify({ ts: "x", run_id: "r" }), "ts"), null);
  assert.equal(parseRoundRecord(JSON.stringify({ ts: "x", round: "abc", run_id: "r" }), "ts"), null);
});

test("AC-254 — the six round carriers are DERIVED from the kernel registry, and equal the criterion's own list", () => {
  const map = roundCarrierMap();
  assert.deepEqual(Object.keys(map).sort(), [...KIND_NAMES].sort(), "every kernel kind has a round carrier");
  // The criterion hardcodes this exact map; deriving it means a new kind cannot silently make the
  // producer and the criterion disagree about what "all six" means.
  assert.deepEqual(map, {
    promotion: "promotion-round.jsonl",
    worker: "worker-round.jsonl",
    outer: "outer-round.jsonl",
    quality: "quality-round.jsonl",
    meta: "meta-driver-round.jsonl",
    goal: "goal-round.jsonl",
  });
  // A kind with no round carrier is NOT-EVALUATED upstream (null), never "no progress".
  assert.equal(roundCarrierName(["outcome.jsonl"]), null);
  assert.equal(roundCarrierName(["a-round.jsonl", "b-round.jsonl"]), null);
});

// @test-group engine
// ac341-post-merge-promotion-events-dialect.test.mjs — the AC-341 regression guard
// (tasks/gap-ac341-criterion-blind-to-v1-status-event-dialect; the criterion lives in
// goals/AC-341-*.md and is re-run every round by goal-driver, so this file is the SUITE-side guard
// that the criterion keeps reading BOTH dialects of its carrier).
//
// THE DEFECT THIS PINS. AC-341 judges: "every promotion-driver todo→ready flip on develop since the
// GOAL-030 merge carries a promote event in .quay/task-status-events.jsonl". The carrier has TWO
// official dialects, both recognised by the repo's own canonical readers
// (plugin/scripts/task-status-events-reconcile.ts:'at = r.ts' for v0 rows; packages/quay/src/cli/task-log.ts
// normalises both): v0 rows carry `ts`, v1 rows (`schema: "task-status-event/v1"`, the writer side that
// landed 2026-10-12T18:21Z) carry `at`. The criterion's scan read ONLY `e.ts`, so every v1 row gave
// `Date.parse(undefined) === NaN`, the `>= t-60000` comparison was permanently false, and the row never
// entered the `have` set — every v1-written flip was reported `CAUSE=flip-without-event`. Measured on
// production 2026-10-13: the pre-fix criterion said 7/154 missing, while all 7 carry a v1 promote event
// with `actor.kind === "promotion-driver"`; 147 v0 + 7 v1 = 154, i.e. the false negatives were exactly
// the v1 rows. The defect is in the JUDGE, not the production write path (hard rule 3b: a judge that
// cannot read its input must not return the same shape it returns for "read it and it is bad").
//
// THE FIX BEING GUARDED (two halves, both load-bearing): (1) read both dialects — `at` if it is a
// string, else `ts`; (2) give "cannot read the input" its OWN value — a candidate row
// (`to=ready ∧ kind=promote`) with neither field exits 3 / NOT-EVALUATED instead of falling through to
// exit 1. NOTHING ELSE CHANGED: the `to=ready ∧ kind=promote` predicate, the `t-60000` window, the
// `CAUSE=flip-without-event` miss path and the `PASS:` stdout line are the ones the criterion had.
//
// WHY THIS TEST IS NOT VACUOUS (hard rule 4 corollary 3: a criterion satisfiable only by an injected
// fixture proves it CAN produce a reading, not that it DOES). Three things make it a measurement:
//   • every arm runs the criterion EXACTLY AS STORED — read out of the goal store at REPO_ROOT, never
//     copied into this file — through runAcceptance, the same runner `quay goal gate` calls;
//   • the arms are BI-DIRECTIONAL: three green arms (v1 / v0 / mixed) plus four red arms that must stay
//     red, so a judge weakened to "always pass" cannot satisfy the set;
//   • the AC7 control runs the PRE-FIX criterion bytes (sha256 74bb00ab…, base64 below) against the very
//     v1 fixture that the installed criterion passes — "switch the correct implementation off and this
//     arm turns red" is what separates a pin from an echo.
//
// HERMETIC: every arm runs with cwd = a throwaway git repo under os.tmpdir(); the production checkout
// and its .quay/ carriers are never touched or read.
//
// Run: scripts/test.sh plugin/test/ac341-post-merge-promotion-events-dialect.test.mjs
//      node --test plugin/test/ac341-post-merge-promotion-events-dialect.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createGoalStore } from "../../packages/quay/src/goal-store.ts";
import { runAcceptance } from "../../packages/quay/src/gate/shared/acceptance-runner.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const GOAL_ID = "AC-341";

// One scratch root for the whole file, removed in after(). Never a fixed __dirname/.tmp-* path
// (test-isolation contract in scripts/test.sh's header).
const SCRATCH_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "ac341-guard-"));
after(() => {
  fs.rmSync(SCRATCH_ROOT, { recursive: true, force: true });
});

// ── fixture timeline ─────────────────────────────────────────────────────────────────────────────
// t = the GOAL-030 landed goal-merge-result the criterion reads its window from. Flip commits and the
// matching events are dated AFTER_T (inside the window); BEFORE_T is more than 60s before t, i.e. the
// "the t-60000 window still applies" arm.
const T = "2026-10-12T18:00:00.000Z";
const AFTER_T = "2026-10-12T18:30:00.000Z";
const BEFORE_T = "2026-10-12T17:00:00.000Z";

const IDS = ["gap-fixture-alpha", "gap-fixture-beta"];

/** The commit subject the criterion's `sed` selects. If this literal ever changes shape the ids stop
 *  being selected, the criterion exits 3, and the green arms below fail loudly — never silently. */
const flipSubject = (id) => `tasks: ${id} todo→ready（promotion-driver 机械晋升）`;

function git(dir, ...args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function makeRepo(name) {
  // A plain mkdir under the single mkdtemp'd SCRATCH_ROOT (removed in after()), not a second
  // mkdtempSync — the test-isolation contract pairs every mkdtemp with a visible cleanup, and the
  // per-arm names below are unique.
  const dir = path.join(SCRATCH_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "develop");
  git(dir, "config", "user.email", "fixture@example.com");
  git(dir, "config", "user.name", "fixture");
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  return dir;
}

/** A GOAL-030 landed merge event — the only source of `t` the criterion has. */
function writeGoalMergeEvent(dir) {
  fs.writeFileSync(
    path.join(dir, ".quay", "gate-events.jsonl"),
    JSON.stringify({ gate: "goal-merge-result", item_id: "GOAL-030", payload: { outcome: "landed" }, timestamp: T }) + "\n",
  );
}

/** A production promotion commit on develop, dated AFTER_T so `git log develop --since=$t` selects it. */
function commitFlip(dir, id) {
  fs.appendFileSync(path.join(dir, "log.txt"), `${id}\n`);
  git(dir, "add", "-A");
  execFileSync("git", ["commit", "-q", "--allow-empty", "-m", flipSubject(id)], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_AUTHOR_DATE: AFTER_T, GIT_COMMITTER_DATE: AFTER_T },
  });
}

const writeEvents = (dir, rows) =>
  fs.writeFileSync(path.join(dir, ".quay", "task-status-events.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

/** v0 dialect matching promote row — timestamp in `ts`. */
const v0 = (id, ts) => ({ ts, taskId: id, from: "todo", to: "ready", kind: "promote", actor: "ready-pool-check --apply" });
/** v1 dialect matching promote row — timestamp in `at`, `actor` is an object (the shipped shape). */
const v1 = (id, at) => ({
  schema: "task-status-event/v1", taskId: id, from: "todo", to: "ready", kind: "promote", at,
  actor: { kind: "promotion-driver", id: "ready-pool-check --apply" },
});
/** A candidate row (`to=ready ∧ kind=promote`) with NO readable timestamp at all. */
const noTimestamp = (id) => ({ taskId: id, from: "todo", to: "ready", kind: "promote" });
/** A promote row whose DESTINATION is `done` — must never satisfy the `to=ready` predicate. */
const readyDone = (id, at) => ({
  schema: "task-status-event/v1", taskId: id, from: "ready", to: "done", kind: "promote", at, actor: { kind: "fan-in" },
});

/** Build a fixture repo with two production flips on develop and the given carrier rows. */
function fixture(name, { events = [], carrier = true } = {}) {
  const dir = makeRepo(name);
  writeGoalMergeEvent(dir);
  for (const id of IDS) commitFlip(dir, id);
  if (carrier) writeEvents(dir, events);
  return dir;
}

// ── the criterion, exactly as the store holds it ─────────────────────────────────────────────────
function storedCriterion() {
  const store = createGoalStore(path.join(REPO_ROOT, "goals"));
  const rec = store.get(GOAL_ID);
  assert.ok(rec, `${GOAL_ID} not found in the goal store — the record was renamed or removed`);
  const criterion = rec.criterion;
  assert.equal(typeof criterion, "string", `${GOAL_ID}.criterion is not a string (got ${typeof criterion})`);
  assert.notEqual(criterion.trim(), "", `${GOAL_ID}.criterion is empty — nothing to run`);
  return criterion;
}

/**
 * The PRE-FIX criterion (sha256 74bb00ab…), kept byte-exact as base64 — a DELIBERATELY FROZEN negative
 * control, not a copy of the live criterion. The repo's usual "never paste criterion text into a test"
 * rule exists so a legitimate criterion rewrite cannot red a test that quoted the old text; this is the
 * opposite case: the control MUST stay frozen at the defective revision, and its sha256 is asserted below
 * so a paraphrase (or a silent edit) fails instead of quietly weakening the control.
 */
const DEGRADED_CRIT_B64 =
  "c2V0IC11CnJvb3Q9JChnaXQgcmV2LXBhcnNlIC0tc2hvdy10b3BsZXZlbCAyPi9kZXYvbnVsbCkgfHwgeyBlY2hvICJOT1QtRVZB" +
  "TFVBVEVEOiBub3QgaW5zaWRlIGEgZ2l0IHJlcG9zaXRvcnkiID4mMjsgZXhpdCAzOyB9CmNkICIkcm9vdCIKdD0kKG5vZGUgLWUg" +
  "JygoKT0+e2NvbnN0IGZzPXJlcXVpcmUoImZzIik7bGV0IHM9IiI7dHJ5e3M9ZnMucmVhZEZpbGVTeW5jKCIucXVheS9nYXRlLWV2" +
  "ZW50cy5qc29ubCIsInV0ZjgiKX1jYXRjaHt9O2xldCByPSIiO2Zvcihjb25zdCBsIG9mIHMuc3BsaXQoIlxuIikpe3RyeXtjb25z" +
  "dCBlPUpTT04ucGFyc2UobCk7aWYoZS5nYXRlPT09ImdvYWwtbWVyZ2UtcmVzdWx0IiYmZS5pdGVtX2lkPT09IkdPQUwtMDMwIiYm" +
  "ZS5wYXlsb2FkJiZlLnBheWxvYWQub3V0Y29tZT09PSJsYW5kZWQiKXI9ZS50aW1lc3RhbXB9Y2F0Y2h7fX07cHJvY2Vzcy5zdGRv" +
  "dXQud3JpdGUocil9KSgpJykKWyAtbiAiJHQiIF0gfHwgeyBlY2hvICJOT1QtRVZBTFVBVEVEOiBHT0FMLTAzMCBoYXMgbm8gbGFu" +
  "ZGVkIGdvYWwtbWVyZ2UtcmVzdWx0IHlldCAocG9zdC1tZXJnZSBBQykiID4mMjsgZXhpdCAzOyB9Cmlkcz0kKGdpdCBsb2cgZGV2" +
  "ZWxvcCAtLXNpbmNlPSIkdCIgLS1mb3JtYXQ9JyVzJyB8IHNlZCAtbkUgJ3MvXnRhc2tzOiAoW14gXSspIHRvZG/ihpJyZWFkee+8" +
  "iHByb21vdGlvbi1kcml2ZXIg5py65qKw5pmL5Y2H77yJLiovXDEvcCcgfCBzb3J0IC11KQpuPSQocHJpbnRmICclc1xuJyAiJGlk" +
  "cyIgfCBncmVwIC1jIC4pClsgIiRuIiAtZ2UgMSBdIHx8IHsgZWNobyAiTk9ULUVWQUxVQVRFRDogbm8gcHJvZHVjdGlvbiBwcm9t" +
  "b3Rpb24tZHJpdmVyIHRvZG/ihpJyZWFkeSBjb21taXQgb24gZGV2ZWxvcCBzaW5jZSB0aGUgbWVyZ2UgKCR0KSIgPiYyOyBleGl0" +
  "IDM7IH0KcHJpbnRmICclc1xuJyAiJGlkcyIgfCBub2RlIC1lICcoKCk9Pntjb25zdCBmcz1yZXF1aXJlKCJmcyIpO2NvbnN0IHQ9" +
  "RGF0ZS5wYXJzZShwcm9jZXNzLmFyZ3ZbMV0pO2xldCBzPSIiO3Byb2Nlc3Muc3RkaW4ub24oImRhdGEiLGQ9PnMrPWQpLm9uKCJl" +
  "bmQiLCgpPT57Y29uc3QgaWRzPXMuc3BsaXQoIlxuIikuZmlsdGVyKEJvb2xlYW4pO2xldCBldj0iIjt0cnl7ZXY9ZnMucmVhZEZp" +
  "bGVTeW5jKCIucXVheS90YXNrLXN0YXR1cy1ldmVudHMuanNvbmwiLCJ1dGY4Iil9Y2F0Y2h7Y29uc29sZS5lcnJvcigiQ0FVU0U9" +
  "ZXZlbnQtY2Fycmllci1hYnNlbnQg4oCUIC5xdWF5L3Rhc2stc3RhdHVzLWV2ZW50cy5qc29ubCBtaXNzaW5nIHdoaWxlICIraWRz" +
  "Lmxlbmd0aCsiIHByb2R1Y3Rpb24gcHJvbW90aW9ucyBoYXBwZW5lZCBzaW5jZSB0aGUgbWVyZ2UiKTtwcm9jZXNzLmV4aXQoMSl9" +
  "CmNvbnN0IGhhdmU9bmV3IFNldCgpO2Zvcihjb25zdCBsIG9mIGV2LnNwbGl0KCJcbiIpKXt0cnl7Y29uc3QgZT1KU09OLnBhcnNl" +
  "KGwpO2lmKGUudG89PT0icmVhZHkiJiZlLmtpbmQ9PT0icHJvbW90ZSImJkRhdGUucGFyc2UoZS50cyk+PXQtNjAwMDApaGF2ZS5h" +
  "ZGQoZS50YXNrSWQpfWNhdGNoe319CmNvbnN0IG1pc3M9aWRzLmZpbHRlcihpPT4haGF2ZS5oYXMoaSkpO2lmKG1pc3MubGVuZ3Ro" +
  "KXtjb25zb2xlLmVycm9yKCJDQVVTRT1mbGlwLXdpdGhvdXQtZXZlbnQg4oCUICIrbWlzcy5sZW5ndGgrIi8iK2lkcy5sZW5ndGgr" +
  "IiBwcm9kdWN0aW9uIHRvZG/ihpJyZWFkeSBmbGlwcyBzaW5jZSB0aGUgbWVyZ2UgaGF2ZSBubyBwcm9tb3RlIGV2ZW50OiAiK21p" +
  "c3Muc2xpY2UoMCw1KS5qb2luKCIsIikpO3Byb2Nlc3MuZXhpdCgxKX0KY29uc29sZS5sb2coIlBBU1M6IGFsbCAiK2lkcy5sZW5n" +
  "dGgrIiBwcm9kdWN0aW9uIHByb21vdGlvbi1kcml2ZXIgdG9kb+KGknJlYWR5IGZsaXBzIHNpbmNlIHRoZSBtZXJnZSBjYXJyeSBh" +
  "IHByb21vdGUgZXZlbnQiKX0pfSkoKScgIiR0Igo=";
const DEGRADED_CRIT_SHA256 = "74bb00abdf89e305bddb2e6d2252623ab329fa726801b51b5fb516d9d5efca39";

/** Run a criterion string the way the gate does, in `cwd`. `reason` carries the runner's own bounded
 *  stderr/stdout excerpt, which is where the CAUSE / NOT-EVALUATED tokens land. */
function runCriterion(criterion, cwd) {
  const r = runAcceptance({ command: criterion, cwd, timeoutMs: 60000 });
  return { code: r.code, reason: r.reason ?? "" };
}

// ── AC2 · both dialects are read ─────────────────────────────────────────────────────────────────
test("AC2a · a v1-only carrier (`at`) passes — the arm that reproduced the production defect", () => {
  const r = runCriterion(storedCriterion(), fixture("ac2a", { events: IDS.map((i) => v1(i, AFTER_T)) }));
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.reason}`);
});

test("AC2b · a v0-only carrier (`ts`) still passes", () => {
  const r = runCriterion(storedCriterion(), fixture("ac2b", { events: IDS.map((i) => v0(i, AFTER_T)) }));
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.reason}`);
});

test("AC2c · a carrier mixing v0 and v1 rows passes", () => {
  const r = runCriterion(storedCriterion(), fixture("ac2c", { events: [v0(IDS[0], AFTER_T), v1(IDS[1], AFTER_T)] }));
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.reason}`);
});

// ── AC3 · the strength was NOT relaxed ───────────────────────────────────────────────────────────
test("AC3a · a flip with no matching event is still a red (exit 1, flip-without-event)", () => {
  const r = runCriterion(storedCriterion(), fixture("ac3a", { events: [] }));
  assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.reason}`);
  assert.match(r.reason, /CAUSE=flip-without-event/, "the miss reason must survive");
});

test("AC3b · a missing carrier is still a red (exit 1, event-carrier-absent)", () => {
  const r = runCriterion(storedCriterion(), fixture("ac3b", { carrier: false }));
  assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.reason}`);
  assert.match(r.reason, /CAUSE=event-carrier-absent/, "carrier absence must keep its own cause");
});

test("AC3c · only pre-merge events do not count — the t-60000 window still applies", () => {
  const r = runCriterion(storedCriterion(), fixture("ac3c", { events: IDS.map((i) => v0(i, BEFORE_T)) }));
  assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.reason}`);
});

test("AC3d · a ready→done promote row does not satisfy the to=ready predicate", () => {
  const r = runCriterion(storedCriterion(), fixture("ac3d", { events: IDS.map((i) => readyDone(i, AFTER_T)) }));
  assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.reason}`);
});

// ── AC4 · "could not read the input" has its own value ───────────────────────────────────────────
test("AC4 · a candidate row with neither `at` nor `ts` exits 3 / NOT-EVALUATED, never 1", () => {
  const r = runCriterion(storedCriterion(), fixture("ac4", { events: [v1(IDS[0], AFTER_T), noTimestamp(IDS[1])] }));
  assert.equal(r.code, 3, `expected exit 3, got ${r.code}: ${r.reason}`);
  assert.match(r.reason, /NOT-EVALUATED/, "an unreadable carrier row must be an explicit non-verdict");
});

// ── AC7 · the pin can take a false value ─────────────────────────────────────────────────────────
test("AC7 · the PRE-FIX criterion bytes turn the v1 arm red (this pin is not an echo)", () => {
  const degraded = Buffer.from(DEGRADED_CRIT_B64, "base64").toString("utf8");
  assert.equal(
    crypto.createHash("sha256").update(degraded, "utf8").digest("hex"),
    DEGRADED_CRIT_SHA256,
    "the frozen pre-fix control is no longer the bytes sha256 74bb00ab… — the control was edited or corrupted",
  );
  assert.notEqual(degraded, storedCriterion(), "the control must differ from the installed criterion");

  const v1Dir = fixture("ac7-v1", { events: IDS.map((i) => v1(i, AFTER_T)) });
  const v1Arm = runCriterion(degraded, v1Dir);
  assert.equal(v1Arm.code, 1, `the pre-fix criterion must go red on a v1 carrier, got exit ${v1Arm.code}`);
  assert.match(v1Arm.reason, /CAUSE=flip-without-event/, "and for exactly the dialect reason");
  // The same bytes on a v0 carrier stay green — the control isolates the TIMESTAMP FIELD, not the fixture.
  const v0Arm = runCriterion(degraded, fixture("ac7-v0", { events: IDS.map((i) => v0(i, AFTER_T)) }));
  assert.equal(v0Arm.code, 0, `the pre-fix criterion passed v0 before, got exit ${v0Arm.code}`);
});

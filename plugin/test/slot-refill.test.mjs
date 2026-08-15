// @test-group governance
// slot-refill.test.mjs — the event-driven dispatch ("slot-refill") decision helper
// (tasks/gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release). Dispatch was
// evaluated ONLY at the inner loop's tick boundary; a completed subagent's freed slot was not
// backfilled until the next tick (measured 39/30/18/33/50-min gaps with a healthy pool). This test
// pins the PRODUCT mechanism for the event-driven path: computing "is a slot free + is there a
// dispatchable candidate" at a COMPLETION event.
//
// AC1 slots_free = max(0, cap − in_flight) — the caller passes the running set explicitly (AC6:
//   telemetry brackets ≠ subagents, never read from telemetry) · AC2 should_refill is the
//   event-driven go/no-go, based on the recommended set (step-4 checks applied) · AC3 recommended is
//   capped at slots_free and production-disjoint (assembleBatch) · AC4 negative control: no
//   dispatchable candidate ⇒ should_refill=false; the helper never writes/dispatches (pure) ·
//   AC5 cap semantics: in-flight ≥ cap ⇒ should_refill=false; cap is an input, never hardcoded ·
//   AC7 idempotent: same inputs ⇒ identical output · AC8 node:test + @test-group governance
// B9 FORCE-DISPATCH (tasks/gap-outer-tick-core-b9-coverage-blind-spot): the outer tick-core B9 branch
//   consumes should_refill + recommended as the two independently-readable preconditions of
//   "空槽强制派发" — should_refill=true AND recommended non-empty ⇒ the tick MUST dispatch 1-2, even when
//   the dispatch QUEUE is non-empty (the old "queue empty ⇒ refill" trigger was the blind spot). The
//   tests below pin the PROBE side: the exact blind-spot shape (non-empty queue + in_flight=0 + a
//   dispatchable recommendation) must be reported as should_refill=true with a non-empty `recommended`
//   the tick can take 1-2 from; a non-empty queue whose candidates ALL fail step-4 ⇒ recommended empty
//   ⇒ should_refill=false (无此场景不误报).
//
// Run: scripts/test.sh plugin/test/slot-refill.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import {
  analyzeSlotRefill,
  computeSlotsFree,
  computeArbitratedCap,
  readSuiteRed,
  isNotYetFlippedSkip,
  hasFanInMerge,
  parseSlotStatusOutput,
  // LANDED-IMPLEMENTATION (tasks/gap-slot-refill-recommends-landed-code-complete-tasks): the pure-git
  // "implementation already in the tree" predicate + its shape-aware completion gate.
  hasLandedImplementation,
  isLandedCodeComplete,
  // IMPLEMENTATION-CLASS FILE (gap-slot-refill-landed-detection-implementation-file-classes): the
  // whitelist predicate that narrows hasLandedImplementation — a non-tasks/ file only counts as
  // landed-implementation evidence when it is an implementation landing point (packages/ ·
  // plugin/scripts/ · plugin/test/ · scripts/ · src/), not a docs/milestones/telemetry sidecar.
  isImplementationClassFile,
  // PHANTOM-KILLER FALSE NEGATIVE (tasks/gap-phantom-killer-false-negative-id-not-in-commits): the
  // task-body-side landed signal (ACs 全勾 + 未勾项均为外层验证 ⇒ 视同 landed — the OR-in alternative to
  // the git-grep, which misses landed tasks whose implementation commits never carry the id) + the
  // outer-verification family recognizer it reuses.
  isBodyLanded,
  isOuterVerificationItem,
  // RESOLVE-BY-TASK-ID (tasks/gap-in-flight-resolve-by-task-id-not-worktree-name): normalize an
  // in-flight identifier (worktree dir / branch / task id) to the TRUE task id so a truncated worktree
  // slug still resolves and the in-flight count stops under-reporting.
  resolveInFlightId,
} from "../scripts/slot-refill.ts";
// AC2 (gap-delivery-critical-label-at-promote-not-after-dispatch): the promote gate is the fix's
// label DETERMINATION point — applyPromotions (ready-pool-check --apply heartbeat) flips todo→ready
// AND writes the delivery-critical label at promote time ("标签与 ready 同现"). The e2e test uses it
// to model the CORRECT timing (label at promote), then asserts slot-refill's sort key consumes it.
// AC47 (gap-ac47-completion-predicate-consumer-fail-closed): the shape-aware completion counter (the
// single source both slot-refill's landed gate and ready-pool-check's notYetFlipped consume) — needed
// directly for the AC2 all-5-consumers negative control on the DIR-014 suffixed-heading shape.
import { applyPromotions, countCompletionCheckboxes } from "../scripts/ready-pool-check.ts";
import { countAcCheckboxes } from "../scripts/task-status-drift-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── fixture helpers ───────────────────────────────────────────────────────────────────────────────

function makeWorkspace(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `slot-refill-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "code"), { recursive: true });
  return dir;
}

function writeTask(root, id, { status = "todo", labels = [], parent = null, role = null, body, selfTouch = true } = {}) {
  const fm = [
    "---",
    `id: ${id}`,
    `title: fixture ${id}`,
    `status: ${status}`,
    role ? `role: ${role}` : null,
    "labels:",
    ...labels.map((l) => `  - ${l}`),
    `parent: ${parent}`,
    "extra:",
    "  schema: v1",
    "---",
  ].filter((x) => x !== null).join("\n");
  // C8 SELF-TOUCH MODELING (gap-slot-refill-c8-reject-no-backfill): a real dispatchable task's
  // `## Touches` must contain `tasks/<id>.md` WITHOUT `(new)` — the C8 dispatch gate
  // (fast-mode-tick-core.md C8) the inner's A15 gate ⑤ applies pre-dispatch. Fixtures DEFAULT to a
  // C8-clean body so slot-refill's default self-touch gate admits them; pass `selfTouch: false` to
  // model a C8-MISSING (non-dispatchable) candidate.
  if (selfTouch && body.includes("## Touches") && !body.includes(`- tasks/${id}.md`)) {
    body = body.replace(/(## Touches\n)/, `$1- tasks/${id}.md\n`);
  }
  fs.writeFileSync(path.join(root, "tasks", `${id}.md`), `${fm}\n\n${body}`);
}

// A dispatchable ready task: `(new)` touches on ABSENT files ⇒ stays in the ready pool (not
// not-yet-flipped: the (new) file does not exist on disk) AND passes the touches-resolve gate
// ((new) entries are not must-exist, so majority-missing is never fired).
function dispatchableBody(touches, extra = "") {
  return [
    "**type:** execution",
    "## Proposal",
    "A real proposal paragraph that is definitely more than forty non-whitespace chars.",
    "## Contract",
    "measure   slot = `node plugin/scripts/slot-refill.ts` stdout 的 slots_free 字段",
    "band      slot = ≥0",
    "invoke    `node plugin/scripts/slot-refill.ts`",
    "control   in-flight≥cap ⇒ should_refill false",
    "resume    分步提交",
    "## Touches",
    ...touches,
    "## Acceptance Criteria",
    "- [ ] an AC item that is long enough",
    "## Definition of Done",
    "standard DoD — the five clauses; meta-enforcer fixture-pinned.",
    extra,
  ].join("\n");
}

function inFlightTask(id, touches) {
  return { id, body: dispatchableBody(touches) };
}

// NOT-YET-FLIPPED SKIP (gap-slot-refill-repeats-done-eligible-recommendations) fixtures.
//
// A ready task whose work has LANDED but status is still `ready` — the "已 fan-in 待翻 done" shape.
// Deliberately crafted so ready-pool-check's `taskWorkLanded` (the MASTER-only git-history signal)
// does NOT fire: the Touches entry is a NON-(new) existing-file path and the AC prose carries no
// resolvable backticked symbols, so `notYetFlipped` returns false and the task stays in pool.ready.
// The ONLY "work landed" evidence is the durable fan-in MERGE record — which the master-only signal
// misses but slot-refill's `hasFanInMerge` (--all merge history) sees. This is the exact real-store
// shape: work fanned into integration/develop, invisible to `git log master`.
function fannedInBody(nChecked, nTotal) {
  const acs = [];
  for (let i = 0; i < nTotal; i++) {
    acs.push(`- [${i < nChecked ? "x" : " "}] AC${i + 1}: a long enough acceptance criterion item number ${i + 1}`);
  }
  return [
    "**type:** execution",
    "## Proposal",
    "A real proposal paragraph that is definitely more than forty non-whitespace chars.",
    "## Contract",
    "measure   slot = `node plugin/scripts/slot-refill.ts` stdout 的 slots_free 字段",
    "band      slot = ≥0",
    "invoke    `node plugin/scripts/slot-refill.ts`",
    "control   in-flight≥cap ⇒ should_refill false",
    "resume    分步提交",
    "## Touches",
    "- code/touched.ts", // NOT (new): existing-file touch ⇒ file existence is not landing evidence
    "## Acceptance Criteria",
    ...acs,
    "## Definition of Done",
    "standard DoD — the five clauses; meta-enforcer fixture-pinned.",
  ].join("\n");
}

/** Real temp git repo where the task's branch was MERGED as a fan-in (the two-line model's durable
 *  fan-in record). `mergeFormat`: "canonical" ⇒ message `fan-in: task/<id>`; "bare" ⇒ message
 *  `merge: <id> — …` (the adhoc format observed for gap-runner-grouping). Current checkout is
 *  `integration` (the fan-in line); `master` does NOT exist — the exact master-invisible shape.
 *  The `code/touched.ts` file the task touches exists on disk (fan-in landed it). */
function makeFannedInWorkspace(tag, { mergeFormat = "canonical" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `slot-refill-fan-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "code"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  runGit(dir, "init", "-q");
  runGit(dir, "config", "user.email", "t@t");
  runGit(dir, "config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
  runGit(dir, "add", "-A");
  runGit(dir, "commit", "-qm", "base");
  runGit(dir, "branch", "-M", "develop");
  // task branch: the task's touched file is implemented there…
  runGit(dir, "checkout", "-qb", "task/gap-fanned");
  fs.writeFileSync(path.join(dir, "code", "touched.ts"), "// implementation\n");
  runGit(dir, "add", "-A");
  runGit(dir, "commit", "-qm", "implement gap-fanned");
  // …then fanned back into develop as a merge (the durable fan-in record).
  runGit(dir, "checkout", "-q", "develop");
  const msg = mergeFormat === "bare" ? "merge: gap-fanned — fan-in" : "fan-in: task/gap-fanned";
  runGit(dir, "merge", "--no-ff", "task/gap-fanned", "-m", msg);
  runGit(dir, "branch", "integration");
  runGit(dir, "checkout", "-q", "integration");
  return dir;
}

// ── AC1: slots_free arithmetic ─────────────────────────────────────────────────────────────────────

test("computeSlotsFree = max(0, cap − in_flight), never negative (AC1)", () => {
  assert.equal(computeSlotsFree(3, 0), 3);
  assert.equal(computeSlotsFree(3, 1), 2);
  assert.equal(computeSlotsFree(3, 2), 1);
  assert.equal(computeSlotsFree(3, 3), 0);
  assert.equal(computeSlotsFree(3, 5), 0, "never negative under overload");
  assert.equal(computeSlotsFree(1, 0), 1);
});

// ── FIXED-CAP RETIREMENT (gap-fixed-cap-5-dynamic-cap-retired AC3) ─────────────────────────────────
// The dynamic cap is retired (human ruling 2026-08-09): `--cap` NOT passed ⇒ the default is the fixed
// constant 5, so slot-refill and its derived floor (5 × floor_mult = 20) are stable regardless of
// load/suite state. This is the Contract's `slot_refill_default_5` invariant.
test("FIXED-CAP — --cap not passed ⇒ default 5, floor = 5 × 4 = 20 (AC3, slot_refill_default_5)", (t) => {
  const root = makeWorkspace("fixed-cap");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  writeTask(root, "gap-b", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/b.ts (new)"]) });

  // analyzeSlotRefill without a cap: default resolves to 5.
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.cap, 5, "default cap is the fixed 5");
  assert.equal(r.floor_mult, 4, "floor_mult default is 4");
  assert.equal(r.floor, 20, "floor = 5 × 4 = 20 (the Contract's floor=20)");
  assert.equal(r.slots_free, 5, "0 in-flight ⇒ 5 free slots at the fixed cap");

  // CLI without --cap: JSON carries cap=5 and floor=20.
  // LOAD-SENSITIVE (gap-delivery-critical-label-at-promote-not-after-dispatch AC4): a bare
  // `slot-refill` (no --in-flight) MEASURES the in-flight view via fast-mode-telemetry --slot-status,
  // whose non-task-subagent count scans /proc GLOBALLY — under a concurrent full suite the live lane
  // processes inflate that count and shrink slots_free (measured: 5→4 under round-109's 16 lanes).
  // QUAY_TELEMETRY_SUBAGENTS is the telemetry CLI's OWN documented deterministic override (same pin
  // fast-mode-telemetry.test.mjs / ac36-sortkey-criterion-check.test.mjs apply for exact-count
  // assertions). Pinning it to 0 hermeticizes the exact slots_free=5 assertion against ambient load.
  const script = path.resolve(__dirname, "..", "scripts", "slot-refill.ts");
  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", script, "--root", root],
    { encoding: "utf8", env: { ...process.env, QUAY_TELEMETRY_SUBAGENTS: "0" } },
  );
  const parsed = JSON.parse(out);
  assert.equal(parsed.cap, 5, "CLI --cap default is 5");
  assert.equal(parsed.floor, 20, "CLI floor = 20");
  assert.equal(parsed.slots_free, 5);
});

test("FIXED-CAP — an explicit --cap still overrides the fixed default (manual/test runs)", (t) => {
  const root = makeWorkspace("cap-override");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  const r3 = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.equal(r3.cap, 3, "explicit cap wins");
  assert.equal(r3.slots_free, 3);
});

// ── AC2/AC3: positive — free slot + dispatchable candidate ⇒ should_refill, capped recommended ──────

test("should_refill=true with a free slot and a dispatchable candidate (AC2/AC3)", (t) => {
  const root = makeWorkspace("pos");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  writeTask(root, "gap-b", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/b.ts (new)"]) });

  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.equal(r.slots_free, 3);
  assert.equal(r.pool, 2);
  assert.equal(r.should_refill, true);
  assert.equal(r.no_refill_reason, null);
  assert.equal(r.recommended.length, 2, "both disjoint candidates recommended (capped at slots_free=3)");
  assert.ok(r.recommended.includes("gap-a"));
  assert.ok(r.recommended.includes("gap-b"));
});

// ── B9 空槽强制派发 (tasks/gap-outer-tick-core-b9-coverage-blind-spot) ──────────────────────────────
// The outer tick-core B9 branch: should_refill=true AND recommended non-empty ⇒ the tick MUST
// force-dispatch 1-2 from recommended (queue-empty is no longer the only trigger — the 2026-08-10
// 05:00–06:44 blind spot was a NON-empty queue with in_flight=0 and should_refill=true yet zero
// dispatch). These tests pin the PROBE side of that force-dispatch chain.

test("B9 FORCE-DISPATCH — non-empty queue + in_flight=0 + recommended non-empty ⇒ should_refill=true, recommended carries 1-2+ dispatchable ids (AC2)", (t) => {
  const root = makeWorkspace("b9-force");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // A NON-EMPTY ready queue (3 disjoint dispatchable candidates) — the old B9 "queue empty ⇒ refill"
  // trigger would NOT fire here, which is exactly the blind spot being closed.
  writeTask(root, "gap-b9-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/b9a.ts (new)"]) });
  writeTask(root, "gap-b9-b", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/b9b.ts (new)"]) });
  writeTask(root, "gap-b9-c", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/b9c.ts (new)"]) });

  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 5 });
  assert.equal(r.pool, 3, "the queue is NON-empty (3 ready candidates)");
  assert.equal(r.in_flight_count, 0, "in_flight=0 — the queue is non-empty but nothing is running");
  assert.equal(r.slots_free, 5, "empty slots exist");
  assert.equal(r.should_refill, true, "should_refill=true — the blind-spot scenario the old B9 missed");
  assert.equal(r.no_refill_reason, null);
  assert.ok(r.recommended.length >= 1, "recommended is non-empty — the tick can take 1-2 from it");
  assert.ok(r.recommended.includes("gap-b9-a") && r.recommended.includes("gap-b9-b") && r.recommended.includes("gap-b9-c"),
    "all disjoint candidates are recommended (force-dispatch has 1-2+ to pick)");
});

test("B9 FORCE-DISPATCH — negative control: non-empty queue but recommended empty (no step-4 candidate) ⇒ should_refill=false, no false dispatch (control: 无此场景不误报)", (t) => {
  const root = makeWorkspace("b9-neg");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Queue is non-empty, but the ONLY candidate fails the step-4 touches-resolve check (absent files
  // WITHOUT (new)) ⇒ recommended is empty ⇒ the force-dispatch branch must NOT fire.
  writeTask(root, "gap-b9-missing", {
    status: "ready",
    labels: ["gap"],
    body: dispatchableBody(["- code/absent-1.ts", "- code/absent-2.ts"]),
  });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 5 });
  assert.equal(r.pool, 1, "the queue is non-empty (1 candidate)");
  assert.equal(r.slots_free, 5, "slots exist");
  assert.equal(r.recommended.length, 0, "but no dispatchable recommendation passes step-4");
  assert.equal(r.should_refill, false, "recommended empty ⇒ should_refill=false ⇒ no force dispatch (无此场景不误报)");
  assert.match(r.no_refill_reason, /no dispatchable candidate/);
});

test("recommended is capped at slots_free (AC3)", (t) => {
  const root = makeWorkspace("cap-rec");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const id of ["gap-r1", "gap-r2", "gap-r3", "gap-r4"]) {
    writeTask(root, id, { status: "ready", labels: ["gap"], body: dispatchableBody([`- code/${id}.ts (new)`]) });
  }
  // Only 1 slot free (cap 3, 2 in-flight).
  const inFlight = [inFlightTask("gap-in1", ["- code/in1.ts (new)"]), inFlightTask("gap-in2", ["- code/in2.ts (new)"])];
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3, inFlight });
  assert.equal(r.slots_free, 1);
  assert.equal(r.recommended.length, 1, "recommended never exceeds slots_free");
});

// ── AC5: the cap bound — in-flight ≥ cap ⇒ no refill ───────────────────────────────────────────────

test("in-flight ≥ cap ⇒ should_refill=false, no_refill_reason names the bound (AC5)", (t) => {
  const root = makeWorkspace("cap-bound");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  const inFlight = [
    inFlightTask("gap-f1", ["- code/f1.ts (new)"]),
    inFlightTask("gap-f2", ["- code/f2.ts (new)"]),
    inFlightTask("gap-f3", ["- code/f3.ts (new)"]),
  ];
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3, inFlight });
  assert.equal(r.slots_free, 0);
  assert.equal(r.should_refill, false);
  assert.match(r.no_refill_reason, /no free slots/);
  assert.deepEqual(r.recommended, []);
});

test("cap is an INPUT — a smaller cap reduces free slots (AC5 mechanism/strategy separation)", (t) => {
  const root = makeWorkspace("cap-input");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  const r1 = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  const r2 = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 1 });
  assert.equal(r1.slots_free, 3);
  assert.equal(r2.slots_free, 1, "a cap of 1 leaves exactly 1 free slot");
  assert.equal(r1.should_refill, true);
  assert.equal(r2.should_refill, true);
});

// ── REVERSE DIRECTION (gap-closed-bracket-leaves-live-agent-consuming-slots): a CLOSED bracket whose
//    executor is still present occupies a slot — slots_free must not read it as free ─────────────────

test("closedButLive occupies a slot: slots_free reduced, can flip should_refill (AC3 reverse)", (t) => {
  const root = makeWorkspace("cbl");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  // cap 1; 1 running + 1 closed-but-live ⇒ occupied 2 ⇒ 0 free ⇒ no refill into a busy slot.
  const inFlight = [inFlightTask("gap-run", ["- code/run.ts (new)"])];
  const closedButLive = [inFlightTask("gap-ghost", ["- code/ghost.ts (new)"])];
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 1, inFlight, closedButLive });
  assert.equal(r.in_flight_count, 1);
  assert.equal(r.closed_but_live_count, 1);
  assert.equal(r.occupied_slots, 2);
  assert.equal(r.slots_free, 0);
  assert.equal(r.should_refill, false);
  assert.match(r.no_refill_reason, /closed-but-live 1/);
  assert.deepEqual(r.recommended, []);
});

test("closedButLive absent ⇒ byte-compatible forward-only slot arithmetic", (t) => {
  const root = makeWorkspace("cbl-absent");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  const inFlight = [inFlightTask("gap-run", ["- code/run.ts (new)"])];
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 2, inFlight });
  assert.equal(r.closed_but_live_count, 0);
  assert.equal(r.occupied_slots, 1);
  assert.equal(r.slots_free, 1);
  assert.equal(r.should_refill, true);
});

test("a candidate colliding with a closedButLive agent's touches is not recommended (concurrency eligibility)", (t) => {
  const root = makeWorkspace("cbl-collide");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-free", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/free.ts (new)"]) });
  writeTask(root, "gap-blocked", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/ghost.ts (new)"]) });
  const closedButLive = [inFlightTask("gap-ghost", ["- code/ghost.ts (new)"])];
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 2, closedButLive });
  assert.equal(r.slots_free, 1, "cap 2 − 1 closed-but-live = 1");
  assert.ok(r.recommended.includes("gap-free"), "disjoint-from-closed-but-live candidate recommended");
  assert.ok(!r.recommended.includes("gap-blocked"), "candidate colliding with a closed-but-live agent's touches is NOT recommended");
});

test("CLI --closed-but-live: closed-bracket-but-live ids reduce slots_free (AC3 reverse)", (t) => {
  const root = makeWorkspace("cli-cbl");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  writeTask(root, "gap-ghost", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/ghost.ts (new)"]) });
  const script = path.resolve(__dirname, "..", "scripts", "slot-refill.ts");
  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", script, "--root", root, "--cap", "1", "--closed-but-live", "gap-ghost"],
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(out);
  assert.equal(parsed.closed_but_live_count, 1);
  assert.equal(parsed.occupied_slots, 1);
  assert.equal(parsed.slots_free, 0);
  assert.equal(parsed.should_refill, false);
});

// ── AC4: negative control — no dispatchable candidate ⇒ no refill ──────────────────────────────────

test("empty ready pool ⇒ should_refill=false with a named reason (AC4)", (t) => {
  const root = makeWorkspace("neg-empty");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.equal(r.pool, 0);
  assert.equal(r.slots_free, 3);
  assert.equal(r.should_refill, false);
  assert.match(r.no_refill_reason, /no dispatchable candidate/);
  assert.deepEqual(r.recommended, []);
});

test("only a majority-missing-touches candidate ⇒ should_refill=false (step-4 touches-resolve applied)", (t) => {
  const root = makeWorkspace("neg-missing");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Touches point at ABSENT files WITHOUT the (new) tag → majority-missing → not dispatchable.
  writeTask(root, "gap-missing", {
    status: "ready",
    labels: ["gap"],
    body: dispatchableBody(["- code/absent-1.ts", "- code/absent-2.ts"]),
  });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.equal(r.pool, 1, "the candidate is in the ready pool…");
  assert.equal(r.should_refill, false, "…but fails the step-4 touches-resolve check ⇒ no refill");
  assert.deepEqual(r.recommended, []);
});

test("ready candidate whose parent is not done ⇒ not recommended (deps-ready filter)", (t) => {
  const root = makeWorkspace("neg-deps");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-orphan", { status: "todo", labels: ["gap"], body: dispatchableBody(["- code/orphan.ts (new)"]) });
  writeTask(root, "gap-child", {
    status: "ready",
    labels: ["gap"],
    parent: "gap-ghost-parent", // parent file missing ⇒ fail-closed, deps not ready
    body: dispatchableBody(["- code/child.ts (new)"]),
  });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.equal(r.pool, 1, "gap-child is ready and in the pool");
  assert.deepEqual(r.recommended, [], "undone-parent ready candidate is not dispatchable");
  assert.equal(r.should_refill, false);
});

// ── COMPOUND AGGREGATION (gap-compound-depsreadyfor-structural-deadlock AC2 + invariants) ────────────
// (1) compound_parent_not_dispatchable: a `role: compound` parent is an AGGREGATE (done ⇔ all children
//     done) — never leaf work — so it must NEVER be recommended and must be deferred with the explicit
//     reason `compound-not-dispatchable`, NOT `self-touch-missing-c8` (its Touches delegate to children
//     by convention — no_self_touch_false_negative).
// (2) a READY child of a compound parent is deps-ready (the compound-parent edge is skipped) ⇒ it IS
//     recommended — the deadlock direction broken on the dispatch path too.

test("COMPOUND: a ready compound parent is never recommended; deferred compound-not-dispatchable, not self-touch-missing", (t) => {
  const root = makeWorkspace("compound-norec");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Ready compound parent with NO self-file (its Touches delegate to children by convention).
  writeTask(root, "gap-compound", {
    status: "ready", labels: ["gap"], role: "compound", selfTouch: false,
    body: dispatchableBody(["- code/comp.ts (new)"]),
  });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.equal(r.pool, 1, "compound parent is ready and in the pool");
  assert.deepEqual(r.recommended, [], "compound parent must NEVER be recommended (aggregate, not leaf work)");
  const reasons = (r.deferred || []).filter((d) => d.id === "gap-compound").map((d) => d.reason);
  assert.ok(reasons.includes("compound-not-dispatchable"), "compound deferred with the explicit compound reason");
  assert.ok(!reasons.includes("self-touch-missing-c8"), "compound must NOT be deferred as self-touch-missing (no false negative)");
  assert.equal(r.should_refill, false);
});

test("COMPOUND: a READY child of a compound parent is recommended (compound-parent edge skipped)", (t) => {
  const root = makeWorkspace("compound-child");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Compound parent (ready, not done) + a READY child naming it. Pre-fix the child would be deferred
  // deps-not-ready (parent not done) — the deadlock. Post-fix the compound-parent edge is skipped.
  writeTask(root, "gap-compound", {
    status: "ready", labels: ["gap"], role: "compound", selfTouch: false,
    body: dispatchableBody(["- code/comp.ts (new)"]),
  });
  writeTask(root, "gap-compound-child", {
    status: "ready", labels: ["gap"], parent: "gap-compound", selfTouch: true,
    body: dispatchableBody(["- code/child.ts (new)"]),
  });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.equal(r.pool, 2, "both compound parent and child are ready and in the pool");
  assert.ok(r.recommended.includes("gap-compound-child"), "a child of a compound parent IS deps-ready and recommended (deadlock broken)");
  assert.ok(!r.recommended.includes("gap-compound"), "the compound parent itself is still not recommended");
  const reasons = (r.deferred || []).filter((d) => d.id === "gap-compound").map((d) => d.reason);
  assert.ok(reasons.includes("compound-not-dispatchable"), "compound parent deferred with the explicit compound reason");
});

// ── AC3: recommended is production-disjoint (no two colliding candidates) ───────────────────────────

test("recommended never contains two colliding candidates (assembleBatch disjointness)", (t) => {
  const root = makeWorkspace("disjoint");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-shared-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/shared.ts (new)"]) });
  writeTask(root, "gap-shared-b", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/shared.ts (new)"]) });
  writeTask(root, "gap-other", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/other.ts (new)"]) });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.equal(r.slots_free, 3);
  assert.equal(r.recommended.length, 2, "one of the colliding pair + gap-other");
  // The two colliding tasks must never BOTH be recommended.
  const hasA = r.recommended.includes("gap-shared-a");
  const hasB = r.recommended.includes("gap-shared-b");
  assert.ok(!(hasA && hasB), "colliding candidates must not be recommended together");
  assert.ok(r.recommended.includes("gap-other"));
});

test("ready candidate colliding with an in-flight task is not recommended (concurrency eligibility)", (t) => {
  const root = makeWorkspace("inflight-collide");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-free", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/free.ts (new)"]) });
  writeTask(root, "gap-blocked", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/inflight.ts (new)"]) });
  const inFlight = [inFlightTask("gap-in1", ["- code/inflight.ts (new)"])];
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3, inFlight });
  assert.equal(r.slots_free, 2);
  assert.ok(r.recommended.includes("gap-free"), "disjoint-from-in-flight candidate recommended");
  assert.ok(!r.recommended.includes("gap-blocked"), "candidate colliding with in-flight is not recommended");
});

// ── DEFER ACCOUNTING (gap-over90-clock-measures-queue-time-not-work-time): slot-refill is a PURE
// recommender (never writes brackets), but it must SURFACE which candidates were deferred and why so
// the tick can mechanically close their open brackets (closure-lag-check.sh --close-task --outcome
// deferred) — the queue segment then never counts toward OVER90. ─────────────────────────────────────

test("DEFER — slot-refill exposes deferred candidates with reasons (touches-overlap / deps / majority-missing / self-touch)", (t) => {
  const root = makeWorkspace("defer");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Recommended: a clean disjoint candidate.
  writeTask(root, "gap-free", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/free.ts (new)"]) });
  // Deferred (touches-overlap with in-flight): must be surfaced with the overlap reason.
  writeTask(root, "gap-blocked", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/inflight.ts (new)"]) });
  // Deferred (deps not ready): parent not done.
  writeTask(root, "gap-dep", { status: "ready", labels: ["gap"], parent: "gap-never-done", body: dispatchableBody(["- code/dep.ts (new)"]) });
  // Deferred (majority-missing touches): absent files without (new).
  writeTask(root, "gap-missing", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/absent-1.ts", "- code/absent-2.ts"]) });
  // Deferred (C8 self-touch missing): own task file not in Touches.
  writeTask(root, "gap-selftouch", { status: "ready", labels: ["gap"], selfTouch: false, body: dispatchableBody(["- code/st.ts (new)"]) });
  const inFlight = [inFlightTask("gap-in1", ["- code/inflight.ts (new)"])];
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 5, inFlight });

  assert.ok(r.recommended.includes("gap-free"), "the disjoint candidate is still recommended");
  const byId = Object.fromEntries(r.deferred.map((d) => [d.id, d.reason]));
  assert.ok(r.deferred.length >= 4, `expected ≥4 deferred candidates, got ${r.deferred.length}`);
  assert.ok(byId["gap-blocked"] && /touches-overlap-in-flight/.test(byId["gap-blocked"]),
    `touches-overlap defer surfaced with reason, got: ${JSON.stringify(byId["gap-blocked"])}`);
  assert.ok(byId["gap-dep"] && /deps-not-ready/.test(byId["gap-dep"]), "deps-not-ready defer surfaced");
  assert.ok(byId["gap-missing"] && /touches-majority-missing/.test(byId["gap-missing"]), "touches-majority-missing defer surfaced");
  assert.ok(byId["gap-selftouch"] && /self-touch-missing-c8/.test(byId["gap-selftouch"]), "self-touch defer surfaced");
  // None of the deferred ids may appear in recommended.
  for (const d of r.deferred) assert.ok(!r.recommended.includes(d.id), `deferred ${d.id} must not be recommended`);
});

test("SUPERSEDED FILTER — marker-form only: a ready task CARRYING **SUPERSEDED** is deferred; one DISCUSSING the word is recommended (AC46 marker fix)", (t) => {
  const root = makeWorkspace("superseded-filter");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Marker-form: the outer retreat writes `> **SUPERSEDED / 作废** …` — must be deferred.
  writeTask(root, "gap-marker", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/marker.ts (new)"], "\n> **SUPERSEDED / 作废** premise deleted by a human ruling.\n") });
  // Discussion-only: the body names the `superseded-capability` checker — before the fix the bare
  // /SUPERSEDED/i regex matched this and wrongly deferred the task (gap-slot-refill-clique-ignores-
  // landed-touches real-world sample). Must stay dispatchable.
  writeTask(root, "gap-discusses", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/discusses.ts (new)"], "\nThe superseded-capability checker runs in the full-suite gate.\n") });
  writeTask(root, "gap-clean", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/clean.ts (new)"]) });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 5 });
  const byId = Object.fromEntries((r.deferred || []).map((d) => [d.id, d.reason]));
  assert.ok(/superseded/.test(byId["gap-marker"] || ""), `marker-carrying task deferred as superseded, got: ${byId["gap-marker"]}`);
  assert.ok(!(byId["gap-discusses"] || "").includes("superseded"), "discussion-only task NOT deferred as superseded");
  assert.ok(r.recommended.includes("gap-discusses"), "discussion-only task is recommended");
  assert.ok(r.recommended.includes("gap-clean"), "clean task is recommended");
  assert.ok(!r.recommended.includes("gap-marker"), "marker-carrying task never recommended");
});

// ── AC7: idempotence — pure, no writes, same inputs ⇒ identical output ─────────────────────────────

test("analyzeSlotRefill is a pure reader: same inputs ⇒ deep-equal output, no store mutation (AC7)", (t) => {
  const root = makeWorkspace("idem");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  writeTask(root, "gap-b", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/b.ts (new)"]) });
  const tasksDir = path.join(root, "tasks");
  const before = fs.readFileSync(path.join(tasksDir, "gap-a.md"), "utf8");
  const r1 = analyzeSlotRefill({ tasksDir, root, cap: 3 });
  const r2 = analyzeSlotRefill({ tasksDir, root, cap: 3 });
  assert.deepEqual(r2, r1, "repeated evaluation with the same state is byte-identical");
  const after = fs.readFileSync(path.join(tasksDir, "gap-a.md"), "utf8");
  assert.equal(after, before, "the helper must not mutate the store");
});

// ── CLI smoke ─────────────────────────────────────────────────────────────────────────────────────

test("CLI smoke: --root/--cap/--in-flight produces JSON with the refill fields (exit 0)", (t) => {
  const root = makeWorkspace("cli");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  writeTask(root, "gap-b", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/b.ts (new)"]) });
  const script = path.resolve(__dirname, "..", "scripts", "slot-refill.ts");
  // LOAD-SENSITIVE (gap-delivery-critical-label-at-promote-not-after-dispatch AC4): a bare
  // `slot-refill` (no --in-flight) MEASURES the in-flight view via the /proc-GLOBAL non-task-subagent
  // scan — under a concurrent full suite the live lane processes inflate it and shrink slots_free
  // (measured: 3→2 under round-109's 16 lanes). QUAY_TELEMETRY_SUBAGENTS=0 is the telemetry CLI's own
  // documented deterministic override (same pin the ac36 e2e and fast-mode-telemetry tests apply).
  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", script, "--root", root, "--cap", "3"],
    { encoding: "utf8", env: { ...process.env, QUAY_TELEMETRY_SUBAGENTS: "0" } },
  );
  const parsed = JSON.parse(out);
  assert.equal(typeof parsed.slots_free, "number");
  assert.equal(typeof parsed.should_refill, "boolean");
  assert.equal(typeof parsed.dispatchable_disjoint, "number");
  assert.equal(parsed.slots_free, 3);
  assert.equal(parsed.should_refill, true);
  assert.ok(Array.isArray(parsed.recommended));
  assert.equal(parsed.recommended.length, 2);
});

// ── RESOLVE-BY-TASK-ID (tasks/gap-in-flight-resolve-by-task-id-not-worktree-name) ──────────────────
// AC1 判据1: `--in-flight` parsing matches BY TASK ID — worktree dir name / branch name / task id all
// normalize to the TRUE task id, so a truncated worktree slug (the `<slug>` convention's agent-chosen
// abbreviation) still resolves. The three forms' in_flight_count MUST agree (⊢ disagreement ⇒ RED).
// AC2 判据2 (real sample, 能取假): gap-workflows-dual-copy-drift (truncated dir — true id
// `…-unchecked`) previously under-counted the in-flight set (readTasks silently skipped the missing
// `tasks/<slug>.md`); after the fix the truncated name resolves to the true id and the count is not
// biased. AC3 判据3: the AC53 gate is NOT changed — only the quantity fed to it (the in-flight set).

test("resolveInFlightId — exact id / branch form / truncated dir all resolve to the true task id (判据1)", (t) => {
  const root = makeWorkspace("resolve");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tasksDir = path.join(root, "tasks");
  // The real 2026-08-14 sample pair: the worktree slug is a TRUNCATED prefix of the true task id.
  writeTask(root, "gap-workflows-dual-copy-drift-unchecked", {
    status: "ready", labels: ["gap"], body: dispatchableBody(["- code/wcd.ts (new)"]),
  });
  // A prefix-collision guard: an id whose prefix is ALSO a distinct exact task — the exact task must
  // win (never re-resolve an exact id to a longer prefix-match sibling).
  writeTask(root, "gap-prefix", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/p.ts (new)"]) });
  writeTask(root, "gap-prefix-extended", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/pe.ts (new)"]) });

  // 1. exact task id → exact, unchanged.
  assert.deepEqual(resolveInFlightId(tasksDir, "gap-workflows-dual-copy-drift-unchecked"),
    { id: "gap-workflows-dual-copy-drift-unchecked", method: "exact" });
  // 2. branch form `task/<id>` → strip the prefix, exact.
  assert.deepEqual(resolveInFlightId(tasksDir, "task/gap-workflows-dual-copy-drift-unchecked"),
    { id: "gap-workflows-dual-copy-drift-unchecked", method: "exact" });
  // 3. TRUNCATED worktree dir name → truncated-prefix resolves to the TRUE id (the real sample).
  assert.deepEqual(resolveInFlightId(tasksDir, "gap-workflows-dual-copy-drift"),
    { id: "gap-workflows-dual-copy-drift-unchecked", method: "truncated-prefix" });
  // 4. TRUNCATED branch name → strip `task/`, then truncated-prefix.
  assert.deepEqual(resolveInFlightId(tasksDir, "task/gap-workflows-dual-copy-drift"),
    { id: "gap-workflows-dual-copy-drift-unchecked", method: "truncated-prefix" });
  // 5. an exact id whose longer sibling also shares the prefix → exact wins, NEVER re-resolved.
  assert.deepEqual(resolveInFlightId(tasksDir, "gap-prefix"), { id: "gap-prefix", method: "exact" });
  // 6. unresolved (no task matches) → input unchanged, method "unresolved".
  assert.deepEqual(resolveInFlightId(tasksDir, "gap-no-such-task"), { id: "gap-no-such-task", method: "unresolved" });
});

test("resolveInFlightId — ambiguous prefix (2+ tasks extend it) ⇒ unresolved, never guesses", (t) => {
  const root = makeWorkspace("resolve-amb");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tasksDir = path.join(root, "tasks");
  writeTask(root, "gap-amb-one", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/1.ts (new)"]) });
  writeTask(root, "gap-amb-two", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/2.ts (new)"]) });
  // `gap-amb` is a strict prefix of BOTH — ambiguous ⇒ unresolved (a wrong id would poison the
  // touches-disjointness set worse than a missing id).
  assert.deepEqual(resolveInFlightId(tasksDir, "gap-amb"), { id: "gap-amb", method: "unresolved" });
});

test("CLI --in-flight: truncated worktree dir name resolves to the true id — in_flight_count not biased (判据2 real sample)", (t) => {
  const root = makeWorkspace("resolve-cli");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-workflows-dual-copy-drift-unchecked", {
    status: "ready", labels: ["gap"], body: dispatchableBody(["- code/wcd.ts (new)"]),
  });
  const script = path.resolve(__dirname, "..", "scripts", "slot-refill.ts");
  const run = (inFlight) => JSON.parse(execFileSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", script, "--root", root, "--cap", "3", "--json", "--in-flight", inFlight],
    { encoding: "utf8", env: { ...process.env, QUAY_TELEMETRY_SUBAGENTS: "0" } },
  ));
  // TRUE id form.
  const byTrueId = run("gap-workflows-dual-copy-drift-unchecked");
  assert.equal(byTrueId.in_flight_count, 1, "true task id form → 1 in-flight");
  // TRUNCATED worktree dir form (the 2026-08-14 real sample). PRE-FIX this silently skipped
  // `tasks/gap-workflows-dual-copy-drift.md` (missing) → in_flight_count=0 → slots_free inflated
  // → AC53 拒写. POST-FIX it resolves to the true id → count agrees with the true-id form.
  const byTruncDir = run("gap-workflows-dual-copy-drift");
  assert.equal(byTruncDir.in_flight_count, 1, "truncated worktree dir name resolves → 1 in-flight");
  // 判据1 ⊢: the truncated dir form and the true-id form AGREE (disagreement ⇒ RED).
  assert.equal(byTruncDir.in_flight_count, byTrueId.in_flight_count,
    "判据1: worktree-dir-name form and task-id form MUST give the same in_flight_count");
  assert.equal(byTruncDir.slots_free, byTrueId.slots_free,
    "the truncated form must not inflate slots_free (the AC53 gate quantity is fixed, the gate untouched)");
});

test("CLI --in-flight: the three forms (true id / branch / truncated dir) agree on in_flight_count (判据1)", (t) => {
  const root = makeWorkspace("resolve-3form");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The full real 2026-08-14 in-flight set (5 worktrees): two have truncated slugs.
  const ids = [
    "gap-ac63-judgment2-no-carrier",
    "gap-fan-in-flip-no-ac-completion-check",
    "gap-in-flight-resolve-by-task-id",
    "gap-test-isolation-backlog-44-violations-unmeasured",
    "gap-workflows-dual-copy-drift-unchecked",
  ];
  for (const id of ids) writeTask(root, id, { status: "ready", labels: ["gap"], body: dispatchableBody([`- code/${id}.ts (new)`]) });
  const script = path.resolve(__dirname, "..", "scripts", "slot-refill.ts");
  const run = (inFlight) => JSON.parse(execFileSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", script, "--root", root, "--cap", "5", "--json", "--in-flight", inFlight],
    { encoding: "utf8", env: { ...process.env, QUAY_TELEMETRY_SUBAGENTS: "0" } },
  ));
  const trueForm = ids.join(",");
  const branchForm = ids.map((id) => `task/${id}`).join(",");
  // The truncated worktree DIR names as they actually exist in `git worktree list` (2026-08-14).
  const dirForm = [
    "gap-ac63-judgment2-no-carrier",
    "gap-fan-in-flip-no-ac-completion-check",
    "gap-in-flight-resolve-by-task-id",
    "gap-test-isolation-backlog-44",          // truncated dir — true id …-violations-unmeasured
    "gap-workflows-dual-copy-drift",          // truncated dir — true id …-unchecked
  ].join(",");
  const byTrue = run(trueForm);
  const byBranch = run(branchForm);
  const byDir = run(dirForm);
  assert.equal(byTrue.in_flight_count, 5, "true task id form → 5 in-flight");
  assert.equal(byBranch.in_flight_count, 5, "branch form (task/<id>) → 5 in-flight");
  assert.equal(byDir.in_flight_count, 5, "truncated worktree dir form → 5 in-flight (both truncated slugs resolve)");
  assert.equal(byDir.in_flight_count, byTrue.in_flight_count, "判据1: the three forms MUST agree");
  assert.equal(byBranch.in_flight_count, byTrue.in_flight_count, "判据1: the three forms MUST agree");
});

// ── AC5 DUAL-CONSUMER SPLIT (tasks/gap-in-flight-resolve-by-task-id-not-worktree-name, 人 12:5xZ) ──
// 消费者 A · 触碰面不相交（dispatchable_disjoint / checkTouchesPair）⇒ 宽集 = 所有未落地任务（含
//   awaiting retry——worktree 还在，新任务碰同文件会撞）。
// 消费者 B · 槽位计数（slots_free / should_refill）⇒ 窄集 = 当前在跑的任务 subagent 数（cap=5 保护
//   subagent；awaiting retry 无 subagent ⇒ 不占 cap）。
// ⊢ 判据: 同一时刻两分母【允许不等】；若实现仍取同一集合 ⇒ 未落地。

test("AC5 — runningSubagentCount splits Consumer B (slots) from Consumer A (touches): two denominators may differ (判据 ⊢)", (t) => {
  const root = makeWorkspace("ac5-split");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tasksDir = path.join(root, "tasks");
  // 5 WIDE un-landed tasks (the real 2026-08-14 in-flight set).
  const wide = [
    "gap-ac63-judgment2-no-carrier",
    "gap-fan-in-flip-no-ac-completion-check",
    "gap-in-flight-resolve-by-task-id",
    "gap-test-isolation-backlog-44-violations-unmeasured",
    "gap-workflows-dual-copy-drift-unchecked",
  ];
  for (const id of wide) writeTask(root, id, { status: "ready", labels: ["gap"], body: dispatchableBody([`- code/${id}.ts (new)`]) });
  const inFlight = wide.map((id) => inFlightTask(id, [`- code/${id}.ts (new)`]));
  const base = { tasksDir, root, cap: 5 };

  // Consumer B narrow: only 3 of the 5 are ACTUALLY-RUNNING subagents (ac63 + in-flight-resolve impl
  // + workflows-dual-copy — the 2026-08-14 empirical split: 5 worktrees, 3 live subagents).
  const narrow = analyzeSlotRefill({ ...base, inFlight, runningSubagentCount: 3 });
  assert.equal(narrow.in_flight_count, 5, "Consumer A denominator stays WIDE (all un-landed tasks)");
  assert.equal(narrow.running_subagent_count, 3, "Consumer B denominator is the NARROW running-subagent count");
  assert.equal(narrow.slot_denominator_source, "running-subagents");
  assert.equal(narrow.slots_free, 2, "true slots_free = cap 5 − 3 running subagents = 2");

  // Backward compat: no runningSubagentCount ⇒ Consumer B falls back to the wide set.
  const fallback = analyzeSlotRefill({ ...base, inFlight });
  assert.equal(fallback.running_subagent_count, 5, "fallback Consumer B = wide set");
  assert.equal(fallback.slot_denominator_source, "in-flight-fallback");
  assert.equal(fallback.slots_free, 0, "fallback slots_free = cap 5 − 5 wide = 0 (the old shared-denominator shape)");

  // ⊢ 判据: the two denominators are allowed to differ — 5 (wide, Consumer A) vs 3 (narrow, Consumer B).
  assert.notEqual(narrow.in_flight_count, narrow.running_subagent_count,
    "判据: dispatchable_disjoint 分母 (5) 与 slots_free 分母 (3) 允许不等");
  assert.equal(narrow.dispatchable_disjoint, fallback.dispatchable_disjoint,
    "Consumer A (dispatchable_disjoint) is UNCHANGED by the Consumer-B split");
});

test("AC5 — CLI --running: 5 wide / 3 running ⇒ slots_free=2; without --running falls back to 0 (real sample)", (t) => {
  const root = makeWorkspace("ac5-cli");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ids = [
    "gap-ac63-judgment2-no-carrier",
    "gap-fan-in-flip-no-ac-completion-check",
    "gap-in-flight-resolve-by-task-id",
    "gap-test-isolation-backlog-44-violations-unmeasured",
    "gap-workflows-dual-copy-drift-unchecked",
  ];
  for (const id of ids) writeTask(root, id, { status: "ready", labels: ["gap"], body: dispatchableBody([`- code/${id}.ts (new)`]) });
  const script = path.resolve(__dirname, "..", "scripts", "slot-refill.ts");
  const run = (args) => JSON.parse(execFileSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", script, "--root", root, "--cap", "5", "--json", ...args],
    { encoding: "utf8", env: { ...process.env, QUAY_TELEMETRY_SUBAGENTS: "0" } },
  ));
  const wide = ids.join(",");
  // 3 running subagents: ac63 + in-flight-resolve + workflows-dual-copy (the empirical live set).
  const narrow3 = ["gap-ac63-judgment2-no-carrier", "gap-in-flight-resolve-by-task-id", "gap-workflows-dual-copy-drift-unchecked"].join(",");

  const withRunning = run(["--in-flight", wide, "--running", narrow3]);
  assert.equal(withRunning.in_flight_count, 5, "Consumer A wide denominator = 5");
  assert.equal(withRunning.running_subagent_count, 3, "Consumer B narrow denominator = 3");
  assert.equal(withRunning.slot_denominator_source, "running-subagents");
  assert.equal(withRunning.slots_free, 2, "true slots_free = 5 − 3 = 2");

  const withoutRunning = run(["--in-flight", wide]);
  assert.equal(withoutRunning.slots_free, 0, "without --running ⇒ Consumer B falls back to the wide set ⇒ 0 free slots");
  assert.equal(withoutRunning.slot_denominator_source, "in-flight-fallback");

  // ⊢ 判据: the SAME moment yields different denominators for the two consumers.
  assert.equal(withRunning.dispatchable_disjoint, withoutRunning.dispatchable_disjoint,
    "Consumer A (dispatchable_disjoint) is unchanged by the Consumer-B split");
});

test("AC5 — Consumer A stays WIDE: a candidate colliding with a wide-but-not-running task is still blocked (awaiting-retry worktree occupies files)", (t) => {
  const root = makeWorkspace("ac5-wide");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tasksDir = path.join(root, "tasks");
  // 3 WIDE in-flight tasks; only 2 (A, B) are running — C is awaiting-retry (no subagent).
  writeTask(root, "gap-if-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  writeTask(root, "gap-if-b", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/b.ts (new)"]) });
  writeTask(root, "gap-if-c", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/c.ts (new)"]) });
  // A ready candidate X touches the SAME file as awaiting-retry C (wide but NOT running).
  writeTask(root, "gap-cand-x", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/c.ts (new)", "- code/x.ts (new)"]) });
  // A disjoint candidate Y touches a fresh file — should be free to recommend.
  writeTask(root, "gap-cand-y", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/y.ts (new)"]) });
  const inFlight = [
    inFlightTask("gap-if-a", ["- code/a.ts (new)"]),
    inFlightTask("gap-if-b", ["- code/b.ts (new)"]),
    inFlightTask("gap-if-c", ["- code/c.ts (new)"]),
  ];
  const r = analyzeSlotRefill({ tasksDir, root, cap: 5, inFlight, runningSubagentCount: 2 });
  assert.equal(r.running_subagent_count, 2, "Consumer B narrow = 2 running subagents");
  assert.equal(r.slots_free, 3, "true slots_free = 5 − 2 = 3");
  assert.ok(r.recommended.includes("gap-cand-y"), "disjoint candidate Y recommended (slots are free)");
  assert.ok(!r.recommended.includes("gap-cand-x"),
    "X collides with awaiting-retry C (wide Consumer-A set) ⇒ blocked even though C is NOT running (its worktree still occupies code/c.ts)");
  const deferredX = (r.deferred || []).find((d) => d.id === "gap-cand-x");
  assert.ok(deferredX && /touches-overlap-in-flight/.test(deferredX.reason),
    "X deferred with touches-overlap-in-flight — the WIDE Consumer-A denominator still applies");
});

// ── Suite-blocking rank (tasks/gap-ready-relevance-blind-to-suite-blocking-signal AC3) ──────────────
// AC3: a task the consecutive-red-window signal implicates (pool.suite_blocking.tasks, the
// ready-pool-check blocking_suite axis) is ranked FIRST into `recommended` — the inner's slot-refill
// picks the suite-blocker before any other work. Negative control: no red window ⇒ recommended keeps
// the pre-signal (id) ordering.

/** AC84 (gap-ac84-suite-source-starvation-reader-disposition AC2): slot-refill's suite-blocking
 *  (via analyzeTasks) now reads per-task-suite-records.jsonl — the ONLY ongoing suite source after
 *  AC84 (verification-round is NO LONGER a throttling input). This helper writes the per-task-suite-
 *  record shape, converting the round-shaped fixture rows ({round,state,reason,fail,failures}) into
 *  it. Every fixture row is a REAL full-suite result (fullSuiteRan:true) — a green row breaks the
 *  window, a red row counts. */
function writeRounds(root, rows) {
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  const recs = rows.map((r, i) => ({
    taskId: `fixture-${i}`,
    runId: `fixture-run-${i}`,
    state: r.state,
    laneCount: r.laneCount ?? 16,
    durationMs: 1000,
    failedFiles: Array.isArray(r.failures) ? r.failures.map((f) => f.file).filter(Boolean) : [],
    fullSuiteRan: true,
    startedAt: `2026-08-15T00:00:0${i}Z`,
    finishedAt: `2026-08-15T00:00:0${i}Z`,
  }));
  fs.writeFileSync(path.join(root, ".quay", "per-task-suite-records.jsonl"), recs.map((r) => JSON.stringify(r)).join("\n"));
}

// full-suite-state.json is RETIRED as a red-window input under AC84, but slot-refill's `suite_red`
// DIAGNOSTIC (arbitration.suite_red, readSuiteRed) still reads it — slot-refill.ts is outside this
// task's Touches, so the diagnostic keeps its (now-stale) source. writeState keeps writing the file so
// the diagnostic assertions stay live.
function writeState(root, failures) {
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "full-suite-state.json"), JSON.stringify({ state: "red", reason: "failed", failures }));
}

test("slot-refill recommends the suite-blocking task first; no red window ⇒ unchanged (AC3/negative)", (t) => {
  const root = makeWorkspace("suiteblock");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-plain-ready", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/plain.ts (new)"]) });
  writeTask(root, "gap-watchdog", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/wd.ts (new)"]) });
  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 2 };

  // AC4 negative control FIRST: no suite history ⇒ recommended keeps the de-ordered (lexicographic) form.
  const before = analyzeSlotRefill(opts);
  assert.equal(before.suite_blocking.window_active, false);
  assert.deepEqual(before.recommended, ["gap-plain-ready", "gap-watchdog"], "no red window ⇒ de-ordered (lexicographic)");
  assert.ok(/order meaningless/.test(before.recommended_order), "the de-ordered output is explicitly annotated");

  // AC3: 3 consecutive red rounds whose failures hit the watchdog task's Touches ⇒ the suite-blocker
  // is picked first BY THE PRIORITY SORT (exposed in `ranking`, the AC36 diagnostic) while the
  // dispatch-facing `recommended` array stays de-ordered (AC56 去锚).
  writeRounds(root, Array.from({ length: 3 }, (_, i) => ({ round: 220 + i, state: "red", reason: "failed", fail: 1, failures: [{ file: "code/wd.ts", line: "x" }] })));
  writeState(root, [{ file: "code/wd.ts", line: "x" }]);
  const after = analyzeSlotRefill(opts);
  assert.equal(after.suite_blocking.window_active, true);
  assert.deepEqual(after.suite_blocking.tasks, ["gap-watchdog"]);
  assert.equal(after.recommended[0], "gap-plain-ready", "recommended is de-ordered (lexicographic) — the suite-blocker is NOT first in the dispatch-facing array");
  assert.equal(after.recommended.length, 2, "both dispatchable candidates still recommended (cap 2)");
  assert.equal(after.ranking[0].id, "gap-watchdog", "the suite-blocker is first in the ranking (the priority-sorted AC36 diagnostic)");

  // negative: last round green clears the window ⇒ recommended stays de-ordered (lexicographic).
  writeRounds(root, [
    ...Array.from({ length: 3 }, () => ({ state: "red", reason: "failed", fail: 1, failures: [{ file: "code/wd.ts" }] })),
    { round: 223, state: "green", fail: 0 },
  ]);
  const green = analyzeSlotRefill(opts);
  assert.equal(green.suite_blocking.window_active, false);
  assert.deepEqual(green.recommended, ["gap-plain-ready", "gap-watchdog"], "green round clears the window ⇒ de-ordered (lexicographic)");
  assert.equal(green.ranking[0].id, "gap-plain-ready", "no suite-blocker ⇒ id-tie-break order in the ranking");
});

// ── B3 ①/④ ARBITRATION (gap-b3-arbitration-inflight-vs-backlog) ─────────────────────────────────────
// ① (in_flight<cap ⇒ dispatch) conflicts with ④ (integration ahead + suite green ⇒ batch-merge): ④ is a
// DOWNSTREAM constraint on ①. When the delivery gate is blocked by a red suite AND the integration
// backlog exceeds the threshold, the effective dispatch cap narrows to "just enough to fix red"; the cap
// restores on green; an empty backlog has no effect (AC2/AC4, the Contract's band + invariants).

/** Run a git command in a temp repo. MODULE-LEVEL on purpose: a nested function def between a
 *  mkdtemp and its `return` misdirects test-isolation-check's nearestFuncName association (the
 *  returned dir's funcName resolves to the NESTED fn, whose call sites never capture+clean it), which
 *  would false-flag a mkdtemp-no-cleanup ratchet violation on an otherwise-cleaned helper. */
function runGit(dir, ...args) {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

/** Build a REAL temp git repo where `integration` is `ahead` commits ahead of `develop`, so the
 *  git-read backlog (`git rev-list --count develop..integration`) is exercised, not injected. */
function makeGitWorkspace(tag, ahead) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `slot-refill-git-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  runGit(dir, "init", "-q");
  runGit(dir, "config", "user.email", "t@t");
  runGit(dir, "config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
  runGit(dir, "add", "-A");
  runGit(dir, "commit", "-qm", "base");
  runGit(dir, "branch", "-M", "develop");
  runGit(dir, "checkout", "-qb", "integration");
  for (let i = 0; i < ahead; i++) {
    fs.writeFileSync(path.join(dir, `int-${i}.txt`), `${i}\n`);
    runGit(dir, "add", "-A");
    runGit(dir, "commit", "-qm", `int ${i}`);
  }
  return dir;
}

test("computeArbitratedCap — red window active narrows to redBacklogCap; inactive keeps base (AC1 pure)", () => {
  assert.equal(computeArbitratedCap({ baseCap: 5, redWindowActive: true }), 2, "red window active ⇒ redBacklogCap (2)");
  assert.equal(computeArbitratedCap({ baseCap: 5, redWindowActive: false }), 5, "no red window ⇒ base cap unchanged");
  // custom redBacklogCap honored; an inactive window still keeps base
  assert.equal(computeArbitratedCap({ baseCap: 5, redWindowActive: true, redBacklogCap: 3 }), 3);
  assert.equal(computeArbitratedCap({ baseCap: 5, redWindowActive: false, redBacklogCap: 3 }), 5);
});

test("readSuiteRed — state red ⇒ true; green/running/absent/unparseable ⇒ false (A11 parity)", (t) => {
  const root = makeWorkspace("suitered");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(readSuiteRed(root), false, "absent state file ⇒ proceed, not red-blocked");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "full-suite-state.json"), JSON.stringify({ state: "green" }));
  assert.equal(readSuiteRed(root), false);
  fs.writeFileSync(path.join(root, ".quay", "full-suite-state.json"), JSON.stringify({ state: "running" }));
  assert.equal(readSuiteRed(root), false, "running is not red-blocked");
  fs.writeFileSync(path.join(root, ".quay", "full-suite-state.json"), JSON.stringify({ state: "red" }));
  assert.equal(readSuiteRed(root), true);
  fs.writeFileSync(path.join(root, ".quay", "full-suite-state.json"), "not json");
  assert.equal(readSuiteRed(root), false, "unparseable ⇒ fail-safe proceed");
});

test("ARBITRATION — red window ALONE narrows the cap even with backlog below the old threshold (AC1 regression)", (t) => {
  const root = makeWorkspace("arb-redwindow");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  // 3 consecutive red rounds ⇒ window ACTIVE. Backlog 10 is BELOW the retired 50 threshold — the
  // measured defect: under `suite_red && backlog > 50` the cap stayed 5 during a red round at
  // backlog 10. Now the red window ALONE triggers the narrowing.
  writeRounds(root, Array.from({ length: 3 }, (_, i) => ({ round: 240 + i, state: "red", reason: "failed", fail: 1, failures: [{ file: "code/a.ts", line: "x" }] })));
  writeState(root, [{ file: "code/a.ts" }]);
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, integrationBacklog: 10 });
  assert.equal(r.base_cap, 5, "base cap is the fixed 5");
  assert.equal(r.effective_cap, 2, "red window active + backlog 10 < 50 ⇒ narrowed to redBacklogCap (regression: old trigger needed backlog > 50)");
  assert.equal(r.cap, 2, "the consumed cap is the effective (arbitrated) cap");
  assert.equal(r.arbitration.cap_narrowed, true);
  assert.equal(r.arbitration.red_window_active, true);
  assert.equal(r.arbitration.suite_red, true);
  assert.equal(r.arbitration.integration_backlog, 10);
  assert.equal(r.arbitration.red_backlog_cap, 2);
  assert.equal(r.slots_free, 2, "dispatch capped at the narrowed cap");
});

test("ARBITRATION — recommended is capped at the NARROWED cap, not the base cap (AC2/AC3)", (t) => {
  const root = makeWorkspace("arb-cap-rec");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const id of ["gap-r1", "gap-r2", "gap-r3", "gap-r4", "gap-r5"]) {
    writeTask(root, id, { status: "ready", labels: ["gap"], body: dispatchableBody([`- code/${id}.ts (new)`]) });
  }
  writeRounds(root, Array.from({ length: 3 }, (_, i) => ({ round: 250 + i, state: "red", reason: "failed", fail: 1, failures: [{ file: "code/r1.ts", line: "x" }] })));
  writeState(root, [{ file: "code/r1.ts" }]); // state red
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, integrationBacklog: 80 });
  assert.equal(r.effective_cap, 2);
  assert.equal(r.slots_free, 2);
  assert.equal(r.recommended.length, 2, "5 dispatchable candidates but the narrowed cap admits only 2 — WIP not added behind the red gate");
});

test("ARBITRATION — no red window keeps full cap even with high backlog; red state alone is not the trigger; absent state proceeds (AC2 invariants)", (t) => {
  const root = makeWorkspace("arb-green");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  // green window + high backlog ⇒ cap stays full (backlog is NO LONGER part of the trigger)
  writeRounds(root, Array.from({ length: 3 }, (_, i) => ({ round: 260 + i, state: "green", reason: "pass", fail: 0 })));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "full-suite-state.json"), JSON.stringify({ state: "green", fail: 0 }));
  const green = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, integrationBacklog: 80 });
  assert.equal(green.effective_cap, 5, "green window ⇒ cap stays full (backlog 80 is irrelevant — not a trigger)");
  assert.equal(green.arbitration.cap_narrowed, false);
  assert.equal(green.arbitration.red_window_active, false);
  // red STATE file but green ROUNDS (no consecutive-red window) ⇒ no narrowing — the state alone is
  // not the trigger, the WINDOW is
  writeState(root, [{ file: "code/a.ts" }]);
  const redNoWindow = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, integrationBacklog: 80 });
  assert.equal(redNoWindow.effective_cap, 5, "suite state red but no consecutive-red window ⇒ no narrowing");
  assert.equal(redNoWindow.arbitration.cap_narrowed, false);
  assert.equal(redNoWindow.arbitration.red_window_active, false);
  assert.equal(redNoWindow.arbitration.suite_red, true, "suite_red is still reported as a diagnostic");
  // absent state + no rounds ⇒ not red-blocked ⇒ proceed
  fs.rmSync(path.join(root, ".quay", "full-suite-state.json"));
  fs.rmSync(path.join(root, ".quay", "per-task-suite-records.jsonl"));
  const noState = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, integrationBacklog: 80 });
  assert.equal(noState.effective_cap, 5, "absent suite state + no window ⇒ no narrowing");
});

test("ARBITRATION — CLI with a real git repo: a red window narrows the cap; green window restores (AC4)", (t) => {
  const root = makeGitWorkspace("redbacklog", 55);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  writeRounds(root, Array.from({ length: 3 }, (_, i) => ({ round: 270 + i, state: "red", reason: "failed", fail: 1, failures: [{ file: "code/a.ts", line: "x" }] })));
  writeState(root, [{ file: "code/a.ts" }]); // state red
  const script = path.resolve(__dirname, "..", "scripts", "slot-refill.ts");
  // QUAY_TELEMETRY_SUBAGENTS=0: this run asserts exact slots_free — the telemetry CLI's /proc-GLOBAL
  // non-task-subagent scan must not shrink it under a concurrent full suite.
  const redOut = JSON.parse(execFileSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", script, "--root", root, "--json"],
    { encoding: "utf8", env: { ...process.env, QUAY_TELEMETRY_SUBAGENTS: "0" } },
  ));
  assert.equal(redOut.arbitration.integration_backlog, 55, "git-read backlog (develop..integration) still reported as a diagnostic");
  assert.equal(redOut.arbitration.red_window_active, true);
  assert.equal(redOut.arbitration.cap_narrowed, true);
  assert.equal(redOut.effective_cap, 2, "red window (3 consecutive red rounds) ⇒ narrowed to redBacklogCap");
  assert.equal(redOut.slots_free, 2);
  // green window ⇒ cap restores to full
  writeRounds(root, Array.from({ length: 3 }, (_, i) => ({ round: 273 + i, state: "green", reason: "pass", fail: 0 })));
  fs.writeFileSync(path.join(root, ".quay", "full-suite-state.json"), JSON.stringify({ state: "green", fail: 0 }));
  const greenOut = JSON.parse(execFileSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", script, "--root", root, "--json"],
    { encoding: "utf8", env: { ...process.env, QUAY_TELEMETRY_SUBAGENTS: "0" } },
  ));
  assert.equal(greenOut.arbitration.cap_narrowed, false);
  assert.equal(greenOut.effective_cap, 5, "green window ⇒ effective cap restored");
});

test("ARBITRATION — default (no red window/backlog) is byte-forward-compatible: cap stays the base cap (AC5 no-regress)", (t) => {
  const root = makeWorkspace("arb-default");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.cap, 5, "no red window + no git backlog ⇒ fixed cap unchanged");
  assert.equal(r.effective_cap, 5);
  assert.equal(r.arbitration.cap_narrowed, false);
  assert.equal(r.arbitration.red_window_active, false);
  assert.equal(r.arbitration.integration_backlog, 0, "non-git temp root fails safe to 0");
  assert.equal(r.slots_free, 5);
});

// ── DELIVERY-CRITICAL SECOND AXIS (tasks/gap-ac36-delivery-critical-priority-axis) ────────────────
// candidates.sort key becomes (blocking_suite, delivery_critical, id): a task labeled
// `delivery-critical` ranks below a suite-blocker but ABOVE plain id order, so the
// productization-delivery phase's AC tasks are picked by the refill before ordinary pool work.
// AC3 positive: labeled task strictly moves forward IN THE RANKING (the AC36 diagnostic). AC3
// negative control: an unlabeled same-family task keeps its id-order position in the ranking.
// Invariant: blocking_suite stays the top axis. AC4 end-to-end: after labeling, the next refill
// evaluation picks the labeled task (dispatch evaluation happens strictly after the label is applied
// — timestamp order). AC56 去锚 (tasks/gap-ac56-recommended-deordered): the DISPATCH-facing
// `recommended` array is de-ordered (lexicographic + "order meaningless" annotation) so inner is not
// anchored to "the mechanism's first pick"; the priority axis is verified via `ranking`, which inner
// does NOT consume for dispatch.

test("DELIVERY-CRITICAL — the axis moves the labeled task first in ranking while recommended stays de-ordered (AC3 + AC56)", (t) => {
  const root = makeWorkspace("ac36-rank");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "ac36-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  writeTask(root, "ac36-b", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/b.ts (new)"]) });
  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3 };

  // Negative control FIRST: no delivery-critical label ⇒ recommended is de-ordered (lexicographic: a before b).
  const before = analyzeSlotRefill(opts);
  assert.deepEqual(before.recommended, ["ac36-a", "ac36-b"], "no label ⇒ de-ordered (lexicographic)");
  assert.equal(before.ranking[0].id, "ac36-a", "no label ⇒ id tie-break order in the ranking");

  // Positive: add the label to b ⇒ the DC axis moves it first IN THE RANKING (the AC36 diagnostic),
  // while the dispatch-facing recommended array stays de-ordered (AC56 去锚 — inner is NOT anchored to
  // "the mechanism's first pick").
  writeTask(root, "ac36-b", { status: "ready", labels: ["gap", "delivery-critical"], body: dispatchableBody(["- code/b.ts (new)"]) });
  const after = analyzeSlotRefill(opts);
  assert.deepEqual(after.recommended, ["ac36-a", "ac36-b"], "recommended stays de-ordered (lexicographic) — the label does NOT reorder the dispatch array");
  assert.equal(after.ranking[0].id, "ac36-b", "the labeled task ranks first in the ranking (delivery-critical axis above id order)");
  assert.match(after.recommended_order, /order meaningless/, "the de-ordered output is explicitly annotated");
});

test("DELIVERY-CRITICAL — negative control: unlabeled same-family tasks keep relative id order (AC3)", (t) => {
  const root = makeWorkspace("ac36-neg");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "ac36-x", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/x.ts (new)"]) });
  writeTask(root, "ac36-y", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/y.ts (new)"]) });
  writeTask(root, "ac36-z", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/z.ts (new)"]) });
  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3 };

  const before = analyzeSlotRefill(opts);
  assert.deepEqual(before.recommended, ["ac36-x", "ac36-y", "ac36-z"], "de-ordered (lexicographic) baseline");

  // Label only the middle task; the unlabeled x and z must keep x-before-z relative order IN THE
  // RANKING (the AC36 negative control) while recommended stays de-ordered (AC56).
  writeTask(root, "ac36-y", { status: "ready", labels: ["gap", "delivery-critical"], body: dispatchableBody(["- code/y.ts (new)"]) });
  const after = analyzeSlotRefill(opts);
  assert.deepEqual(after.recommended, ["ac36-x", "ac36-y", "ac36-z"], "recommended stays de-ordered (lexicographic) — the label does NOT reorder the dispatch array");
  assert.deepEqual(after.ranking.map((e) => e.id), ["ac36-y", "ac36-x", "ac36-z"], "in the ranking y moves up; unlabeled x/z keep id order");
});

test("DELIVERY-CRITICAL — blocking_suite axis stays ABOVE delivery-critical (invariant)", (t) => {
  const root = makeWorkspace("ac36-suite");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "ac36-watchdog", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/wd.ts (new)"]) });
  writeTask(root, "ac36-critical", { status: "ready", labels: ["gap", "delivery-critical"], body: dispatchableBody(["- code/crit.ts (new)"]) });
  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 2 };

  // 3 consecutive red rounds implicating the watchdog task's Touches ⇒ watchdog is a suite-blocker.
  writeRounds(root, Array.from({ length: 3 }, (_, i) => ({ round: 300 + i, state: "red", reason: "failed", fail: 1, failures: [{ file: "code/wd.ts", line: "x" }] })));
  writeState(root, [{ file: "code/wd.ts", line: "x" }]);
  const r = analyzeSlotRefill(opts);
  assert.equal(r.suite_blocking.window_active, true);
  assert.deepEqual(r.recommended, ["ac36-critical", "ac36-watchdog"], "recommended is de-ordered (lexicographic: critical < watchdog) — the dispatch array does NOT encode blocking_suite/delivery-critical priority");
  assert.equal(r.ranking[0].id, "ac36-watchdog", "in the ranking the suite-blocker ranks above delivery-critical (blocking_suite > delivery_critical — the AC36 diagnostic)");
  assert.equal(r.ranking[1].id, "ac36-critical", "delivery-critical ranks second (above id order, below blocking_suite) in the ranking");
});

test("DELIVERY-CRITICAL — a false-positive dir-glob suite-blocker does NOT demote the DC task (AC4 — gap-suite-blocking-directory-glob-overbroad)", (t) => {
  const root = makeWorkspace("glob-dc");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The crystallization shape: Touches carry concrete scripts AND the `plugin/test/` directory glob.
  writeTask(root, "gap-crystal-dir", { status: "ready", labels: ["gap"], body: dispatchableBody(["- plugin/test/", "- plugin/scripts/capability-catalog.sh (new)"]) });
  // The delivery-critical task that must rank #1 when nothing is a true suite-blocker.
  writeTask(root, "ac37-dc", { status: "ready", labels: ["gap", "delivery-critical"], body: dispatchableBody(["- code/dc.ts (new)"]) });
  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 2 };

  // 3 consecutive red rounds whose ONLY failing file is under plugin/test/ — the dir glob must NOT
  // implicate gap-crystal-dir, so the DC task keeps the top of the ranking (before the fix, the dir
  // glob made gap-crystal-dir a false suite-blocker and pushed it to #1, demoting the DC task).
  writeRounds(root, Array.from({ length: 3 }, (_, i) => ({ round: 310 + i, state: "red", reason: "failed", fail: 1, failures: [{ file: "plugin/test/checker-cost.test.mjs", line: "x" }] })));
  writeState(root, [{ file: "plugin/test/checker-cost.test.mjs", line: "x" }]);
  const r = analyzeSlotRefill(opts);
  assert.equal(r.suite_blocking.window_active, true);
  assert.ok(!r.suite_blocking.tasks.includes("gap-crystal-dir"), "the dir-glob task is NOT a suite-blocker (AC2 negative control)");
  assert.equal(r.ranking[0].id, "ac37-dc", "no suite-blocker ⇒ the delivery-critical task ranks first in the ranking (DC axis restored)");
  assert.ok(r.recommended.includes("gap-crystal-dir"), "the dir-glob task is still dispatchable");
  assert.deepEqual(r.recommended, ["ac37-dc", "gap-crystal-dir"], "recommended is de-ordered (lexicographic: ac37-dc < gap-crystal-dir) — the dispatch array does NOT encode the DC axis");
});

test("DELIVERY-CRITICAL — end-to-end: a delivery-critical task promoted (todo→ready) ranks FIRST in the next refill (AC2 promote-time semantics)", (t) => {
  const root = makeWorkspace("ac36-e2e");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // ac36-aaa is READY unlabeled; ac36-e2e is a TODO carrying the delivery-critical label. The promote
  // gate flips it to ready WITH the label ("标签与 ready 同现") — the fix's timing: the label exists
  // when the task enters the ready pool, so the sort key is in place for the NEXT selection.
  writeTask(root, "ac36-aaa", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/aaa.ts (new)"]) });
  // dispatchableBody's stock AC item is 36 non-whitespace chars — BELOW the author→ready gate's 40-char
  // MIN_SECTION_CHARS. The todo task must pass the four-artifacts gate to be promoted, so give it an
  // AC section that clears the threshold (a real ready-pool candidate would carry a full AC item).
  const todoBody = dispatchableBody(["- code/e2e.ts (new)"]).replace(
    "- [ ] an AC item that is long enough",
    "- [ ] a sufficiently long acceptance criterion item that clears the four-artifact author gate",
  );
  writeTask(root, "ac36-e2e", { status: "todo", labels: ["gap", "delivery-critical"], body: todoBody });
  const script = path.resolve(__dirname, "..", "scripts", "slot-refill.ts");
  // QUAY_TELEMETRY_SUBAGENTS=0: this run asserts an EXACT 2-task recommended window — the telemetry
  // CLI's /proc-GLOBAL non-task-subagent scan must not shrink slots_free under a concurrent suite.
  const run = () => JSON.parse(execFileSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", script, "--root", root, "--cap", "3", "--json"],
    { encoding: "utf8", env: { ...process.env, QUAY_TELEMETRY_SUBAGENTS: "0" } },
  ));

  // Before promotion the task is TODO — not in the ready pool / recommended at all.
  const before = run();
  assert.deepEqual(before.recommended, ["ac36-aaa"], "a TODO task is not in recommended (not in the ready pool)");

  // Promote ac36-e2e todo→ready, carrying the label (the promote gate's --apply write).
  const promoted = applyPromotions({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  assert.equal(promoted.should_apply, true);
  assert.equal(promoted.applied_promotions[0].deliveryCritical, true, "the promote record exposes the delivery-critical determination");
  const raw = fs.readFileSync(path.join(root, "tasks", "ac36-e2e.md"), "utf8");
  assert.match(raw, /^status:\s*ready$/m, "status landed on disk");
  assert.match(raw, /delivery-critical/, "the label co-occurs with ready in the frontmatter");

  // The next refill: the promoted delivery-critical task enters the set; recommended stays de-ordered
  // (AC56) while ranking records the strict forward movement (outside → rank 0, AC36).
  const after = run();
  assert.deepEqual(after.recommended, ["ac36-aaa", "ac36-e2e"], "recommended is de-ordered (lexicographic) — the promoted DC task is not first in the dispatch array");
  const afterRank = after.ranking.find((e) => e.id === "ac36-e2e").rank;
  assert.equal(afterRank, 0, "strict forward movement in the ranking: outside (before) → rank 0 (after)");
});

test("DELIVERY-CRITICAL — negative control: a post-dispatch label is NOT recorded as AC36 triggered; the in-flight DC task surfaces in delivery_critical_in_flight (AC2/AC3)", (t) => {
  const root = makeWorkspace("ac36-inflight-neg");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The exact defect timing: the task is READY and DISPATCHED (in-flight) BEFORE the label lands.
  writeTask(root, "ac36-aaa", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/aaa.ts (new)"]) });
  writeTask(root, "ac36-e2e", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/e2e.ts (new)"]) });
  const script = path.resolve(__dirname, "..", "scripts", "slot-refill.ts");
  // QUAY_TELEMETRY_SUBAGENTS=0: this run asserts exact recommended/ranking — the telemetry CLI's
  // /proc-GLOBAL non-task-subagent scan must not shrink slots_free under a concurrent suite.
  const run = (inFlight) => JSON.parse(execFileSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", script, "--root", root, "--cap", "3", "--json", ...(inFlight ? ["--in-flight", inFlight] : [])],
    { encoding: "utf8", env: { ...process.env, QUAY_TELEMETRY_SUBAGENTS: "0" } },
  ));

  // Before dispatch: both ready, id order (no label yet).
  const before = run("");
  assert.deepEqual(before.recommended, ["ac36-aaa", "ac36-e2e"], "id order before the label");

  // Dispatch ac36-e2e (in-flight), THEN apply the delivery-critical label (post-dispatch).
  writeTask(root, "ac36-e2e", { status: "ready", labels: ["gap", "delivery-critical"], body: dispatchableBody(["- code/e2e.ts (new)"]) });
  const after = run("ac36-e2e");
  // The in-flight DC task is legitimately ABSENT from recommended (touches-overlap-in-flight
  // self-exclusion — AC2: 已在飞任务不要求出现在 recommended).
  assert.ok(!after.recommended.includes("ac36-e2e"), "in-flight DC task is NOT recommended (self-excluded)");
  assert.deepEqual(after.recommended, ["ac36-aaa"], "only the dispatchable non-DC task is recommended");
  // The post-dispatch label did NOT move the task into the ranking — the negative control is
  // mechanically visible in delivery_critical_in_flight (in-flight, NOT ranked ⇒ NOT AC36 triggered).
  assert.ok(Array.isArray(after.delivery_critical_in_flight), "delivery_critical_in_flight field is exposed");
  assert.ok(after.delivery_critical_in_flight.includes("ac36-e2e"), "the post-dispatch-labeled in-flight task is surfaced as in-flight, not ranked");
  assert.equal(after.ranking.length, 1, "ranking holds only the dispatchable task — no false AC36 trigger for the in-flight task");
});

test("DELIVERY-CRITICAL — pure: a delivery-critical in-flight task is excluded from recommended AND named in delivery_critical_in_flight (AC2/AC3)", (t) => {
  const root = makeWorkspace("ac36-inflight-pure");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "ac36-aaa", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/aaa.ts (new)"]) });
  writeTask(root, "ac36-e2e", { status: "ready", labels: ["gap", "delivery-critical"], body: dispatchableBody(["- code/e2e.ts (new)"]) });

  // The inner tick's authoritative path: inFlight is passed as the running-subagent set (the dispatch
  // already happened — the label landed AFTER the task was picked).
  const r = analyzeSlotRefill({
    tasksDir: path.join(root, "tasks"),
    root,
    cap: 3,
    inFlight: [inFlightTask("ac36-e2e", ["- code/e2e.ts (new)"])],
  });
  assert.ok(!r.recommended.includes("ac36-e2e"), "in-flight DC task is not recommended (self-excluded)");
  assert.deepEqual(r.delivery_critical_in_flight, ["ac36-e2e"], "the in-flight DC task is surfaced, NOT ranked — the negative control");
  assert.ok(!r.ranking.some((e) => e.id === "ac36-e2e"), "the in-flight DC task has no ranking entry — not a false AC36 trigger");

  // Negative control: NO in-flight DC task ⇒ the field is empty.
  const r2 = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.deepEqual(r2.delivery_critical_in_flight, [], "no in-flight DC task ⇒ empty");
  assert.deepEqual(r2.recommended, ["ac36-aaa", "ac36-e2e"], "recommended is de-ordered (lexicographic) — the dispatch array does NOT encode the DC axis");
  assert.equal(r2.ranking[0].id, "ac36-e2e", "in the ranking the DC task ranks first (the axis works — AC36 diagnostic)");
});

// ── RANKING EXPOSURE (tasks/gap-ac36-recommended-exposes-sort-key AC2) ───────────────────────────────
// The `recommended` STRING array is the dispatch-facing set — since AC56 (去锚) it is de-ordered
// (lexicographic) + annotated; every consumer above reads ids, never a priority order. The parallel
// `ranking` array exposes each recommended id's sort axes ({id, deliveryCritical, suiteBlocking,
// rank}) in PRIORITY order so AC36 判据②'s "strict forward movement + negative control" is
// mechanically assertable from the JSON alone — the exact gap AC36 closed (recommended was a pure
// string array exposing NO sort field; 判据② could only be eyeballed). rank = position within the
// priority-ordered ranking, NOT the de-ordered recommended array's position.

test("RANKING — the priority-ordered diagnostic carries {id, deliveryCritical, suiteBlocking, rank} for every recommended id (AC2 + AC56)", (t) => {
  const root = makeWorkspace("ranking-expose");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "ac36-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  writeTask(root, "ac36-b", { status: "ready", labels: ["gap", "delivery-critical"], body: dispatchableBody(["- code/b.ts (new)"]) });

  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.deepEqual(r.recommended, ["ac36-a", "ac36-b"], "recommended is de-ordered (lexicographic) — the DC task is not first in the dispatch array (AC56)");
  assert.ok(/order meaningless/.test(r.recommended_order), "the de-ordered output is explicitly annotated");
  assert.ok(Array.isArray(r.ranking), "--json exposes the ranking array");
  assert.equal(r.ranking.length, r.recommended.length, "ranking holds one entry per recommended id");
  assert.deepEqual(r.ranking.map((e) => e.id), ["ac36-b", "ac36-a"], "ranking is PRIORITY-ordered (DC first) — the AC36 diagnostic, distinct from the de-ordered recommended");
  const b = r.ranking.find((e) => e.id === "ac36-b");
  assert.equal(b.deliveryCritical, true, "deliveryCritical axis exposed for the labeled task");
  assert.equal(b.suiteBlocking, false);
  assert.equal(b.rank, 0, "rank = position within the priority-ordered ranking");
  const a = r.ranking.find((e) => e.id === "ac36-a");
  assert.equal(a.deliveryCritical, false, "unlabeled task exposes deliveryCritical=false");
  assert.equal(a.rank, 1);
});

test("RANKING — a suite-blocker's ranking entry carries suiteBlocking:true (blocking_suite axis exposed) (AC2)", (t) => {
  const root = makeWorkspace("ranking-sb");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "ac36-watchdog", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/wd.ts (new)"]) });
  writeTask(root, "ac36-critical", { status: "ready", labels: ["gap", "delivery-critical"], body: dispatchableBody(["- code/crit.ts (new)"]) });
  writeRounds(root, Array.from({ length: 3 }, (_, i) => ({ round: 400 + i, state: "red", reason: "failed", fail: 1, failures: [{ file: "code/wd.ts", line: "x" }] })));
  writeState(root, [{ file: "code/wd.ts", line: "x" }]);

  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 2 });
  assert.equal(r.suite_blocking.window_active, true);
  assert.deepEqual(r.recommended, ["ac36-critical", "ac36-watchdog"], "recommended is de-ordered (lexicographic) — the dispatch array does NOT encode blocking_suite > delivery_critical (AC56)");
  const wd = r.ranking.find((e) => e.id === "ac36-watchdog");
  assert.equal(wd.suiteBlocking, true, "suiteBlocking axis exposed for the suite-blocker");
  assert.equal(wd.rank, 0, "suite-blocker ranks first in the ranking (blocking_suite > delivery_critical — the AC36 diagnostic)");
  const crit = r.ranking.find((e) => e.id === "ac36-critical");
  assert.equal(crit.deliveryCritical, true);
  assert.equal(crit.suiteBlocking, false);
  assert.equal(crit.rank, 1);
});

test("RANKING — halted ⇒ ranking is empty (parallel to the empty recommended) (AC2)", (t) => {
  const root = makeWorkspace("ranking-halt");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "ac36-a", { status: "ready", labels: ["gap", "delivery-critical"], body: dispatchableBody(["- code/a.ts (new)"]) });
  fs.writeFileSync(path.join(root, ".halt"), "paused");
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.equal(r.halted, true);
  assert.deepEqual(r.recommended, [], "halted ⇒ nothing recommended");
  assert.deepEqual(r.ranking, [], "halted ⇒ nothing ranked");
});

// ── NOT-YET-FLIPPED SKIP (tasks/gap-slot-refill-repeats-done-eligible-recommendations) ──────────────
// slot-refill's candidate loop at :243 used to iterate pool.ready + 3 step-4 checks and NEVER looked
// at the not-yet-flipped signal (grep not-yet-flipped|excluded = 0 hits). A task whose work LANDED
// (fan-in merged into the two-line model's integration line — invisible to the master-only git-history
// signal) but whose status is still `ready` was re-recommended every round, re-dispatching a subagent
// to re-verify already-landed work (25 re-dispatch commits self-described on 2026-08-10). AC2: the 4th
// step-4 check skips not-yet-flipped tasks; AC4: it never touches AC5's strictness (the task still
// waits for the green round to flip done, it is just not re-dispatched).

test("NOT-YET-FLIPPED — a fanned-in (merged) task with >50% ACs is NOT recommended; an unfanned ready task still is (AC2/nyf_task_not_recommended/unfanned_ready_still_recommended)", (t) => {
  const root = makeFannedInWorkspace("canonical");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // gap-fanned: work fanned in (merge record), 4/5 ACs ⇒ "已 fan-in 待翻 done" — must NOT be re-dispatched.
  writeTask(root, "gap-fanned", { status: "ready", labels: ["gap"], body: fannedInBody(4, 5) });
  // gap-unfanned: no merge record, real work ⇒ must still be recommended.
  writeTask(root, "gap-unfanned", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/unfanned.ts (new)"]) });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.ok(r.recommended.includes("gap-unfanned"), "unfanned ready task is still recommended (unfanned_ready_still_recommended)");
  assert.ok(!r.recommended.includes("gap-fanned"), "fanned-in ready task (4/5 ACs) is not re-dispatched (nyf_task_not_recommended)");
});

test("NOT-YET-FLIPPED — the adhoc `merge: <id>` fan-in format is also caught (bare-id arm of hasFanInMerge)", (t) => {
  const root = makeFannedInWorkspace("bare", { mergeFormat: "bare" });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-fanned", { status: "ready", labels: ["gap"], body: fannedInBody(4, 5) });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.ok(!r.recommended.includes("gap-fanned"), "bare-id-format fan-in is also skipped");
});

test("NOT-YET-FLIPPED — a fanned-in task with ACs at/under 50% stays dispatchable (stuck-work not trapped, gap-ready-pool-worklanded-traps-stuck-work parity)", (t) => {
  const root = makeFannedInWorkspace("stuck");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // 2/5 = 40% — the merge record fired, but the AC-completeness gate (>50% or all) keeps it dispatchable:
  // an AC-incomplete fan-in is genuinely stuck-work with real remaining implementation, not done-work.
  writeTask(root, "gap-fanned", { status: "ready", labels: ["gap"], body: fannedInBody(2, 5) });
  writeTask(root, "gap-stuck", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/stuck.ts (new)"]) });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.ok(r.recommended.includes("gap-fanned"), "fanned-in but AC-incomplete task stays dispatchable (stuck-work)");
  assert.ok(r.recommended.includes("gap-stuck"));
});

test("NOT-YET-FLIPPED — a task ready-pool-check already excluded as not-yet-flipped is never in recommended (AC2 pool.excluded arm)", (t) => {
  const root = makeWorkspace("excluded-arm");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // All ACs checked ⇒ ready-pool-check's notYetFlipped all_acs_checked branch fires ⇒ pool.excluded.
  writeTask(root, "gap-excluded", { status: "ready", labels: ["gap"], body: fannedInBody(3, 3) });
  writeTask(root, "gap-open", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/open.ts (new)"]) });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.ok(!r.recommended.includes("gap-excluded"), "already-excluded not-yet-flipped task is never recommended");
  assert.ok(r.recommended.includes("gap-open"), "dispatchable sibling still recommended");
});

test("isNotYetFlippedSkip — pure unit: excludedNyfIds arm, merge arm, AC gate, total=0 (AC2)", (t) => {
  const root = makeFannedInWorkspace("unit");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const body4of5 = fannedInBody(4, 5);
  // (a) excludedNyfIds arm — true regardless of merge/AC state.
  assert.equal(isNotYetFlippedSkip({ id: "gap-any", body: body4of5, root, excludedNyfIds: new Set(["gap-any"]) }), true);
  // (b) no merge record ⇒ false (even with complete ACs — the pool.excluded arm is the only way).
  assert.equal(isNotYetFlippedSkip({ id: "gap-nomerge", body: body4of5, root, excludedNyfIds: new Set() }), false);
  // (c) merge record + 4/5 ACs ⇒ true.
  assert.equal(isNotYetFlippedSkip({ id: "gap-fanned", body: body4of5, root, excludedNyfIds: new Set() }), true);
  // (d) merge record + 2/5 ACs ⇒ false (stuck-work stays dispatchable).
  assert.equal(isNotYetFlippedSkip({ id: "gap-fanned", body: fannedInBody(2, 5), root, excludedNyfIds: new Set() }), false);
  // (e) merge record + zero AC boxes ⇒ false (total=0 ⇒ no gate).
  assert.equal(isNotYetFlippedSkip({ id: "gap-fanned", body: fannedInBody(0, 0), root, excludedNyfIds: new Set() }), false);
  // (f) hasFanInMerge itself: merge record fires, and a plain (non-merge) commit never does.
  assert.equal(hasFanInMerge(root, "gap-fanned"), true, "the fan-in merge record is durable evidence");
  assert.equal(hasFanInMerge(root, "gap-nonexistent"), false);
});

// ── LANDED-IMPLEMENTATION (tasks/gap-slot-refill-recommends-landed-code-complete-tasks) ──────────────
// slot-refill's recommended used to PERMANENTLY include tasks whose IMPLEMENTATION is already in the
// tree — a develop commit whose message contains the task id AND changed files outside tasks/ — but
// whose status is still `ready` awaiting the closure batch (the "landed-but-not-flipped" shape;
// observed 4-6 times/day: ac53-end-invariant / src-n-anchor / precommit-guard / npm-pack / catalog /
// runner-grouping, all "代码已合进 develop、ACs 全勾、只差绿轮验证后的 closure"). step-4 checked only
// DECLARATIONS (touches / deps / C8 self-touch), never TREE FACTS — the B9 force-dispatch chain
// pointed at code-complete work. AC1: the new step-4 check excludes landed tasks from recommended;
// AC2: negative control (a genuinely-new task / nonexistent id is NOT excluded); AC3: the MERGE-landing
// shape is recognized (-m --first-parent — without it a merge shows 0 files, measured 7418c615);
// AC4: a commit that only touches tasks/<id>.md is NOT "implementation" (files must be outside tasks/).

/** A ready body with ALL ACs checked under the `## AC` heading (NOT `## Acceptance Criteria`) — the
 *  realistic phantom-task shape ("ACs 全勾"). Touches the MERGED implementation file `code/impl.ts`
 *  WITHOUT (new) so it resolves against the tree (not majority-missing). NOTE: an all-checked ready
 *  task is ALSO excluded by ready-pool-check's notYetFlipped (`allChecked` arm) at the pool level — so
 *  the AC1 outcome holds for this shape via the pool exclusion (defense-in-depth layering), while the
 *  NEW step-4 check fires on the shape that ready-pool-check's declared-touches signals MISS (see
 *  landedNoCheckboxBody below). */
function landedAllCheckedBody() {
  return [
    "**type:** execution",
    "## Proposal",
    "A real proposal paragraph that is definitely more than forty non-whitespace chars.",
    "## Contract",
    "measure   slot = `node plugin/scripts/slot-refill.ts` stdout 的 slots_free 字段",
    "band      slot = ≥0",
    "invoke    `node plugin/scripts/slot-refill.ts`",
    "control   in-flight≥cap ⇒ should_refill false",
    "resume    分步提交",
    "## Touches",
    "- plugin/scripts/impl.ts", // NOT (new): the merged implementation file exists in the tree
    "## AC",
    "- [x] AC1: the landed implementation is verified",
    "- [x] AC2: the landed implementation is green",
    "- [x] AC3: closure awaited",
    "## Definition of Done",
    "standard DoD — the five clauses; meta-enforcer fixture-pinned.",
  ].join("\n");
}

/** A ready body with NO completion checkboxes (total=0 — the landing is its closeout, per the
 *  isLandedCodeComplete gate) whose Touches declare a `(new)` file that does NOT exist on disk —
 *  so ready-pool-check's workLanded signals do NOT fire (no git-history on the declared touches, no
 *  landed (new) touch, no resolvable AC symbol) AND the commit-trace arm does NOT fire (the fixture's
 *  merge message is neutral — see makeLandedWorkspace's mergeMessage). The task therefore STAYS in
 *  pool.ready and REACHES slot-refill's new landed-implementation step-4 check — the exact
 *  defense-in-depth case the predicate adds: the id is in develop history but the declared-touches
 *  signals missed it. */
function landedNoCheckboxBody() {
  return [
    "**type:** execution",
    "## Proposal",
    "A real proposal paragraph that is definitely more than forty non-whitespace chars.",
    "## Contract",
    "measure   slot = `node plugin/scripts/slot-refill.ts` stdout 的 slots_free 字段",
    "band      slot = ≥0",
    "invoke    `node plugin/scripts/slot-refill.ts`",
    "control   in-flight≥cap ⇒ should_refill false",
    "resume    分步提交",
    "## Touches",
    "- code/future.ts (new)", // does NOT exist — not landed-evidence, but touches-resolve-safe ((new))
    // AC47 (gap-ac47-completion-predicate-consumer-fail-closed, AC1): the AC heading MUST be present
    // (even box-less) for sectionFound=true. Under the fail-closed fix an ABSENT AC section reads
    // total=NaN → isLandedCodeComplete=false → the "landing is its closeout" path (total===0) is
    // unreachable. This fixture tests the no-CHECKBOX closeout, so the AC section is present but has
    // zero checkboxes (total still 0, sectionFound now true).
    "## Acceptance Criteria",
    "prose acceptance criteria with no checkboxes at all",
    "## Definition of Done",
    "standard DoD — the five clauses; meta-enforcer fixture-pinned.",
  ].join("\n");
}

/** A ready body with open IMPLEMENTATION ACs (2/5) that touches the MERGED file `code/impl.ts` — the
 *  stuck-work shape: the code is in the tree but the task body declares real remaining implementation,
 *  so the completion gate must keep it dispatchable (gap-ready-pool-worklanded-traps-stuck-work). */
function landedStuckWorkBody(nChecked, nTotal) {
  const acs = [];
  for (let i = 0; i < nTotal; i++) acs.push(`- [${i < nChecked ? "x" : " "}] AC${i + 1}: a long enough acceptance criterion item number ${i + 1}`);
  return [
    "**type:** execution",
    "## Proposal",
    "A real proposal paragraph that is definitely more than forty non-whitespace chars.",
    "## Contract",
    "measure   slot = `node plugin/scripts/slot-refill.ts` stdout 的 slots_free 字段",
    "band      slot = ≥0",
    "invoke    `node plugin/scripts/slot-refill.ts`",
    "control   in-flight≥cap ⇒ should_refill false",
    "resume    分步提交",
    "## Touches",
    "- plugin/scripts/impl.ts", // the merged implementation file (exists in the tree) — workLanded fires, but the completion gate (open impl boxes) keeps it dispatchable
    "## Acceptance Criteria",
    ...acs,
    "## Definition of Done",
    "standard DoD — the five clauses; meta-enforcer fixture-pinned.",
  ].join("\n");
}

/** Build a REAL temp git repo where the task's implementation LANDED on develop — a MERGE whose
 *  message contains the task id AND whose first-parent diff changed an IMPLEMENTATION-CLASS file
 *  (`plugin/scripts/impl.ts`) — the exact "实现已在树" shape (AC3's "-m --first-parent" visibility
 *  case: plain `git show --name-only` prints 0 files for a merge; and the 2026-08-13 narrowing: the
 *  file must be implementation-class, not just any non-tasks/ sidecar). `mergeMessage` defaults to the
 *  canonical `fan-in: task/<id>` (the realistic landing); tests that need the NEW step-4 check to fire
 *  pass a NEUTRAL message (`merge: <id> — landing`) so ready-pool-check's commit-trace arm does NOT
 *  also fire (a traced task is excluded at the pool level before the candidate loop runs). The task's
 *  own tasks/<id>.md is written by the caller AFTER (in the working tree, uncommitted — develop
 *  history carries only the implementation). */
function makeLandedWorkspace(tag, landedId, opts = {}) {
  const { mergeMessage = `fan-in: task/${landedId}` } = opts;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `slot-refill-landed-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "plugin", "scripts"), { recursive: true });
  runGit(dir, "init", "-q");
  runGit(dir, "config", "user.email", "t@t");
  runGit(dir, "config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
  runGit(dir, "add", "-A");
  runGit(dir, "commit", "-qm", "base");
  runGit(dir, "branch", "-M", "develop");
  runGit(dir, "checkout", "-qb", `task/${landedId}`);
  fs.writeFileSync(path.join(dir, "plugin", "scripts", "impl.ts"), "// implementation\n");
  runGit(dir, "add", "-A");
  runGit(dir, "commit", "-qm", `implement ${landedId}`);
  runGit(dir, "checkout", "-q", "develop");
  runGit(dir, "merge", "--no-ff", `task/${landedId}`, "-m", mergeMessage);
  return dir;
}

/** Build a REAL temp git repo where develop has a commit whose message contains the task id BUT the
 *  commit changed ONLY `tasks/<taskId>.md` plus ONE sidecar file (a doc / telemetry path like
 *  docs/… or milestones/…). The predicate must NOT fire — the sidecar is not implementation-class
 *  (gap-slot-refill-landed-detection-implementation-file-classes: the phantom-killer false positives
 *  51699289 / 1f99e276 — a task-creation/analysis commit that incidentally touched a sidecar). */
function makeSidecarCommitWorkspace(tag, taskId, sidecarPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `slot-refill-sidecar-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.dirname(path.join(dir, sidecarPath)), { recursive: true });
  runGit(dir, "init", "-q");
  runGit(dir, "config", "user.email", "t@t");
  runGit(dir, "config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
  runGit(dir, "add", "-A");
  runGit(dir, "commit", "-qm", "base");
  runGit(dir, "branch", "-M", "develop");
  fs.writeFileSync(path.join(dir, "tasks", `${taskId}.md`), `---\nid: ${taskId}\nstatus: ready\n---\n\nstub\n`);
  fs.writeFileSync(path.join(dir, sidecarPath), "sidecar\n");
  runGit(dir, "add", "-A");
  runGit(dir, "commit", "-qm", `task: create ${taskId} (+ sidecar)`);
  return dir;
}

/** Build a REAL temp git repo where develop has a commit whose message contains the task id BUT the
 *  commit changed ONLY `tasks/<id>.md` (a task-creation / body-edit commit) — NOT implementation.
 *  The predicate must NOT fire (AC4: the implementation evidence must be a file OUTSIDE tasks/). */
function makeTaskOnlyCommitWorkspace(tag, taskId) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `slot-refill-doc-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "code"), { recursive: true });
  runGit(dir, "init", "-q");
  runGit(dir, "config", "user.email", "t@t");
  runGit(dir, "config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
  runGit(dir, "add", "-A");
  runGit(dir, "commit", "-qm", "base");
  runGit(dir, "branch", "-M", "develop");
  fs.writeFileSync(path.join(dir, "tasks", `${taskId}.md`), `---\nid: ${taskId}\nstatus: ready\n---\n\nstub\n`);
  runGit(dir, "add", "-A");
  runGit(dir, "commit", "-qm", `task: create ${taskId}`);
  return dir;
}

/** Build a REAL temp git repo where the task's implementation LANDED on develop but NO commit
 *  message carries the task id — the exact phantom-killer FALSE-NEGATIVE shape
 *  (gap-phantom-killer-false-negative-id-not-in-commits): hasLandedImplementation's `git log develop
 *  --grep <id>` misses EVERY commit (the empirical gap-superseded-modeled case — deba6463/8a8fc8f6/
 *  f12863a8/8bf44f9f/2d3caab0/23c8fee3 all ancestor on develop but their messages say "VALID_STATUSES
 *  加 superseded", never the id), so the pure-git signal returns false and the task is ONLY caught by
 *  the OR-in body-side signal (isBodyLanded). */
function makeLandedNoIdWorkspace(tag, landedId) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `slot-refill-fn-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "plugin", "scripts"), { recursive: true });
  runGit(dir, "init", "-q");
  runGit(dir, "config", "user.email", "t@t");
  runGit(dir, "config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
  runGit(dir, "add", "-A");
  runGit(dir, "commit", "-qm", "base");
  runGit(dir, "branch", "-M", "develop");
  runGit(dir, "checkout", "-qb", "feature/superseded");
  fs.writeFileSync(path.join(dir, "plugin", "scripts", "impl.ts"), "// implementation\n");
  runGit(dir, "add", "-A");
  runGit(dir, "commit", "-qm", "VALID_STATUSES 加 superseded");
  runGit(dir, "checkout", "-q", "develop");
  runGit(dir, "merge", "--no-ff", "feature/superseded", "-m", "merge: superseded lifecycle modeling");
  // Sanity: the landedId appears in NO develop commit message (the false-negative precondition).
  const hits = runGit(dir, "log", "develop", "--format=%s", "--grep", landedId);
  assert.equal(hits.trim(), "", `precondition: no develop commit names ${landedId}`);
  return dir;
}

/** The superseded-modeled task-body SHAPE that reproduced the phantom-killer false negative
 *  (gap-superseded-modeled-as-task-lifecycle-terminal at the empirical moment): ACs 全勾 (5/5) + the
 *  ONLY unchecked completion item is the outer full-suite verification — annotated `——外层 verification-
 *  round 验证`, NOT `（待外部）` (the exact form the fail-closed isExternalVerificationItem misses). */
function bodyLandedOuterUncheckedBody() {
  return [
    "**type:** execution",
    "## Proposal",
    "A real proposal paragraph that is definitely more than forty non-whitespace chars.",
    "## Contract",
    "measure   slot = `node plugin/scripts/slot-refill.ts` stdout 的 slots_free 字段",
    "band      slot = ≥0",
    "invoke    `node plugin/scripts/slot-refill.ts`",
    "control   in-flight≥cap ⇒ should_refill false",
    "resume    分步提交",
    "## Touches",
    "- code/impl.ts (new)", // (new) ⇒ touches-resolve-safe; NOT landed-evidence — the git-grep is the ONLY miss
    "## Acceptance Criteria",
    "- [x] AC1: the superseded lifecycle is modeled",
    "- [x] AC2: VALID_STATUSES accepts superseded",
    "- [x] AC3: web/MCP surfaces superseded",
    "- [x] AC4: migration of 18 tasks done",
    "- [x] AC5: existing tests green",
    "## Definition of Done",
    "- [x] AC1–AC5 全部勾上",
    "- [x] 修后实跑：superseded 可经 API 写读 + web 独立成桶",
    "- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）",
    "- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证",
  ].join("\n");
}

test("LANDED-IMPLEMENTATION — a ready task whose implementation is merged into develop (declared-touches signals missed it) is NOT recommended; deferred landed-implementation (AC1/AC2/AC3)", (t) => {
  const root = makeLandedWorkspace("pos", "gap-landed", { mergeMessage: "merge: gap-landed — landing" });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // gap-landed: implementation merged into develop (code/impl.ts, id in the merge message), but the
  // task's Touches declare a (new) file that does NOT exist and it has no completion checkboxes — so
  // ready-pool-check's workLanded/commit-trace/notYetFlipped all miss it and it stays in pool.ready.
  // The NEW pure-git + shape-aware step-4 check is the one that catches it.
  writeTask(root, "gap-landed", { status: "ready", labels: ["gap"], body: landedNoCheckboxBody() });
  // gap-fresh: genuinely-new (no develop implementation commit) — must still be recommended.
  writeTask(root, "gap-fresh", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/fresh.ts (new)"]) });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.ok(r.pool >= 2, "both candidates are in the ready pool");
  assert.ok(!r.recommended.includes("gap-landed"), "implementation-in-tree ready task is not re-recommended (AC1)");
  const reasons = (r.deferred || []).filter((d) => d.id === "gap-landed").map((d) => d.reason);
  assert.ok(reasons.includes("landed-implementation"), `landed task deferred with the explicit landed-implementation reason, got: ${reasons.join(",")}`);
  assert.ok(r.recommended.includes("gap-fresh"), "a genuinely-new ready task is still recommended (AC2 negative control)");
});

test("LANDED-IMPLEMENTATION — an all-checked landed task (the realistic phantom shape) is NOT in recommended (AC1, pool-level layering)", (t) => {
  const root = makeLandedWorkspace("layered", "gap-landed");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // gap-landed: implementation merged (code/impl.ts) AND all ACs checked under `## AC`. The AC1
  // outcome (recommended excludes it) holds via ready-pool-check's notYetFlipped allChecked arm at the
  // pool level — the new step-4 check is the defense-in-depth for the case that signal misses.
  writeTask(root, "gap-landed", { status: "ready", labels: ["gap"], body: landedAllCheckedBody() });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.ok(!r.recommended.includes("gap-landed"), "all-checked landed task is excluded from recommended (AC1)");
});

test("LANDED-IMPLEMENTATION — a landed task with open implementation ACs (stuck-work) stays dispatchable (gap-ready-pool-worklanded-traps-stuck-work parity)", (t) => {
  const root = makeLandedWorkspace("stuck", "gap-landed");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Implementation merged into develop, but the task body has 2/5 open implementation ACs — the pure
  // git signal alone would trap it as "landed"; the completion gate keeps it dispatchable (stuck-work).
  writeTask(root, "gap-landed", { status: "ready", labels: ["gap"], body: landedStuckWorkBody(2, 5) });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.ok(r.recommended.includes("gap-landed"), "an AC-incomplete landed task is stuck-work — stays dispatchable");
});

test("LANDED-IMPLEMENTATION — a commit that only touches tasks/<id>.md is NOT 'implementation' (AC4)", (t) => {
  const root = makeTaskOnlyCommitWorkspace("doc", "gap-doconly");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Pure predicate: the develop commit names the id but changed only tasks/ files ⇒ false.
  assert.equal(hasLandedImplementation(root, "gap-doconly"), false, "task-file-only commit is not landed implementation (AC4)");
  // End-to-end: overwrite the stub with a real ready body; still recommended.
  writeTask(root, "gap-doconly", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/doc.ts (new)"]) });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.ok(r.recommended.includes("gap-doconly"), "a task with only tasks-file commits is still dispatchable (AC4)");
});

test("LANDED-IMPLEMENTATION — AC3: the merge's file list is INVISIBLE without `-m --first-parent` and visible with it (measured 7418c615)", (t) => {
  const root = makeLandedWorkspace("ac3", "gap-landed");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const mergeSha = runGit(root, "log", "--merges", "--format=%H", "-1", "develop").trim();
  // Plain `git show --name-only` on a MERGE prints ZERO files (the default combined diff is empty) —
  // the false-negative pitfall the predicate exists to avoid.
  const withoutM = runGit(root, "show", "--name-only", "--format=", mergeSha);
  assert.equal(withoutM.trim(), "", "without -m a merge shows 0 files (AC3 pitfall)");
  // `-m --first-parent` diffs against the first parent → the merged implementation file is visible.
  const withM = runGit(root, "show", "-m", "--first-parent", "--name-only", "--format=", mergeSha);
  assert.ok(withM.includes("plugin/scripts/impl.ts"), `-m --first-parent reveals the merged files, got: ${withM}`);
  // The predicate consumes exactly that shape.
  assert.equal(hasLandedImplementation(root, "gap-landed"), true, "the merge landing is recognized (AC3)");
});

test("LANDED-IMPLEMENTATION — hasLandedImplementation pure: nonexistent id false, non-git root false (AC2 negative control)", (t) => {
  const root = makeLandedWorkspace("unit", "gap-landed");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(hasLandedImplementation(root, "gap-does-not-exist-xyz"), false, "nonexistent id ⇒ false (AC2 negative control)");
  const nonGit = makeWorkspace("nongit");
  t.after(() => fs.rmSync(nonGit, { recursive: true, force: true }));
  assert.equal(hasLandedImplementation(nonGit, "gap-anything"), false, "non-git root ⇒ fail-safe false (no false positive from an unavailable source)");
});

// ── PHANTOM-KILLER FALSE NEGATIVE (tasks/gap-phantom-killer-false-negative-id-not-in-commits) ───────
// hasLandedImplementation reads `git log develop --grep <taskId>` — when the implementation commits
// never carry the task id (the empirical case: gap-superseded-modeled-as-task-lifecycle-terminal, impl
// deba6463 etc. on develop, ACs 8/9 with the ONLY unchecked item the outer full-suite verification,
// status ready → still recommended) the grep misses and a LANDED task is still recommended. The fix
// ORs in a task-body-side landed signal (isBodyLanded — ACs 全勾 + every remaining unchecked item is
// outer-verification （待外部）/「外层全量验证」⇒ 视同 landed, AC2). Negative control: a genuinely-new task
// (lanes-nproc/two-peer class — id matches only task-creation/frame commits) judges NOT landed (AC3).
// AC1: the incidence observation point — phantom_killer_false_negative_caught counts body-caught /
// git-missed tasks.

test("PHANTOM-KILLER FALSE NEGATIVE — a landed task whose implementation commits never carry the id (superseded-modeled shape) is NOT recommended (AC1/AC2/AC3)", (t) => {
  const root = makeLandedNoIdWorkspace("body", "gap-superseded");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Pure-git: NO develop commit names the id ⇒ hasLandedImplementation is false — the false negative.
  assert.equal(hasLandedImplementation(root, "gap-superseded"), false, "git-grep misses the id-less implementation (the false negative)");
  // Body-side: ACs 全勾 + the ONLY unchecked item is the outer full-suite verification ⇒ landed.
  const body = bodyLandedOuterUncheckedBody();
  assert.equal(isOuterVerificationItem("全量套件绿（`fail 0`）——外层 verification-round 验证"), true, "the outer full-suite item is recognized as outer-verification (AC2)");
  assert.equal(isBodyLanded(body), true, "ACs 全勾 + 唯一未勾是外层验证 ⇒ body-side landed (AC2)");
  assert.equal(isLandedCodeComplete(body), true, "the completion gate also recognizes the outer family (AC2)");
  // End-to-end: the landed-but-id-less task is deferred, NOT recommended; a genuinely-new peer still is.
  writeTask(root, "gap-superseded", { status: "ready", labels: ["gap"], body });
  writeTask(root, "gap-fresh", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/fresh.ts (new)"]) });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.ok(!r.recommended.includes("gap-superseded"), "id-less landed task is NOT recommended (AC2)");
  const reasons = (r.deferred || []).filter((d) => d.id === "gap-superseded").map((d) => d.reason);
  assert.ok(reasons.includes("landed-implementation"), `deferred landed-implementation, got: ${reasons.join(",")}`);
  assert.ok(r.recommended.includes("gap-fresh"), "a genuinely-new ready task is still recommended (AC3 negative control)");
  assert.equal(r.phantom_killer_false_negative_caught, 1, "the body-side catch of a git-missed task is counted (AC1)");
});

test("PHANTOM-KILLER FALSE NEGATIVE — a genuinely-new task (lanes-nproc/two-peer class, id in task-creation commit only) judges NOT landed (AC3 negative control)", (t) => {
  const root = makeTaskOnlyCommitWorkspace("neg", "gap-lanes-nproc");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The id matches only the task-creation commit (tasks/<id>.md) — not implementation-class ⇒ git
  // signal false; the body is a genuinely-new dispatchable body with OPEN implementation ACs ⇒
  // body-side signal false. Judge NOT landed.
  const body = dispatchableBody(["- code/lanes.ts (new)"]);
  assert.equal(hasLandedImplementation(root, "gap-lanes-nproc"), false, "task-creation-only commit is not landed implementation (AC3)");
  assert.equal(isBodyLanded(body), false, "a genuinely-new task with open ACs is NOT body-side landed (AC3)");
  writeTask(root, "gap-lanes-nproc", { status: "ready", labels: ["gap"], body });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.ok(r.recommended.includes("gap-lanes-nproc"), "a genuinely-new ready task is still recommended (AC3)");
  assert.equal(r.phantom_killer_false_negative_caught, 0, "no false-negative catch for a genuinely-new task (AC1)");
});

test("PHANTOM-KILLER FALSE NEGATIVE — isBodyLanded pure: no-checkbox body NOT landed from body alone; （待外部）-annotated body landed (AC2 fail-safe)", () => {
  assert.equal(isBodyLanded(landedNoCheckboxBody()), false, "a no-checkbox task is NOT judged landed from body alone (would be a false positive)");
  assert.equal(isBodyLanded(dispatchableBody(["- code/x.ts (new)"])), false, "an open-AC dispatchable body is not landed");
  const annotated = bodyLandedOuterUncheckedBody().replace(
    "- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证",
    "- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）（待外部）",
  );
  assert.equal(isBodyLanded(annotated), true, "（待外部）-annotated outer item ⇒ body-side landed (reuses the pool's single-source predicate)");
  assert.equal(isOuterVerificationItem("AC1: a long enough acceptance criterion item number 1"), false, "an implementation AC is NOT outer-verification (fail-closed)");
});

// ── IMPLEMENTATION-CLASS FILE CLASS (gap-slot-refill-landed-detection-implementation-file-classes) ──
// The phantom-killer fix: hasLandedImplementation used to count ANY non-tasks/ file as landed-
// implementation evidence — a task-creation/analysis commit that incidentally touched a doc or
// telemetry sidecar (streaming-red 51699289 touched milestones/fast-mode-telemetry/*.json;
// worktree-node-modules 1f99e276 touched docs/analysis/*.md) judged the task "landed" with AC 0/10,
// no fan-in — real work suppressed by the killer. The evidence file must be IMPLEMENTATION-CLASS:
// packages/ · plugin/scripts/ · plugin/test/ · scripts/ · src/ (AC1 whitelist); docs/milestones/
// .quay/ telemetry sidecars never count (AC2 negative controls); a real landed task still judges true
// (AC3 positive control).

test("LANDED-IMPLEMENTATION — AC1: isImplementationClassFile whitelist — implementation landing points true, docs/milestones/.quay/telemetry sidecars false", () => {
  for (const p of [
    "packages/quay/src/gate/engine.js",
    "plugin/scripts/slot-refill.ts",
    "plugin/test/slot-refill.test.mjs",
    "scripts/test.sh",
    "src/main.ts",
  ]) {
    assert.equal(isImplementationClassFile(p), true, `${p} is an implementation-class landing point`);
  }
  for (const p of [
    "tasks/gap-x.md",
    "docs/analysis/batch2-queue-state.md",
    "milestones/fast-mode-telemetry/2026-08-13.json",
    ".quay/config.yml",
    "adr/ADR-001.md",
    "orchestration/manager-tick-core.md",
    "CLAUDE.md",
    "orchestration/manager-obligation-ledger.jsonl",
  ]) {
    assert.equal(isImplementationClassFile(p), false, `${p} is a sidecar / doc / telemetry path, NOT implementation-class`);
  }
});

test("LANDED-IMPLEMENTATION — AC2 NEGATIVE CONTROLS: a commit touching only tasks/ + a doc/telemetry sidecar is NOT landed (streaming-red 51699289 shape / worktree-node-modules 1f99e276 shape)", (t) => {
  // streaming-red shape: the task-creation commit 51699289 incidentally touched
  // milestones/fast-mode-telemetry/2026-08-13.json (+ tasks/*.md) ⇒ must judge FALSE (AC 0/10, no fan-in).
  const streaming = makeSidecarCommitWorkspace(
    "neg-streaming",
    "gap-streaming-red-cascade-amplifies-failures-array",
    "milestones/fast-mode-telemetry/2026-08-13.json",
  );
  t.after(() => fs.rmSync(streaming, { recursive: true, force: true }));
  assert.equal(hasLandedImplementation(streaming, "gap-streaming-red-cascade-amplifies-failures-array"), false,
    "streaming-red (milestones/ telemetry sidecar) is NOT landed implementation — real work not suppressed (AC2)");

  // worktree-node-modules shape: the analysis commit 1f99e276 incidentally touched
  // docs/analysis/batch2-queue-state.md (+ tasks/*.md) ⇒ must judge FALSE (AC 0/10, no fan-in).
  const wtnm = makeSidecarCommitWorkspace(
    "neg-wtnm",
    "gap-worktree-node-modules-inconsistent-self-verify",
    "docs/analysis/batch2-queue-state.md",
  );
  t.after(() => fs.rmSync(wtnm, { recursive: true, force: true }));
  assert.equal(hasLandedImplementation(wtnm, "gap-worktree-node-modules-inconsistent-self-verify"), false,
    "worktree-node-modules (docs/ sidecar) is NOT landed implementation — real work not suppressed (AC2)");
});

test("LANDED-IMPLEMENTATION — AC3 POSITIVE CONTROL: a real landed task (implementation-class file changed, id in the merge message) still judges TRUE", (t) => {
  // The runner-spawn code commit 1f2326e2 changed plugin/scripts/full-suite-runner.ts +
  // plugin/test/full-suite-runner.test.mjs — but its message does NOT name the task id, so the
  // grep-based predicate cannot see it. The representative real landed task whose develop merge DOES
  // name the id AND changed an implementation-class file is the predecessor of this very predicate:
  // gap-slot-refill-recommends-landed-code-complete-tasks (fan-in c6fc14a7 changed plugin/scripts/
  // ready-pool-check.ts + plugin/scripts/slot-refill.ts + plugin/test/slot-refill.test.mjs). The
  // fixture rebuilds that exact shape (merge message names the id; first-parent diff changed
  // plugin/scripts/impl.ts — an implementation-class landing point).
  const root = makeLandedWorkspace("pos-real", "gap-slot-refill-recommends-landed-code-complete-tasks");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(hasLandedImplementation(root, "gap-slot-refill-recommends-landed-code-complete-tasks"), true,
    "a real landed task (implementation-class file changed, id in the merge message) still judges TRUE (AC3 positive control)");
});

test("LANDED-IMPLEMENTATION — isLandedCodeComplete: all-checked true, open implementation items false (stuck-work), (待外部)-only true", () => {
  assert.equal(isLandedCodeComplete(landedAllCheckedBody()), true, "all ACs checked (shape-aware ## AC) ⇒ code-complete");
  assert.equal(isLandedCodeComplete(landedStuckWorkBody(2, 5)), false, "open implementation ACs ⇒ NOT code-complete (stuck-work)");
  assert.equal(isLandedCodeComplete(landedNoCheckboxBody()), true, "no completion boxes ⇒ the landing is its closeout (code-complete)");
  assert.equal(isLandedCodeComplete(dispatchableBody(["- code/x.ts (new)"])), false, "an in-progress ready task with an open AC is not code-complete");
  // awaiting-verification: every open item annotated （待外部）
  const ext = landedStuckWorkBody(2, 3).replace(
    "- [ ] AC3: a long enough acceptance criterion item number 3",
    "- [ ] AC3: await external verification （待外部）",
  );
  assert.equal(isLandedCodeComplete(ext), true, "every remaining item （待外部） ⇒ code-complete (awaiting verification)");
});

// ── AC47 fail-closed (gap-ac47-completion-predicate-consumer-fail-closed) ─────────────────────────
// DIR-014's LIVE fail-open shape: `## Acceptance Criteria (runnable — …)` suffixed heading (NOT
// recognized by the literal `## Acceptance Criteria` extractSection) carrying 5 unchecked boxes, and
// `## Definition of Done — REAL LANDING is the bar`. Before the fix countAcCheckboxes(null) returned
// {unchecked: 0} → countCompletionCheckboxes {total:0, checked:0, unchecked:0} → judged complete
// (fail-open, manager 2026-08-13). After the fix: AC3 REGISTERS the suffixed headings (section found,
// the 5 boxes counted) AND the fail-closed NaN backstop covers any UNREGISTERED variant. Either way NO
// consumer reports "complete/landed".
function dir014SuffixedBody() {
  return [
    "## Finding",
    "A finding paragraph that is definitely more than forty non-whitespace chars.",
    "## Acceptance Criteria (runnable — artifacts are necessary-not-sufficient)",
    "- [ ] item 1: the milestone carries a real Proposal section",
    "- [ ] item 2: the plan reference resolves to an existing docs/plans file",
    "- [ ] item 3: the enforcement is real, not prose (it0-dod-check exits non-zero on a stub)",
    "- [ ] item 4: OUTER-LOOP step 5 invokes quay-task-to-plan as the operative route",
    "- [ ] item 5: the two-class policy is the default, not discretionary",
    "## Definition of Done — REAL LANDING is the bar, not artifacts",
    "NOT done when the skill is wired in prose — a green fixture alone is NOT sufficient.",
  ].join("\n");
}

test("AC47 — SHAPE_SECTIONS registration: the DIR-014 suffixed AC/DoD headings ARE recognized and its 5 unchecked boxes are counted (AC3)", () => {
  const cb = countCompletionCheckboxes(dir014SuffixedBody());
  assert.equal(cb.sectionFound, true, "registered suffixed headings are recognized (sectionFound:true)");
  assert.equal(cb.total, 5, "the 5 unchecked boxes under the suffixed AC heading are COUNTED (AC3)");
  assert.equal(cb.checked, 0);
  assert.equal(cb.unchecked, 5);
});

test("AC47 — negative control on DIR-014's suffixed-heading + 5 unchecked boxes: NONE of the 5 consumers reports complete/landed (AC2)", (t) => {
  const body = dir014SuffixedBody();
  const cb = countCompletionCheckboxes(body);
  // 1. slot-refill:373 isLandedCodeComplete (the MAIN fail-open — fed landed judgment): not landed.
  assert.equal(isLandedCodeComplete(body), false, "DIR-014 shape is NOT judged landed (AC2)");
  assert.equal(isBodyLanded(body), false, "the body-side landed OR-in also does NOT fire (AC2)");
  // 2. slot-refill:274 isNotYetFlippedSkip (destructures countAcCheckboxes): not wrongly skipped. Its
  //    literal `## Acceptance Criteria` extractSection cannot see the suffixed heading → section
  //    found=false → fail-closed (not a not-yet-flipped skip).
  const root = makeLandedWorkspace("ac47-nyf", "gap-ac47-ctl");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(hasFanInMerge(root, "gap-ac47-ctl"), true, "precondition: the id's branch was fanned in");
  assert.equal(
    isNotYetFlippedSkip({ id: "gap-ac47-ctl", body, root, excludedNyfIds: new Set() }),
    false,
    "unreadable literal AC section ⇒ NOT a not-yet-flipped skip (AC2)",
  );
  // 3. ready-pool-check:793 allChecked (countCompletionCheckboxes + `total > 0 && checked === total`):
  //    total=5, checked=0 → allChecked false.
  assert.equal(cb.total > 0 && cb.checked === cb.total, false, "not all-checked (AC2)");
  // 4. ready-pool-check:1754 acOpen = cb.unchecked → 5 (not 0) → NOT the "clean backlog" (甲) split.
  assert.equal(cb.unchecked === 0, false, "acOpen=5 ≠ 0 ⇒ NOT mis-split as clean backlog (AC2)");
  // 5. task-status-drift-check:810 closed-without-work guard `acBoxes.total > 0` — it reads the LITERAL
  //    `## Acceptance Criteria` section (extractSection → null for the suffixed heading) → countAcCheckboxes
  //    is fail-closed NaN → NaN > 0 is false → the guard does NOT fire → not flagged "pass" (AC2).
  const literalAc = null; // the suffixed heading is invisible to the literal extractSection
  const acBoxes = countAcCheckboxes(literalAc);
  assert.equal(acBoxes.total > 0 && acBoxes.checked === 0, false, "closed-without-work guard does not fire on an unreadable section (AC2)");
  assert.equal(Number.isNaN(acBoxes.total), true, "the fail-closed NaN shape is what makes old read-patterns structurally unable to pass");
});

test("AC47 — an UNREGISTERED suffixed variant fails CLOSED (sectionFound:false, no consumer can judge complete/landed)", () => {
  // `## Acceptance Criteria for the OLD design` is NOT in SHAPE_SECTIONS — prefix-matching would
  // wrongly swallow it; explicit registration means it is unrecognized → fail-closed.
  const unregistered = [
    "## Contract",
    "measure   x = 1",
    "## Acceptance Criteria for the OLD design",
    "- [ ] a real remaining unchecked box",
    "## Definition of Done",
    "standard",
  ].join("\n");
  const cb = countCompletionCheckboxes(unregistered);
  assert.equal(cb.sectionFound, false, "an unregistered suffixed heading is NOT recognized (AC3)");
  assert.equal(Number.isNaN(cb.total), true, "absent/unrecognized section ⇒ total NaN (fail-closed structural guarantee)");
  assert.equal(cb.total === 0, false, "total is NOT 0 — the old fail-open ({unchecked:0} → complete) is impossible");
  assert.equal(isLandedCodeComplete(unregistered), false, "an unregistered-variant task is NOT judged landed (AC1/AC2)");
  assert.equal(isBodyLanded(unregistered), false, "an unregistered-variant task is NOT judged body-side landed (AC1/AC2)");
});

// ── MUTEX-CLIQUE LANDED-IGNORE (tasks/gap-slot-refill-clique-ignores-landed-touches) ─────────────────
// The phantom-killer's recommendation exclusion (landed && code-complete) did NOT cover the impact of a
// landed-but-NOT-code-complete task's touches on the MUTEX CLIQUE: its implementation is already in the
// tree (it won't/shouldn't be re-dispatched as new work), yet its `## Touches` kept occupying the batch
// clique and crowded out a genuinely-dispatchable task touching the same file — the measured
// phase-overlap → 2-slot exclusion (P1 dropped from recommended AND deferred, in-clique crowding with no
// reading). AC1: the clique computation ignores the touches of hasLandedImplementation=true ready tasks
// (reusing the existing signal, never a new fetch); AC2: a landed-but-not-flipped task + a real new task
// touching the same file ⇒ the new task is NOT crowded out, and the recommendation exclusion for a
// code-complete landed task still holds; AC4: two NON-landed tasks touching the same file remain mutually
// exclusive (the change never relaxes real-overlap serialization).

test("CLIQUE-LANDED — AC1/AC2: a landed-but-not-flipped task's touches leave the mutex clique (phase-overlap shape); the real task touching the same file is recommended; the stuck-work landed task stays dispatchable", (t) => {
  const root = makeLandedWorkspace("clique-pos", "gap-overlap");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The shared file BOTH conflicting tasks touch must EXIST (a non-(new) touch resolves to the tree).
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "test.sh"), "#!/bin/sh\necho test\n");
  // gap-overlap: implementation LANDED (plugin/scripts/impl.ts merged into develop — hasLandedImplementation
  // fires) but 2/5 open implementation ACs ⇒ isLandedCodeComplete=false — the exact phase-overlap
  // pre-flip shape (landed-but-not-code-complete, e.g. a DoD meta box not annotated （待外部）). Touches
  // scripts/test.sh (the shared file) — and it is NOT not-yet-flipped (2/5 ≤ 50%), NOT deferred by the
  // recommendation exclusion (not code-complete), so it reaches the candidate list.
  writeTask(root, "gap-overlap", {
    status: "ready", labels: ["gap"],
    body: landedStuckWorkBody(2, 5).replace("- plugin/scripts/impl.ts", "- scripts/test.sh"),
  });
  // gap-p1: a genuinely-dispatchable NEW task touching the SAME file (the measured 2-slot task P1).
  writeTask(root, "gap-p1", {
    status: "ready", labels: ["gap"],
    body: dispatchableBody(["- scripts/test.sh", "- code/p1.ts (new)"]),
  });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 5 });
  // AC1/AC2 primary: P1 IS recommended — its clique collision with the landed task's touches is ignored
  // (pre-fix the landed task's touches blocked it in the batch: neither recommended nor deferred).
  assert.ok(r.recommended.includes("gap-p1"), "AC2: the real new task is NOT crowded out by the landed task's touches");
  // AC1/stuck-work parity: the landed-but-not-code-complete task stays a candidate and is recommended —
  // it is NOT deferred; only its touches leave the clique (gap-ready-pool-worklanded-traps-stuck-work).
  assert.ok(r.recommended.includes("gap-overlap"), "AC1: the landed stuck-work task stays dispatchable (only its touches are clique-exempt)");
  // AC56 去序: `recommended` is de-ordered (lexicographic) — the batch's internal "real work first,
  // landed re-appended after" priority is no longer an OUTPUT property. The AC1/AC2 guarantee (real
  // work NOT crowded out of the SET — landed touches never displace real work) is the membership
  // assertion above; the dispatch array itself must not encode a priority order.
  assert.deepEqual(
    r.recommended,
    ["gap-overlap", "gap-p1"],
    "recommended is de-ordered (lexicographic: overlap < p1) — the dispatch array no longer encodes the landed-vs-real priority (AC56)",
  );
});

test("CLIQUE-LANDED — AC2 guard: the recommendation exclusion (landed && code-complete) still holds — a code-complete landed task is not re-recommended even in the same fixture", (t) => {
  const root = makeLandedWorkspace("clique-guard", "gap-complete");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // gap-complete: implementation LANDED (merged into develop) AND all completion boxes checked ⇒
  // code-complete. The recommendation exclusion must still keep it out of recommended (AC2: 不重新推荐
  // landed 任务) — it is pool-excluded (allChecked) and/or deferred landed-implementation, never in the
  // batch clique.
  writeTask(root, "gap-complete", { status: "ready", labels: ["gap"], body: landedAllCheckedBody() });
  // gap-fresh: a genuinely-new ready task (no landing record) — must still be recommended.
  writeTask(root, "gap-fresh", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/fresh.ts (new)"]) });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.ok(!r.recommended.includes("gap-complete"), "AC2: a code-complete landed task is still excluded from recommendation");
  assert.ok(r.recommended.includes("gap-fresh"), "AC2: a genuinely-new ready task is still recommended");
});

test("CLIQUE-LANDED — AC4: two NON-landed tasks touching the same file remain mutually exclusive (the change never relaxes real-overlap serialization)", (t) => {
  const root = makeWorkspace("clique-ac4");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Neither task is landed (makeWorkspace is a non-git temp dir ⇒ hasLandedImplementation fails safe to
  // false) and BOTH touch the same file — the batch clique must still serialize them (AC4).
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/shared.ts (new)"]) });
  writeTask(root, "gap-b", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/shared.ts (new)"]) });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 5 });
  const hasA = r.recommended.includes("gap-a");
  const hasB = r.recommended.includes("gap-b");
  assert.ok(!(hasA && hasB), "AC4: two non-landed tasks touching the same file are never both recommended");
  assert.equal(r.recommended.length, 1, "AC4: exactly one of the colliding non-landed pair is recommended");
});

// ── C8 SELF-TOUCH / BACKFILL (tasks/gap-slot-refill-c8-reject-no-backfill) ──────────────────────────
// slot-refill's candidate loop used to apply only its OWN step-4 checks (touches-resolve / deps /
// concurrency / nyf) and NOT the inner dispatch side's C8 self-touch gate. It therefore recommended
// candidates that the inner rejected one-by-one at dispatch (C8: `## Touches` must contain
// `tasks/<id>.md` without `(new)`), with NO backfill from later-in-sort candidates — the measured
// "17 本可派 + 本 tick 无可派" deadlock (22 ready, 5 missing self-touch). AC2: the candidate loop now
// rejects C8-MISSING candidates and BACKFILLS from later-in-sort candidates until cap filled or
// candidates exhausted. AC4: all candidates rejected ⇒如实无可派 (no fabrication). The injected
// `dispatchGate` callback gives the inner a per-candidate gate extension point with the same backfill.

test("C8 BACKFILL — the first 3 id-sorted candidates lack self-touch; the 4th+ have it ⇒ recommended backfills the 4th+ (AC2, c8_rejected_candidate_backfilled)", (t) => {
  const root = makeWorkspace("c8-backfill");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // id-sorted order: c8-a, c8-b, c8-c rank FIRST but are C8-MISSING (selfTouch: false) — the inner
  // would reject each at dispatch. c8-d, c8-e rank LATER and ARE C8-clean — they must backfill.
  writeTask(root, "gap-c8-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]), selfTouch: false });
  writeTask(root, "gap-c8-b", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/b.ts (new)"]), selfTouch: false });
  writeTask(root, "gap-c8-c", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/c.ts (new)"]), selfTouch: false });
  writeTask(root, "gap-c8-d", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/d.ts (new)"]) });
  writeTask(root, "gap-c8-e", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/e.ts (new)"]) });

  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 5 });
  assert.equal(r.pool, 5, "all 5 are ready and in the pool");
  assert.equal(r.should_refill, true);
  assert.ok(r.recommended.includes("gap-c8-d"), "4th candidate (C8-clean) BACKFILLS into recommended");
  assert.ok(r.recommended.includes("gap-c8-e"), "5th candidate (C8-clean) BACKFILLS into recommended");
  for (const id of ["gap-c8-a", "gap-c8-b", "gap-c8-c"]) {
    assert.ok(!r.recommended.includes(id), `C8-MISSING candidate ${id} is NOT recommended (rejected ⇒ later candidate backfills)`);
  }
});

test("C8 ALL-REJECTED — every candidate lacks self-touch ⇒ recommended empty, should_refill=false, no fabricated dispatch (AC4, all_rejected_no_fake)", (t) => {
  const root = makeWorkspace("c8-all-rejected");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-c8-x", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/x.ts (new)"]), selfTouch: false });
  writeTask(root, "gap-c8-y", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/y.ts (new)"]), selfTouch: false });
  writeTask(root, "gap-c8-z", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/z.ts (new)"]), selfTouch: false });

  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 5 });
  assert.equal(r.pool, 3, "3 ready candidates in the pool");
  assert.equal(r.slots_free, 5, "slots exist");
  assert.equal(r.recommended.length, 0, "all C8-MISSING ⇒ nothing recommended — 如实无可派 (no fabrication from backfill)");
  assert.equal(r.should_refill, false, "recommended empty ⇒ should_refill=false");
  assert.match(r.no_refill_reason, /no dispatchable candidate/);
});

test("C8 BACKFILL — injected dispatchGate rejects a mid-rank candidate ⇒ later candidate backfills (AC2, dispatch-gate callback)", (t) => {
  const root = makeWorkspace("c8-gate");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // id-sorted: gate-a, gate-b, gate-c — all C8-clean. The INJECTED gate rejects gate-b (mid-ranked);
  // the loop must skip it and BACKFILL gate-c into recommended (never recommend gate-b).
  writeTask(root, "gap-gate-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/ga.ts (new)"]) });
  writeTask(root, "gap-gate-b", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/gb.ts (new)"]) });
  writeTask(root, "gap-gate-c", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/gc.ts (new)"]) });
  const r = analyzeSlotRefill({
    tasksDir: path.join(root, "tasks"),
    root,
    cap: 3,
    dispatchGate: ({ id }) => (id === "gap-gate-b" ? { ok: false, reason: "test gate rejects gap-gate-b" } : { ok: true }),
  });
  assert.ok(r.recommended.includes("gap-gate-a"), "unrejected candidate still recommended");
  assert.ok(r.recommended.includes("gap-gate-c"), "later candidate BACKFILLS the rejected slot");
  assert.ok(!r.recommended.includes("gap-gate-b"), "gate-rejected candidate is not recommended (no fabrication)");
});

// ── MEASURED IN-FLIGHT (tasks/gap-slot-refill-inflight-disconnected-from-worktrees) ───────────────────
// A bare `slot-refill --json` (no --in-flight) used to read in_flight_count=0 even while worktrees +
// telemetry showed tasks in flight — the manager's 2026-08-12 field reading (2 worktrees + telemetry
// inProgress, slot-refill 0), same "counter reports 0 instead of erroring" family as
// gap-inbox-counter-disconnected-from-files. The fix: when --in-flight/--closed-but-live are NOT
// passed, MEASURE the in-flight view from the authoritative reconcile-aware telemetry `--slot-status`
// (kept real-in-flight records + closed-but-live agents + non-task subagents). The inner tick's
// explicit --in-flight path is byte-unchanged. AC1: 有在飞 ⇒ in_flight_count ≥ 实际数; AC2: 无在飞 ⇒ 0
// (negative control); AC3: occupied_slots/should_refill consistent with in-flight (never 5 free while
// 2 occupied); AC4: new tests cover (a)(b)(c); AC5: existing tests stay green.

const TELEMETRY_CLI = path.resolve(__dirname, "..", "scripts", "fast-mode-telemetry.ts");
const SLOT_REFILL_CLI = path.resolve(__dirname, "..", "scripts", "slot-refill.ts");

/** Run the slot-refill CLI with `--root` + `--cap 5` + extra args, parse the JSON. The child telemetry
 *  `--slot-status` scan of live subagent processes is made deterministic via QUAY_TELEMETRY_SUBAGENTS=0
 *  (never depends on whatever else is running on the machine at test time). */
function runSlotRefillJson(root, extraArgs = []) {
  return JSON.parse(execFileSync(process.execPath, [
    "--no-warnings", "--experimental-strip-types", SLOT_REFILL_CLI, "--root", root, "--cap", "5", ...extraArgs,
  ], { encoding: "utf8", env: { ...process.env, QUAY_TELEMETRY_SUBAGENTS: "0" } }));
}

/** Write a REAL telemetry start event via the CLI (validated), returning the runId it printed. */
function runTelemetryTaskStart(root, taskId) {
  const out = execFileSync(process.execPath, [
    "--no-warnings", "--experimental-strip-types", TELEMETRY_CLI, "--task-start", "--taskId", taskId, "--root", root,
  ], { encoding: "utf8", env: { ...process.env, QUAY_TELEMETRY_SUBAGENTS: "0" } });
  const line = out.trim().split("\n").pop(); // runId is the last stdout line
  assert.ok(/^fm-/.test(line), `--task-start printed a runId, got: ${line}`);
  return line;
}

/** Build a REAL git workspace where `task/<inflightId>` is checked out in an OPEN worktree (the
 *  reconcile KEEP signal) AND a telemetry start event exists — the exact "有在飞" shape the manager
 *  read (`git worktree list` + telemetry inProgress). The worktree lives INSIDE the temp root, so a
 *  plain rmSync(root) cleans both the worktree files and its .git/worktrees metadata. */
function makeInflightWorkspace(tag, inflightId) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `slot-refill-infl-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "code"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".workflow-events"), { recursive: true });
  runGit(dir, "init", "-q");
  runGit(dir, "config", "user.email", "t@t");
  runGit(dir, "config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
  runGit(dir, "add", "-A");
  runGit(dir, "commit", "-qm", "base");
  runGit(dir, "branch", "-M", "develop");
  // The in-flight task's branch, checked out in a worktree (reconcile keep signal) + a start event.
  runGit(dir, "checkout", "-qb", `task/${inflightId}`);
  runGit(dir, "checkout", "-q", "develop");
  runGit(dir, "worktree", "add", path.join(dir, `wt-${inflightId}`), `task/${inflightId}`);
  runTelemetryTaskStart(dir, inflightId);
  return dir;
}

test("parseSlotStatusOutput — pure parser maps kept/closed-but-live/subagents from --slot-status JSON", () => {
  const parsed = parseSlotStatusOutput(JSON.stringify({
    real_in_flight: 2,
    subagents_in_flight: 1,
    occupied_slots: 4,
    kept: [{ taskId: "gap-a", keepReason: "worktree-present" }, { taskId: "gap-b", keepReason: "worktree-present" }],
    closed_but_live_agents: [{ taskId: "gap-ghost", reason: "worktree-present" }],
  }));
  assert.deepEqual(parsed.keptIds, ["gap-a", "gap-b"]);
  assert.deepEqual(parsed.closedButLiveIds, ["gap-ghost"]);
  assert.equal(parsed.realInFlight, 2);
  assert.equal(parsed.closedButLiveCount, 1);
  assert.equal(parsed.subagentsInFlight, 1);
  assert.equal(parsed.occupiedSlots, 4);
});

test("MEASURED — bare invocation reads real in-flight from telemetry; never re-recommends it (AC1/AC3)", (t) => {
  const root = makeInflightWorkspace("pos", "gap-inflight");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-inflight", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/inflight.ts (new)"]) });
  writeTask(root, "gap-other", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/other.ts (new)"]) });

  // The BARE invocation (no --in-flight) — exactly the manager's field reading that used to report 0.
  const r = runSlotRefillJson(root);
  assert.equal(r.measurement_source, "telemetry-slot-status", "the in-flight view is measured, not input");
  assert.equal(r.measurement_error, null);
  assert.equal(r.in_flight_count, 1, "AC1: 有在飞 ⇒ in_flight_count ≥ 实际数 (telemetry kept 1)");
  assert.equal(r.occupied_slots, 1, "AC3: occupied matches telemetry (1), not 0");
  assert.equal(r.slots_free, 4, "AC3: 5 − 1 occupied = 4 free, never 5 while 1 occupied");
  assert.ok(!r.recommended.includes("gap-inflight"), "an in-flight task is never re-recommended (touches-overlap with itself)");
  assert.ok(r.recommended.includes("gap-other"), "a disjoint dispatchable candidate is still recommended");
});

test("MEASURED — negative control: no events/worktree ⇒ in_flight_count=0, measured source (AC2)", (t) => {
  const root = makeWorkspace("neg-meas");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });

  const r = runSlotRefillJson(root);
  assert.equal(r.measurement_source, "telemetry-slot-status");
  assert.equal(r.in_flight_count, 0, "AC2: 无在飞 ⇒ 0 (negative control)");
  assert.equal(r.occupied_slots, 0);
  assert.equal(r.slots_free, 5);
});

test("MEASURED — explicit --in-flight (inner tick path) reports explicit-input, byte-compatible arithmetic", (t) => {
  const root = makeWorkspace("expl");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-in", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/in.ts (new)"]) });
  writeTask(root, "gap-out", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/out.ts (new)"]) });

  // The inner tick A12 passes its own maintained --in-flight → the explicit path, NO telemetry read.
  const r = runSlotRefillJson(root, ["--in-flight", "gap-in"]);
  assert.equal(r.measurement_source, "explicit-input");
  assert.equal(r.in_flight_count, 1);
  assert.equal(r.occupied_slots, 1);
  assert.equal(r.slots_free, 4);
  assert.ok(!r.recommended.includes("gap-in"), "explicit in-flight task not recommended");
  assert.ok(r.recommended.includes("gap-out"));
});

test("MEASURED — subagentsInFlight occupies a slot in the pure function (occupied_slots/slots_free)", (t) => {
  const root = makeWorkspace("subagents");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  // 1 in-flight + 2 investigation subagents (no task id — count only, never in the disjointness check).
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 5, subagentsInFlight: 2 });
  assert.equal(r.subagents_in_flight, 2);
  assert.equal(r.occupied_slots, 2, "occupied = 0 in-flight + 2 subagents");
  assert.equal(r.slots_free, 3);
  assert.ok(r.recommended.includes("gap-a"), "subagents don't block the disjointness check (no task id to overlap)");
});

test("MEASURED — telemetry read failure degrades but is never silent (measurement_source + measurement_error)", (t) => {
  const root = makeWorkspace("deg");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  // `.workflow-events` as a regular FILE makes the telemetry CLI's readdir throw (ENOTDIR) → the
  // measurement subprocess fails → the JSON must surface the failure, not silently read 0.
  fs.writeFileSync(path.join(root, ".workflow-events"), "not a dir\n");

  const r = runSlotRefillJson(root);
  assert.equal(r.measurement_source, "degraded-no-telemetry");
  assert.ok(r.measurement_error && /ENOTDIR|not a directory|Command failed/.test(r.measurement_error),
    `measurement_error surfaced, got: ${r.measurement_error}`);
  // AC6 (tasks/gap-in-flight-resolve-by-task-id-not-worktree-name, 判据5 修法 (a)): a degraded
  // measurement is NOT "genuinely 0 in-flight" — the slot-family fields are NULL so a downstream
  // arithmetic consumer crashes instead of silently computing "5 empty slots".
  assert.equal(r.in_flight_count, null, "degraded → in_flight_count is null (not same-shaped as 0)");
  assert.equal(r.slots_free, null, "degraded → slots_free is null (never a silently-computed '5 empty slots')");
  assert.equal(r.occupied_slots, null, "degraded → occupied_slots is null");
  assert.equal(r.subagents_in_flight, null, "degraded → subagents_in_flight is null");
  assert.equal(r.should_refill, false, "degraded → fail-closed: no refill");
});

// AC6 DUAL-MEASUREMENT NEGATIVE CONTROL (tasks/gap-in-flight-resolve-by-task-id-not-worktree-name,
// 判据5 修法 (a), manager 13:2xZ): mock measurement_error non-empty ⇒ the measured slot-family fields
// are null; the SAME call with a healthy measurement_source ⇒ they stay numbers (negative control —
// the null is keyed to degraded, not to "empty in-flight").

test("AC6 — degraded measurement nulls in_flight_count/slots_free/subagents_in_flight; healthy source keeps numbers (负控制)", (t) => {
  const root = makeWorkspace("ac6-degraded");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tasksDir = path.join(root, "tasks");
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  const base = { tasksDir, root, cap: 5, inFlight: [inFlightTask("gap-a", ["- code/a.ts (new)"])] };

  // 负控制 mock: measurement_error non-empty + degraded source (the 2026-08-14 13:2xZ 现场 shape:
  // spawnSync ETIMEDOUT ⇒ measurement_source='degraded-no-telemetry').
  const degraded = analyzeSlotRefill({ ...base, measurementSource: "degraded-no-telemetry", measurementError: "spawnSync fast-mode-telemetry.ts ETIMEDOUT (load1=18.58)" });
  assert.equal(degraded.measurement_source, "degraded-no-telemetry");
  assert.ok(degraded.measurement_error, "measurement_error is non-empty (the mock)");
  assert.equal(degraded.in_flight_count, null, "degraded → in_flight_count null (never a silent 0)");
  assert.equal(degraded.slots_free, null, "degraded → slots_free null (never a silently-computed '5 empty slots')");
  assert.equal(degraded.subagents_in_flight, null, "degraded → subagents_in_flight null");
  assert.equal(degraded.occupied_slots, null, "degraded → occupied_slots null");
  assert.equal(degraded.running_subagent_count, null, "degraded → running_subagent_count null");
  assert.equal(degraded.should_refill, false, "degraded → fail-closed no-refill");
  assert.ok(degraded.no_refill_reason && /measurement degraded/.test(degraded.no_refill_reason),
    "no_refill_reason names the degraded state, not a fake 'no free slots'");

  // Negative control: the SAME inputs with a HEALTHY source (explicit-input) ⇒ numbers, not null.
  const healthy = analyzeSlotRefill({ ...base, measurementSource: "explicit-input" });
  assert.equal(healthy.in_flight_count, 1, "healthy → in_flight_count stays a number");
  assert.equal(healthy.slots_free, 4, "healthy → slots_free stays a number");
  assert.equal(healthy.occupied_slots, 1, "healthy → occupied_slots stays a number");
  assert.equal(healthy.subagents_in_flight, 0, "healthy → subagents_in_flight stays a number");
});

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
} from "../scripts/slot-refill.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── fixture helpers ───────────────────────────────────────────────────────────────────────────────

function makeWorkspace(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `slot-refill-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "code"), { recursive: true });
  return dir;
}

function writeTask(root, id, { status = "todo", labels = [], parent = null, body }) {
  const fm = [
    "---",
    `id: ${id}`,
    `title: fixture ${id}`,
    `status: ${status}`,
    "labels:",
    ...labels.map((l) => `  - ${l}`),
    `parent: ${parent}`,
    "extra:",
    "  schema: v1",
    "---",
  ].join("\n");
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
  const script = path.resolve(__dirname, "..", "scripts", "slot-refill.ts");
  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", script, "--root", root],
    { encoding: "utf8" },
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
  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", script, "--root", root, "--cap", "3"],
    { encoding: "utf8" },
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

// ── Suite-blocking rank (tasks/gap-ready-relevance-blind-to-suite-blocking-signal AC3) ──────────────
// AC3: a task the consecutive-red-window signal implicates (pool.suite_blocking.tasks, the
// ready-pool-check blocking_suite axis) is ranked FIRST into `recommended` — the inner's slot-refill
// picks the suite-blocker before any other work. Negative control: no red window ⇒ recommended keeps
// the pre-signal (id) ordering.

function writeRounds(root, rows) {
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "verification-round.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n"));
}

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

  // AC4 negative control FIRST: no suite history ⇒ recommended keeps the id tie-break order.
  const before = analyzeSlotRefill(opts);
  assert.equal(before.suite_blocking.window_active, false);
  assert.deepEqual(before.recommended, ["gap-plain-ready", "gap-watchdog"], "no red window ⇒ pre-signal ordering");

  // AC3: 3 consecutive red rounds whose failures hit the watchdog task's Touches ⇒ it ranks first.
  writeRounds(root, Array.from({ length: 3 }, (_, i) => ({ round: 220 + i, state: "red", reason: "failed", fail: 1, failures: [{ file: "code/wd.ts", line: "x" }] })));
  writeState(root, [{ file: "code/wd.ts", line: "x" }]);
  const after = analyzeSlotRefill(opts);
  assert.equal(after.suite_blocking.window_active, true);
  assert.deepEqual(after.suite_blocking.tasks, ["gap-watchdog"]);
  assert.equal(after.recommended[0], "gap-watchdog", "the suite-blocker is picked first by the refill");
  assert.equal(after.recommended.length, 2, "both dispatchable candidates still recommended (cap 2)");

  // negative: last round green clears the window ⇒ recommended back to pre-signal order.
  writeRounds(root, [
    ...Array.from({ length: 3 }, () => ({ state: "red", reason: "failed", fail: 1, failures: [{ file: "code/wd.ts" }] })),
    { round: 223, state: "green", fail: 0 },
  ]);
  const green = analyzeSlotRefill(opts);
  assert.equal(green.suite_blocking.window_active, false);
  assert.deepEqual(green.recommended, ["gap-plain-ready", "gap-watchdog"], "green round clears the window ⇒ no re-rank");
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

test("computeArbitratedCap — red + backlog > threshold narrows; every other combo keeps base (AC2 pure)", () => {
  assert.equal(computeArbitratedCap({ baseCap: 5, suiteRed: true, integrationBacklog: 60 }), 2, "red + backlog 60 > 50 ⇒ redBacklogCap");
  assert.equal(computeArbitratedCap({ baseCap: 5, suiteRed: true, integrationBacklog: 51 }), 2, "strict >: 51 > 50 narrows");
  assert.equal(computeArbitratedCap({ baseCap: 5, suiteRed: true, integrationBacklog: 50 }), 5, "threshold is strict >: 50 not > 50");
  assert.equal(computeArbitratedCap({ baseCap: 5, suiteRed: false, integrationBacklog: 60 }), 5, "green suite ⇒ cap restores (invariant cap_restores_on_green)");
  assert.equal(computeArbitratedCap({ baseCap: 5, suiteRed: true, integrationBacklog: 0 }), 5, "red + no backlog ⇒ no effect (invariant no_backlog_no_effect)");
  // custom threshold/cap are honored
  assert.equal(computeArbitratedCap({ baseCap: 5, suiteRed: true, integrationBacklog: 30, redBacklogThreshold: 20, redBacklogCap: 3 }), 3);
  assert.equal(computeArbitratedCap({ baseCap: 5, suiteRed: true, integrationBacklog: 10, redBacklogThreshold: 20, redBacklogCap: 3 }), 5);
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

test("ARBITRATION — analyzeSlotRefill narrows the effective cap under red suite + high backlog (AC2)", (t) => {
  const root = makeWorkspace("arb-narrow");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  writeState(root, [{ file: "code/a.ts" }]); // state red
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, integrationBacklog: 60 });
  assert.equal(r.base_cap, 5, "base cap is the fixed 5");
  assert.equal(r.effective_cap, 2, "red + backlog 60 ⇒ narrowed to redBacklogCap");
  assert.equal(r.cap, 2, "the consumed cap is the effective (arbitrated) cap");
  assert.equal(r.arbitration.cap_narrowed, true);
  assert.equal(r.arbitration.suite_red, true);
  assert.equal(r.arbitration.integration_backlog, 60);
  assert.equal(r.arbitration.backlog_threshold, 50);
  assert.equal(r.arbitration.red_backlog_cap, 2);
  assert.equal(r.slots_free, 2, "dispatch capped at the narrowed cap");
});

test("ARBITRATION — recommended is capped at the NARROWED cap, not the base cap (AC2/AC3)", (t) => {
  const root = makeWorkspace("arb-cap-rec");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const id of ["gap-r1", "gap-r2", "gap-r3", "gap-r4", "gap-r5"]) {
    writeTask(root, id, { status: "ready", labels: ["gap"], body: dispatchableBody([`- code/${id}.ts (new)`]) });
  }
  writeState(root, [{ file: "code/r1.ts" }]); // state red
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, integrationBacklog: 80 });
  assert.equal(r.effective_cap, 2);
  assert.equal(r.slots_free, 2);
  assert.equal(r.recommended.length, 2, "5 dispatchable candidates but the narrowed cap admits only 2 — WIP not added behind the red gate");
});

test("ARBITRATION — green restores full cap; red without backlog has no effect; absent state proceeds (AC2 invariants)", (t) => {
  const root = makeWorkspace("arb-green");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  // green + high backlog ⇒ cap restores (cap_restores_on_green)
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "full-suite-state.json"), JSON.stringify({ state: "green", fail: 0 }));
  const green = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, integrationBacklog: 80 });
  assert.equal(green.effective_cap, 5, "green suite ⇒ cap restores to full");
  assert.equal(green.arbitration.cap_narrowed, false);
  // red + backlog below/at threshold ⇒ no narrowing
  writeState(root, [{ file: "code/a.ts" }]);
  const redSmall = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, integrationBacklog: 10 });
  assert.equal(redSmall.effective_cap, 5, "red but backlog ≤ threshold ⇒ no narrowing");
  assert.equal(redSmall.arbitration.cap_narrowed, false);
  // red + no backlog ⇒ no effect (no_backlog_no_effect)
  const redZero = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, integrationBacklog: 0 });
  assert.equal(redZero.effective_cap, 5, "red but no backlog ⇒ no effect");
  assert.equal(redZero.arbitration.cap_narrowed, false);
  // missing state file + high backlog ⇒ not red-blocked ⇒ proceed
  fs.rmSync(path.join(root, ".quay", "full-suite-state.json"));
  const noState = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, integrationBacklog: 80 });
  assert.equal(noState.effective_cap, 5, "absent suite state ⇒ not red-blocked ⇒ no narrowing");
});

test("ARBITRATION — CLI with a real git repo: git-read backlog drives the narrowing; green restores (AC4)", (t) => {
  const root = makeGitWorkspace("redbacklog", 55);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  writeState(root, [{ file: "code/a.ts" }]); // state red
  const script = path.resolve(__dirname, "..", "scripts", "slot-refill.ts");
  const redOut = JSON.parse(execFileSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", script, "--root", root, "--json"],
    { encoding: "utf8" },
  ));
  assert.equal(redOut.arbitration.integration_backlog, 55, "git-read backlog (develop..integration), not injected");
  assert.equal(redOut.arbitration.cap_narrowed, true);
  assert.equal(redOut.effective_cap, 2, "red + real backlog 55 > 50 ⇒ narrowed");
  assert.equal(redOut.slots_free, 2);
  // green state ⇒ cap restores to full
  fs.writeFileSync(path.join(root, ".quay", "full-suite-state.json"), JSON.stringify({ state: "green", fail: 0 }));
  const greenOut = JSON.parse(execFileSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", script, "--root", root, "--json"],
    { encoding: "utf8" },
  ));
  assert.equal(greenOut.arbitration.cap_narrowed, false);
  assert.equal(greenOut.effective_cap, 5, "green ⇒ effective cap restored");
});

test("ARBITRATION — default (no red/backlog) is byte-forward-compatible: cap stays the base cap (AC5 no-regress)", (t) => {
  const root = makeWorkspace("arb-default");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.cap, 5, "no red suite + no git backlog ⇒ fixed cap unchanged");
  assert.equal(r.effective_cap, 5);
  assert.equal(r.arbitration.cap_narrowed, false);
  assert.equal(r.arbitration.integration_backlog, 0, "non-git temp root fails safe to 0");
  assert.equal(r.slots_free, 5);
});

// ── DELIVERY-CRITICAL SECOND AXIS (tasks/gap-ac36-delivery-critical-priority-axis) ────────────────
// candidates.sort key becomes (blocking_suite, delivery_critical, id): a task labeled
// `delivery-critical` ranks below a suite-blocker but ABOVE plain id order, so the
// productization-delivery phase's AC tasks are picked by the refill before ordinary pool work.
// AC3 positive: labeled task strictly moves forward in recommended. AC3 negative control: an
// unlabeled same-family task keeps its id-order position. Invariant: blocking_suite stays the top
// axis. AC4 end-to-end: after labeling, the next refill evaluation picks the labeled task
// (dispatch evaluation happens strictly after the label is applied — timestamp order).

test("DELIVERY-CRITICAL — labeled task strictly moves forward in recommended; unlabeled sibling keeps id order (AC3)", (t) => {
  const root = makeWorkspace("ac36-rank");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "ac36-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  writeTask(root, "ac36-b", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/b.ts (new)"]) });
  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3 };

  // Negative control FIRST: no delivery-critical label ⇒ id tie-break order (a before b).
  const before = analyzeSlotRefill(opts);
  assert.deepEqual(before.recommended, ["ac36-a", "ac36-b"], "no label ⇒ id tie-break order");

  // Positive: add the label to b ⇒ it strictly moves ahead of a.
  writeTask(root, "ac36-b", { status: "ready", labels: ["gap", "delivery-critical"], body: dispatchableBody(["- code/b.ts (new)"]) });
  const after = analyzeSlotRefill(opts);
  assert.deepEqual(after.recommended, ["ac36-b", "ac36-a"], "labeled task ranks first (delivery-critical axis above id order)");
});

test("DELIVERY-CRITICAL — negative control: unlabeled same-family tasks keep relative id order (AC3)", (t) => {
  const root = makeWorkspace("ac36-neg");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "ac36-x", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/x.ts (new)"]) });
  writeTask(root, "ac36-y", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/y.ts (new)"]) });
  writeTask(root, "ac36-z", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/z.ts (new)"]) });
  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3 };

  const before = analyzeSlotRefill(opts);
  assert.deepEqual(before.recommended, ["ac36-x", "ac36-y", "ac36-z"], "id order baseline");

  // Label only the middle task; the unlabeled x and z must keep x-before-z relative order.
  writeTask(root, "ac36-y", { status: "ready", labels: ["gap", "delivery-critical"], body: dispatchableBody(["- code/y.ts (new)"]) });
  const after = analyzeSlotRefill(opts);
  assert.deepEqual(after.recommended, ["ac36-y", "ac36-x", "ac36-z"], "y moves up; unlabeled x/z keep id order");
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
  assert.equal(r.recommended[0], "ac36-watchdog", "suite-blocker ranks above delivery-critical (blocking_suite > delivery_critical)");
  assert.equal(r.recommended[1], "ac36-critical", "delivery-critical ranks second (above id order, below blocking_suite)");
});

test("DELIVERY-CRITICAL — end-to-end: after labeling, the next refill evaluation picks the labeled task (dispatch eval > label ts) (AC4)", (t) => {
  const root = makeWorkspace("ac36-e2e");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // ac36-aaa sorts BEFORE ac36-e2e in id order, so the labeled task is NOT first before labeling —
  // the label must strictly move it from rank 1 to rank 0.
  writeTask(root, "ac36-aaa", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/aaa.ts (new)"]) });
  writeTask(root, "ac36-e2e", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/e2e.ts (new)"]) });
  const script = path.resolve(__dirname, "..", "scripts", "slot-refill.ts");
  const run = () => JSON.parse(execFileSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", script, "--root", root, "--cap", "3", "--json"],
    { encoding: "utf8" },
  ));

  const before = run();
  assert.deepEqual(before.recommended, ["ac36-aaa", "ac36-e2e"], "id order before labeling");
  const beforeRank = before.recommended.indexOf("ac36-e2e");
  assert.equal(beforeRank, 1, "labeled task starts at rank 1 (id order)");

  // Apply the delivery-critical label; record the wall-clock label time before the next refill eval.
  const labelTs = Date.now();
  writeTask(root, "ac36-e2e", { status: "ready", labels: ["gap", "delivery-critical"], body: dispatchableBody(["- code/e2e.ts (new)"]) });

  const after = run();
  const afterRank = after.recommended.indexOf("ac36-e2e");
  assert.ok(afterRank < beforeRank, `rank strictly improves: before ${beforeRank} → after ${afterRank}`);
  assert.equal(after.recommended[0], "ac36-e2e", "the next refill would dispatch the labeled task first");
  assert.ok(Date.now() >= labelTs, "dispatch evaluation happens after the label is applied (ts order)");
});

// ── RANKING EXPOSURE (tasks/gap-ac36-recommended-exposes-sort-key AC2) ───────────────────────────────
// The `recommended` STRING array is unchanged (backward compat — every consumer above reads ids).
// The parallel `ranking` array exposes each recommended id's sort axes ({id, deliveryCritical,
// suiteBlocking, rank}) so AC36 判据②'s "strict forward movement + negative control" is mechanically
// assertable from the JSON alone — the exact gap this task closes (recommended was a pure string
// array exposing NO sort field; 判据② could only be eyeballed).

test("RANKING — parallel to recommended, carries {id, deliveryCritical, suiteBlocking, rank} for every recommended id (AC2)", (t) => {
  const root = makeWorkspace("ranking-expose");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "ac36-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  writeTask(root, "ac36-b", { status: "ready", labels: ["gap", "delivery-critical"], body: dispatchableBody(["- code/b.ts (new)"]) });

  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.deepEqual(r.recommended, ["ac36-b", "ac36-a"], "string recommended is unchanged");
  assert.ok(Array.isArray(r.ranking), "--json exposes the ranking array");
  assert.equal(r.ranking.length, r.recommended.length, "ranking is parallel to recommended");
  assert.deepEqual(r.ranking.map((e) => e.id), r.recommended, "ranking order === recommended order");
  const b = r.ranking.find((e) => e.id === "ac36-b");
  assert.equal(b.deliveryCritical, true, "deliveryCritical axis exposed for the labeled task");
  assert.equal(b.suiteBlocking, false);
  assert.equal(b.rank, 0, "rank = position within recommended");
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
  assert.deepEqual(r.recommended, ["ac36-watchdog", "ac36-critical"], "blocking_suite above delivery_critical");
  const wd = r.ranking.find((e) => e.id === "ac36-watchdog");
  assert.equal(wd.suiteBlocking, true, "suiteBlocking axis exposed for the suite-blocker");
  assert.equal(wd.rank, 0, "suite-blocker ranks first");
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

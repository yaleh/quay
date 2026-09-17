// @test-group engine
// ready-pool-check.test.mjs — the ready-pool maintenance mechanism
// (tasks/gap-promotion-cadence-is-role-volition-not-product-mechanism). Promotion cadence used to
// live in an outer's VOLUNTARY AC-queue (role volition, lost on session/model change); this test
// pins the PRODUCT mechanism: computing the REAL ready pool (excluding not-yet-flipped / fixture /
// PARKED), reporting dispatchable_disjoint (the largest mutually-disjoint pool subset via
// checkTouchesPair) as the CRITERION, and recommending todo→ready promotions in a DEFINED order
// (touch-disjointness FIRST vs the pool + in-flight, then gap-* > DIR-*, then touches-resolve
// first) when pool < floor (= cap × 4, default 20 — dispatch single source).
//
// AC1 floor = cap × 4 (20 at cap 5, configurable) · AC2 dispatchable_disjoint via checkTouchesPair
// AC3 pool-big-but-all-colliding self-report + no-false-report-on-criterion-met · AC4 disjointness
//   ranks before kind, incl. in-flight · AC5 touchesResolve guard kept · AC6 cost asymmetry doc
// AC7 real use · AC8 node:test + @test-group engine
//
// Run: scripts/test.sh plugin/test/ready-pool-check.test.mjs

// SPLIT from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files — shard 21/22 (8 tests). Shared fixtures: ./helpers/ready-pool-check-harness.mjs (single source).

import { test } from "node:test";
import { __dirname, analyzeTasks, appendPropagationRecord, assert, bodyAnnotatedNewFiles, bodyUnannotatedNewFiles, commitsAheadOfRefForTask, computeMergeWorktreeSurfaces, execFileSync, fourArtifactBody, fs, gapTask, isWriteFacePropagationFailure, judgeBodyFreshness, loadParsedTaskStoreAtRef, makeConflictedMergeWorktree, makeGitWorkspace, normStore, os, parseTask, path, readLastPropagationRecords, readTaskFileAtRef, readTaskFilesAtRefBatch, readTaskStatusAtRef, refTaskIds, rpCachePath, writeTask } from "./helpers/ready-pool-check-harness.mjs";

test("computeMergeWorktreeSurfaces: a LIVE mid-merge worktree surface = ONLY unmerged files (AC3 wiring)", (t) => {
  const { dir } = makeConflictedMergeWorktree("live-wiring", new Date().toISOString());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = computeMergeWorktreeSurfaces(dir);
  assert.equal(out.length, 1, "one live mid-merge worktree surface");
  assert.deepEqual(out[0].files.sort(), ["conflict-a.md", "conflict-b.md", "conflict-c.md"], "surface = unmerged conflict paths only (clean.md excluded)");
});

// ── STALE MAIN-CHECKOUT STATUS (tasks/gap-dispatch-reads-stale-main-checkout-task-status, AC1/AC3) ──
// A task landed on develop as `status: done` but the manager working branch's disk still says
// `status: ready` (the main checkout 20-commits-behind shape). Dispatch's status read must come from
// the develop REF, not the stale disk — otherwise the done task is re-dispatched until the retry cap.
// The read source is asserted directly: readTaskStatusAtRef/readTaskFileAtRef read develop (done),
// while the working tree (fs.readFileSync) reads the stale ready.


test("dispatch reads task status from the develop ref, not the stale working tree (AC1/AC3)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-stale-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "develop", "-q", ".");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  // develop: the task is done (landed + flip-done).
  writeTask(root, "gap-stale-status", { status: "done", labels: ["gap"], body: fourArtifactBody() });
  git("add", ".");
  git("commit", "-q", "-m", "gap-stale-status: flip done");
  // Stale manager branch: rewrite the same task back to `ready` and STAY on it (disk=ready, develop=done).
  git("checkout", "-q", "-b", "manager-stale");
  writeTask(root, "gap-stale-status", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  git("add", ".");
  git("commit", "-q", "-m", "gap-stale-status: stale reset to ready");

  // AC3 read-source assertion: the develop ref carries `done`; the stale working tree carries `ready`.
  assert.equal(readTaskStatusAtRef(root, "develop", "gap-stale-status"), "done", "readTaskStatusAtRef reads develop → done");
  assert.match(readTaskFileAtRef(root, "develop", "gap-stale-status"), /^status:\s*done/m, "readTaskFileAtRef reads develop → done");
  assert.match(fs.readFileSync(path.join(root, "tasks", "gap-stale-status.md"), "utf8"), /^status:\s*ready/m, "stale working tree carries ready");

  const tasksDir = path.join(root, "tasks");
  // AC1: dispatch read (taskReadRef=develop) judges the task done → NOT in the ready pool.
  const rDev = analyzeTasks({ tasksDir, root, taskReadRef: "develop" });
  assert.equal(rDev.ready.includes("gap-stale-status"), false, "develop-read judges the task done → not dispatchable");
  assert.equal(rDev.pool, 0, "no ready task when the develop ref is the source of truth");

  // Negative control: WITHOUT the develop read (the old disk read), the stale `ready` WOULD be seen.
  const rDisk = analyzeTasks({ tasksDir, root });
  assert.equal(rDisk.ready.includes("gap-stale-status"), true, "the stale working tree alone would still see it ready (the defect)");
});

// ── PROMOTION DECISION READS DEVELOP (tasks/gap-dispatch-reads-stale-main-checkout-task-status, AC6) ──
// The write side (gap-ff-propagate-…, 1e7fb9be4) flips develop to `ready` and RESTORES the manager
// working tree's disk to the pre-promotion `todo`. `ready-pool-check --apply` must therefore JUDGE
// candidates from the develop ref — a disk read re-promotes the same task every tick (duplicate
// same-content commits). This pins the promotion PATH (--apply), not just the dispatch-read path.


test("AC6 — --apply promotion decision reads develop: develop=ready + disk=todo ⇒ no re-promotion", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-ac6-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "develop", "-q", ".");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  // develop: the task is ALREADY promoted (ready) — the write side flipped it there.
  writeTask(root, "gap-promoted", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  git("add", ".");
  git("commit", "-q", "-m", "gap-promoted: promoted to ready on develop");
  // Stale disk: the write side restored the working tree to the pre-promotion status (todo, self-touch).
  git("checkout", "-q", "-b", "manager-stale");
  writeTask(root, "gap-promoted", gapTask("gap-promoted"));
  git("add", ".");
  git("commit", "-q", "-m", "gap-promoted: restore todo on disk");

  // Falsifiability: develop carries ready; the stale working tree carries todo.
  assert.equal(readTaskStatusAtRef(root, "develop", "gap-promoted"), "ready", "develop carries ready");
  assert.match(fs.readFileSync(path.join(root, "tasks", "gap-promoted.md"), "utf8"), /^status:\s*todo/m, "stale disk carries todo");

  // Negative control: the disk-read analysis (no taskReadRef) sees the stale todo as an eligible
  // candidate — the exact re-promotion defect this AC closes.
  const rDisk = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  assert.equal(rDisk.promotions.some((p) => p.id === "gap-promoted"), true, "negative control: disk-read sees the stale todo as a candidate (the defect)");

  // The promotion path: --apply must judge from develop ⇒ already-ready ⇒ zero promotions, zero writes.
  const script = path.resolve(__dirname, "..", "scripts", "ready-pool-check.ts");
  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", script, "--root", root, "--cap", "3", "--floor-mult", "1", "--apply"],
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(out);
  assert.equal(parsed.should_apply, false, "AC6: develop=ready ⇒ no promotion recommended (⛔ 仍读盘上、重复晋升 ⇒ 假)");
  assert.equal(parsed.applied_promotions.length, 0, "AC6: zero promotions applied");
  // The disk stays todo — the promotion did NOT re-land.
  assert.match(fs.readFileSync(path.join(root, "tasks", "gap-promoted.md"), "utf8"), /^status:\s*todo/m, "AC6: disk stays todo (no duplicate promotion)");
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// BODY-FRESHNESS — the third state for a read source behind the write face
// (tasks/gap-ready-pool-body-still-read-from-stale-main-checkout)
//
// THE DEFECT, REPLAYED. 2026-09-14: the gate read the DEVELOP REF (taskReadRef — that part of the
// read face was already fixed), but a task_write whose fix carried the missing `(new)` annotations
// FAILED to propagate there (`.quay/store-commit-propagation.jsonl`:
// `branchClass:"other" changeKind:"must-propagate" propagated:false`). Rounds 188/189 therefore kept
// reading the PRE-FIX body ⇒ `touchesResolve=false` ⇒ fix worker ⇒ timeout ⇒ 3 retries ⇒ needs-human.
// Replaying both historical bodies through the SAME `checkTaskTouchesResolve` on the SAME root: the
// pre-fix body ⇒ majorityMissing:true, the fixed body ⇒ majorityMissing:false. The fixed body passes
// BY CONSTRUCTION — so the gate did not read it. The read SOURCE was right; the ref was BEHIND THE
// WRITE FACE (the mirror of the disk-lags-develop family, and only the ledger carries that direction).
//
// These fixtures reproduce that shape with the exact mechanism: 3 declared Touches files absent from
// disk (pre-fix) vs the same 3 annotated `(new)` (fixed).

/** The pre-fix / post-fix Touches pair from the 2026-09-14 replay: three NEW files, unannotated
 *  (⇒ mustExist 3, majority missing ⇒ touchesResolve=false) vs annotated `(new)` (⇒ touchesResolve=true). */

/** Append a propagation-ledger record (the shape store.ts's logPropagationOutcome writes). */


test("body-freshness: the free functions — ledger read, the narrow failure predicate, the ahead measure (AC2)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-freshfn-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "develop", "-q", ".");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeTask(root, "gap-f", { status: "todo", labels: ["gap"], body: bodyUnannotatedNewFiles("gap-f") });
  git("add", ".");
  git("commit", "-q", "-m", "seed");

  // ── No ledger ⇒ no records ⇒ NOT "clean", just "nothing recorded" (缺值 = 未查, 硬规则 6) ──
  assert.equal(readLastPropagationRecords(root).size, 0, "absent ledger ⇒ empty map, never a positive");
  assert.equal(judgeBodyFreshness({ root, id: "gap-f", ref: "develop", lastRecords: readLastPropagationRecords(root) }).status, "fresh");
  assert.equal(
    judgeBodyFreshness({ root, id: "gap-f", ref: "develop", lastRecords: readLastPropagationRecords(root) }).reason,
    "no-propagation-record",
  );

  // ── The predicate is NARROW: two ledger shapes say propagated:false BY DESIGN and are not staleness ──
  assert.equal(isWriteFacePropagationFailure({ propagated: false, changeKind: "must-propagate", branchClass: "other" }), true, "the write-face failure shape");
  assert.equal(isWriteFacePropagationFailure({ propagated: false, changeKind: "must-propagate", branchClass: "task-branch" }), false, "a worktree write: fan-in carries it — NOT a failure");
  assert.equal(isWriteFacePropagationFailure({ propagated: false, changeKind: "self-only", branchClass: "other" }), false, "an AC-tick self-only write: carried by the task's own fan-in");
  assert.equal(isWriteFacePropagationFailure({ propagated: true, changeKind: "must-propagate", branchClass: "other" }), false, "a SUCCESSFUL propagate is not a failure");
  assert.equal(isWriteFacePropagationFailure(null), false, "no record ⇒ not a failure");

  // ── The ahead measure: 0 when the write face holds nothing the ref lacks; >0 after a write face commit ──
  assert.equal(commitsAheadOfRefForTask(root, "develop", "gap-f"), 0, "HEAD == develop ⇒ nothing ahead");
  git("checkout", "-q", "-b", "author");
  writeTask(root, "gap-f", { status: "todo", labels: ["gap"], body: bodyAnnotatedNewFiles("gap-f") });
  git("add", ".");
  git("commit", "-q", "-m", "fix (not propagated)");
  assert.equal(commitsAheadOfRefForTask(root, "develop", "gap-f"), 1, "one commit on the write face the ref lacks");
  assert.equal(commitsAheadOfRefForTask(root, "no-such-ref", "gap-f"), null, "an unresolvable ref ⇒ null (unmeasurable, never a positive)");
  // Direction is native to this measure: a task file the REF has and the write face does not measures 0,
  // so the normal "disk lags develop" case can never be flagged as write-face staleness.
  assert.equal(commitsAheadOfRefForTask(root, "author", "gap-f"), 0, "ref == write face ⇒ 0 (both directions)");
});


test("body-freshness: AC1 — a body dimension's verdict FLIPS with the read source, and the gate's third state fires on the production read source", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-fresh-ac1-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "develop", "-q", ".");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  const tasksDir = path.join(root, "tasks");

  // develop: the PRE-FIX body (3 unannotated new files ⇒ touchesResolve=false). This is what the
  // 05:05 filing committed and successfully propagated.
  writeTask(root, "gap-body-stale", { status: "todo", labels: ["gap"], body: bodyUnannotatedNewFiles("gap-body-stale") });
  git("add", ".");
  git("commit", "-q", "-m", "gap-body-stale: filing (propagated)");

  // The WRITE FACE: the FIX body (annotated `(new)` ⇒ touchesResolve=true), committed but NOT
  // propagated — exactly the 05:05:16/17 pair.
  git("checkout", "-q", "-b", "author");
  writeTask(root, "gap-body-stale", { status: "todo", labels: ["gap"], body: bodyAnnotatedNewFiles("gap-body-stale") });
  git("add", ".");
  git("commit", "-q", "-m", "gap-body-stale: fix the (new) annotations (propagation FAILED)");
  appendPropagationRecord(root, {
    ts: "2026-09-14T05:05:17.097Z", id: "gap-body-stale", verb: "task_write",
    changeKind: "must-propagate", branchClass: "other", propagated: false,
  });

  // AC1 first reading — the gate's production read source (the develop ref) judges the PRE-FIX body.
  const rRef = analyzeTasks({ tasksDir, root, cap: 3, floorMult: 1, taskReadRef: "develop" });
  const cRef = rRef.candidates.find((c) => c.id === "gap-body-stale");
  assert.ok(cRef, "the todo is a candidate");
  assert.equal(cRef.touchesResolve, false, "ref read ⇒ the pre-fix body ⇒ touchesResolve=false (the 05:09/05:12 reading, reproduced)");
  // AC2 — and the read source is measurably behind the write face ⇒ THIRD STATE, not that verdict.
  assert.equal(cRef.bodyFreshness, "stale-suspected", "the failed propagate + a write face ahead of the ref ⇒ stale-suspected");
  assert.equal(cRef.bodyEvaluated, false, "not evaluated — the verdict above is not vouched for");
  assert.equal(cRef.bodyFreshnessReason, "write-face-ahead-of-ref");
  assert.equal(cRef.eligible, false, "a body the mechanism cannot vouch for is never promoted on that judgment");
  assert.deepEqual(rRef.promotions.map((p) => p.id), [], "zero promotions from a stale body — this is the fix-worker retry burn's root");
  assert.deepEqual(
    rRef.not_evaluated.map((n) => [n.id, n.freshness, n.reason]),
    [["gap-body-stale", "stale-suspected", "write-face-ahead-of-ref"]],
    "AC2: the output's own word list carries the independent not-evaluated value + its cause",
  );
  assert.equal(rRef.not_evaluated[0].evidence.commitsAhead, 1, "the evidence carries the measured gap");
  assert.equal(rRef.not_evaluated[0].evidence.ts, "2026-09-14T05:05:17.097Z", "…and the ledger record it came from");
  // The withheld promotion is traceable (a no-promotion is never a silent skip).
  assert.ok(rRef.intercepted.some((i) => i.id === "gap-body-stale" && /^body-not-evaluated \(stale-suspected/.test(i.reason)), "the withheld promotion is in `intercepted` with its reason");

  // AC1 second reading — the DISK read source judges the SAME task from the FIX body.
  const rDisk = analyzeTasks({ tasksDir, root, cap: 3, floorMult: 1 });
  const cDisk = rDisk.candidates.find((c) => c.id === "gap-body-stale");
  assert.equal(cDisk.touchesResolve, true, "disk read ⇒ the fix body ⇒ touchesResolve=true — THE SAME DIMENSION, OPPOSITE VERDICT");
  assert.equal(cDisk.bodyFreshness, "fresh", "no ref read ⇒ the disk IS the write face ⇒ nothing can be stale relative to it");
  assert.equal(cDisk.bodyEvaluated, true);
  assert.equal(cDisk.eligible, true, "the fix body is promotion-eligible — it passes the gate by construction (the replay's other half)");
  assert.deepEqual(rDisk.promotions.map((p) => p.id), ["gap-body-stale"], "…and it IS promoted from that read source");

  // AC1 NEGATIVE CONTROL — when the two sides AGREE, both read sources give the SAME verdict.
  // Bring HEAD onto develop (the fix never landed there; it is still the pre-fix body) ⇒ ahead = 0.
  git("checkout", "-q", "develop");
  assert.equal(commitsAheadOfRefForTask(root, "develop", "gap-body-stale"), 0, "control: the write face holds nothing the ref lacks");
  const nRef = analyzeTasks({ tasksDir, root, cap: 3, floorMult: 1, taskReadRef: "develop" });
  const nDisk = analyzeTasks({ tasksDir, root, cap: 3, floorMult: 1 });
  const nCRef = nRef.candidates.find((c) => c.id === "gap-body-stale");
  const nCDisk = nDisk.candidates.find((c) => c.id === "gap-body-stale");
  assert.equal(nCRef.bodyFreshness, "fresh", "control: ref and write face agree ⇒ fresh");
  assert.equal(nCRef.bodyEvaluated, true, "control: evaluated");
  assert.equal(nCRef.touchesResolve, nCDisk.touchesResolve, "control: identical bodies ⇒ identical verdict from either read source");
  assert.equal(nCRef.touchesResolve, false, "control: both read the pre-fix body ⇒ both say false");
  assert.deepEqual(nRef.not_evaluated, [], "control: nothing withheld for staleness");
  assert.deepEqual(nDisk.not_evaluated, [], "control: the disk read never withholds");
});


test("body-freshness: AC2 negative controls — a HEALED propagate and the two by-design `propagated:false` shapes never withhold a promotion", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-fresh-heal-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "develop", "-q", ".");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  const tasksDir = path.join(root, "tasks");
  writeTask(root, "gap-healed", { status: "todo", labels: ["gap"], body: bodyAnnotatedNewFiles("gap-healed") });
  git("add", ".");
  git("commit", "-q", "-m", "seed (the fixed body IS on the ref)");

  // The ledger still carries a FAILED write for this task — but the write face holds nothing the ref
  // lacks (the sync healed it). A ledger-only trigger would withhold this promotion forever; the
  // measured gap says there is nothing to withhold. This is the control that makes the trigger
  // takeable-false in the useful direction.
  appendPropagationRecord(root, { ts: "2026-09-14T05:05:17.097Z", id: "gap-healed", verb: "task_write", changeKind: "must-propagate", branchClass: "other", propagated: false });
  const healed = analyzeTasks({ tasksDir, root, cap: 3, floorMult: 1, taskReadRef: "develop" });
  const hc = healed.candidates.find((c) => c.id === "gap-healed");
  assert.equal(hc.bodyFreshness, "fresh", "a healed propagate ⇒ fresh (the ledger record alone is NOT staleness)");
  assert.equal(hc.bodyFreshnessReason, "ref-not-behind-write-face");
  assert.deepEqual(healed.not_evaluated, [], "nothing withheld");
  assert.deepEqual(healed.promotions.map((p) => p.id), ["gap-healed"], "the healthy candidate still promotes");

  // The two by-design `propagated:false` shapes (a worktree write and a self-only AC tick) must not
  // withhold either — they are the majority of the ledger's false values.
  for (const [tag, rec] of [
    ["task-branch", { ts: "2026-09-14T06:00:00.000Z", id: "gap-wt", verb: "task_write", changeKind: "must-propagate", branchClass: "task-branch", propagated: false }],
    ["self-only", { ts: "2026-09-14T06:00:01.000Z", id: "gap-so", verb: "task_write", changeKind: "self-only", branchClass: "other", propagated: false }],
  ]) {
    writeTask(root, rec.id, { status: "todo", labels: ["gap"], body: bodyAnnotatedNewFiles(rec.id) });
    git("add", ".");
    git("commit", "-q", "-m", `${rec.id}: seed`);
    appendPropagationRecord(root, rec);
    const r = analyzeTasks({ tasksDir, root, cap: 3, floorMult: 1, taskReadRef: "develop" });
    const c = r.candidates.find((x) => x.id === rec.id);
    assert.equal(c.bodyFreshness, "fresh", `${tag}: by-design propagated:false ⇒ fresh`);
    assert.equal(c.eligible, true, `${tag}: still eligible (no withholding)`);
  }
});


test("body-freshness: AC2 — an unmeasurable direction is `unknown`, its own value, never `fresh` (硬规则 3b)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-fresh-unknown-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main", "-q", "."); // ⛔ no `develop` branch: the direction cannot be measured
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeTask(root, "gap-unk", { status: "todo", labels: ["gap"], body: bodyAnnotatedNewFiles("gap-unk") });
  git("add", ".");
  git("commit", "-q", "-m", "seed");
  appendPropagationRecord(root, { ts: "2026-09-14T05:05:17.097Z", id: "gap-unk", verb: "task_write", changeKind: "must-propagate", branchClass: "other", propagated: false });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1, taskReadRef: "develop" });
  const c = r.candidates.find((x) => x.id === "gap-unk");
  assert.equal(c.bodyFreshness, "unknown", "the trace exists but the direction is unmeasurable ⇒ `unknown`");
  assert.equal(c.bodyFreshnessReason, "ahead-unmeasurable");
  assert.equal(c.bodyEvaluated, false, "unknown is NOT evaluated — it must never share a value with a clean measurement");
  assert.notEqual(c.bodyFreshness, "fresh", "⛔ never folded into `fresh`");
  assert.deepEqual(r.not_evaluated.map((n) => [n.id, n.freshness]), [["gap-unk", "unknown"]], "the word list distinguishes the two not-evaluated causes");
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// PERSISTENT CONTENT-KEYED CACHES
// (tasks/gap-ready-pool-check-is-o-pool-size-and-costs-as-much-as-the-whole-suite)
//
// The checker cost 212.7 h over 33 days — 97.8% of ALL checker cost, the same order as the entire
// test suite. The two dominant terms were both pure functions of git CONTENT recomputed from
// scratch on every poll: the whole-store blob read + YAML parse, and a full-history `git log
// --name-only` dump over the whole repo history. These tests pin the replacement mechanism, and —
// the half that matters — that a cache keyed by git object identity cannot serve content that is
// not that object's content:
//   · equivalence with the uncached read (cold, warm, and after a ref advance)
//   · CONTENT-KEYED, no staleness window (a changed blob is re-read on the very next call)
//   · the ref stays the single source (a stale working tree never wins, 硬规则 4b)
//   · fail-soft (absent / corrupt / version-drifted / kill-switched ⇒ byte-identical result)
//   · the incremental history merge (A..B) == a full rebuild
//   · the AC5 scale regression: on an N≥2000 store the cached call must beat the uncached baseline
// ═════════════════════════════════════════════════════════════════════════════════════════════════

/** A REAL git-backed task store (the caches key on git objects, so a bare directory will not do):
 *  `git init` + one commit carrying `n` tasks. `statusFor(i)` picks each task's status — the
 *  production store is overwhelmingly `done`, and a fixture that is mostly `todo` would measure the
 *  todo-candidate scan instead of the store read. Default branch is forced to `main` so that the
 *  landing-ref resolution (`integration → develop → master`) deterministically finds nothing and the
 *  history index stays out of the way unless a test asks for it. */

/** A realistic task body (~700 B) — big enough that the store read is a measurable share of a call,
 *  and carrying the four artifacts so the analysis exercises its real code paths. */

/** Order-insensitive structural snapshot of a task store / history index, for equality asserts. */

/** Run `fn` with the cache disabled, then restore the previous env value — the kill-switch is the
 *  comparison baseline every fail-soft and regression assert below is measured against. */

/** The cache lives in the repo's GIT DIR (see the loadParsedTaskStoreAtRef doc comment) — never in
 *  the working tree, so it cannot dirty `git status`. Resolved through git, not assumed, because the
 *  fixtures are real repos created by `makeGitWorkspace`. */


test("store cache: the parse-cached ref read equals the uncached batched read, cold and warm", (t) => {
  const { root } = makeGitWorkspace("store-eq", { n: 40 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ids = refTaskIds(root);

  const expected = new Map();
  for (const [id, raw] of readTaskFilesAtRefBatch(root, "HEAD", ids)) expected.set(id, parseTask(raw));

  const cacheFile = rpCachePath(root, "ready-pool-store-cache.json");
  fs.rmSync(cacheFile, { force: true });
  const cold = loadParsedTaskStoreAtRef(root, "HEAD", ids);
  assert.ok(fs.existsSync(cacheFile), "the first call must WRITE the cache (otherwise there is nothing to be warm)");
  const warm = loadParsedTaskStoreAtRef(root, "HEAD", ids);

  assert.equal(normStore(cold), normStore(expected), "cold cache must reproduce the uncached parse exactly");
  assert.equal(normStore(warm), normStore(expected), "warm cache must reproduce the uncached parse exactly");
  assert.equal(cold.size, expected.size);
});

// Shared harness for the slot-refill shards (split of slot-refill.test.mjs by
// gap-suite-split-15-over-30s-test-files). ONE copy of every depth-0 helper — the shards import the
// names they use; ⛔ no shard re-declares a fixture.
//
// SRC_URL re-establishes the ORIGINAL directory so the moved code's own
// __dirname / import.meta.url-relative paths keep resolving from helpers/.
const SRC_URL = new URL("../slot-refill.test.mjs", import.meta.url).href;

// @test-group engine
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
//   AC7 idempotent: same inputs ⇒ identical output · AC8 node:test + @test-group lowconc
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
  // DIRECTORY-GLOB SELF-FILE EXEMPTION (tasks/gap-directory-level-tasks-touch-global-lock AC1): the
  // in-flight disjointness judgment that excludes a candidate's OWN C8 self-file when the in-flight
  // side covers it only via a directory glob (`tasks/*.md`) — the fix that stops a directory-level
  // Touches declaration from becoming a global dispatch lock.
  checkTouchesPairInFlight,
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
  // FF-STARVATION RELIEF (gap-ff-starvation-no-dynamic-cap-relief): the second trigger on
  // computeArbitratedCap — a live task's current-round ff-failure count narrows the dispatch cap so
  // the starved task lands with no NEW competitor. Tiered (k=1 no / k=2→2 / k≥3→1), stateless (AC8),
  // with distinguishable non-landing cause (AC5) and perpetrator type (AC7).
  computeFfStarvationCap,
  readFfRetryRecords,
  readFfEscalationRecords,
  computeFfFailureCounts,
  computeUnresolvedEscalationTaskIds,
  computeFfStarvationRelief,
  classifyFfPerpetrator,
  classifyNonLandingCause,
  // EXITED-NOT-LANDED CONTINUE EXEMPTION (tasks/gap-slot-refill-continue-touches-overlap-redundant-
  // exemption): the live detection of exited-not-landed CONTINUE candidates (residual worktree +
  // worker-outcome final_state=exited-not-landed) — unit-tested directly so the production mechanism
  // (not just the injected seam) is covered.
  computeExitedNotLandedContinueIds,
} from "../../scripts/slot-refill.ts";
// AC2 (gap-delivery-critical-label-at-promote-not-after-dispatch): the promote gate is the fix's
// label DETERMINATION point — applyPromotions (ready-pool-check --apply heartbeat) flips todo→ready
// AND writes the delivery-critical label at promote time ("标签与 ready 同现"). The e2e test uses it
// to model the CORRECT timing (label at promote), then asserts slot-refill's sort key consumes it.
// AC47 (gap-ac47-completion-predicate-consumer-fail-closed): the shape-aware completion counter (the
// single source both slot-refill's landed gate and ready-pool-check's notYetFlipped consume) — needed
// directly for the AC2 all-5-consumers negative control on the DIR-014 suffixed-heading shape.
import { applyPromotions, countCompletionCheckboxes, RETREATED_MARKER_RE, isRetreated, analyzeTasks, readTaskStatusAtRef } from "../../scripts/ready-pool-check.ts";
import { countAcCheckboxes } from "../../scripts/task-status-drift-check.ts";
// AC53 gate (gap-scheduler-inflight-detection-misses-fan-in-worktree AC2): the END invariant the AC53
// heartbeat gate judges on — `violated === false` ⇒ the gate ACCEPTS the round end (no false refusal).
// Reused here so the AC2 test asserts the gate's actual verdict, not just slot-refill's intermediate.
import { judgeEndInvariant } from "../../scripts/inner-wakeup-heartbeat-check.ts";
// DIRECTORY-GLOB SELF-FILE EXEMPTION (tasks/gap-directory-level-tasks-touch-global-lock AC1): the
// pure-function unit test needs parseTouches (candidate/in-flight Touches parsing) + expandGlobs (the
// test expander) — imported from the single-source orthogonality module, never a parallel copy.
import { parseTouches, expandGlobs } from "../../scripts/touches-orthogonality-check.ts";


// ── fixture helpers ───────────────────────────────────────────────────────────────────────────────






/** Real temp git repo where the task's branch was MERGED as a fan-in (the two-line model's durable
 *  fan-in record). `mergeFormat`: "canonical" ⇒ message `fan-in: task/<id>`; "bare" ⇒ message
 *  `merge: <id> — …` (the adhoc format observed for gap-runner-grouping). Current checkout is
 *  `integration` (the fan-in line); `master` does NOT exist — the exact master-invisible shape.
 *  The `code/touched.ts` file the task touches exists on disk (fan-in landed it). */

// ── AC1: slots_free arithmetic ─────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(SRC_URL));

function makeWorkspace(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `slot-refill-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "code"), { recursive: true });
  return dir;
}

function writeTask(root, id, { status = "todo", labels = [], parent = null, role = null, dependsOn = [], goal_ac = null, body, selfTouch = true } = {}) {
  const fm = [
    "---",
    `id: ${id}`,
    `title: fixture ${id}`,
    `status: ${status}`,
    role ? `role: ${role}` : null,
    "labels:",
    ...labels.map((l) => `  - ${l}`),
    `parent: ${parent}`,
    // DEPENDS_ON (tasks/gap-slot-refill-depsreadyfor-ignores-depends-on): flow-form `depends_on:
    // [a, b]` — the machine-readable prerequisite edges (readDependsOn). Absent when empty (no dead
    // relation edge to confuse the mirror of a task that has no depends_on).
    dependsOn.length ? `depends_on: [${dependsOn.join(", ")}]` : null,
    // LONG-TERM-GUARANTEE FILING-TIME GATE (gap-long-term-guarantee-registry-hand-maintained): a
    // delivery-critical fixture must carry goal_ac to be promotion-eligible (立案时必填, fail-closed).
    goal_ac ? `goal_ac: ${goal_ac}` : null,
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

function runGit(dir, ...args) {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

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

function writeFfRetries(root, records) {
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "fan-in-retries.jsonl"), records.map((r) => JSON.stringify(r)).join("\n"));
}

function writeFfEscalations(root, records) {
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "fan-in-ff-escalations.jsonl"), records.map((r) => JSON.stringify(r)).join("\n"));
}

function legacyAllRefsHasFanInMerge(root, taskId) {
  const out = execFileSync("git", ["-C", root, "log", "--all", "--format=%H", "--merges", "--grep", taskId], { encoding: "utf8" });
  return out.trim().length > 0;
}

function makePreFanInMergeWorkspace(tag, { landed = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `slot-refill-prefan-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "code"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  runGit(dir, "init", "-q");
  runGit(dir, "config", "user.email", "t@t");
  runGit(dir, "config", "user.name", "t");
  // code/touched.ts exists on develop from the start ⇒ the fixture task's Touches resolve (it is NOT
  // the branch's own landing evidence — the file is not what makes this fixture interesting).
  fs.writeFileSync(path.join(dir, "code", "touched.ts"), "// pre-existing implementation file\n");
  runGit(dir, "add", "-A");
  runGit(dir, "commit", "-qm", "base");
  runGit(dir, "branch", "-M", "develop");
  const id = "gap-stranded";
  // 1. the worker's task branch, forked from develop.
  runGit(dir, "checkout", "-qb", `task/${id}`);
  // 2. develop moves on (another task landed) — what makes the pre-fan-in merge non-trivial.
  runGit(dir, "checkout", "-q", "develop");
  fs.writeFileSync(path.join(dir, "code", "other.ts"), "// another task's landing\n");
  runGit(dir, "add", "-A");
  runGit(dir, "commit", "-qm", "other work on develop");
  // 3. the worker syncs develop INTO its task branch — the merge commit that carries the task id and
  //    that the pre-fix `--all` read mistook for the fan-in.
  runGit(dir, "checkout", "-q", `task/${id}`);
  runGit(dir, "merge", "--no-ff", "develop", "-m", `Merge branch 'develop' into task/${id}`);
  runGit(dir, "checkout", "-q", "develop");
  if (landed) {
    // 4. the fan-in DID happen: ff develop onto the task branch (the two-line model's landing).
    runGit(dir, "merge", "--ff-only", `task/${id}`);
  }
  return { dir, id };
}

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

const SLOT_REFILL_CLI = path.resolve(__dirname, "..", "scripts", "slot-refill.ts");

function runSlotRefillJson(root, extraArgs = []) {
  return JSON.parse(execFileSync(process.execPath, [
    "--no-warnings", "--experimental-strip-types", SLOT_REFILL_CLI, "--root", root, "--cap", "5", ...extraArgs,
  ], { encoding: "utf8" }));
}

export { RETREATED_MARKER_RE, SLOT_REFILL_CLI, __dirname, analyzeSlotRefill, analyzeTasks, applyPromotions, assert, bodyLandedOuterUncheckedBody, checkTouchesPairInFlight, classifyFfPerpetrator, classifyNonLandingCause, computeArbitratedCap, computeExitedNotLandedContinueIds, computeFfFailureCounts, computeFfStarvationCap, computeFfStarvationRelief, computeSlotsFree, computeUnresolvedEscalationTaskIds, countAcCheckboxes, countCompletionCheckboxes, dir014SuffixedBody, dispatchableBody, execFileSync, expandGlobs, fannedInBody, fileURLToPath, fs, hasFanInMerge, hasLandedImplementation, inFlightTask, isBodyLanded, isImplementationClassFile, isLandedCodeComplete, isNotYetFlippedSkip, isOuterVerificationItem, isRetreated, judgeEndInvariant, landedAllCheckedBody, landedNoCheckboxBody, landedStuckWorkBody, legacyAllRefsHasFanInMerge, makeFannedInWorkspace, makeGitWorkspace, makeLandedNoIdWorkspace, makeLandedWorkspace, makePreFanInMergeWorkspace, makeSidecarCommitWorkspace, makeTaskOnlyCommitWorkspace, makeWorkspace, os, parseTouches, path, readFfEscalationRecords, readFfRetryRecords, readSuiteRed, readTaskStatusAtRef, resolveInFlightId, runGit, runSlotRefillJson, test, writeFfEscalations, writeFfRetries, writeRounds, writeState, writeTask };

// @test-group governance
// ready-pool-check.test.mjs — the ready-pool maintenance mechanism
// (tasks/gap-promotion-cadence-is-role-volition-not-product-mechanism). Promotion cadence used to
// live in an outer's VOLUNTARY AC-queue (role volition, lost on session/model change); this test
// pins the PRODUCT mechanism: computing the REAL ready pool (excluding not-yet-flipped / fixture /
// PARKED), reporting dispatchable_disjoint (the largest mutually-disjoint pool subset via
// checkTouchesPair) as the CRITERION, and recommending todo→ready promotions in a DEFINED order
// (touch-disjointness FIRST vs the pool + in-flight, then gap-* > DIR-*, then touches-resolve
// first) when pool < floor (= cap × 4, default 12).
//
// AC1 floor = cap × 4 (12 at cap 3, configurable) · AC2 dispatchable_disjoint via checkTouchesPair
// AC3 pool-big-but-all-colliding self-report + no-false-report-on-criterion-met · AC4 disjointness
//   ranks before kind, incl. in-flight · AC5 touchesResolve guard kept · AC6 cost asymmetry doc
// AC7 real use · AC8 node:test + @test-group governance
//
// Run: scripts/test.sh plugin/test/ready-pool-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import {
  analyzeTasks,
  artifactsComplete,
  notYetFlipped,
  isParked,
  isFixture,
  classifyKind,
  POOL_FLOOR,
  CONCURRENCY_CAP_DEFAULT,
  POOL_FLOOR_MULT_DEFAULT,
  computePoolFloor,
  maxMutuallyDisjointSubset,
  PARKED_MARKER_RE,
  SUPERSEDED_MARKER_RE,
  computeRelevance,
  computeDependedOnCount,
  readChildren,
  strategicTraceable,
  touchesScale,
  STRATEGIC_REF_RE,
  STRATEGIC_WEIGHT,
  BLOCKING_WEIGHT,
  computeLandingBlocked,
  detectLandingBlocked,
  LANDING_STALENESS_MS_DEFAULT,
  LANDING_BEHIND_THRESHOLD_DEFAULT,
  setTaskStatus,
  applyPromotions,
  applyRevaluations,
  retreatReadyToTodo,
  buildTargetedPromotion,
  ensureDeliveryCriticalLabel,
  computeSuiteBlocking,
  isDirectoryGlob,
  consecutiveRedRounds,
  collectFailureFiles,
  isRedRound,
  isExperimentRound,
  readJsonLines,
  readVerificationRounds,
  countUnattributedFailures,
  SUITE_BLOCKING_WEIGHT,
  RED_WINDOW_MIN_DEFAULT,
  isSuiteFixTask,
  exemptFromSuiteBlocking,
  buildCommitTraceIndex,
  commitSubjectTracesTask,
  commitTraceLanded,
  isCompoundTask,
  isExternalVerificationItem,
  isPendingImplementationItem,
  priorityLevel,
  deriveDefaultLane,
  readPerTaskSuiteRecords,
  isSuiteRecordSkip,
  computeMergeWorktreeSurfaces,
  resolveMergeWorktreeSurfaces,
  unmergedConflictPaths,
  readTaskFileAtRef,
  readTaskStatusAtRef,
} from "../scripts/ready-pool-check.ts";
import { INFLIGHT_WORKTREE_STALE_MS } from "../scripts/concurrent-batch-scheduler.ts";
import { propagateDocBranchToDevelop } from "../scripts/driver-filters.ts";
import { parseTask } from "../scripts/task-schema.ts";
import { taskWorkLanded } from "../scripts/task-status-drift-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── fixture helpers ───────────────────────────────────────────────────────────────────────────────

function makeWorkspace(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "code"), { recursive: true });
  return dir;
}

function writeTask(root, id, { status = "todo", labels = [], parent = null, children = [], role = null, body }) {
  const fm = [
    "---",
    `id: ${id}`,
    `title: fixture ${id}`,
    `status: ${status}`,
    role ? `role: ${role}` : null,
    `labels:`,
    ...labels.map((l) => `  - ${l}`),
    `parent: ${parent}`,
    children.length > 0 ? "children:" : "children: []",
    ...children.map((c) => `  - ${c}`),
    "extra:",
    "  schema: v1",
    "---",
  ].filter((x) => x !== null).join("\n");
  fs.writeFileSync(path.join(root, "tasks", `${id}.md`), `${fm}\n\n${body}`);
}

// A minimal contract-shape body carrying the four artifacts (Proposal / Contract / AC / DoD).
// `checkedAc` marks the first N AC boxes `- [x]` (default 0 — all unchecked, the fan-in merge shape).
// `uncheckedText` overrides the text of the UNCHECKED AC boxes — the workLanded arm reads the author-
// DECLARED annotation at the item END (（待外部）/（待本任务）, closed enum; unannotated = 待本任务
// fail-closed, gap-ready-pool-remaining-external-vs-implementation), so done-flip fixtures set it to
// an external-verification item ending in （待外部） (e.g. "全量套件绿（外层 verification-round 验证）（待外部）").
function fourArtifactBody({ acBoxes = 4, touches = "", extra = "", checkedAc = 0, uncheckedText = "an AC item that is long enough" } = {}) {
  const acLines = Array.from({ length: acBoxes }, (_, i) =>
    i < checkedAc ? "- [x] an AC item that is long enough" : `- [ ] ${uncheckedText}`);
  return [
    "**type:** execution",
    "## Proposal",
    "A real proposal paragraph that is definitely more than forty non-whitespace chars.",
    "## Contract",
    "measure   ready_pool = `node plugin/scripts/ready-pool-check.ts` stdout 的 pool 字段",
    "band      ready_pool = ≥3",
    "invariant promotion_order = gap-first",
    "invoke    `node plugin/scripts/ready-pool-check.ts`",
    "control   pool<3 有合格候选 ⇒ 推荐；否则不推荐",
    "resume    分两次提交",
    ...(touches ? [`## Touches`, ...touches] : []),
    "## Acceptance Criteria",
    ...acLines,
    "## Definition of Done",
    "standard DoD — the five clauses; meta-enforcer fixture-pinned.",
    extra,
  ].join("\n");
}

// AC1 (gap-ac46-pool-criteria-in-gate): the todo→ready promotion gate now requires the candidate's
// OWN tasks/<id>.md in ## Touches without `(new)` (C8 self-touch — the dispatch gate's grant). Todo
// fixtures are promotion candidates by default, so gapTask injects the self-touch into the body
// unless the test already declared it (a test that specifically wants self-touch-MISSING passes an
// explicit `touches`/`body` omitting it). `withSelfTouch` appends `- tasks/<id>.md` to the body's
// `## Touches` section, or adds the section when the body has none.
function withSelfTouch(body, id) {
  const line = `- tasks/${id}.md`;
  const idx = body.indexOf("## Touches");
  if (idx === -1) return `${body}\n## Touches\n${line}\n`;
  // Insert the self-touch after the LAST line of the existing Touches section (before the next `## ` heading or EOF).
  const rest = body.slice(idx);
  const nextHeading = rest.indexOf("\n## ");
  const cut = nextHeading === -1 ? body.length : idx + nextHeading;
  return body.slice(0, cut) + `\n${line}` + body.slice(cut);
}

function gapTask(id, opts = {}) {
  // When the test passes an explicit `touches` (not a full `body`), thread them through fourArtifactBody.
  const body = opts.body
    ? withSelfTouch(opts.body, id)
    : fourArtifactBody({ ...opts, touches: [...((opts.touches || []).map((t) => (t.startsWith("- ") ? t : `- ${t}`))), `- tasks/${id}.md`] });
  return { id, status: "todo", labels: ["gap"], ...opts, body };
}

function dirTask(id, opts) {
  return { id, status: "todo", labels: ["milestone-candidate"], body: fourArtifactBody(opts), ...opts };
}

// ── AC1 / AC6: pool computation with the three exclusions ─────────────────────────────────────────

test("ready pool excludes fixture, PARKED, and done-flip ready tasks; keeps stuck-work", (t) => {
  const root = makeWorkspace("excl");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-b", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "QENG-DEMO", { status: "ready", labels: ["fixture"], body: fourArtifactBody() });
  writeTask(root, "AC-REC", { status: "ready", labels: ["ac"], body: fourArtifactBody() });
  writeTask(root, "gap-parked", {
    status: "ready",
    labels: ["gap"],
    body: "> **PARKED (outer ruling, 2026-08-04) — execution suspended.**\n\n" + fourArtifactBody(),
  });
  // A MERGED DONE-FLIP ready task: work landed (Touches file exists on disk) AND every remaining
  // unchecked box is an EXTERNAL-VERIFICATION item (the "verification-window" shape — only the full
  // suite green remains) → not-yet-flipped → not dispatchable.
  fs.writeFileSync(path.join(root, "code", "landed.ts"), "export const landed = 1;\n");
  writeTask(root, "gap-done-flip", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ checkedAc: 3, uncheckedText: "全量套件绿（外层 verification-round 验证）（待外部）", touches: ["- code/landed.ts (new)"] }),
  });
  // STUCK-WORK: work landed but ACs far from complete (0/4) — REAL remaining implementation, NOT a
  // done-flip (gap-ready-pool-worklanded-traps-stuck-work AC2) → stays dispatchable.
  writeTask(root, "gap-stuck-work", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/landed.ts (new)"] }),
  });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.pool, 3, "pool should be gap-a + gap-b + gap-stuck-work");
  assert.deepEqual(r.ready.sort(), ["gap-a", "gap-b", "gap-stuck-work"]);

  const reasonsById = Object.fromEntries(r.excluded.map((e) => [e.id, e.reasons]));
  assert.deepEqual(reasonsById["QENG-DEMO"], ["fixture"]);
  assert.deepEqual(reasonsById["AC-REC"], ["ac-record"], "ac-labelled AC record excluded by kind (isAcRecord, SPEC §5 AC-tracking)");
  assert.deepEqual(reasonsById["gap-parked"], ["parked"]);
  assert.ok(reasonsById["gap-done-flip"].includes("not-yet-flipped"), "near-complete workLanded ready task excluded as done-flip");
  assert.equal(reasonsById["gap-stuck-work"], undefined, "AC-incomplete workLanded ready task is stuck-work → stays dispatchable");
});

// ── AC5/AC6: the "merged but AC all unchecked" shape is STUCK-WORK, not done-work ──────────────────
// Regression pin (gap-ready-pool-worklanded-traps-stuck-work): a merged task whose ACs are far from
// complete (<50%) has REAL remaining implementation → counted in the pool; a merged DONE-FLIP task
// (work landed AND ACs near-complete) is excluded; a truly-unstarted ready task stays.

test("pool counts merged-but-AC-incomplete stuck-work, excludes merged done-flip, keeps truly-unstarted (AC5/AC6)", (t) => {
  const root = makeWorkspace("merged-shape");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // STUCK-WORK: work LANDED (Touches file exists on disk) but ACs all unchecked → real remaining
  // implementation → must stay dispatchable (gap-ready-pool-worklanded-traps-stuck-work AC2).
  fs.writeFileSync(path.join(root, "code", "landed.ts"), "export const landed = 1;\n");
  writeTask(root, "gap-merged-stuck", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/landed.ts (new)"] }), // 0/4 AC checked
  });
  // DONE-FLIP: work landed AND the only remaining unchecked box is an EXTERNAL-VERIFICATION item
  // (3/4 — the verification-window shape) → excluded.
  writeTask(root, "gap-merged-done-flip", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ checkedAc: 3, uncheckedText: "全量套件绿（外层 verification-round 验证）（待外部）", touches: ["- code/landed.ts (new)"] }),
  });
  // A genuinely-unstarted ready task: Touches file does not exist, no resolving symbols → stays.
  writeTask(root, "gap-unstarted", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/does-not-exist.ts"] }),
  });
  writeTask(root, "gap-real", { status: "ready", labels: ["gap"], body: fourArtifactBody() });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.pool, 3, "pool counts the merged stuck-work task (real remaining work)");
  assert.deepEqual(r.ready.sort(), ["gap-merged-stuck", "gap-real", "gap-unstarted"]);
  const reasonsById = Object.fromEntries(r.excluded.map((e) => [e.id, e.reasons]));
  assert.equal(reasonsById["gap-merged-stuck"], undefined, "merged-but-AC-incomplete stuck-work task stays in the pool (AC2)");
  assert.ok(reasonsById["gap-merged-done-flip"].includes("not-yet-flipped"), "merged near-complete done-flip task excluded (AC3)");
  assert.ok(!reasonsById["gap-unstarted"], "truly-unstarted ready task stays in the pool");
});

// ── AC2/AC3/AC4 (gap-ready-pool-check-taskworklanded-overshoot-excludes-existing-file-tasks) ──────
// The taskWorkLanded touch signal overshot: "Touches file exists on master" fired for tasks that
// merely MODIFY an existing file, excluding them from the pool. Fix: only a task-CREATED file
// (`(new)` touch now existing) is landing evidence; an existing-file task is judged by its own
// symbols. AC2 (not-landed existing-file task stays in pool) + AC3 (landed one is excluded).

test("existing-file-modifying tasks: not-landed stays, done-flip landed is excluded, stuck-work landed stays (AC2/AC3)", (t) => {
  const root = makeWorkspace("existing-file");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The file exists on master regardless — the touch is NOT marked (new), so file existence must
  // NOT count as landing evidence for THIS task.
  fs.writeFileSync(path.join(root, "code", "existing.ts"), "export const preexisting = 1;\n");
  // NOT landed: an existing-file task whose work has not landed → must stay in the pool.
  writeTask(root, "gap-mod-not-landed", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/existing.ts"] }), // 0/4 AC, no (new), no resolving symbols
  });
  // DONE-FLIP landed: an existing-file task whose work HAS landed via a task-created file ((new)
  // exists) AND the only remaining unchecked box is an EXTERNAL-VERIFICATION item (3/4) → excluded.
  fs.writeFileSync(path.join(root, "code", "created.ts"), "export const created = 1;\n");
  writeTask(root, "gap-mod-done-flip", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ checkedAc: 3, uncheckedText: "全量套件绿（外层 verification-round 验证）（待外部）", touches: ["- code/existing.ts", "- code/created.ts (new)"] }),
  });
  // STUCK-WORK landed: the same landing evidence but ACs far from complete (0/4) → real remaining
  // implementation → stays dispatchable (AC2).
  writeTask(root, "gap-mod-stuck", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/existing.ts", "- code/created.ts (new)"] }),
  });
  writeTask(root, "gap-real", { status: "ready", labels: ["gap"], body: fourArtifactBody() });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.pool, 3, "pool keeps the not-landed + the stuck-work existing-file tasks");
  assert.deepEqual(r.ready.sort(), ["gap-mod-not-landed", "gap-mod-stuck", "gap-real"]);
  const reasonsById = Object.fromEntries(r.excluded.map((e) => [e.id, e.reasons]));
  assert.ok(!reasonsById["gap-mod-not-landed"], "not-landed existing-file task stays in the pool (AC2)");
  assert.equal(reasonsById["gap-mod-stuck"], undefined, "landed-but-AC-incomplete existing-file task is stuck-work → stays (AC2)");
  assert.ok(reasonsById["gap-mod-done-flip"].includes("not-yet-flipped"), "near-complete landed existing-file task excluded (AC3)");
});

// ── git-history landed signal (gap-ready-pool-taskworklanded-underdetects-prose-ac-merged-tasks) ──
// A prose-heavy-AC merged task (no resolvable symbols, no (new) touches) whose work landed via a
// fan-in merge that references it is judged by the SAME AC gate as the other workLanded signals:
// near-complete (>50% AC) → done-flip, excluded from the dispatchable pool; far-from-complete
// (<50% AC) → stuck-work, stays dispatchable (gap-ready-pool-worklanded-traps-stuck-work AC2/AC3).
// These tests need a REAL git repo (the signal reads `git log master`), created inline (mkdtemp +
// the same t.after cleanup the other ready-pool tests use) so the R6 isolation checker sees the
// directory covered.

test("ready pool excludes a prose-heavy DONE-FLIP via git-history, keeps git-history STUCK-WORK (AC1/AC2/AC3)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-gh-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "master", "-q", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  fs.writeFileSync(path.join(root, ".gitkeep"), "base\n");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  // A prose-heavy DONE-FLIP task: ACs yield no resolvable symbols and Touches are existing-file
  // paths (no (new)) — the shape that was under-detected (web-board). Its work lands via a fan-in
  // merge "merge web-board: …" that modified code/board.ts → git-history fires; the only remaining
  // unchecked box is an EXTERNAL-VERIFICATION item (3/4) → excluded as done-flip.
  writeTask(root, "gap-web-board-needs-an-inconsistency-verdict-it-does-not-have", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ checkedAc: 3, uncheckedText: "全量套件绿（外层 verification-round 验证）（待外部）", touches: ["- code/board.ts"] }),
  });
  // A genuinely-unstarted ready task stays in the pool (no commit references it).
  writeTask(root, "gap-unstarted", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/never.ts"] }) });
  git("checkout", "-q", "-b", "task/gap-web-board");
  fs.writeFileSync(path.join(root, "code", "board.ts"), "board\n");
  git("add", ".");
  git("commit", "-q", "-m", "board impl");
  git("checkout", "-q", "master");
  git("merge", "--no-ff", "task/gap-web-board", "-m", "merge web-board: /board route joins intent/execution/landing", "-q");
  git("branch", "-D", "task/gap-web-board");
  // STUCK-WORK via git-history: the same under-detected prose shape whose work also lands via a
  // fan-in merge (references "web-stuck") BUT whose ACs are far from complete (0/4) → real remaining
  // implementation → stays dispatchable (AC2).
  writeTask(root, "gap-web-stuck-work", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/board-stuck.ts"] }),
  });
  git("checkout", "-q", "-b", "task/gap-web-stuck");
  fs.writeFileSync(path.join(root, "code", "board-stuck.ts"), "stuck\n");
  git("add", ".");
  git("commit", "-q", "-m", "board-stuck impl");
  git("checkout", "-q", "master");
  git("merge", "--no-ff", "task/gap-web-stuck", "-m", "merge web-stuck: /board-stuck route joins intent/execution/landing", "-q");
  git("branch", "-D", "task/gap-web-stuck");

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  const byId = Object.fromEntries(r.excluded.map((e) => [e.id, e.reasons]));
  assert.ok(
    byId["gap-web-board-needs-an-inconsistency-verdict-it-does-not-have"]?.includes("not-yet-flipped"),
    "prose-heavy near-complete merged task excluded via the git-history signal (AC3)",
  );
  assert.equal(r.ready.includes("gap-web-board-needs-an-inconsistency-verdict-it-does-not-have"), false,
    "the done-flip landed task is NOT in the dispatchable pool");
  assert.equal(r.ready.includes("gap-web-stuck-work"), true,
    "git-history landed but AC-incomplete task is stuck-work → in the dispatchable pool (AC2)");
  assert.equal(byId["gap-web-stuck-work"], undefined, "stuck-work task not excluded (AC2)");
  assert.equal(r.ready.includes("gap-unstarted"), true, "a genuinely-unstarted ready task stays in the pool");
});

// ── COMMIT-TRACE signal (gap-nyf-branch-existence-vs-commit-trace) ────────────────────────────────
// The not-yet-flipped criterion used to depend on TRANSIENT artifacts: the task/<id> branch existing
// and unmerged (a branch merged+DELETED makes that signal vanish), and a git-history signal hardcoded
// to `master` (STALE under the two-line branch model — integration-landed commits invisible to it).
// Both hid "work already landed, still ready" tasks — the 16 phantom ready tasks (2026-08-11), each
// verified via `git log --all | grep -E "inner: <id>|fan-in: task/<id>"`. The COMMIT-TRACE signal is
// PERSISTENT (commit SUBJECTS survive branch deletion) and reads `--all` (covers the integration
// fan-in). AC2: `inner: <id>` / `fan-in: task/<id>` commit ⇒ work landed ⇒ not dispatchable. AC3: the
// "别改它" stuck-work guard (gap-ready-pool-worklanded-traps-stuck-work) is preserved — a traced task
// whose ACs are far from complete stays dispatchable.

test("commitSubjectTracesTask: inner:/fan-in: subject forms trace the task; mere id mentions do not (AC2)", () => {
  const id = "gap-ac36-recommended-exposes-sort-key";
  // positive: the four live commit conventions.
  assert.equal(commitSubjectTracesTask(`inner: ${id} — impl landed`, id), true, "inner: <id> form");
  assert.equal(commitSubjectTracesTask(`fan-in: task/${id}`, id), true, "fan-in: task/<id> form");
  assert.equal(commitSubjectTracesTask(`merge: fan-in task/${id} — per-hunk union`, id), true, "merge: fan-in task/<id> form");
  assert.equal(commitSubjectTracesTask(`merge: fan-in ${id} (A6, task-file evidence)`, id), true, "bare merge: fan-in <id> form");
  // negative: the id merely MENTIONED elsewhere in a subject is NOT a trace (position-based judgment —
  // e.g. an outer: closure commit listing many ids must not fire for each).
  assert.equal(commitSubjectTracesTask(`outer: closure pass 16 tasks — ${id}/fifty-to-six/install → done`, id), false, "id in a list is not a trace");
  // negative: prefix cross-fire — a LONGER sibling id must not trace a shorter id (delimited word).
  assert.equal(commitSubjectTracesTask(`inner: ${id}-sibling — impl`, id), false, "longer id must not trace the shorter prefix");
  assert.equal(commitSubjectTracesTask(`fan-in task/${id}-sibling`, id), false, "longer fan-in id must not trace the shorter prefix");
  // negative: the git-history merge format the OTHER signal handles (`merge web-board: …`) is not a trace.
  assert.equal(commitSubjectTracesTask("merge web-board: /board route joins intent/execution/landing", "gap-web-board-needs-an-inconsistency-verdict-it-does-not-have"), false);
});

test("buildCommitTraceIndex: fail-closed on a non-git root (empty, never throws)", (t) => {
  const root = makeWorkspace("ct-nongit");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(buildCommitTraceIndex(root), [], "non-git root ⇒ empty index");
  assert.equal(commitTraceLanded("gap-any", buildCommitTraceIndex(root)), false, "empty index never traces");
});

test("commit-trace nyf: branch merged+DELETED on integration (master stale) ⇒ done-flip not dispatchable, stuck-work stays, untraced stays (AC2/AC3)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-ct-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "master", "-q", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  fs.writeFileSync(path.join(root, ".gitkeep"), "base\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  // The two-line branch model: work lands on integration; master STAYS at base (stale) — so the
  // master-based git-history signal (gitHistoryLanded) sees NONE of it. Only the commit-trace signal
  // (reads --all) can see the integration fan-in.
  git("checkout", "-q", "-b", "integration");
  // TRACED DONE-FLIP: work landed via `inner:` impl commit + `fan-in: task/<id>` merge on integration,
  // branch then DELETED (the transient branch-existence signal vanishes — the commit trace persists).
  // ALL ACs checked (the commit-trace arm's self-declared completion condition — gap-ready-pool-commit-
  // trace-subject-not-proof-of-done: a traced task with ANY unchecked AC is NOT landed).
  writeTask(root, "gap-traced-done-flip", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ checkedAc: 4, touches: ["- code/impl.ts"] }), // prose AC (no backticked symbols), existing-file touch
  });
  git("add", ".");
  git("commit", "-q", "-m", "task file gap-traced-done-flip");
  git("checkout", "-q", "-b", "task/gap-traced-done-flip");
  fs.writeFileSync(path.join(root, "code", "impl.ts"), "export const impl = 1;\n");
  git("add", ".");
  git("commit", "-q", "-m", "inner: gap-traced-done-flip — impl landed on integration");
  git("checkout", "-q", "integration");
  git("merge", "--no-ff", "task/gap-traced-done-flip", "-m", "fan-in: task/gap-traced-done-flip", "-q");
  git("branch", "-D", "task/gap-traced-done-flip");
  // TRACED PARTIAL (gap-ready-pool-commit-trace-subject-not-proof-of-done regression anchor — the
  // 5-swallowed-tasks shape): an `inner:` subject names the task but the ACs are NOT all checked
  // (4/4 boxes, 3 checked — an intermediate step commit, not completion), AND the intermediate commit
  // touches a file OUTSIDE the task's declared Touches (so taskWorkLanded — symbol/touch/git-history
  // evidence — does NOT fire: only the WEAK subject string names the task). The subject hit alone must
  // NOT exclude it: it has REAL remaining implementation → STAYS in the pool.
  writeTask(root, "gap-traced-partial", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ checkedAc: 3, touches: ["- code/never-touched.ts"] }),
  });
  git("add", ".");
  git("commit", "-q", "-m", "task file gap-traced-partial");
  git("checkout", "-q", "-b", "task/gap-traced-partial");
  fs.writeFileSync(path.join(root, "code", "intermediate.ts"), "export const intermediate = 1;\n");
  git("add", ".");
  git("commit", "-q", "-m", "inner: gap-traced-partial — intermediate step (导出 7 函数), not done");
  git("checkout", "-q", "integration");
  git("merge", "--no-ff", "task/gap-traced-partial", "-m", "merge: fan-in task/gap-traced-partial", "-q");
  git("branch", "-D", "task/gap-traced-partial");
  // TRACED WORKLANDED PARTIAL (criterion ⑦d — a RATIO cannot tell verification from implementation):
  // the work REALLY landed (the inner commit touches the task's OWN Touches file — taskWorkLanded
  // fires via git-history) but the remaining unchecked box (3/4) is this task's OWN implementation
  // ("an AC item that is long enough" — a generic AC, NOT an external-verification item). 3/4 = 75%
  // > 50% WOULD have been a done-flip under the old ratio — but ANY remaining implementation box
  // means NOT landed (gap-ready-pool-remaining-external-vs-implementation) → stays dispatchable.
  writeTask(root, "gap-worklanded-partial", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ checkedAc: 3, touches: ["- code/wl-partial.ts"] }),
  });
  git("add", ".");
  git("commit", "-q", "-m", "task file gap-worklanded-partial");
  git("checkout", "-q", "-b", "task/gap-worklanded-partial");
  fs.writeFileSync(path.join(root, "code", "wl-partial.ts"), "export const wlPartial = 1;\n");
  git("add", ".");
  git("commit", "-q", "-m", "inner: gap-worklanded-partial — impl landed");
  git("checkout", "-q", "integration");
  git("merge", "--no-ff", "task/gap-worklanded-partial", "-m", "fan-in: task/gap-worklanded-partial", "-q");
  git("branch", "-D", "task/gap-worklanded-partial");
  // TRACED WORKLANDED VERIFY (the awaiting-verification population anchor, e.g. gap-mcp-server): the
  // work REALLY landed AND every remaining unchecked box is annotated `（待外部）` (the
  // `全量套件绿 … 外层验证` shape — only the full suite green remains). The workLanded arm excludes it
  // as a LEGAL done-flip — but the excluded entry carries awaiting_verification:true (the task's
  // entry into the awaiting-verification state, NOT a 乙/contradiction).
  writeTask(root, "gap-worklanded-verify", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ checkedAc: 3, uncheckedText: "全量套件绿（外层 verification-round 验证）（待外部）", touches: ["- code/wl-verify.ts"] }),
  });
  git("add", ".");
  git("commit", "-q", "-m", "task file gap-worklanded-verify");
  git("checkout", "-q", "-b", "task/gap-worklanded-verify");
  fs.writeFileSync(path.join(root, "code", "wl-verify.ts"), "export const wlVerify = 1;\n");
  git("add", ".");
  git("commit", "-q", "-m", "inner: gap-worklanded-verify — impl landed");
  git("checkout", "-q", "integration");
  git("merge", "--no-ff", "task/gap-worklanded-verify", "-m", "fan-in: task/gap-worklanded-verify", "-q");
  git("branch", "-D", "task/gap-worklanded-verify");
  // TRACED STUCK-WORK: also has an `inner:` commit (and a `merge: fan-in task/<id>` merge) but ACs far
  // from complete → real remaining implementation → STAYS dispatchable (the "别改它" stuck-work guard).
  writeTask(root, "gap-traced-stuck", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ checkedAc: 0, touches: ["- code/impl-stuck.ts"] }),
  });
  git("add", ".");
  git("commit", "-q", "-m", "task file gap-traced-stuck");
  git("checkout", "-q", "-b", "task/gap-traced-stuck");
  fs.writeFileSync(path.join(root, "code", "impl-stuck.ts"), "export const stuck = 1;\n");
  git("add", ".");
  git("commit", "-q", "-m", "inner: gap-traced-stuck — partial impl");
  git("checkout", "-q", "integration");
  git("merge", "--no-ff", "task/gap-traced-stuck", "-m", "merge: fan-in task/gap-traced-stuck", "-q");
  git("branch", "-D", "task/gap-traced-stuck");
  // UNTRACED: no inner:/fan-in: commit anywhere → genuinely fresh ready work.
  writeTask(root, "gap-unstarted", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/never.ts"] }) });
  git("add", ".");
  git("commit", "-q", "-m", "task file gap-unstarted");

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  const byId = Object.fromEntries(r.excluded.map((e) => [e.id, e.reasons]));
  const acOpenById = Object.fromEntries(r.excluded.map((e) => [e.id, e.ac_open]));
  // AC2 verification anchor (a): branch merged+DELETED, but the commit trace persists on integration
  // (invisible to the stale-master git-history signal) ⇒ the done-flip task is NOT dispatchable.
  assert.ok(
    byId["gap-traced-done-flip"]?.includes("not-yet-flipped"),
    "traced done-flip task excluded via commit-trace (master stale, branch deleted)",
  );
  assert.equal(r.ready.includes("gap-traced-done-flip"), false, "traced done-flip NOT in the dispatchable pool");
  // gap-ready-pool-nyf-split-backlog-vs-contradiction: a done-flip with EVERY completion checkbox
  // checked is 甲/backlog → ac_open=0 on the excluded entry.
  assert.equal(acOpenById["gap-traced-done-flip"], 0, "all-checked not-yet-flipped task is 甲/backlog (ac_open=0)");
  // gap-ready-pool-commit-trace-subject-not-proof-of-done: a subject hit alone (partial ACs unchecked)
  // must NOT exclude — the 5-swallowed-tasks shape (e.g. gap-cli-import-refactor-run-shell-architecture:
  // inner "导出 7 函数" intermediate step, AC 5/9 unchecked) stays in the pool with real remaining work.
  assert.equal(byId["gap-traced-partial"], undefined, "traced-but-AC-partial task is NOT landed → not excluded");
  assert.equal(r.ready.includes("gap-traced-partial"), true, "traced-partial task stays in the dispatchable pool");
  // gap-ready-pool-remaining-external-vs-implementation (criterion ⑦d): a work-landed 3/4 task whose
  // remaining unchecked box is this task's OWN implementation is NOT landed — it stays dispatchable
  // (the old >50% RATIO would have excluded it as a done-flip; the NATURE of the remaining item says
  // otherwise).
  assert.equal(byId["gap-worklanded-partial"], undefined, "worklanded 3/4 with an open IMPLEMENTATION box is NOT landed → not excluded");
  assert.equal(r.ready.includes("gap-worklanded-partial"), true, "worklanded partial task stays in the dispatchable pool");
  // awaiting-verification (e.g. gap-mcp-server): a work-landed task whose EVERY remaining unchecked box
  // is annotated `（待外部）` is a LEGAL done-flip — excluded, but the entry carries
  // awaiting_verification:true (the task's entry into the awaiting-verification state, NOT a
  // 乙/contradiction).
  assert.equal(byId["gap-worklanded-verify"]?.includes("not-yet-flipped"), true, "worklanded all-remaining-external (3/4) is a legal done-flip");
  assert.equal(acOpenById["gap-worklanded-verify"], 1, "awaiting-verification task carries ac_open=1");
  const verifyEntry = r.excluded.find((e) => e.id === "gap-worklanded-verify");
  assert.equal(verifyEntry?.awaiting_verification, true, "awaiting-verification excluded entry carries the marker");
  assert.equal(r.ready.includes("gap-worklanded-verify"), false, "awaiting-verification task is NOT in the dispatchable pool");
  // "别改它" (gap-ready-pool-worklanded-traps-stuck-work): a traced task whose completion boxes are
  // far from complete is STUCK-WORK with real remaining implementation → stays dispatchable (the
  // commit-trace signal does NOT bypass the completion gate).
  assert.equal(byId["gap-traced-stuck"], undefined, "traced-but-AC-incomplete task is stuck-work → not excluded");
  assert.equal(r.ready.includes("gap-traced-stuck"), true, "traced stuck-work stays in the dispatchable pool");
  // a genuinely un-traced ready task stays dispatchable (negative control).
  assert.equal(byId["gap-unstarted"], undefined, "untraced ready task not excluded");
  assert.equal(r.ready.includes("gap-unstarted"), true, "untraced ready task stays in the dispatchable pool");
  // The A9 population-split counters: 甲 = done-flip with all boxes checked (backlog), 乙 = judged
  // landed but an open IMPLEMENTATION box (contradiction, threshold 1), awaiting_verification = every
  // open box annotated （待外部） (legitimately waiting — the awaiting-verification entry, neither 甲 nor
  // 乙).
  assert.equal(r.nyf_backlog, 1, "exactly one 甲/backlog not-yet-flipped task (the all-checked done-flip)");
  assert.equal(r.nyf_contradiction, 0, "no 乙/contradiction — a worklanded 3/4 with an open implementation box is NOT landed (stays in pool)");
  assert.equal(r.awaiting_verification, 1, "exactly one awaiting-verification task (worklanded, all remaining external)");
});

test("isFixture / isParked / notYetFlipped unit behavior", (t) => {
  const root = makeWorkspace("n-y-f");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const fixture = parseTask("---\nid: x\nlabels:\n  - fixture\n---\nbody");
  assert.equal(isFixture(fixture), true);
  assert.equal(isFixture(parseTask("---\nid: x\nlabels:\n  - gap\n---\nbody")), false);

  // A plain-text mention of the WORD "PARKED" in AC prose is NOT a marker.
  const proseParked = parseTask("---\nid: x\n---\nbody with PARKED in prose explaining exclusions");
  assert.equal(isParked(proseParked), false);
  assert.equal(PARKED_MARKER_RE.test("PARKED"), false, "bare word must not match the bold-marker regex");

  const parked = parseTask("---\nid: x\n---\n> **PARKED (human, 2026-08-04) — execution suspended.**\nmore");
  assert.equal(isParked(parked), true);

  // notYetFlipped's workLanded signal is now AC-gated (gap-ready-pool-worklanded-traps-stuck-work):
  // a merged-but-AC-incomplete ready task is STUCK-WORK (real remaining implementation) →
  // dispatchable; a merged NEAR-COMPLETE ready task (work landed + ACs >50%) is a done-flip →
  // excluded.
  fs.writeFileSync(path.join(root, "code", "landed.ts"), "export const landed = 1;\n");
  const stuckWork = {
    status: "ready",
    body: "## Acceptance Criteria\n- [ ] unchecked\n- [ ] still unchecked\n## Touches\n- code/landed.ts (new)\n## Definition of Done\nstandard",
  };
  assert.equal(notYetFlipped(stuckWork, root), false, "merged-but-AC-incomplete stuck-work ready task stays dispatchable");
  const doneFlip = {
    status: "ready",
    body: "## Acceptance Criteria\n- [x] done\n- [x] done\n- [ ] 全量套件绿（外层 verification-round 验证）（待外部）\n## Touches\n- code/landed.ts (new)\n## Definition of Done\nstandard",
  };
  assert.equal(notYetFlipped(doneFlip, root), true, "merged ready task whose only remaining box is external verification is a done-flip and must be excluded");

  // A truly-unstarted ready task (work not on master — Touches file absent, no resolving symbols)
  // STAYS in the pool.
  const unstarted = {
    status: "ready",
    body: "## Acceptance Criteria\n- [ ] not started\n## Touches\n- code/missing.ts\n## Definition of Done\nstandard",
  };
  assert.equal(notYetFlipped(unstarted, root), false, "unstarted ready task must stay in the pool");

  // status is part of the predicate: a `done` task is never the not-yet-flipped state.
  const doneTask = { status: "done", body: "## Acceptance Criteria\n- [ ] whatever\n## Touches\n- code/landed.ts\n" };
  assert.equal(notYetFlipped(doneTask, root), false, "done status is not the not-yet-flipped state");
});

// ── AC-complete-not-flipped union signal (gap-closure-detection-reads-symbols-not-checkboxes) ──────
// The ready-pool closure signal (`notYetFlipped`) read WORK-LANDED evidence (symbol resolution /
// `(new)` touches / git history) — never AC checkboxes — so a prose-AC COMPLETED task (all ACs
// checked, but no resolvable symbols / no `(new)` touches / no git reference) stayed in the
// dispatchable pool and got re-dispatched (measured 2026-08-08: 17/21 ready tasks were
// AC-complete-not-flipped). Fix: the not-yet-flipped signal is a UNION — taskWorkLanded OR
// all_acs_checked && status==ready (the COMPLETION state, independent of writing style). The
// taskWorkLanded arm is itself AC-gated (gap-ready-pool-worklanded-traps-stuck-work): a workLanded
// task is a done-flip only when AC-complete or near-complete (>50%); AC-far-from-complete
// workLanded tasks are STUCK-WORK and stay dispatchable. AC1 positive control
// (AC-complete-but-not-flipped is surfaced) + AC2 union-with-AC-gate (taskWorkLanded stays pure /
// landed-but-incomplete is stuck-work / landed-near-complete is excluded) + negative controls
// (partial / zero-checkbox / non-ready are NOT surfaced).

test("AC-complete-not-flipped ready task is surfaced; genuinely-pending is not (AC1 union positive control)", (t) => {
  const root = makeWorkspace("ac-complete");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // AC-complete-but-not-flipped: all 4 ACs checked, but NO work-landing evidence — the Touches file
  // does not exist, no resolvable symbols, no git history. taskWorkLanded alone would MISS this
  // (the prose-AC completed shape); the AC-checkbox union signal must surface it.
  writeTask(root, "gap-ac-complete", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ checkedAc: 4, touches: ["- code/never-landed.ts"] }),
  });
  // A genuinely-pending ready task: ACs unchecked, work not landed → stays in the pool.
  writeTask(root, "gap-pending", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/never-landed-2.ts"] }),
  });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  const byId = Object.fromEntries(r.excluded.map((e) => [e.id, e.reasons]));
  assert.ok(
    byId["gap-ac-complete"]?.includes("not-yet-flipped"),
    "AC-complete-but-not-flipped ready task must be surfaced (AC1)",
  );
  assert.equal(r.ready.includes("gap-ac-complete"), false, "AC-complete task NOT in the dispatchable pool");
  assert.equal(r.ready.includes("gap-pending"), true, "genuinely-pending task stays in the pool");
  assert.deepEqual(r.ready, ["gap-pending"]);
});

test("AC-complete signal is a UNION not a replace: partial/zero/non-ready NOT surfaced, landed-unchecked STILL excluded (AC2)", (t) => {
  const root = makeWorkspace("ac-union");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Partial ACs (2/4) + work not landed → NOT not-yet-flipped (the AC signal requires ALL checked).
  const partial = { status: "ready", body: fourArtifactBody({ checkedAc: 2, touches: ["- code/missing.ts"] }) };
  assert.equal(notYetFlipped(partial, root), false, "partial-AC ready task is not a closure candidate (AC2)");

  // Zero AC checkboxes (total 0) → NOT not-yet-flipped (total > 0 guard — 0/0 must not vacuous-true).
  const zeroAc = {
    status: "ready",
    body: "## Acceptance Criteria\nno checkboxes at all\n## Touches\n- code/missing.ts\n## Definition of Done\nstandard",
  };
  assert.equal(notYetFlipped(zeroAc, root), false, "zero-checkbox ready task is not a closure candidate (AC2)");

  // Non-ready status (todo) with all ACs checked → NOT not-yet-flipped (status guard).
  const todoChecked = { status: "todo", body: fourArtifactBody({ checkedAc: 4, touches: ["- code/missing.ts"] }) };
  assert.equal(notYetFlipped(todoChecked, root), false, "todo-status task is not the not-yet-flipped state (AC2)");

  // union-not-replace / taskWorkLanded pure: an AC-all-checked + work-NOT-landed task must NOT be
  // judged landed by taskWorkLanded itself (the work-landed signal stays independent of checkbox
  // state) — only the union's AC signal surfaces it.
  fs.writeFileSync(path.join(root, "code", "landed.ts"), "export const landed = 1;\n");
  const acCompleteNotLanded = { status: "ready", body: fourArtifactBody({ checkedAc: 4, touches: ["- code/never.ts"] }) };
  assert.equal(taskWorkLanded(acCompleteNotLanded.body, root), false, "taskWorkLanded stays a pure work-landed signal (AC2)");
  assert.equal(notYetFlipped(acCompleteNotLanded, root), true, "union catches it via the AC-complete signal (AC1)");

  // taskWorkLanded stays a pure work-landed signal, but notYetFlipped now AC-gates it
  // (gap-ready-pool-worklanded-traps-stuck-work): a work-landed-but-AC-incomplete ready task is
  // STUCK-WORK → dispatchable (AC2); a work-landed NEAR-COMPLETE ready task is a done-flip → still
  // excluded (AC3).
  const landedUnchecked = {
    status: "ready",
    body: "## Acceptance Criteria\n- [ ] unchecked\n## Touches\n- code/landed.ts (new)\n## Definition of Done\nstandard",
  };
  assert.equal(notYetFlipped(landedUnchecked, root), false, "landed-but-AC-incomplete ready task is stuck-work → dispatchable (AC2)");
  const landedDoneFlip = {
    status: "ready",
    body: "## Acceptance Criteria\n- [x] done\n- [x] done\n- [x] done\n- [ ] 全量套件绿（外层 verification-round 验证）（待外部）\n## Touches\n- code/landed.ts (new)\n## Definition of Done\nstandard",
  };
  assert.equal(notYetFlipped(landedDoneFlip, root), true, "landed task whose only remaining box is external verification is a done-flip → excluded (AC3)");

  // Neither signal fires → stays in the pool.
  const pending = { status: "ready", body: fourArtifactBody({ touches: ["- code/never.ts"] }) };
  assert.equal(notYetFlipped(pending, root), false, "neither signal fires → stays in the pool");
});

// ── LEFTOVER-WORKTREE EXEMPTION (gap-ready-pool-notyflipped-allchecked-leftover-worktree-exemption) ──
// The `allChecked` arm (2026-08-08) excluded a ready task purely on self-declared completion, with NO
// landing evidence. A mechanical fan-in FAILURE (suite red / merge-develop conflict) leaves the task
// `ready + all-checked + un-landed` WITH its `task/<id>` worktree still open (ff-merge success is what
// deletes it) — the old arm excluded it forever, so the landing path never ran again (permanent
// stranding, one dead task froze the pool). The fix: an OPEN `task/<id>` worktree is the DIRECT
// "fan-in not yet complete" quantity (same `git worktree list` source as computeInFlightWorktreeTouches)
// — while it exists the allChecked task stays dispatchable so the next dispatch triggers the driver's
// mechanical fan-in retry. No worktree keeps the original exclude (the prose-AC shape).

test("LEFTOVER-WORKTREE — allChecked + leftover task/<id> worktree is NOT not-yet-flipped (AC1); no worktree keeps the exclusion (AC2)", (t) => {
  const root = makeRealGitRepo("nyf-leftover");
  const wtPath = path.join(root, "..", `${path.basename(root)}-leftover`);
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(wtPath, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  fs.writeFileSync(path.join(root, "code", "seed.ts"), "export const seed = 1;\n");
  gitCommit(root, "seed");

  const id = "gap-nyf-leftover";
  const body = fourArtifactBody({ checkedAc: 4, touches: ["- code/never.ts"] });
  writeTask(root, id, { status: "ready", labels: ["gap"], body });

  // AC2 negative control: allChecked + NO worktree ⇒ still excluded (2026-08-08 behavior unchanged).
  assert.equal(notYetFlipped({ id, status: "ready", body }, root), true,
    "all-checked + no leftover worktree is still not-yet-flipped (AC2)");

  // Create the leftover task/<id> worktree (the fan-in-failed shape).
  execFileSync("git", ["-C", root, "worktree", "add", "-q", "-b", `task/${id}`, wtPath]);

  // AC1 positive: allChecked + leftover worktree ⇒ NOT not-yet-flipped ⇒ stays dispatchable.
  assert.equal(notYetFlipped({ id, status: "ready", body }, root), false,
    "all-checked + leftover worktree is NOT not-yet-flipped (AC1)");

  // Removing the worktree restores the exclusion — the exemption is keyed on the open worktree.
  execFileSync("git", ["-C", root, "worktree", "remove", "--force", wtPath]);
  assert.equal(notYetFlipped({ id, status: "ready", body }, root), true,
    "removing the leftover worktree restores the not-yet-flipped exclusion (AC2)");
});

test("LEFTOVER-WORKTREE — analyzeTasks keeps an allChecked + leftover-worktree task in ready, not excluded (AC1/AC3)", (t) => {
  const root = makeRealGitRepo("nyf-leftover-pool");
  const wtPath = path.join(root, "..", `${path.basename(root)}-leftover`);
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(wtPath, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  fs.writeFileSync(path.join(root, "code", "seed.ts"), "export const seed = 1;\n");
  gitCommit(root, "seed");

  const id = "gap-nyf-leftover";
  writeTask(root, id, {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ checkedAc: 4, touches: ["- code/never.ts"] }),
  });
  execFileSync("git", ["-C", root, "worktree", "add", "-q", "-b", `task/${id}`, wtPath]);

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.ready.includes(id), true, "allChecked + leftover worktree task stays in the ready pool (AC1/AC3)");
  assert.equal(r.excluded.some((e) => e.id === id && e.reasons.includes("not-yet-flipped")), false,
    "no not-yet-flipped exclusion when a leftover worktree is present (AC1/AC3)");
});

test("LEFTOVER-WORKTREE — a single allChecked dead task no longer zeroes the pool (dispatchable_disjoint ≥ 1, AC4)", (t) => {
  const root = makeRealGitRepo("nyf-pool-effect");
  const wtPath = path.join(root, "..", `${path.basename(root)}-leftover`);
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(wtPath, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  fs.writeFileSync(path.join(root, "code", "seed.ts"), "export const seed = 1;\n");
  gitCommit(root, "seed");

  const id = "gap-nyf-pool";
  writeTask(root, id, {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ checkedAc: 4, touches: ["- code/never.ts"] }),
  });
  execFileSync("git", ["-C", root, "worktree", "add", "-q", "-b", `task/${id}`, wtPath]);

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.pool, 1, "the single allChecked dead task is counted in the pool, not dropped (AC4)");
  assert.equal(r.dispatchable_disjoint, 1, "dispatchable_disjoint ≥ 1 — the dead task is itself dispatchable, no longer zeroed (AC4)");
  assert.equal(r.pool_big_all_colliding, false, "pool_big_all_colliding stays false (AC4)");
});

// ── no-AC-section fallback (gap-git-history-landed-master-stale-under-two-line-model AC4) ──────────
// A task with NO `## Acceptance Criteria` checkboxes (total=0) is STRUCTURALLY unable to tick ACs:
// allAcsChecked is恒 false, so it could never be a done-flip through the checkbox signals and would
// sit in the ready pool forever (measured 2026-08-11: last-pane / suite-red — the closure probe's
// systematic undercount). The fallback: when its work HAS landed, the landing itself is its closeout
// signal — total===0 joins the all-checked / >50% gate. A no-AC task whose work has NOT landed stays
// dispatchable (stuck-work protection intact).

test("no-AC-section fallback (AC4, AC47-corrected): present-but-boxless landed no-AC task is a done-flip; ABSENT AC section is fail-closed", (t) => {
  const root = makeWorkspace("no-ac");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Work landed via a (new)-marked touch file that now exists.
  fs.writeFileSync(path.join(root, "code", "last-pane.ts"), "export const lastPane = 1;\n");
  // PRESENT `## Acceptance Criteria` heading with ZERO checkboxes (prose only) — the "段存在且零未勾"
  // state: total=0, sectionFound=true ⇒ the no-AC closeout fallback PRESERVED (landing is its
  // closeout) — a done-flip candidate (AC4, unchanged by the AC47 fail-closed fix).
  const landedProseNoBox = {
    status: "ready",
    body: "## Acceptance Criteria\nno checkboxes at all\n## Touches\n- code/last-pane.ts (new)\n## Definition of Done\nstandard",
  };
  assert.equal(notYetFlipped(landedProseNoBox, root), true,
    "present-but-boxless no-AC task whose work has landed is a done-flip candidate (AC4)");
  // ABSENT `## Acceptance Criteria` heading (extractSectionByShape → null) — the AC47 fail-closed
  // shape: sectionFound=false ⇒ countCompletionCheckboxes total is NaN ⇒ the total===0 closeout
  // arm is STRUCTURALLY unreachable ⇒ NOT a done-flip, even with work landed. (Deliberate change:
  // gap-ac47-completion-predicate-consumer-fail-closed — an unreadable section must not be judged
  // complete, else DIR-014's 5 unchecked boxes under a suffixed heading are swallowed.)
  const landedAbsentAc = {
    status: "ready",
    body: "## Touches\n- code/last-pane.ts (new)\n## Definition of Done\nstandard",
  };
  assert.equal(notYetFlipped(landedAbsentAc, root), false,
    "ABSENT AC section + landed work is fail-closed (NOT a done-flip — the section was never read)");
  // Work NOT landed → no-AC task stays in the dispatchable pool (present or absent section).
  const unlandedNoAc = {
    status: "ready",
    body: "## Touches\n- code/never.ts (new)\n## Definition of Done\nstandard",
  };
  assert.equal(notYetFlipped(unlandedNoAc, root), false,
    "no-AC task whose work has NOT landed stays in the pool (AC4)");
  // A no-AC section entirely ABSENT (extractSection → null) + unlanded work stays in the pool.
  const noAcSection = {
    status: "ready",
    body: "## Proposal\nA real proposal paragraph that is more than forty non-whitespace chars.\n## Touches\n- code/never.ts (new)\n",
  };
  assert.equal(notYetFlipped(noAcSection, root), false,
    "absent AC section + unlanded work stays in the pool (AC4)");
});

test("ready pool: a no-AC task whose work lands on INTEGRATION is a done-flip (two-line model + AC4)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-2line-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "master", "-q", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  fs.writeFileSync(path.join(root, ".gitkeep"), "base\n");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  // Two-line model: the working line is integration (master stays stale behind it).
  git("checkout", "-q", "-b", "integration");
  // A no-checkbox task: `## Acceptance Criteria` heading PRESENT but with zero checkboxes (the
  // "段存在且零未勾" state — sectionFound:true, total:0) — structurally unable to tick ACs, so its
  // landing is its closeout (AC4 no-AC fallback, PRESERVED by the AC47 fail-closed fix; the fix
  // only fails-closed on an ABSENT/unreadable section, not a present-but-boxless one).
  writeTask(root, "gap-last-pane-telemetry", {
    status: "ready",
    labels: ["gap"],
    body: [
      "**type:** execution",
      "## Proposal",
      "A real proposal paragraph that is definitely more than forty non-whitespace chars.",
      "## Touches",
      "- code/last-pane.ts",
      "## Acceptance Criteria",
      "prose acceptance criteria with no checkboxes at all",
      "## Definition of Done",
      "standard DoD — the five clauses; meta-enforcer fixture-pinned.",
    ].join("\n"),
  });
  // Land the work on integration via a fan-in merge that references the task.
  git("checkout", "-q", "-b", "task/gap-last-pane");
  fs.writeFileSync(path.join(root, "code", "last-pane.ts"), "export const lastPane = 1;\n");
  git("add", ".");
  git("commit", "-q", "-m", "last-pane impl");
  git("checkout", "-q", "integration");
  git("merge", "--no-ff", "task/gap-last-pane", "-m", "inner: gap-last-pane-telemetry — emit last-pane evidence", "-q");
  git("branch", "-D", "task/gap-last-pane");

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, integration: "integration" });
  const byId = Object.fromEntries(r.excluded.map((e) => [e.id, e.reasons]));
  assert.ok(byId["gap-last-pane-telemetry"]?.includes("not-yet-flipped"),
    "no-AC task whose work landed on integration is a done-flip (AC4 + two-line model)");
  assert.equal(r.ready.includes("gap-last-pane-telemetry"), false, "the done-flip task is NOT in the dispatchable pool");
});

// ── stuck-work vs done-flip (gap-ready-pool-worklanded-traps-stuck-work) ──────────────────────────
// The not-yet-flipped exclusion used to treat ANY workLanded task as "done, not yet flipped". But
// workLanded only means "some work landed" — a workLanded task with an open completion box that is
// this task's OWN implementation/evidence has REAL remaining implementation (stuck-work) and must
// stay dispatchable (AC2); only a workLanded task that is completion-complete, OR whose every
// remaining unchecked box is an EXTERNAL-VERIFICATION item (the "verification-window" done-flip
// shape — gap-ready-pool-remaining-external-vs-implementation, criterion ⑦d: judged by the NATURE of
// the remaining items, never a ratio), is excluded (AC3). A task at exactly 50% (gap-session-liveness
// 4/8 — with non-external remaining items) returns to the pool (verification anchor (a)).

test("stuck-work (workLanded + AC ≤50%) stays dispatchable; done-flip (workLanded + AC >50%) is excluded (AC2/AC3)", (t) => {
  const root = makeWorkspace("stuck-vs-flip");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // gap-session-liveness shape: work landed (Touches file exists) but only 4/8 ACs checked = 50%.
  fs.writeFileSync(path.join(root, "code", "landed.ts"), "export const landed = 1;\n");
  writeTask(root, "gap-session-liveness", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ acBoxes: 8, checkedAc: 4, touches: ["- code/landed.ts (new)"] }),
  });
  // gap-dispatch shape: work landed and 5/6 ACs checked — the ONE remaining unchecked box is an
  // EXTERNAL-VERIFICATION item (only the verification window remains) → excluded.
  writeTask(root, "gap-dispatch", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ acBoxes: 6, checkedAc: 5, uncheckedText: "全量套件绿（外层 verification-round 验证）（待外部）", touches: ["- code/landed.ts (new)"] }),
  });
  writeTask(root, "gap-real", { status: "ready", labels: ["gap"], body: fourArtifactBody() });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  const byId = Object.fromEntries(r.excluded.map((e) => [e.id, e.reasons]));
  assert.equal(r.ready.includes("gap-session-liveness"), true, "AC-incomplete workLanded task is stuck-work → back in the pool (AC2)");
  assert.equal(byId["gap-session-liveness"], undefined, "stuck-work task not excluded (AC2)");
  assert.equal(r.ready.includes("gap-dispatch"), false, "near-complete workLanded task is a done-flip → excluded (AC3)");
  assert.ok(byId["gap-dispatch"]?.includes("not-yet-flipped"), "done-flip task excluded with reason not-yet-flipped (AC3)");
  assert.equal(r.pool, 2, "pool = gap-session-liveness + gap-real");
});

// ── remaining-external-vs-implementation (gap-ready-pool-remaining-external-vs-implementation) ──────
// The workLanded arm's "verification-window done-flip" leniency used to be a RATIO (acRatio > 0.5),
// which could not distinguish "the remaining unchecked boxes depend only on EXTERNAL events (suite
// green / outer verification-round)" from "the remaining unchecked boxes include this task's OWN
// implementation/evidence" — the gap-cli-import-refactor misfire (AC 5/5 + DoD 4/4 = 5/9 = 55.6% >
// 50%: the DoD still carried the run()/shell golden-replay EVIDENCE — real remaining implementation —
// yet it was excluded as landed). HUMAN ruling (2026-08-12): the ratio is DELETED — the remaining-item
// nature is DECLARED by the task author at the item END (`（待外部）` / `（待本任务）`, closed enum;
// UNANNOTATED = 待本任务, fail-closed). ALL remaining items annotated （待外部） ⇒ awaiting-verification
// (excluded from the dispatchable pool); ANY （待本任务） or unannotated ⇒ stays ready (dispatchable).

test("isExternalVerificationItem / isPendingImplementationItem: the author DECLARED annotation enum (human ruling)", () => {
  // （待外部） at the item END ⇒ external (the awaiting-verification shape).
  assert.equal(isExternalVerificationItem("全量套件绿（外层 verification-round 验证）（待外部）"), true, "item ends with （待外部） ⇒ external");
  assert.equal(isExternalVerificationItem("等外层 verification-round（待外部）"), true, "（待外部） trailing marker");
  assert.equal(isExternalVerificationItem("full suite green（待外部）"), true, "（待外部） on an EN item");
  // POSITION: the annotation must be at the END — a （待外部） NOT at the end is not the declared enum
  // (position-based judgment, hard rule 2).
  assert.equal(isExternalVerificationItem("（待外部）全量套件绿"), false, "annotation must be at the item END, not the front");
  // （待本任务） ⇒ this task's own work ⇒ NOT external.
  assert.equal(isExternalVerificationItem("run()/shell 架构 + 逐命令搬迁的 golden-replay 证据 + 实际耗时贴出（待本任务）"), false, "（待本任务） ⇒ not external");
  assert.equal(isExternalVerificationItem("拆后 floor 下降 + 总耗时贴出（待本任务）"), false, "（待本任务） evidence ⇒ not external");
  assert.equal(isPendingImplementationItem("run()/shell 架构 + golden-replay 证据（待本任务）"), true, "isPendingImplementationItem agrees");
  // FAIL-CLOSED (the decisive direction): an UNANNOTATED unchecked item defaults to 待本任务 — a
  // missing annotation can never make a task wrongly landed (today's 5-swallowed-tasks defect).
  assert.equal(isExternalVerificationItem("全量套件绿（外层 verification-round 验证）"), false, "unannotated external-looking item is NOT external (fail-closed)");
  assert.equal(isExternalVerificationItem("an AC item that is long enough"), false, "unannotated generic item ⇒ not external");
  assert.equal(isExternalVerificationItem("AC1–AC5 全部勾上"), false, "unannotated ⇒ not external (fail-closed)");
  // An item annotated with the OLD non-enum marker （外部） is NOT the declared （待外部） ⇒ fail-closed.
  assert.equal(isExternalVerificationItem("全量套件绿（外层 verification-round 验证）（外部）"), false, "（外部） is NOT in the closed enum ⇒ fail-closed 待本任务");
});

test(">50% checked but a remaining implementation box ⇒ NOT landed (stays in the dispatchable pool)", (t) => {
  const root = makeWorkspace("remaining-impl");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // work landed (Touches file exists on disk) AND 3/4 = 75% > 50% — but the ONE remaining unchecked
  // box is a generic AC item (this task's own implementation). The old >50% ratio would have excluded
  // it as a done-flip; criterion ⑦d says ANY remaining implementation box ⇒ NOT landed.
  fs.writeFileSync(path.join(root, "code", "landed.ts"), "export const landed = 1;\n");
  const task = {
    status: "ready",
    body: fourArtifactBody({ checkedAc: 3, touches: ["- code/landed.ts (new)"] }),
  };
  assert.equal(notYetFlipped(task, root), false, ">50% with an open implementation box is NOT landed");
});

test("all remaining unchecked boxes annotated （待外部） ⇒ awaiting-verification (excluded, not dispatchable)", (t) => {
  const root = makeWorkspace("remaining-ext");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // work landed AND 3/4 checked — the ONE remaining unchecked box is annotated （待外部） (only the full
  // suite green remains, e.g. gap-mcp-server) ⇒ the task enters awaiting-verification (a legal
  // done-flip — excluded from the dispatchable pool).
  fs.writeFileSync(path.join(root, "code", "landed.ts"), "export const landed = 1;\n");
  const task = {
    status: "ready",
    body: fourArtifactBody({ checkedAc: 3, uncheckedText: "全量套件绿（外层 verification-round 验证）（待外部）", touches: ["- code/landed.ts (new)"] }),
  };
  assert.equal(notYetFlipped(task, root), true, "all-remaining-external workLanded task enters awaiting-verification (excluded)");
});

test("AC all checked but DoD has unchecked IMPLEMENTATION boxes ⇒ NOT landed (cli-import shape, human ruling)", (t) => {
  const root = makeWorkspace("ac-full-dod-open");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The gap-cli-import-refactor shape: AC 5/5 fully checked, but the DoD still carries this task's
  // OWN implementation/evidence as UNCHECKED boxes annotated `（待本任务）` (the run()/shell golden-replay
  // EVIDENCE + scoped test green), plus one `（待外部）` full-suite item. Work LANDED (the code IS merged)
  // + AC all checked was the old "landed" judgment — but the author DECLARED the implementation items
  // 待本任务, so the task is NOT landed ⇒ stays in the dispatchable pool.
  fs.writeFileSync(path.join(root, "code", "landed.ts"), "export const landed = 1;\n");
  const task = {
    status: "ready",
    body: [
      "**type:** execution",
      "## Proposal",
      "A real proposal paragraph that is definitely more than forty non-whitespace chars.",
      "## Contract",
      "measure x\nband y\ninvoke z\ncontrol ok\nresume r",
      "## Acceptance Criteria",
      "- [x] AC1: done long enough to be a real box",
      "- [x] AC2: done long enough to be a real box",
      "- [x] AC3: done long enough to be a real box",
      "- [x] AC4: done long enough to be a real box",
      "- [x] AC5: done long enough to be a real box",
      "## Definition of Done",
      "- [ ] run()/shell 架构 + 逐命令搬迁的 golden-replay 证据 + 实际耗时贴出（见 Evidence）（待本任务）",
      "- [ ] 既有测试 + 新增测试全绿（--for-task scoped）（待本任务）",
      "- [ ] 全量套件绿（外层 verification-round 验证）（待外部）",
      "## Touches",
      "- code/landed.ts (new)",
    ].join("\n"),
  };
  assert.equal(notYetFlipped(task, root), false, "AC all-checked but DoD has open 待本任务 boxes ⇒ NOT landed (stays in pool)");
});

test("artifactsComplete is shape-aware and content-gated", () => {
  const contract = fourArtifactBody();
  assert.deepEqual(artifactsComplete(contract).missing, []);
  assert.equal(artifactsComplete(contract).complete, true);

  // Missing DoD → incomplete, names the missing artifact.
  const noDod = fourArtifactBody().replace("## Definition of Done", "## Resolution");
  const r = artifactsComplete(noDod);
  assert.equal(r.complete, false);
  assert.ok(r.missing.includes("dod"), `missing should include dod, got ${r.missing}`);

  // Unknown shape fails closed.
  assert.equal(artifactsComplete("## Some unknown heading\ncontent").complete, false);
});

test("artifactsComplete recognizes finding-shape draft AC/DoD headings (gap-todo-shape-mismatch-author-gate)", () => {
  // The 9 finding-shape gap-* tasks use `## AC（draft）` / `## DoD（draft）` (full-width parens) or
  // `## AC (draft)` (half-width parens) for their AC/DoD sections. The `（draft）` suffix is a
  // heading-label convention, not an absent section — the four-artifacts gate must count these
  // sections or those todo tasks are wrongly ineligible for author→ready promotion.
  const finding = "## Finding\nA real finding paragraph that is definitely more than forty non-whitespace characters long.";
  const acDraft = "## AC（draft）\n- [ ] the first draft acceptance item whose text is definitely longer than forty characters";
  const dodDraft = "## DoD（draft）\n- [ ] the first draft done item whose text is definitely longer than forty characters";
  const fullWidth = finding + "\n" + acDraft + "\n" + dodDraft;
  const rFull = artifactsComplete(fullWidth);
  assert.equal(rFull.complete, true, `full-width draft headings should complete, got ${JSON.stringify(rFull.missing)}`);
  assert.deepEqual(rFull.missing, []);

  // Half-width parens need literal (regex-escaped) heading matching — `AC (draft)` must not be
  // interpreted as a regex capture group.
  const halfWidth = finding + "\n" + acDraft.replace("（draft）", " (draft)") + "\n" + dodDraft.replace("（draft）", " (draft)");
  const rHalf = artifactsComplete(halfWidth);
  assert.equal(rHalf.complete, true, `half-width draft headings should complete, got ${JSON.stringify(rHalf.missing)}`);
  assert.deepEqual(rHalf.missing, []);

  // A finding-shape task WITHOUT any AC section still fails closed (missing ac+dod).
  const noAc = finding + "\n## Proposal\nA proposal paragraph that is more than forty non-whitespace chars.";
  const rNoAc = artifactsComplete(noAc);
  assert.equal(rNoAc.complete, false);
  assert.ok(rNoAc.missing.includes("ac"), `missing should include ac, got ${rNoAc.missing}`);
});

// ── AC1: floor = cap × 4 (12 at cap 3) — single source, no hardcoded 3 ────────────────────────────

test("POOL_FLOOR = cap × 4 (12 at cap 3) — single source, no hardcoded 3 (AC1)", () => {
  assert.equal(CONCURRENCY_CAP_DEFAULT, 3);
  assert.equal(POOL_FLOOR_MULT_DEFAULT, 4);
  assert.equal(POOL_FLOOR, 12, "default floor = 3 × 4");
  assert.equal(computePoolFloor(3, 4), 12);
  assert.equal(computePoolFloor(3), 12, "floorMult defaults to 4");
  assert.equal(computePoolFloor(2, 4), 8);
  assert.equal(computePoolFloor(4, 4), 16);
  assert.equal(computePoolFloor(1, 1), 1, "small floors are legal for tests/experiments");
});

// ── AC2: dispatchable_disjoint = largest mutually-disjoint pool subset via checkTouchesPair ────────

test("dispatchable_disjoint = largest mutually-disjoint pool subset via checkTouchesPair (AC2)", (t) => {
  const root = makeWorkspace("disjoint");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // a,b,c mutually disjoint; d,e collide (code/shared.ts); a,f collide (code/a.ts).
  // Conflicts = the matching {(d,e),(a,f)} ⇒ MIS = 6 − 2 = 4.
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/a.ts"] }) });
  writeTask(root, "gap-b", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/b.ts"] }) });
  writeTask(root, "gap-c", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/c.ts"] }) });
  writeTask(root, "gap-d", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/shared.ts"] }) });
  writeTask(root, "gap-e", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/shared.ts"] }) });
  writeTask(root, "gap-f", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/a.ts"] }) });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  assert.equal(r.pool, 6);
  assert.equal(r.dispatchable_disjoint, 4, "largest mutually-disjoint subset is 4 ({a,b,c,d} or {a,b,c,e})");
  assert.equal(r.criterion_met, true, "4 ≥ cap 3 ⇒ criterion met");
  assert.equal(r.pool_big_all_colliding, false);
});

test("maxMutuallyDisjointSubset handles empty, singleton, disjoint, and colliding sets", () => {
  const expand = (globs) => new Set(globs);
  const a = { hasSection: true, globs: ["code/a.ts"] };
  const b = { hasSection: true, globs: ["code/b.ts"] };
  const shared = { hasSection: true, globs: ["code/shared.ts"] };
  assert.equal(maxMutuallyDisjointSubset([], expand), 0);
  assert.equal(maxMutuallyDisjointSubset([a], expand), 1);
  assert.equal(maxMutuallyDisjointSubset([a, b], expand), 2);
  assert.equal(maxMutuallyDisjointSubset([a, shared, { hasSection: true, globs: ["code/shared.ts"] }], expand), 2);
});

// ── AC3: pool-big-but-all-colliding self-report; no false report when criterion already met ────────

test("pool ≥ floor but all colliding ⇒ mechanism self-reports (AC3)", (t) => {
  const root = makeWorkspace("all-collide");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const id of ["gap-r1", "gap-r2", "gap-r3", "gap-r4"]) {
    writeTask(root, id, { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/shared.ts"] }) });
  }
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 }); // floor 3
  assert.equal(r.pool, 4);
  assert.ok(r.pool >= r.floor, "pool is at/above the floor");
  assert.equal(r.dispatchable_disjoint, 1, "all four collide on code/shared.ts");
  assert.equal(r.criterion_met, false, "1 < cap 3");
  assert.equal(r.pool_big_all_colliding, true, "pool big but all colliding must self-report");
  assert.match(r.report, /POOL BIG BUT ALL COLLIDING/);
});

test("pool < floor but dispatchable_disjoint ≥ cap ⇒ criterion met, NO false report (AC3 negative)", (t) => {
  const root = makeWorkspace("criterion-met");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/a.ts"] }) });
  writeTask(root, "gap-b", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/b.ts"] }) });
  // cap 2, floorMult 6 ⇒ floor 12; pool 2 < 12 but 2 mutually-disjoint ≥ cap 2.
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 2, floorMult: 6 });
  assert.equal(r.floor, 12);
  assert.equal(r.pool, 2);
  assert.ok(r.pool < r.floor, "pool below floor");
  assert.equal(r.dispatchable_disjoint, 2);
  assert.equal(r.criterion_met, true, "2 ≥ cap 2 ⇒ criterion satisfied");
  assert.equal(r.pool_big_all_colliding, false, "must NOT report pool-big-all-colliding");
  assert.doesNotMatch(r.report, /POOL BIG BUT ALL COLLIDING/);
});

// ── AC4 + AC48: the pool<floor gate is RETIRED — pool ≥ floor with a qualified candidate NOW
//    recommends it (合格即晋, 不看 pool 大小). The only negative control left is "no qualified
//    candidate ⇒ no promotions" (covered below). ──────────────────────────────────────────────────

test("pool >= floor with qualified candidate ⇒ promotes it (AC48 合格即晋 — pool<floor gate retired)", (t) => {
  const root = makeWorkspace("pos-pool-full");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const id of ["gap-r1", "gap-r2", "gap-r3"]) {
    writeTask(root, id, { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  }
  // A fully-qualified todo candidate exists AND the pool is at/above floor — pre-AC48 this was the
  // "no busy-work" case (promotions []); post-AC48 the pool<floor gate is cancelled so it promotes.
  writeTask(root, "gap-candidate", gapTask("gap-candidate"));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 }); // floor 3
  assert.equal(r.pool, 3);
  assert.equal(r.floor, 3);
  assert.equal(r.deficit, 0);
  assert.deepEqual(r.promotions.map((p) => p.id), ["gap-candidate"], "qualified candidate promotes regardless of pool size (AC48)");
});

// ── AC4: pool < floor + qualified candidate ⇒ recommend ───────────────────────────────────────────

test("pool < floor with a qualified todo candidate ⇒ recommend it with a reason", (t) => {
  const root = makeWorkspace("pos-rec");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-candidate", gapTask("gap-candidate")); // no Touches → resolves trivially, no parent → deps ready

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 }); // floor 3
  assert.equal(r.pool, 2);
  assert.equal(r.deficit, 1);
  assert.equal(r.promotions.length, 1);
  assert.equal(r.promotions[0].id, "gap-candidate");
  assert.match(r.promotions[0].reason, /touches resolve/);
  assert.match(r.promotions[0].reason, /four-artifacts complete/);
});

// ── AC4: pool < floor + NO qualified candidate ⇒ no recommendation ───────────────────────────────

test("pool < floor but no qualified candidate ⇒ no promotions", (t) => {
  const root = makeWorkspace("neg-no-qual");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });

  // Candidate fails four-artifacts (no DoD).
  writeTask(root, "gap-no-dod", gapTask("gap-no-dod", { body: fourArtifactBody().replace("## Definition of Done", "## Resolution") }));
  // Candidate fails deps (parent file missing → fail-closed, parent cannot be confirmed done).
  writeTask(root, "gap-child", { ...gapTask("gap-child"), parent: "gap-ghost-parent" });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 }); // floor 3
  assert.equal(r.deficit, 1);
  assert.deepEqual(r.promotions, [], "no qualified candidate ⇒ nothing to recommend");
  const byId = Object.fromEntries(r.candidates.map((c) => [c.id, c]));
  assert.equal(byId["gap-no-dod"].eligible, false);
  assert.equal(byId["gap-no-dod"].missingArtifacts.includes("dod"), true);
  assert.equal(byId["gap-child"].eligible, false);
  assert.equal(byId["gap-child"].depsReady, false);
});

// ── DEPENDS_ON READS DEVELOP REF (gap-ready-pool-depends-on-status-stale-read) ─────────────────────
// The depends_on/parent statusOf in depsReadyFor used to read the `allTasks` Map — built from the
// manager working branch's DISK (a stale agent-proxy, 硬规则 4b) — so a dependency already `done` on
// develop still reported blocking. The fix reads the canonical develop ref via readTaskStatusAtRef.
// AC1/AC3: dep done on develop + stale disk ⇒ deps-ready (not blocking). AC2: dep genuinely not done
// on develop ⇒ still blocking (fail-closed unchanged). Needs a REAL git repo (the ref read is
// `git cat-file --batch`), created inline like the git-history tests above.

test("depends_on statusOf reads develop ref, not the stale disk allTasks (gap-ready-pool-depends-on-status-stale-read AC1/AC2/AC3)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-depref-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "master", "-q", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");

  // Deps as they exist ON DEVELOP: gap-dep-done is done; gap-dep-todo is genuinely todo.
  writeTask(root, "gap-dep-done", { status: "done", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-dep-todo", { status: "todo", labels: ["gap"], body: fourArtifactBody() });
  fs.writeFileSync(path.join(root, ".gitkeep"), "base\n");
  git("add", ".");
  git("commit", "-q", "-m", "deps as committed on develop");
  git("branch", "-q", "develop"); // develop ← the snapshot where gap-dep-done is done

  // The manager working branch's DISK goes STALE: gap-dep-done flips back to todo on disk, while
  // develop still has it done. (gap-dep-todo stays todo on both — the AC2 negative control.)
  writeTask(root, "gap-dep-done", { status: "todo", labels: ["gap"], body: fourArtifactBody() });

  // Two todo candidates, each depending on one dep (patched in after writeTask — writeTask has no
  // dependsOn param).
  for (const [id, dep] of [["gap-cand-done", "gap-dep-done"], ["gap-cand-todo", "gap-dep-todo"]]) {
    writeTask(root, id, {
      status: "todo", labels: ["gap"], parent: null, children: [],
      body: fourArtifactBody({ touches: [`- code/${id}.ts (new)`] }),
    });
    const f = path.join(root, "tasks", `${id}.md`);
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("parent: null", `depends_on:\n  - ${dep}\nparent: null`));
  }

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  const byId = Object.fromEntries(r.candidates.map((c) => [c.id, c]));
  assert.equal(byId["gap-cand-done"].depsReady, true,
    "dep done on develop ⇒ deps-ready even though the disk allTasks view is stale (todo)");
  assert.equal(byId["gap-cand-todo"].depsReady, false,
    "dep genuinely not done on develop ⇒ still blocking (fail-closed unchanged)");
});

// ── COMPOUND AGGREGATION (gap-compound-depsreadyfor-structural-deadlock AC2/AC3) ─────────────────────
// The structural deadlock: a compound parent (`role: compound`, status ready NOT done) is only done
// once ALL its children are done (parent-done-iff-children, DIR-026), so a child waiting on its
// compound parent is 双向互等 (child waits on parent, parent waits on children) ⇒ the whole subtree is
// permanently un-dispatchable. The fix: `depsReadyFor` treats a compound parent as an AGGREGATION
// edge (the parent IS the children's sum, not a predecessor) and EXCLUDES it from a child's deps —
// children dispatch on their own depends_on edges alone. A non-compound (primitive) parent not done
// STILL blocks its child (predecessor semantics intact — negative control).

test("COMPOUND: a todo child whose parent is `role: compound` IS deps-ready (aggregation, not predecessor)", (t) => {
  const root = makeWorkspace("compound-deps");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The compound parent is status `ready` (NOT done) — the exact shape that deadlocks pre-fix: a
  // child waiting on it can never see it done while any child is open.
  writeTask(root, "gap-compound-parent", {
    status: "ready", labels: ["gap"], role: "compound", children: ["gap-compound-child"],
    body: fourArtifactBody({ touches: ["- code/parent.ts (new)"] }),
  });
  // The todo child names the compound parent — pre-fix depsReady=false (parent not done); post-fix
  // the compound-parent edge is EXCLUDED ⇒ depsReady=true.
  writeTask(root, "gap-compound-child", {
    status: "todo", labels: ["gap"], parent: "gap-compound-parent",
    body: fourArtifactBody({ touches: ["- code/child.ts (new)"] }),
  });
  // Negative control: a NON-compound (primitive) parent not done still blocks its child.
  writeTask(root, "gap-plain-parent", {
    status: "ready", labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/plain.ts (new)"] }),
  });
  writeTask(root, "gap-plain-child", {
    status: "todo", labels: ["gap"], parent: "gap-plain-parent",
    body: fourArtifactBody({ touches: ["- code/plain-child.ts (new)"] }),
  });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  const byId = Object.fromEntries(r.candidates.map((c) => [c.id, c]));
  assert.equal(byId["gap-compound-child"].depsReady, true,
    "compound parent (aggregation) must NOT block the child — the structural deadlock is broken");
  assert.equal(byId["gap-plain-child"].depsReady, false,
    "a non-compound (primitive) parent not done STILL blocks the child (predecessor semantics intact)");
});

test("COMPOUND: isCompoundTask reads the frontmatter role (unit, incl. negative + missing-task)", (t) => {
  const root = makeWorkspace("compound-unit");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-compound-parent", {
    status: "ready", labels: ["gap"], role: "compound",
    body: fourArtifactBody({ touches: ["- code/parent.ts (new)"] }),
  });
  writeTask(root, "gap-plain-parent", {
    status: "ready", labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/plain.ts (new)"] }),
  });
  const all = new Map();
  for (const f of fs.readdirSync(path.join(root, "tasks")).filter((f) => f.endsWith(".md"))) {
    const id = f.replace(/\.md$/, "");
    const task = parseTask(fs.readFileSync(path.join(root, "tasks", f), "utf8"));
    task.id = id;
    task.parent = null;
    all.set(id, task);
  }
  assert.equal(isCompoundTask(all.get("gap-compound-parent")), true, "role: compound ⇒ compound");
  assert.equal(isCompoundTask(all.get("gap-plain-parent")), false, "no role ⇒ not compound");
  assert.equal(isCompoundTask(all.get("gap-ghost-missing")), false, "missing task ⇒ not compound (fail closed)");
  assert.equal(isCompoundTask({ body: "no frontmatter" }), false, "task without frontmatterRaw ⇒ not compound");
});

// ── AC5: candidate with majority-missing Touches is not recommended (guard KEPT) ──────────────────

test("candidate with majority-missing Touches is not recommended (AC5)", (t) => {
  const root = makeWorkspace("neg-touches");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  // Candidate declares touches on files that do not exist (no `(new)` tag).
  writeTask(root, "gap-missing-touch", gapTask("gap-missing-touch", {
    body: fourArtifactBody({ touches: ["- code/does-not-exist.ts", "- plugin/scripts/also-missing.ts"] }),
  }));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 }); // floor 3
  assert.equal(r.deficit, 1);
  assert.deepEqual(r.promotions, []);
  const c = r.candidates.find((x) => x.id === "gap-missing-touch");
  assert.equal(c.touchesResolve, false);
  assert.equal(c.eligible, false);
});

// ── AC4: ordering — touch-disjointness ranks FIRST (pool + in-flight), gap-*>DIR-* as tiebreak ────

test("candidate order: gap-* defect sorts before DIR-* capability", (t) => {
  const root = makeWorkspace("order-kind");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "DIR-new-cap", dirTask("DIR-new-cap"));
  writeTask(root, "gap-defect", gapTask("gap-defect"));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  const ids = r.candidates.map((c) => c.id);
  assert.deepEqual(ids, ["gap-defect", "DIR-new-cap"], "gap-* must sort before DIR-* (equal disjointness)");
  assert.equal(classifyKind("gap-defect"), "gap");
  assert.equal(classifyKind("DIR-new-cap"), "dir");
  assert.equal(classifyKind("ARCH-x"), "other");
});

test("candidate order: touches-resolvable sorts before non-resolvable within a kind", (t) => {
  const root = makeWorkspace("order-resolve");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "code", "exists.ts"), "export const real = 1;\n");
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-resolvable", gapTask("gap-resolvable", {
    body: fourArtifactBody({ touches: ["- code/exists.ts"] }),
  }));
  // AC1 (gap-ac46-pool-criteria-in-gate): gapTask injects the C8 self-touch, and the self-touch file
  // EXISTS (writeTask wrote it) — so a single missing real touch is no longer the majority. Two
  // missing real touches keep the candidate majority-missing even with the (existing) self-touch.
  writeTask(root, "gap-unresolvable", gapTask("gap-unresolvable", {
    body: fourArtifactBody({ touches: ["- code/missing.ts", "- code/also-missing.ts"] }),
  }));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  const byId = Object.fromEntries(r.candidates.map((c) => [c.id, c]));
  assert.equal(byId["gap-resolvable"].touchesResolve, true);
  assert.equal(byId["gap-unresolvable"].touchesResolve, false);
  const idxResolvable = r.candidates.findIndex((c) => c.id === "gap-resolvable");
  const idxUnresolvable = r.candidates.findIndex((c) => c.id === "gap-unresolvable");
  assert.ok(idxResolvable < idxUnresolvable, "resolvable candidate must sort before non-resolvable");
});

test("promotion ranks touch-disjointness first (vs pool + in-flight), kind as secondary tiebreak (AC4)", (t) => {
  const root = makeWorkspace("rank");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const f of ["code/pool.ts", "code/other.ts", "code/other2.ts", "code/inflight.ts"]) {
    fs.writeFileSync(path.join(root, f), "export const x = 1;\n");
  }
  // Pool: 1 ready task touching code/pool.ts.
  writeTask(root, "gap-pool", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/pool.ts"] }) });
  // Candidates (all eligible; disjointScore vs pool(1) + in-flight(1)):
  writeTask(root, "gap-colliding", gapTask("gap-colliding", { body: fourArtifactBody({ touches: ["- code/pool.ts"] }) })); // collides pool → 1
  writeTask(root, "DIR-disjoint", dirTask("DIR-disjoint", { body: fourArtifactBody({ touches: ["- code/other.ts"] }) })); // disjoint both → 2
  writeTask(root, "gap-inf-disjoint", gapTask("gap-inf-disjoint", { body: fourArtifactBody({ touches: ["- code/other2.ts"] }) })); // disjoint both → 2
  writeTask(root, "ARCH-colliding-inf", { status: "todo", labels: [], body: fourArtifactBody({ touches: ["- code/inflight.ts"] }) }); // collides in-flight → 1

  const inFlight = [{ id: "gap-inflight", body: fourArtifactBody({ touches: ["- code/inflight.ts"] }) }];
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1, inFlight });
  assert.deepEqual(
    r.candidates.map((c) => c.id),
    ["gap-inf-disjoint", "DIR-disjoint", "gap-colliding", "ARCH-colliding-inf"],
    "disjointness score first (gap before dir within a score), then kind",
  );
  assert.equal(r.promotions[0].id, "gap-inf-disjoint", "most-disjoint candidate promoted first");
  // Disjointness beats kind: a disjoint DIR* ranks before a colliding gap*.
  const idxDir = r.candidates.findIndex((c) => c.id === "DIR-disjoint");
  const idxGap = r.candidates.findIndex((c) => c.id === "gap-colliding");
  assert.ok(idxDir < idxGap, "disjoint DIR candidate ranks before colliding gap candidate");
  // In-flight dimension: disjoint-from-in-flight ranks before colliding-with-in-flight.
  const idxInfD = r.candidates.findIndex((c) => c.id === "gap-inf-disjoint");
  const idxInfC = r.candidates.findIndex((c) => c.id === "ARCH-colliding-inf");
  assert.ok(idxInfD < idxInfC, "disjoint-from-in-flight ranks before colliding-with-in-flight");
});

// ── PRIORITY TIEBREAKER (gap-priority-has-no-mechanism-reader, AC1/AC3): the explicit `priority:*`
//    label (p1 > p2 > none) is read from the SAME frontmatter-labels source the dispatch sort reads
//    (parseTask/parseCandidate), and re-orders promotion candidates WITHIN an equal-disjointness
//    bucket — the "priority has a MECHANISM reader" fix (C17 closure). AC3: it NEVER overrides the
//    disjointness safety axis (a higher-disjoint no-priority candidate still ranks first).

test("priorityLevel maps p1/p2/none to ascending sort ranks (p1=1, p2=2, none=Infinity; unknown level fail-open)", () => {
  assert.equal(priorityLevel(["gap", "priority:p1"]), 1);
  assert.equal(priorityLevel(["gap", "priority:p2"]), 2);
  assert.equal(priorityLevel(["gap"]), Infinity, "no priority label ⇒ none (last)");
  assert.equal(priorityLevel(["gap", "priority:urgent"]), Infinity, "an unregistered level is fail-open (no rank)");
  assert.equal(priorityLevel([]), Infinity);
});

test("candidate order: priority tiebreaker p1 > p2 > none within equal disjointness (AC1)", (t) => {
  const root = makeWorkspace("order-priority");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const f of ["code/pool.ts", "code/other.ts", "code/other2.ts", "code/other3.ts"]) {
    fs.writeFileSync(path.join(root, f), "export const x = 1;\n");
  }
  // Pool: 1 ready task touching code/pool.ts; no in-flight ⇒ every disjoint candidate scores 1.
  writeTask(root, "gap-pool", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/pool.ts"] }) });
  writeTask(root, "gap-plain", gapTask("gap-plain", { body: fourArtifactBody({ touches: ["- code/other.ts"] }) }));
  writeTask(root, "gap-p2", gapTask("gap-p2", { labels: ["gap", "priority:p2"], body: fourArtifactBody({ touches: ["- code/other2.ts"] }) }));
  writeTask(root, "gap-p1", gapTask("gap-p1", { labels: ["gap", "priority:p1"], body: fourArtifactBody({ touches: ["- code/other3.ts"] }) }));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  assert.deepEqual(r.candidates.map((c) => c.id), ["gap-p1", "gap-p2", "gap-plain"], "p1 before p2 before none at equal disjointness");
  const byId = Object.fromEntries(r.candidates.map((c) => [c.id, c]));
  assert.equal(byId["gap-p1"].priority, 1);
  assert.equal(byId["gap-p2"].priority, 2);
  assert.equal(byId["gap-plain"].priority, Infinity);
  // The pick loop follows the sort: the p1 candidate is promoted first, and the record exposes the rank.
  assert.equal(r.promotions[0].id, "gap-p1", "p1 candidate promoted first");
  assert.equal(r.promotions[0].priority, 1, "promotion record exposes the priority rank");
});

test("candidate order: priority never overrides the disjointness safety axis (AC3)", (t) => {
  const root = makeWorkspace("order-priority-safety");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const f of ["code/pool.ts", "code/inflight.ts", "code/other.ts"]) {
    fs.writeFileSync(path.join(root, f), "export const x = 1;\n");
  }
  // Pool: 1 ready task touching code/pool.ts; in-flight: 1 touching code/inflight.ts.
  // code/other.ts is disjoint from BOTH ⇒ disjointScore 2 (max). code/pool.ts collides the pool ⇒ 1.
  writeTask(root, "gap-pool", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/pool.ts"] }) });
  writeTask(root, "gap-no-priority-disjoint", gapTask("gap-no-priority-disjoint", { body: fourArtifactBody({ touches: ["- code/other.ts"] }) }));
  writeTask(root, "gap-p1-colliding", gapTask("gap-p1-colliding", { labels: ["gap", "priority:p1"], body: fourArtifactBody({ touches: ["- code/pool.ts"] }) }));

  const inFlight = [{ id: "gap-inflight", body: fourArtifactBody({ touches: ["- code/inflight.ts"] }) }];
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1, inFlight });
  assert.deepEqual(
    r.candidates.map((c) => c.id),
    ["gap-no-priority-disjoint", "gap-p1-colliding"],
    "disjointness ranks before priority — a p1 colliding candidate cannot jump a disjoint no-priority one",
  );
  assert.equal(r.promotions[0].id, "gap-no-priority-disjoint", "AC3: safety first — the disjoint no-priority candidate is promoted first");
});

test("candidate order: priority beats the gap>DIR kind tiebreak within equal disjointness (AC1)", (t) => {
  const root = makeWorkspace("order-priority-kind");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const f of ["code/pool.ts", "code/other.ts"]) {
    fs.writeFileSync(path.join(root, f), "export const x = 1;\n");
  }
  // Pool: 1 ready task touching code/pool.ts. Both candidates are disjoint from the pool (score 1);
  // the kind tiebreak (gap before DIR) is outranked by the explicit priority label.
  writeTask(root, "gap-pool", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/pool.ts"] }) });
  writeTask(root, "gap-plain", gapTask("gap-plain", { body: fourArtifactBody({ touches: ["- code/other.ts"] }) }));
  writeTask(root, "DIR-p1", dirTask("DIR-p1", { labels: ["milestone-candidate", "priority:p1"], body: fourArtifactBody({ touches: ["- code/other.ts"] }) }));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  assert.deepEqual(r.candidates.map((c) => c.id), ["DIR-p1", "gap-plain"], "within equal disjointness, priority:p1 beats the gap>DIR kind tiebreak");
});

// ── REVERSE DIRECTION (gap-closed-bracket-leaves-live-agent-consuming-slots): closed-but-live agents
//    rank in the in-flight disjointness set — a new dispatch must not collide with their touches even
//    though their telemetry bracket already closed (bracket-close ≠ agent-exit) ─────────────────────

test("AC4 reverse — closedButLive agents rank in the in-flight disjointness set", (t) => {
  const root = makeWorkspace("cbl-rank");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const f of ["code/pool.ts", "code/other.ts", "code/ghost.ts"]) {
    fs.writeFileSync(path.join(root, f), "export const x = 1;\n");
  }
  // Pool: 1 ready task touching code/pool.ts.
  writeTask(root, "gap-pool", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/pool.ts"] }) });
  // Candidates (all eligible; disjointScore vs pool(1) + closed-but-live(1)):
  writeTask(root, "gap-ghost-colliding", gapTask("gap-ghost-colliding", { body: fourArtifactBody({ touches: ["- code/ghost.ts"] }) })); // collides closed-but-live → 1
  writeTask(root, "gap-free", gapTask("gap-free", { body: fourArtifactBody({ touches: ["- code/other.ts"] }) })); // disjoint both → 2

  const closedButLive = [{ id: "gap-ghost", body: fourArtifactBody({ touches: ["- code/ghost.ts"] }) }];
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1, closedButLive });
  assert.equal(r.closed_but_live[0], "gap-ghost", "the closed-but-live set is surfaced in the output");
  assert.ok(r.candidates.find((c) => c.id === "gap-free"), "gap-free candidate present");
  assert.ok(r.candidates.find((c) => c.id === "gap-ghost-colliding"), "ghost-colliding candidate present");
  const idxFree = r.candidates.findIndex((c) => c.id === "gap-free");
  const idxGhost = r.candidates.findIndex((c) => c.id === "gap-ghost-colliding");
  assert.ok(idxFree < idxGhost, "disjoint-from-closed-but-live ranks before colliding-with-closed-but-live");
  // The closed-but-live id is excluded from ready_relevance (it is NOT dispatchable room).
  const readyRel = r.ready_relevance.map((x) => x.id);
  assert.ok(!readyRel.includes("gap-ghost"), "closed-but-live id excluded from ready relevance");
});

// ── AC4/AC5: hard-cap floor constant is what the ticks use ────────────────────────────────────────

test("analyzeTasks derives floor from cap × floorMult (configurable, single source)", (t) => {
  const root = makeWorkspace("floor-derive");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  // cap 5 × floorMult 2 ⇒ floor 10; pool 1 ⇒ deficit 9.
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 5, floorMult: 2 });
  assert.equal(r.cap, 5);
  assert.equal(r.floorMult, 2);
  assert.equal(r.floor, 10);
  assert.equal(r.deficit, 9);
});

// ── gap-value-prioritization-has-no-mechanism: relevance signal + priority query (AC1/AC2/AC3/AC6) ──
// The manager layer's prioritization function: each candidate carries a MECHANICAL relevance signal
// (strategicTrace = body grep for FINDING-*/RESEARCH-*/GOAL-*/REVIEW-cadence; unblocks = non-done
// tasks with this candidate as their `parent`; costTouches = declared `## Touches` parsed scale) and
// `--top N` emits `top_relevance` — the N highest-value current todos with a reason each. AC4: the
// existing promotion sort (disjointness first, gap>DIR) is untouched.

test("CLI smoke: --root produces JSON with pool/dispatchable_disjoint/floor (exit 0)", (t) => {
  const root = makeWorkspace("cli");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  const script = path.resolve(__dirname, "..", "scripts", "ready-pool-check.ts");
  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", script, "--root", root],
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(out);
  assert.equal(typeof parsed.pool, "number");
  assert.equal(parsed.pool, 1);
  assert.equal(parsed.floor, 12, "default floor = cap×4 = 12");
  assert.equal(typeof parsed.dispatchable_disjoint, "number");
  assert.equal(typeof parsed.criterion_met, "boolean");
  assert.equal(typeof parsed.scanned, "number");
});

// ── Value-prioritization relevance signal (gap-value-prioritization-has-no-mechanism) ──────────────
// AC1: per-candidate relevance signal (strategic traceability grep + parent/children blocking +
// touches-scale cost) output to JSON. AC3: all sources mechanical (no human scoring). AC2/AC6: the
// --top query emits the highest-value N todos with reasons, and ready_relevance ranks the ready pool
// by the same signal (the "who to dispatch next" answer). AC4: the existing promotion order is
// untouched (regression assertion).

test("computeRelevance: strategic grep, blocking, cost scale, composite value (AC1/AC3)", () => {
  const childrenByTask = new Map([["gap-parent", ["gap-child-a", "gap-child-b"]]]);
  const parentRefCount = new Map([["gap-blocked-by", 1]]);

  // strategic (3) + cost 1 benefit (1) = 4 — outranks everything.
  const strategic = computeRelevance(
    "gap-strategic",
    { body: "references SYNTHESIS-four-gaps-2026-08-05.md\n## Touches\n- code/a.ts" },
    childrenByTask,
    parentRefCount,
  );
  assert.equal(strategic.strategic, true, "SYNTHESIS- reference ⇒ strategic traceable");
  assert.equal(strategic.blocking, false);
  assert.equal(strategic.cost, 1);
  assert.equal(strategic.value, STRATEGIC_WEIGHT + 1);
  assert.match(strategic.reason, /strategic Y/);

  // blocking via children (2) + cost 1 benefit (1) = 3.
  const blocker = computeRelevance("gap-parent", { body: "plain\n## Touches\n- code/a.ts" }, childrenByTask, parentRefCount);
  assert.equal(blocker.strategic, false);
  assert.equal(blocker.blocking, true);
  assert.equal(blocker.value, BLOCKING_WEIGHT + 1);
  assert.match(blocker.reason, /blocking Y\(2 children\)/);

  // blocking via being named as parent by another task.
  const blockedBy = computeRelevance("gap-blocked-by", { body: "plain\n## Touches\n- code/a.ts" }, childrenByTask, parentRefCount);
  assert.equal(blockedBy.blocking, true, "referenced as parent by another task ⇒ blocking");

  // low value: no strategic, no blocking, 4 touches → cost benefit 0.25.
  const costly = computeRelevance(
    "gap-costly",
    { body: "plain\n## Touches\n- code/a.ts\n- code/b.ts\n- code/c.ts\n- code/d.ts" },
    childrenByTask,
    parentRefCount,
  );
  assert.equal(costly.value, 0.25);
  assert.match(costly.reason, /cost 4 touches/);

  // Composite ordering: strategic > blocking > cheap-plain > costly.
  assert.ok(strategic.value > blocker.value, "strategic outranks blocking");
  assert.ok(blocker.value > costly.value, "blocking outranks plain-costly");
});

test("readChildren / strategicTraceable / touchesScale mechanical sources (AC3)", () => {
  assert.deepEqual(readChildren("---\nchildren:\n  - a\n  - b\n---\nbody"), ["a", "b"]);
  assert.deepEqual(readChildren("---\nchildren: [x, y]\n---\nbody"), ["x", "y"]);
  assert.deepEqual(readChildren("---\nchildren: []\n---\nbody"), []);
  assert.deepEqual(readChildren("---\nno children here\n---\nbody"), []);

  assert.equal(strategicTraceable("proposal cites FINDING-roadmap-2026"), true);
  assert.equal(strategicTraceable("proposal cites SPEC-state-crystallization"), true);
  assert.equal(strategicTraceable("proposal cites REVIEW-cadence mechanism"), true);
  assert.equal(strategicTraceable("just a normal task"), false);
  assert.equal(STRATEGIC_REF_RE.test("lowercase spec- reference"), false, "case-sensitive prefix match");

  assert.deepEqual(touchesScale("## Touches\n- code/a.ts\n- code/b.ts"), { hasSection: true, count: 2 });
  assert.equal(touchesScale("no touches section").count, 0, "missing Touches = unknown scope (high cost)");
});

test("analyzeTasks --top: top_relevance = highest-value N todos with reasons; strategic ranks front (AC2/control)", (t) => {
  const root = makeWorkspace("top-rel");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  // todos: strategic, blocking (children), plain small — all gap-* so the gap>DIR tiebreak cannot
  // separate them; only the relevance signal can.
  writeTask(root, "gap-strategic", gapTask("gap-strategic", {
    body: fourArtifactBody({ extra: "\nproposal references SYNTHESIS-four-gaps-2026-08-05.md" }),
  }));
  writeTask(root, "gap-blocker", { ...gapTask("gap-blocker"), children: ["gap-child"] });
  writeTask(root, "gap-small", gapTask("gap-small", { body: fourArtifactBody({ touches: ["- code/a.ts"] }) }));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1, topN: 3 });
  assert.ok(Array.isArray(r.top_relevance));
  assert.equal(r.top_relevance.length, 3);
  // control: strategic traceability candidate ranks front (AC6 instance).
  assert.equal(r.top_relevance[0].id, "gap-strategic", "strategic candidate must rank first");
  assert.equal(r.top_relevance[0].strategic, true);
  // every entry carries the mechanical signal fields (AC1 output to JSON).
  for (const e of r.top_relevance) {
    assert.equal(typeof e.strategic, "boolean");
    assert.equal(typeof e.blocking, "boolean");
    assert.equal(typeof e.cost, "number");
    assert.equal(typeof e.value, "number");
    assert.equal(typeof e.reason, "string");
  }
  // value-sorted desc.
  const vals = r.top_relevance.map((e) => e.value);
  assert.deepEqual(vals, [...vals].sort((a, b) => b - a), "top_relevance sorted by value desc");
});

test("analyzeTasks --top: ready_relevance ranks the ready pool by the same signal (AC6)", (t) => {
  const root = makeWorkspace("ready-rel");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Ready pool of two gap-* tasks — the gap>DIR tiebreak cannot pick between them; relevance can.
  writeTask(root, "gap-plain-ready", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/plain.ts"] }) });
  writeTask(root, "gap-strategic-ready", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/s.ts"], extra: "\nproposal references SYNTHESIS-four-gaps-2026-08-05.md" }),
  });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  assert.ok(Array.isArray(r.ready_relevance), "ready_relevance always emitted");
  assert.equal(r.ready_relevance.length, 2);
  const vals = r.ready_relevance.map((e) => e.value);
  assert.deepEqual(vals, [...vals].sort((a, b) => b - a), "ready_relevance sorted by value desc");
  assert.equal(r.ready_relevance[0].id, "gap-strategic-ready", "strategic ready task ranks first in the ready pool");
});

test("analyzeTasks --top: ready_relevance excludes in-flight ids (AC6 dispatchable set)", (t) => {
  const root = makeWorkspace("ready-rel-inf");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-strategic-ready", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/s.ts"], extra: "\nproposal references SYNTHESIS-four-gaps-2026-08-05.md" }),
  });
  writeTask(root, "gap-plain-ready", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/plain.ts"] }) });

  const r = analyzeTasks({
    tasksDir: path.join(root, "tasks"),
    root,
    cap: 3,
    floorMult: 1,
    inFlight: [{ id: "gap-strategic-ready", body: "in flight" }],
  });
  assert.deepEqual(
    r.ready_relevance.map((e) => e.id),
    ["gap-plain-ready"],
    "in-flight ready task excluded from the dispatchable relevance ranking",
  );
});

test("value-prioritization does not alter the gap>DIR promotion order (AC4 regression)", (t) => {
  const root = makeWorkspace("rel-regress");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "DIR-new-cap", dirTask("DIR-new-cap"));
  writeTask(root, "gap-defect", gapTask("gap-defect"));

  const plain = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  const withTop = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1, topN: 5 });
  assert.deepEqual(
    plain.candidates.map((c) => c.id),
    withTop.candidates.map((c) => c.id),
    "candidate set/order identical with and without --top",
  );
  assert.deepEqual(plain.promotions.map((p) => p.id), withTop.promotions.map((p) => p.id));
  assert.deepEqual(withTop.candidates.map((c) => c.id), ["gap-defect", "DIR-new-cap"], "gap>DIR order preserved");
});

// ── VALUE-DEGRADATION REGRESSION (gap-value-priority-signal-degraded-to-1-over-cost) ────────────────
// AC1: the value signal must not be a pure `1/touches` — the three substantive axes
// (strategic/blocking/suite-blocking) must be ABLE to take Y. AC2: a large-touches strategic task (the
// pilot's shape) must NOT structurally bottom out. AC3: the composite metric is discriminative (non
// degenerate). These pin the two取数 fixes: (a) the strategic regex now word-boundary matches the
// strategic-doc reference form `SPEC §11` (the pilot references the SPEC doc by section, not by
// hyphenated filename — the old `/SPEC-/` missed it); (b) the blocking axis now reads the `depends_on`
// reverse edge (a task others depend on IS blocking).

test("value-degradation AC1: strategic axis取数 bug — `SPEC §11`-style reference (pilot's form) reads strategic Y", () => {
  // The pilot references "SPEC §11 阶段 2" — a reference to the strategic SPEC doc by section number,
  // not the hyphenated filename `SPEC-per-task-suite-verification-2026-08-13.md`. The old
  // /FINDING-|SYNTHESIS-|SPEC-|REVIEW-cadence/ required a literal hyphen after SPEC, so the pilot —
  // the stage's single strategic priority — read strategic N. Word-boundary matching catches BOTH.
  assert.equal(STRATEGIC_REF_RE.test("SPEC §11 阶段 2 (per-task 全量试点)"), true, "SPEC §N (space+section) must match");
  assert.equal(STRATEGIC_REF_RE.test("SPEC-per-task-suite-verification-2026-08-13.md"), true, "hyphenated doc name still matches");
  assert.equal(STRATEGIC_REF_RE.test("FINDING-roadmap-predates-ADR-022-retirement"), true);
  assert.equal(STRATEGIC_REF_RE.test("SYNTHESIS-four-gaps-2026-08-05.md"), true);
  assert.equal(STRATEGIC_REF_RE.test("REVIEW-cadence mechanism"), true);
  // negative control: case-sensitivity preserved (a lowercase `spec` in prose is NOT a strategic ref).
  assert.equal(STRATEGIC_REF_RE.test("lowercase spec- reference"), false, "case-sensitive prefix match");
  assert.equal(STRATEGIC_REF_RE.test("just a normal task"), false);

  // end-to-end: a todo whose body references the pilot's actual strategic-doc form gets strategic Y
  // and a value well above its 1/cost — NOT structurally bottomed out.
  const strategic = computeRelevance("gap-spec-11-pilot", {
    body: "references SPEC §11 阶段 2 per-task 全量试点\n## Touches\n- code/a.ts\n- code/b.ts\n- code/c.ts",
  });
  assert.equal(strategic.strategic, true, "SPEC §11 reference ⇒ strategic traceable");
  assert.equal(strategic.value, Number((STRATEGIC_WEIGHT + 1 / 3).toFixed(3)), "value = strategic(4) + costBenefit(1/3), NOT 1/3");
  assert.match(strategic.reason, /strategic Y/);
});

test("value-degradation AC1: blocking axis取数 gap — a task others `depends_on` is blocking", () => {
  const childrenByTask = new Map();
  const parentRefCount = new Map();
  // two tasks list `gap-prereq` in their depends_on — its landing unblocks both (same semantic as
  // being named parent, but the edge family is `depends_on`, which the blocking axis never read).
  const dependedOnCount = new Map([["gap-prereq", 2]]);
  const r = computeRelevance(
    "gap-prereq",
    { body: "plain\n## Touches\n- code/a.ts" },
    childrenByTask,
    parentRefCount,
    null,
    dependedOnCount,
  );
  assert.equal(r.blocking, true, "a task others depends_on is blocking");
  assert.equal(r.value, BLOCKING_WEIGHT + 1, "value = blocking(2) + costBenefit(1)");
  assert.match(r.reason, /depends-on 2/);
  // negative: a task NO ONE depends_on stays non-blocking on this axis.
  const isolated = computeRelevance("gap-isolated", { body: "plain\n## Touches\n- code/a.ts" }, childrenByTask, parentRefCount, null, dependedOnCount);
  assert.equal(isolated.blocking, false);
});

test("computeDependedOnCount — the depends_on reverse-edge index, single source shared with the ff-starvation relief (gap-ff-starvation-no-dynamic-cap-relief)", () => {
  const fm = (extra) => parseTask(`---\nid: gap-x\nstatus: ready\n${extra}---\nbody\n`);
  const a = fm("");
  const b = fm("depends_on:\n  - gap-a\n");
  const c = fm("depends_on:\n  - gap-a\n  - gap-b\n");
  const allTasks = new Map([["gap-a", a], ["gap-b", b], ["gap-c", c]]);
  const m = computeDependedOnCount(allTasks);
  assert.equal(m.get("gap-a"), 2, "two tasks list gap-a in depends_on");
  assert.equal(m.get("gap-b"), 1);
  assert.equal(m.get("gap-c"), undefined, "no one depends_on gap-c ⇒ absent (never a fabricated 0)");
});

test("value-degradation AC2/AC3: a large-touches strategic task floats above a small plain task; composite not 1/cost (--top ordering)", (t) => {
  const root = makeWorkspace("val-nondeg");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The pilot shape: a LARGE touches task (many files) that is strategic — under the old pure-1/cost
  // signal it bottomed out (value = 1/8 for 8 touches); with the strategic axis restored it outranks a
  // tiny plain task.
  writeTask(root, "gap-pilot", gapTask("gap-pilot", {
    body: fourArtifactBody({
      touches: Array.from({ length: 8 }, (_, i) => `- code/file${i}.ts`),
      extra: "\nproposal references SPEC §11 阶段 2 (per-task 全量试点)",
    }),
  }));
  writeTask(root, "gap-plain", gapTask("gap-plain", {
    body: fourArtifactBody({ touches: ["- code/one.ts"] }),
  }));
  // a blocking-via-depends_on todo also ranks above the plain one.
  writeTask(root, "gap-dep", gapTask("gap-dep", {
    body: fourArtifactBody({ touches: ["- code/dep.ts"] }),
  }));
  writeTask(root, "gap-dependent", gapTask("gap-dependent", {
    body: fourArtifactBody({ touches: ["- code/other.ts"] }),
  }));

  // inject a depends_on edge gap-dependent → gap-dep by appending to the frontmatter.
  const depFile = path.join(root, "tasks", "gap-dependent.md");
  const depRaw = fs.readFileSync(depFile, "utf8");
  fs.writeFileSync(depFile, depRaw.replace(/^(extra:)/m, "depends_on:\n  - gap-dep\nextra:"));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1, topN: 4 });
  assert.equal(r.top_relevance[0].id, "gap-pilot", "large-touches strategic task must rank FIRST (not bottom out)");
  assert.equal(r.top_relevance[0].strategic, true);
  // AC1 (gap-ac46-pool-criteria-in-gate): gapTask now injects the C8 self-touch (`- tasks/<id>.md`),
  // which touchesScale counts as a declared touch — gap-pilot's 8 real touches become 9 (8 + self-touch)
  // ⇒ cost = 1/9, value = STRATEGIC_WEIGHT + 1/9.
  assert.equal(r.top_relevance[0].value, Number((STRATEGIC_WEIGHT + 1 / 9).toFixed(3)));
  // the blocking-via-depends_on task ranks above the plain ones (blocking 2 + costBenefit 1 = 3 > 1).
  assert.equal(r.top_relevance[1].id, "gap-dep", "depends_on-blocking task ranks above plain");
  assert.equal(r.top_relevance[1].blocking, true);
  // both plain 1-touch tasks (gap-dependent, gap-plain) tie at value 1; the alphabetical tie-break
  // puts gap-dependent before gap-plain — the plain pair ranks LAST, after pilot and gap-dep.
  const plainIdx = r.top_relevance.map((e) => e.id).filter((id) => id === "gap-dependent" || id === "gap-plain");
  assert.deepEqual(plainIdx, ["gap-dependent", "gap-plain"], "plain pair last of the four");
  // AC3: the value sequence is NOT a monotone 1/cost curve — the strategic large task (4.125) tops
  // the plain tiny task (1), inverting the pure-cost ordering.
  assert.ok(r.top_relevance[0].value > r.top_relevance[2].value, "strategic large task outranks plain small");
  const vals = r.top_relevance.map((e) => e.value);
  assert.deepEqual(vals, [...vals].sort((a, b) => b - a), "top_relevance sorted by value desc");
});

test("CLI smoke: --top 5 emits top_relevance value-sorted array with reasons (AC2/Contract measure)", (t) => {
  const root = makeWorkspace("cli-top");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-strategic", gapTask("gap-strategic", {
    body: fourArtifactBody({ extra: "\nproposal references SYNTHESIS-four-gaps-2026-08-05.md" }),
  }));
  writeTask(root, "gap-small", gapTask("gap-small", { body: fourArtifactBody({ touches: ["- code/a.ts"] }) }));
  const script = path.resolve(__dirname, "..", "scripts", "ready-pool-check.ts");
  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", script, "--root", root, "--top", "5"],
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(out);
  assert.ok(Array.isArray(parsed.top_relevance), "band: top_n_relevance is an array");
  assert.ok(parsed.top_relevance.length >= 1, "band: at least one relevance-sorted entry");
  assert.equal(parsed.top_relevance[0].strategic, true, "control: strategic candidate ranks front");
  assert.ok(parsed.top_relevance.every((e) => typeof e.value === "number" && typeof e.reason === "string"));
});

// ── Cross-machine merge regression (AC17 catch-up): computeRelevance arity — blocking must work ──
// The merge left a 3-arg call to the 4-param computeRelevance; the default empty Map silently
// zeroed blocking (allTasks landed in childrenByTask, .get() → task object, .length undefined).
// Fix: buildCandidate threads childrenByTask/parentRefCount; a parent with a child must report
// blocking=true (the manager's counterexample: Y has child X → 4-arg blocking=true, 3-arg false).
test("relevance blocking works end-to-end — a parent task with a child reports blocking=true (arity regression)", (t) => {
  const root = makeWorkspace("rel-block");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "PARENT-1", { status: "todo", labels: ["gap"], children: ["CHILD-1"], body: fourArtifactBody({ touches: ["- code/a.ts"] }) });
  writeTask(root, "CHILD-1", { status: "todo", labels: ["gap"], parent: "PARENT-1", body: fourArtifactBody({ touches: ["- code/b.ts"] }) });
  const script = path.resolve(__dirname, "..", "scripts", "ready-pool-check.ts");
  const out = execFileSync(process.execPath, ["--experimental-strip-types", script, "--root", root, "--top", "5"], { encoding: "utf8" });
  const parsed = JSON.parse(out);
  const parent = parsed.top_relevance.find((e) => e.id === "PARENT-1");
  assert.ok(parent, "parent candidate present in top_relevance");
  assert.equal(parent.blocking, true, "parent with child must report blocking=true (childrenByTask threaded)");
  assert.match(parent.reason, /blocking Y/, "reason states blocking Y");
  // Negative: the child (no children of its own) is not blocking on the children axis.
  const child = parsed.top_relevance.find((e) => e.id === "CHILD-1");
  assert.equal(child.blocking, false, "child without children reports blocking=false");
});

// ── TARGETED PROMOTION (gap-targeted-promotion-operation-does-not-exist) ───────────────────────────
// The pool<floor refill is the BULK path (inner mechanical, AC3). A stage-goal task the bulk path
// used to leave in todo (the pool<floor gate blocked refill when pool ≥ floor) needed a SECOND,
// floor-INDEPENDENT operation: the OUTER picks the target per stage goal and
// `ready-pool-check --targeted <id>` MECHANICALLY validates it + emits the promote command.
// AC48 (2026-08-13) RETIRED the pool<floor bulk gate — the bulk path now ALSO promotes the eligible
// target at pool ≥ floor (合格即晋), so targeted and bulk agree on the same eligible set; targeted
// remains the outer's stage-goal pick (selection = outer). AC1 mechanical carrier · AC2 floor-
// independent (pool ≥ floor still eligible) · the target's identity is the outer's stage-goal choice.

test("--targeted: pool ≥ floor still promotes a mechanically-eligible todo (AC2 floor-independent)", (t) => {
  const root = makeWorkspace("targeted-floor");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Pool ≥ floor: cap 2, floorMult 1 ⇒ floor 2; two ready tasks ⇒ pool 2, deficit 0.
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  // The stage-goal target sits in todo — pre-AC48 the bulk refill (deficit 0) would never recommend it.
  writeTask(root, "gap-target", gapTask("gap-target"));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 2, floorMult: 1, targetedId: "gap-target" });
  assert.equal(r.pool, 2);
  assert.equal(r.floor, 2);
  assert.ok(r.pool >= r.floor, "pool is at/above the floor");
  assert.equal(r.deficit, 0);
  assert.deepEqual(r.promotions.map((p) => p.id), ["gap-target"], "AC48: bulk refill now ALSO recommends the eligible target at pool ≥ floor (合格即晋)");
  assert.equal(r.targeted_promotion.eligible, true, "targeted promotion still eligible at pool ≥ floor (AC2)");
  assert.equal(r.targeted_promotion.floor_independent, true, "targeted path is marked floor-independent");
  assert.equal(r.targeted_promotion.promote_cmd, "quay promote gap-target", "the mechanical promote command (AC1)");
  assert.equal(r.targeted_promotion.found, true);
  assert.equal(r.targeted_promotion.checks.fourArtifacts, true);
  assert.equal(r.targeted_promotion.checks.depsReady, true);
});

test("--targeted: status guards — done/ready tasks and missing ids are not promotable", (t) => {
  const root = makeWorkspace("targeted-status");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-ready", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-done", { status: "done", labels: ["gap"], body: fourArtifactBody() });

  const ready = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, targetedId: "gap-ready" });
  assert.equal(ready.targeted_promotion.eligible, false);
  assert.equal(ready.targeted_promotion.reason, "status-ready");

  const done = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, targetedId: "gap-done" });
  assert.equal(done.targeted_promotion.eligible, false);
  assert.equal(done.targeted_promotion.reason, "status-done");

  const missing = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, targetedId: "gap-ghost" });
  assert.equal(missing.targeted_promotion.found, false);
  assert.equal(missing.targeted_promotion.eligible, false);
  assert.equal(missing.targeted_promotion.reason, "task-not-found");
});

test("--targeted: fixture and PARKED todo targets are not promotable", (t) => {
  const root = makeWorkspace("targeted-excl");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "QENG-DEMO", { status: "todo", labels: ["fixture"], body: fourArtifactBody() });
  writeTask(root, "gap-parked", {
    status: "todo",
    labels: ["gap"],
    body: "> **PARKED (outer ruling, 2026-08-04) — execution suspended.**\n\n" + fourArtifactBody(),
  });

  const fixture = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, targetedId: "QENG-DEMO" });
  assert.equal(fixture.targeted_promotion.eligible, false);
  assert.equal(fixture.targeted_promotion.reason, "fixture");

  const parked = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, targetedId: "gap-parked" });
  assert.equal(parked.targeted_promotion.eligible, false);
  assert.equal(parked.targeted_promotion.reason, "parked");
});

test("--targeted: ineligible target (missing four-artifacts) reports a concrete reason", (t) => {
  const root = makeWorkspace("targeted-ineligible");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-target", gapTask("gap-target", {
    body: fourArtifactBody().replace("## Definition of Done", "## Resolution"),
  }));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, targetedId: "gap-target" });
  assert.equal(r.targeted_promotion.eligible, false);
  assert.match(r.targeted_promotion.reason, /four-artifacts/);
  assert.match(r.targeted_promotion.reason, /missing dod/);
  assert.equal(r.targeted_promotion.checks.fourArtifacts, false);
});

test("--targeted: bulk promotions/candidates output is unchanged by the targeted query (AC3)", (t) => {
  const root = makeWorkspace("targeted-bulk");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-candidate", gapTask("gap-candidate"));

  const plain = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  const withTargeted = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1, targetedId: "gap-candidate" });
  assert.deepEqual(plain.promotions, withTargeted.promotions, "bulk promotions unchanged");
  assert.deepEqual(plain.candidates, withTargeted.candidates, "bulk candidates unchanged");
  assert.equal(plain.targeted_promotion, null, "no targeted query ⇒ targeted_promotion is null");
  assert.ok(withTargeted.targeted_promotion, "targeted query ⇒ targeted_promotion present");
});

test("CLI smoke: --targeted <id> emits targeted_promotion with promote_cmd (AC1 mechanical carrier)", (t) => {
  const root = makeWorkspace("cli-targeted");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-target", gapTask("gap-target"));
  const script = path.resolve(__dirname, "..", "scripts", "ready-pool-check.ts");
  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", script, "--root", root, "--targeted", "gap-target"],
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(out);
  assert.equal(parsed.targeted_promotion.eligible, true);
  assert.equal(parsed.targeted_promotion.promote_cmd, "quay promote gap-target");
  assert.equal(parsed.targeted_promotion.floor_independent, true);
  assert.equal(typeof parsed.targeted_promotion.checks, "object");
});

// ── RETIRED-MECHANISM INTERCEPT (gap-ready-pool-promotion-ignores-retired-mechanism-candidate-check) ──
// Promotion must not advance a todo that references an ADR-022-deleted classic-pipeline script
// (prepare-milestone.js / execute-milestone.js / milestone-worktree.ts) without annotation — such a
// candidate targets a RETIRED pipeline mechanism (premise-void; dispatching it wastes an agent round).
// AC1 promotion runs the same pool-candidate stale check the strategic-doc-staleness-check CLI exposes
// (--pool-candidate <id>, review-cadence AC8) before todo→ready · AC2 gap-prepare-milestone-no-size-
// aware-routing is intercepted · AC3 clean candidates (productize-manager etc.) still promote (negative
// control) · AC4 the intercept reason is mechanically recorded (never a silent skip).

test("AC1/AC2/AC4 — a candidate referencing an ADR-022-deleted script is NOT promoted and IS intercepted", (t) => {
  const root = makeWorkspace("retired");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Pool below floor (cap 3, floorMult 1 ⇒ floor 3; one ready task ⇒ deficit 2).
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  // The retired-mechanism candidate: references prepare-milestone.js (ADR-022-deleted) unannotated.
  writeTask(root, "gap-prepare-milestone-no-size-aware-routing", gapTask("gap-prepare-milestone-no-size-aware-routing", {
    body: fourArtifactBody({ extra: "\nTarget mechanism: prepare-milestone.js (live).\n" }),
  }));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  assert.ok(r.deficit > 0, "promotion pressure exists");
  assert.deepEqual(r.promotions, [], "the retired-mechanism candidate must NOT be promoted (AC1/AC2)");
  // AC4: the intercept is mechanically recorded, never silently skipped.
  assert.equal(r.intercepted.length, 1, "the intercept is recorded in the output");
  assert.equal(r.intercepted[0].id, "gap-prepare-milestone-no-size-aware-routing");
  assert.equal(r.intercepted[0].reason, "retired-mechanism");
  assert.ok(
    r.intercepted[0].refs.some((ref) => ref.hit === "prepare-milestone.js"),
    "the recorded ref names the deleted script",
  );
  const c = r.candidates.find((x) => x.id === "gap-prepare-milestone-no-size-aware-routing");
  assert.equal(c.retiredMechanism, true, "candidate carries the retiredMechanism flag");
  assert.equal(c.eligible, false, "retired-mechanism candidate is not eligible");
});

test("AC3 — clean candidates still promote; only the retired-mechanism candidate is intercepted (negative control)", (t) => {
  const root = makeWorkspace("retired-clean");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  // A clean candidate (one of the incident's 7 clean candidates — productize-manager) must still promote.
  writeTask(root, "productize-manager", gapTask("productize-manager"));
  // The retired-mechanism candidate.
  writeTask(root, "gap-prepare-milestone-no-size-aware-routing", gapTask("gap-prepare-milestone-no-size-aware-routing", {
    body: fourArtifactBody({ extra: "\nTarget mechanism: prepare-milestone.js (live).\n" }),
  }));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  assert.ok(
    r.promotions.some((p) => p.id === "productize-manager"),
    "clean candidate still promoted (AC3 negative control)",
  );
  assert.ok(
    !r.promotions.some((p) => p.id === "gap-prepare-milestone-no-size-aware-routing"),
    "retired candidate is NOT promoted",
  );
  assert.ok(
    r.intercepted.some((x) => x.id === "gap-prepare-milestone-no-size-aware-routing"),
    "retired candidate is intercepted (recorded)",
  );
});

test("--targeted: a retired-mechanism target is not promotable (retired-mechanism reason)", (t) => {
  const root = makeWorkspace("retired-targeted");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-prepare-milestone-no-size-aware-routing", gapTask("gap-prepare-milestone-no-size-aware-routing", {
    body: fourArtifactBody({ extra: "\nTarget mechanism: prepare-milestone.js (live).\n" }),
  }));

  const r = analyzeTasks({
    tasksDir: path.join(root, "tasks"),
    root,
    targetedId: "gap-prepare-milestone-no-size-aware-routing",
  });
  assert.equal(r.targeted_promotion.eligible, false, "retired-mechanism target is not promotable");
  assert.match(r.targeted_promotion.reason, /retired-mechanism/);
  assert.equal(r.targeted_promotion.checks.retiredMechanism, true, "the check records retiredMechanism: true");
  assert.ok(
    r.targeted_promotion.checks.retiredRefs.some((ref) => ref.hit === "prepare-milestone.js"),
    "the recorded ref names the deleted script",
  );
});

test("--targeted: a clean target stays promotable (retiredMechanism false in checks)", (t) => {
  const root = makeWorkspace("retired-targeted-clean");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-clean-target", gapTask("gap-clean-target"));
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, targetedId: "gap-clean-target" });
  assert.equal(r.targeted_promotion.eligible, true, "clean target is promotable");
  assert.equal(r.targeted_promotion.checks.retiredMechanism, false, "clean target reports retiredMechanism: false");
  assert.equal(r.targeted_promotion.checks.superseded, false, "clean target reports superseded: false");
});

test("--targeted: a SUPERSEDED target is not promotable (superseded reason)", (t) => {
  // gap-judgepoolcandidate-keyword-vs-position companion: the targeted path now reads the
  // **SUPERSEDED** marker (bulk already did). Without it, a task whose premise a human ruling
  // deleted (e.g. gap-split-decision-finality-not-enforced, superseded 2026-08-12) becomes
  // targeted-promotable once its backticked retired-script mentions are correctly read as quotes.
  const root = makeWorkspace("retired-targeted-superseded");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-split-decision-finality-not-enforced", gapTask("gap-split-decision-finality-not-enforced", {
    body: fourArtifactBody({ extra: "\n> **SUPERSEDED / 作废** premise deleted by a human ruling.\n" }),
  }));
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, targetedId: "gap-split-decision-finality-not-enforced" });
  assert.equal(r.targeted_promotion.eligible, false, "SUPERSEDED target is not promotable");
  assert.match(r.targeted_promotion.reason, /superseded/);
  assert.equal(r.targeted_promotion.checks.superseded, true, "the check records superseded: true");
});

test("CLI smoke: --root emits the intercepted array (empty when no retired candidate)", (t) => {
  const root = makeWorkspace("cli-retired");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  const script = path.resolve(__dirname, "..", "scripts", "ready-pool-check.ts");
  const out = execFileSync(process.execPath, ["--experimental-strip-types", script, "--root", root], { encoding: "utf8" });
  const parsed = JSON.parse(out);
  assert.ok(Array.isArray(parsed.intercepted), "intercepted is an array in the CLI output");
  assert.deepEqual(parsed.intercepted, [], "no retired candidate ⇒ empty intercepted array");
});

// ── LANDING-BLOCKED signal (gap-landing-blocked-invisible-to-dispatch-criteria) ─────────────────────
// criterion_met answers "are there ≥cap mutually-disjoint candidates" (touches-conflict graph only —
// grep-verified: ready-pool-check reads NO merge/landing state). slot-refill only measures slot
// release. So criterion_met=True stays True when landing is STRUCTURALLY blocked (AC17 catch-up:
// develop/integration frozen at a stale commit while master has un-migrated commits) — "dispatchable
// visible, landable invisible" (the heartbeat-vs-consciousness instance: the criterion has no basis
// yet still answers). This axis adds landing VISIBILITY: develop behind master ≥ threshold AND the
// merge target (integration) frozen ⇒ reported explicitly, never "has candidates = healthy". AC1
// beyond criterion_met · AC2 the AC17 catch-up scenario observable · AC3 complements
// gap-ready-pool-check-counts-merged (whose notYetFlipped is the "merged-but-not-flipped" heartbeat) ·
// AC4 negative control (normal landing never false-reports). Pure decision (computeLandingBlocked) +
// git-backed (detectLandingBlocked, fail-safe on missing refs).

test("computeLandingBlocked: develop behind master + frozen integration ⇒ landing-blocked (AC2)", () => {
  const stalenessMs = LANDING_STALENESS_MS_DEFAULT;
  const r = computeLandingBlocked({
    developBehindMaster: 62, // the AC17 scenario's un-migrated master commits
    integrationStalenessMs: stalenessMs + 5_000, // frozen beyond the window
    now: 1_000_000,
    stalenessMs,
    behindThreshold: LANDING_BEHIND_THRESHOLD_DEFAULT,
  });
  assert.equal(r.landing_blocked, true, "AC2: catch-up incomplete ⇒ landing-blocked reported");
  assert.match(r.reason, /landing-blocked/);
  assert.match(r.reason, /62 commit/);
  assert.match(r.reason, /catch-up incomplete/);
});

test("computeLandingBlocked: AC4 negative controls — normal landing never false-reports", () => {
  const stalenessMs = LANDING_STALENESS_MS_DEFAULT;
  // develop NOT behind master (master's release role is empty / up-to-date) + stale integration ⇒ NOT blocked.
  assert.equal(
    computeLandingBlocked({ developBehindMaster: 0, integrationStalenessMs: stalenessMs + 1, now: 1_000_000, stalenessMs }).landing_blocked,
    false,
    "develop not behind master ⇒ not blocked",
  );
  // Behind master but integration FRESH (tasks landing on the merge target) ⇒ NOT blocked — landing is
  // not structurally blocked even though catch-up is pending.
  assert.equal(
    computeLandingBlocked({ developBehindMaster: 62, integrationStalenessMs: 60_000, now: 1_000_000, stalenessMs }).landing_blocked,
    false,
    "integration fresh (within window) ⇒ not blocked",
  );
  // Behind below the threshold ⇒ NOT blocked (a single stray master commit is not a catch-up backlog).
  assert.equal(
    computeLandingBlocked({ developBehindMaster: 0, integrationStalenessMs: stalenessMs + 1, now: 1_000_000, stalenessMs, behindThreshold: 1 }).landing_blocked,
    false,
    "below threshold ⇒ not blocked",
  );
  // integrationStalenessMs null (no integration ref — single-line downstream) ⇒ NOT blocked (fail-safe).
  assert.equal(
    computeLandingBlocked({ developBehindMaster: 62, integrationStalenessMs: null, now: 1_000_000, stalenessMs }).landing_blocked,
    false,
    "null staleness (no integration ref) ⇒ not blocked (fail-safe)",
  );
});

test("detectLandingBlocked is fail-safe on a non-git root (no false report, no throw)", (t) => {
  const root = makeWorkspace("lb-nongit");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const r = detectLandingBlocked(root);
  assert.deepEqual(r, { landing_blocked: false, reason: null });
});

// Real-git AC17 catch-up scenario: master advances with un-migrated commits while develop/integration
// stay frozen at the base ⇒ analyzeTasks reports landing_blocked even while criterion_met is True (the
// "dispatchable visible, landable invisible" shape the task is about).

test("analyzeTasks: AC17 catch-up — criterion_met True AND landing_blocked True reported explicitly (AC1/AC2)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-lb-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "master", "-q", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  fs.writeFileSync(path.join(root, ".gitkeep"), "base\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  const baseEpochSec = Number(git("log", "-1", "--format=%ct"));
  git("checkout", "-q", "-b", "develop");
  git("checkout", "-q", "-b", "integration");
  git("checkout", "-q", "master");
  // master advances with un-migrated commits (the AC17 catch-up backlog) — develop/integration frozen.
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(path.join(root, `m${i}.txt`), `m${i}\n`);
    git("add", ".");
    git("commit", "-q", "-m", `master commit ${i}`);
  }
  // Three pairwise-disjoint ready tasks ⇒ dispatchable_disjoint ≥ cap ⇒ criterion_met True (the
  // "dispatchable visible" half) — yet landing is structurally blocked.
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/a.ts"] }) });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/b.ts"] }) });
  writeTask(root, "gap-r3", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/c.ts"] }) });

  const r = analyzeTasks({
    tasksDir: path.join(root, "tasks"),
    root,
    cap: 3,
    floorMult: 1, // floor 3 — pool 3 ≥ floor, no promotion noise
    now: baseEpochSec * 1000 + 3 * 60 * 60 * 1000, // 3h after base — integration frozen past the 2h window
    landingStalenessMs: LANDING_STALENESS_MS_DEFAULT, // 2h
    landingBehindThreshold: LANDING_BEHIND_THRESHOLD_DEFAULT,
  });
  assert.equal(r.criterion_met, true, "dispatchable candidates exist (the old visibility)");
  assert.equal(r.landing_blocked, true, "AC2: catch-up incomplete ⇒ landing-blocked reported");
  assert.match(r.report, /landing-blocked/);
  assert.match(r.landing_blocked_reason, /3 commit/);
});

test("analyzeTasks: AC4 negative — normal landing (integration advancing) ⇒ no landing-blocked false report", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-lbn-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "master", "-q", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  fs.writeFileSync(path.join(root, ".gitkeep"), "base\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  const baseEpochSec = Number(git("log", "-1", "--format=%ct"));
  git("checkout", "-q", "-b", "develop");
  git("checkout", "-q", "-b", "integration");
  git("checkout", "-q", "master");
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(path.join(root, `m${i}.txt`), `m${i}\n`);
    git("add", ".");
    git("commit", "-q", "-m", `master commit ${i}`);
  }
  // integration keeps advancing — a task lands on it (normal landing, NOT structurally blocked).
  git("checkout", "-q", "integration");
  fs.writeFileSync(path.join(root, "task.txt"), "task\n");
  git("add", ".");
  git("commit", "-q", "-m", "Merge branch 'task/gap-r1'");
  const intEpochSec = Number(git("log", "-1", "--format=%ct"));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/a.ts"] }) });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/b.ts"] }) });
  writeTask(root, "gap-r3", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/c.ts"] }) });

  const r = analyzeTasks({
    tasksDir: path.join(root, "tasks"),
    root,
    cap: 3,
    floorMult: 1,
    now: intEpochSec * 1000 + 30 * 60 * 1000, // 30 min after the last integration commit — NOT frozen
    landingStalenessMs: LANDING_STALENESS_MS_DEFAULT, // 2h window
    landingBehindThreshold: LANDING_BEHIND_THRESHOLD_DEFAULT,
  });
  assert.equal(r.criterion_met, true, "dispatch still healthy");
  assert.equal(r.landing_blocked, false, "AC4: normal landing (integration fresh) ⇒ no false report");
  assert.doesNotMatch(r.report, /landing-blocked/);
});

test("CLI Contract measure surface: blocked stdout carries the 'landing-blocked' literal (measure)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-lbc-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "master", "-q", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  fs.writeFileSync(path.join(root, ".gitkeep"), "base\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  git("checkout", "-q", "-b", "develop");
  git("checkout", "-q", "-b", "integration");
  git("checkout", "-q", "master");
  fs.writeFileSync(path.join(root, "m.txt"), "m\n");
  git("add", ".");
  git("commit", "-q", "-m", "master commit");
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/a.ts"] }) });
  const script = path.resolve(__dirname, "..", "scripts", "ready-pool-check.ts");
  // A 1ms staleness window makes the just-made base commit "frozen" deterministically (no --now on the CLI).
  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", script, "--root", root, "--landing-staleness-ms", "1", "--landing-behind-threshold", "1"],
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(out);
  assert.equal(parsed.landing_blocked, true, "CLI reports landing_blocked in the JSON");
  assert.match(out, /landing-blocked/, "Contract measure: stdout carries the 'landing-blocked' literal (grep surface)");
});

// ── HEARTBEAT MODE (gap-ready-pool-promotion-same-class-as-slot-refill) ───────────────────────────
// The tick heartbeat must UNCONDITIONALLY run ready-pool-check and — when pool < floor AND
// promotions non-empty — land the promotion ON DISK (status todo → ready), no volition. Same root
// cause as slot-refill-only-triggered-on-completion-not-tick-heartbeat (a detector answers, nothing
// mechanically guarantees it is asked). AC1 applies; AC3 is the negative control (pool ≥ floor OR
// promotions empty ⇒ zero writes); the default (no --apply) stays a pure detector.

test("--apply heartbeat: pool < floor + eligible todo ⇒ promotion lands on disk (AC1)", (t) => {
  const root = makeWorkspace("apply-ac1");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-candidate", gapTask("gap-candidate")); // eligible: four-artifacts + deps + touches-resolve

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 }; // floor 3, pool 2
  const before = analyzeTasks(opts);
  assert.equal(before.pool, 2);
  assert.equal(before.deficit, 1);
  assert.equal(before.promotions.length, 1);

  const r = applyPromotions(opts);
  assert.equal(r.should_apply, true, "AC1: pool<floor + promotions non-empty ⇒ should_apply");
  assert.equal(r.applied_promotions.length, 1);
  assert.equal(r.applied_promotions[0].id, "gap-candidate");
  assert.equal(r.applied_promotions[0].ok, true);

  // The status actually landed on disk.
  const task = parseTask(fs.readFileSync(path.join(root, "tasks", "gap-candidate.md"), "utf8"));
  assert.match(task.frontmatterRaw, /^status:\s*ready$/m, "frontmatter status must be ready on disk");

  // Re-analyze: the pool has recovered to floor (candidate now ready) — AC4 "恢复 pool 到 floor".
  const after = analyzeTasks(opts);
  assert.equal(after.pool, 3, "pool recovered to floor after mechanical promotion (AC4)");
});

test("--apply: pool >= floor with qualified candidate ⇒ apply lands it (AC48 — pool<floor gate retired)", (t) => {
  const root = makeWorkspace("apply-pos-pool");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r3", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-candidate", gapTask("gap-candidate")); // eligible todo — pre-AC48 this was the no-busy-work case

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 }; // floor 3, pool 3
  const r = applyPromotions(opts);
  assert.equal(r.deficit, 0, "pool at floor");
  assert.equal(r.should_apply, true, "AC48: qualified candidate promotes even at pool ≥ floor (合格即晋)");
  assert.equal(r.applied_promotions.length, 1, "one promotion applied");
  assert.equal(r.applied_promotions[0].id, "gap-candidate");
  const task = parseTask(fs.readFileSync(path.join(root, "tasks", "gap-candidate.md"), "utf8"));
  assert.match(task.frontmatterRaw, /^status:\s*ready$/m, "candidate promoted to ready — pool size no longer gates");
});

test("--apply heartbeat negative control: promotions empty ⇒ zero writes (AC3)", (t) => {
  const root = makeWorkspace("apply-neg-empty");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  // Candidate ineligible: missing DoD (four-artifacts incomplete) ⇒ never in `promotions`.
  writeTask(root, "gap-no-dod", gapTask("gap-no-dod", { body: fourArtifactBody().replace("## Definition of Done", "## Resolution") }));

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 }; // pool 2 < floor 3, deficit 1
  const r = applyPromotions(opts);
  assert.equal(r.deficit, 1, "pool below floor");
  assert.equal(r.promotions.length, 0, "no qualified candidate");
  assert.equal(r.should_apply, false, "AC3: promotions empty ⇒ no apply");
  assert.deepEqual(r.applied_promotions, []);
  const task = parseTask(fs.readFileSync(path.join(root, "tasks", "gap-no-dod.md"), "utf8"));
  assert.match(task.frontmatterRaw, /^status:\s*todo$/m, "ineligible candidate must remain todo");
});

// ── COMMIT-AFTER-WRITE (gap-apply-promotions-commit-status-writes) ────────────────────────────────
// A todo→ready status write must be committed IMMEDIATELY — a status write left uncommitted leaves the
// main checkout dirty, and fan-in-ff-merge.sh treats any dirty tree as exit 2 (blocking every fan-in).
// AC1 (能取假): a promoted task leaves `git status --porcelain` clean — the commit is the fix; without
// it the tree would be dirty. Production root is the main checkout (a git repo); unit-test fixtures are
// repo-less, where the commit is a no-op (committed=false) and the write still lands.

test("applyPromotions commits the status write — git status clean + committed record (AC1)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-commit-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "master", "-q", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  // Two ready tasks + one eligible todo, all committed as a clean baseline.
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-candidate", gapTask("gap-candidate"));
  git("add", ".");
  git("commit", "-q", "-m", "init");
  assert.equal(git("status", "--porcelain"), "", "baseline must be clean before promotion");

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 };
  const r = applyPromotions(opts);
  assert.equal(r.should_apply, true);
  assert.equal(r.applied_promotions.length, 1);
  assert.equal(r.applied_promotions[0].id, "gap-candidate");
  assert.equal(r.applied_promotions[0].committed, true, "a landed promotion in a git repo must commit");

  // AC1 (能取假): the main checkout is immediately clean — the commit is what cleared the status write.
  assert.equal(git("status", "--porcelain"), "", "AC1: after promotion the tree is clean (dirty ⇒ the commit did not land)");
  const subject = git("log", "-1", "--format=%s");
  assert.equal(subject, "tasks: gap-candidate todo→ready（promotion-driver 机械晋升）", "the commit subject names the task and transition");
});

// ── DETACH PROPAGATION (gap-fan-in-ff-ref-update-detach-develop AC6) ─────────────────────────
// The main checkout sits on a doc-only work branch (main/manager-doc) while develop is bare (the
// detach). A promotion flip committed on the doc branch must reach develop — fast-forward push —
// so task worktrees branching from develop see the new status (otherwise dispatch reads ready on the
// doc branch while the worktree base still has the old status). Non-ff (develop advanced independently)
// ⇒ merge develop first, then push.

test("propagateDocBranchToDevelop: doc-branch flip fast-forwards to develop (AC6)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `propagate-ff-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q", "-b", "develop", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeTask(root, "gap-base", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  git("add", ".");
  git("commit", "-q", "-m", "init");
  // The detach: the main checkout moves to a doc-only branch; develop is no longer checked out anywhere.
  git("checkout", "-q", "-b", "main/manager-doc");
  const developBefore = git("rev-parse", "develop");
  // A flip lands on the doc branch (what commitTaskStatus commits before propagate).
  writeTask(root, "gap-flip", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  git("add", ".");
  git("commit", "-q", "-m", "tasks: gap-flip todo→ready（promotion-driver 机械晋升）");
  assert.notEqual(git("rev-parse", "main/manager-doc"), developBefore, "doc branch advanced past develop");

  propagateDocBranchToDevelop(root);

  assert.equal(git("rev-parse", "develop"), git("rev-parse", "main/manager-doc"),
    "AC6: develop fast-forwarded to the doc branch head — the flip is visible to task worktrees");
});

test("propagateDocBranchToDevelop: develop advanced independently ⇒ merge then push (non-ff reconcile)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `propagate-nonff-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q", "-b", "develop", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeTask(root, "gap-base", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  git("add", ".");
  git("commit", "-q", "-m", "init");
  git("checkout", "-q", "-b", "main/manager-doc");
  // Doc branch commits a flip (its own file).
  writeTask(root, "gap-flip", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  git("add", ".");
  git("commit", "-q", "-m", "flip on doc branch");
  // Develop advances independently (a different file) — the two branches diverge.
  git("checkout", "-q", "develop");
  writeTask(root, "gap-land", { status: "done", labels: ["gap"], body: fourArtifactBody() });
  git("add", ".");
  git("commit", "-q", "-m", "land on develop");
  const developHead = git("rev-parse", "develop");
  git("checkout", "-q", "main/manager-doc");

  propagateDocBranchToDevelop(root);

  assert.notEqual(git("rev-parse", "develop"), developHead, "develop advanced (reconcile merge landed)");
  assert.equal(git("status", "--porcelain"), "", "reconcile merge left the doc branch clean");
  assert.match(git("show", "develop:tasks/gap-flip.md"), /^status: ready$/m,
    "the doc-branch flip is visible on develop after reconcile");
});

test("applyPromotions in a repo-less root still lands the write (committed=false, no throw)", (t) => {
  const root = makeWorkspace("apply-nogit");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-candidate", gapTask("gap-candidate"));

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 };
  const r = applyPromotions(opts);
  assert.equal(r.should_apply, true);
  assert.equal(r.applied_promotions[0].committed, false, "repo-less root ⇒ the commit is a no-op, surfaced as committed=false");
  const task = parseTask(fs.readFileSync(path.join(root, "tasks", "gap-candidate.md"), "utf8"));
  assert.match(task.frontmatterRaw, /^status:\s*ready$/m, "the status write still lands on disk");
});

// ── MULTI-PATH TOUCHES GUARD (gap-promotion-driver-commit-bypasses-precommit-touches-guard) ──────────
// The promotion commit path runs `git commit --no-verify`, so the pre-commit hook's Touches detector
// never fires there (production: e7be44a0 landed a `serve-handlers.ts + serve.ts` bullet). The guard
// re-runs the SAME judgment BEFORE the status write — a multi-path candidate must NOT be promoted
// (stays todo, tree stays clean, reason surfaced), the negative control against the silent bypass.

test("applyPromotions blocks a multi-path Touches candidate — no commit, stays todo, reason surfaced (AC1)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-multipath-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "master", "-q", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  // An ELIGIBLE candidate whose ## Touches carries a multi-path bullet (the e7be44a0 shape: "a.ts + b.ts").
  writeTask(root, "gap-multi", gapTask("gap-multi", { touches: ["- code/a.ts + code/b.ts"] }));
  git("add", ".");
  git("commit", "-q", "-m", "init");
  assert.equal(git("status", "--porcelain"), "", "baseline clean before promotion");

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 };
  const r = applyPromotions(opts);
  assert.equal(r.should_apply, true, "the gate still recommends the candidate (multi-path is not a gate criterion — the commit-path guard must catch it)");
  assert.equal(r.applied_promotions.length, 1);
  assert.equal(r.applied_promotions[0].id, "gap-multi");
  assert.equal(r.applied_promotions[0].ok, false, "AC1: the multi-path bullet is blocked at promotion, not silently landed");
  assert.equal(r.applied_promotions[0].reason, "touches-multi-path-bullet");
  assert.equal(r.applied_promotions[0].committed, false, "blocked ⇒ never committed");

  // The status must NOT have flipped — the task stays todo (not promoted into develop).
  const task = parseTask(fs.readFileSync(path.join(root, "tasks", "gap-multi.md"), "utf8"));
  assert.match(task.frontmatterRaw, /^status:\s*todo$/m, "blocked candidate must remain todo on disk");
  assert.equal(git("status", "--porcelain"), "", "AC1: no write, no commit — the tree stays clean (nothing entered develop)");
});

test("setTaskStatus patches frontmatter todo→ready and preserves the body (AC1 mechanism)", (t) => {
  const root = makeWorkspace("sts");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const body = "**type:** execution\n\n## Proposal\nA real proposal paragraph long enough to be counted.\n\n## Plan\nA real plan paragraph long enough to be counted.\n";
  writeTask(root, "gap-a", { status: "todo", labels: ["gap"], body });

  const out = setTaskStatus(root, "gap-a", "ready");
  assert.equal(out.ok, true);
  assert.equal(out.from, "todo");
  assert.equal(out.to, "ready");

  const raw = fs.readFileSync(path.join(root, "tasks", "gap-a.md"), "utf8");
  assert.match(raw, /^status:\s*ready$/m, "status line rewritten");
  assert.ok(raw.includes("## Proposal"), "body preserved");
  assert.match(raw, /^id: gap-a$/m, "other frontmatter preserved");
});

test("setTaskStatus no-ops on non-todo and on missing files (no clobber / idempotent)", (t) => {
  const root = makeWorkspace("sts-neg");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-ready", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-done", { status: "done", labels: ["gap"], body: fourArtifactBody() });

  assert.equal(setTaskStatus(root, "gap-ready", "ready").ok, false, "already ready ⇒ not a todo ⇒ no-op");
  assert.equal(setTaskStatus(root, "gap-done", "ready").ok, false, "done task must not be clobbered");
  assert.equal(setTaskStatus(root, "gap-missing", "ready").ok, false, "missing file ⇒ ok:false");
  assert.equal(setTaskStatus(root, "gap-ready", "ready").reason, "not-todo");

  assert.match(fs.readFileSync(path.join(root, "tasks", "gap-ready.md"), "utf8"), /^status:\s*ready$/m);
  assert.match(fs.readFileSync(path.join(root, "tasks", "gap-done.md"), "utf8"), /^status:\s*done$/m);
});

test("default analyzeTasks never writes tasks/ (pure detector preserved — no --apply = byte-unchanged)", (t) => {
  const root = makeWorkspace("pure");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-candidate", gapTask("gap-candidate"));

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 };
  const before = fs.readFileSync(path.join(root, "tasks", "gap-candidate.md"), "utf8");
  const r = analyzeTasks(opts);
  assert.equal(r.promotions.length, 1, "read mode still recommends the candidate");
  const after = fs.readFileSync(path.join(root, "tasks", "gap-candidate.md"), "utf8");
  assert.equal(after, before, "no writes without --apply");
  assert.equal(Object.hasOwn(r, "should_apply"), false, "read mode has no apply fields");
  assert.equal(Object.hasOwn(r, "applied_promotions"), false);
});

test("CLI --apply smoke: --root/--cap/--floor-mult/--apply lands promotions + emits JSON (exit 0)", (t) => {
  const root = makeWorkspace("apply-cli");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-candidate", gapTask("gap-candidate"));

  const script = path.resolve(__dirname, "..", "scripts", "ready-pool-check.ts");
  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", script, "--root", root, "--cap", "3", "--floor-mult", "1", "--apply"],
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(out);
  assert.equal(parsed.should_apply, true);
  assert.equal(parsed.applied_promotions.length, 1);
  const task = parseTask(fs.readFileSync(path.join(root, "tasks", "gap-candidate.md"), "utf8"));
  assert.match(task.frontmatterRaw, /^status:\s*ready$/m, "CLI --apply lands the promotion on disk");
});

// ── DELIVERY-CRITICAL AT PROMOTE (tasks/gap-delivery-critical-label-at-promote-not-after-dispatch) ─
// The delivery-critical label's effect point is the dispatch-time sort key; it was being applied
// AFTER dispatch (the guard task dispatched 21:21:10, labeled 21:26:17 — 5min7s late), so the task
// entered the ready pool unlabeled and self-excluded from the ranking once in flight. AC1 fix: the
// promote gate DETERMINES delivery-critical at promote (todo→ready) and writes the label together
// with the ready status ("标签与 ready 同现") — so the sort key is in place for the NEXT selection.

test("ensureDeliveryCriticalLabel — adds delivery-critical to a block-list labels field (AC1)", () => {
  const fm = "id: gap-x\ntitle: x\nstatus: todo\nlabels:\n  - gap\n  - defect\nparent: null\n";
  const r = ensureDeliveryCriticalLabel(fm);
  assert.equal(r.deliveryCritical, true);
  assert.equal(r.added, true);
  assert.match(r.fm, /labels:\n  - gap\n  - defect\n  - delivery-critical/);
  assert.match(r.fm, /^parent: null$/m, "next top-level key preserved");
});

test("ensureDeliveryCriticalLabel — adds delivery-critical to a flow-list labels field (AC1)", () => {
  const fm = "id: gap-x\ntitle: x\nstatus: todo\nlabels: [gap, defect]\nparent: null\n";
  const r = ensureDeliveryCriticalLabel(fm);
  assert.equal(r.deliveryCritical, true);
  assert.equal(r.added, true);
  assert.match(r.fm, /labels: \[gap, defect, delivery-critical\]/);
});

test("ensureDeliveryCriticalLabel — appends a labels block when the frontmatter has none (AC1)", () => {
  const fm = "id: gap-x\ntitle: x\nstatus: todo\nparent: null\n";
  const r = ensureDeliveryCriticalLabel(fm);
  assert.equal(r.deliveryCritical, true);
  assert.equal(r.added, true);
  assert.match(r.fm, /labels:\n  - delivery-critical/);
  assert.match(r.fm, /^parent: null$/m, "existing frontmatter preserved");
});

test("ensureDeliveryCriticalLabel — idempotent when delivery-critical is already present (AC1)", () => {
  const fm = "id: gap-x\ntitle: x\nstatus: todo\nlabels:\n  - gap\n  - delivery-critical\nparent: null\n";
  const r = ensureDeliveryCriticalLabel(fm);
  assert.equal(r.deliveryCritical, true);
  assert.equal(r.added, false, "no duplicate item added");
  assert.equal(r.fm, fm, "frontmatter byte-unchanged when the label is already present");
});

test("setTaskStatus with ensureDeliveryCritical writes status AND the delivery-critical label at promote (AC1 — 标签与 ready 同现)", (t) => {
  const root = makeWorkspace("sts-dc");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const body = "**type:** execution\n\n## Proposal\nA real proposal paragraph long enough to be counted.\n\n## Plan\nA real plan paragraph long enough to be counted.\n";
  writeTask(root, "gap-crit", { status: "todo", labels: ["gap"], body });

  const out = setTaskStatus(root, "gap-crit", "ready", { ensureDeliveryCritical: true });
  assert.equal(out.ok, true);
  assert.equal(out.to, "ready");
  assert.equal(out.deliveryCritical, true, "the promote record exposes the determination");

  const raw = fs.readFileSync(path.join(root, "tasks", "gap-crit.md"), "utf8");
  assert.match(raw, /^status:\s*ready$/m, "status flipped to ready");
  assert.match(raw, /^\s+- delivery-critical$/m, "delivery-critical label co-occurs with ready");
  assert.match(raw, /^\s+- gap$/m, "existing label preserved");
});

test("setTaskStatus WITHOUT ensureDeliveryCritical does NOT add the label (AC1 negative control)", (t) => {
  const root = makeWorkspace("sts-dc-neg");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const body = "**type:** execution\n\n## Proposal\nA real proposal paragraph long enough to be counted.\n\n## Plan\nA real plan paragraph long enough to be counted.\n";
  writeTask(root, "gap-plain", { status: "todo", labels: ["gap"], body });

  const out = setTaskStatus(root, "gap-plain", "ready");
  assert.equal(out.ok, true);
  assert.equal(out.deliveryCritical, false, "a non-determined promotion exposes deliveryCritical:false");

  const raw = fs.readFileSync(path.join(root, "tasks", "gap-plain.md"), "utf8");
  assert.match(raw, /^status:\s*ready$/m, "status flipped to ready");
  assert.doesNotMatch(raw, /delivery-critical/, "no label was invented for a non-delivery-critical task");
});

test("applyPromotions: a delivery-critical todo enters ready WITH its label (AC1 — label co-occurs with ready)", (t) => {
  const root = makeWorkspace("apply-dc");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-crit", gapTask("gap-crit", { labels: ["gap", "delivery-critical"] }));

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 }; // floor 3, pool 2
  const r = applyPromotions(opts);
  assert.equal(r.should_apply, true);
  assert.equal(r.applied_promotions.length, 1);
  assert.equal(r.applied_promotions[0].id, "gap-crit");
  assert.equal(r.applied_promotions[0].deliveryCritical, true, "the applied record exposes the delivery-critical determination");

  const task = parseTask(fs.readFileSync(path.join(root, "tasks", "gap-crit.md"), "utf8"));
  assert.match(task.frontmatterRaw, /^status:\s*ready$/m, "status landed on disk");
  assert.ok(task.labels.includes("delivery-critical"), "the label is in the frontmatter at ready-entry (标签与 ready 同现)");
});

test("applyPromotions: a non-delivery-critical candidate is promoted WITHOUT the label (AC1 negative control)", (t) => {
  const root = makeWorkspace("apply-dc-neg");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-plain", gapTask("gap-plain"));

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 }; // floor 3, pool 2
  const r = applyPromotions(opts);
  assert.equal(r.applied_promotions.length, 1);
  assert.equal(r.applied_promotions[0].deliveryCritical, false, "no determination for an unlabeled candidate");

  const task = parseTask(fs.readFileSync(path.join(root, "tasks", "gap-plain.md"), "utf8"));
  assert.match(task.frontmatterRaw, /^status:\s*ready$/m);
  assert.ok(!task.labels.includes("delivery-critical"), "no label invented — negative control");
});

// ── Suite-blocking signal (tasks/gap-ready-relevance-blind-to-suite-blocking-signal) ────────────────
// AC2: computeRelevance reads the consecutive-red window (verification-round.jsonl ≥ N consecutive
//   red rounds) + the failure detail (full-suite-state.json failures[] / per-round failures) mapped
//   onto a task's declared ## Touches ⇒ blocking dynamically true / blocking_suite true / value +
//   SUITE_BLOCKING_WEIGHT. AC3: a suite-blocking task ranks FIRST in ready_relevance (and slot-refill
//   recommended — asserted in slot-refill.test.mjs). AC4 negative control: no red window / no failure
//   hit ⇒ ordering byte-identical. AC5: the obligation shape is recorded in the obligation ledger in
//   mechanically-checkable JSONL form.

/** AC84 (gap-ac84-suite-source-starvation-reader-disposition AC2): analyzeTasks's suite-blocking now
 *  reads per-task-suite-records.jsonl — the ONLY ongoing suite source after AC84 (verification-round
 *  is NO LONGER a throttling input; full-suite-state.json has no writer). This helper writes the
 *  per-task-suite-record shape (taskId/runId/state/laneCount/failedFiles/fullSuiteRan), converting the
 *  round-shaped fixture rows ({round,state,reason,fail,failures}) into it. Every fixture row is a REAL
 *  full-suite result (fullSuiteRan:true) — a green row breaks the window, a red row counts. */
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

test("consecutiveRedRounds / isRedRound / collectFailureFiles window detection (AC2)", () => {
  // canonical red rounds (state:red, reason:failed) + an aborted round in the middle — the abort is
  // STILL red (the suite is not green), so it does not break the consecutive window.
  const rounds = [
    { round: 192, state: "red", reason: "failed", fail: 1, failures: [{ file: "code/wd.ts", line: "x" }] },
    { round: 193, state: "red", reason: "failed", fail: 1, failures: [{ file: "code/wd.ts", line: "x" }] },
    { round: 194, state: "red", reason: "aborted", fail: 0 },
    { round: 195, state: "red", reason: "failed", fail: 1, failures: [{ file: "code/wd.ts", line: "x" }] },
    { round: 196, state: "red", reason: "failed", fail: 1, failures: [{ file: "code/wd.ts", line: "x" }] },
  ];
  assert.equal(isRedRound(rounds[0]), true, "canonical red ⇒ red");
  assert.equal(isRedRound(rounds[2]), true, "aborted is still red (suite not green)");
  assert.equal(isRedRound({ state: "green", fail: 0 }), false, "green ⇒ not red");
  assert.equal(isRedRound({ state: "green", fail: 0, reason: "failed" }), false, "green with fail 0 stays green");
  assert.equal(isRedRound({ fail: 1 }), true, "legacy row (no state, fail>0) ⇒ red");
  assert.equal(isRedRound({ fail: 0 }), false, "legacy row (no state, fail=0) ⇒ not red");
  assert.equal(consecutiveRedRounds(rounds), 5, "aborted in the middle does not break the red window");
  assert.equal(consecutiveRedRounds([...rounds, { round: 197, state: "green", fail: 0 }]), 0, "green last round resets the window");
  assert.equal(consecutiveRedRounds([]), 0);
  assert.equal(consecutiveRedRounds([{ round: 1, state: "red", reason: "failed" }]), 1);
  assert.deepEqual(collectFailureFiles(rounds, []), ["code/wd.ts"], "per-round failures collected");
  assert.deepEqual(collectFailureFiles(rounds, [{ file: "code/other.ts" }]), ["code/wd.ts", "code/other.ts"], "state failures unioned in");
});

test("AC5 — collectFailureFiles slices to the CURRENT red window, not all history (gap-streaming-red-cascade-amplifies-failures-array: 239 → ~12 negative control)", () => {
  // The pre-fix defect: the Set only grew across ALL red rounds — a task touching ANY historical
  // failing file was blocked ("touched any history", not "touches the current red cause"), tightening
  // monotonically until the pool locked. windowSize = consecutiveRed slices to the current window.
  const rounds = [
    // 200 historical red rounds with an old failure file
    ...Array.from({ length: 200 }, (_, i) => ({ round: 100 + i, state: "red", reason: "failed", failures: [{ file: "code/old.ts" }] })),
    // the current 3-round red window with the CURRENT failure file
    { round: 300, state: "red", reason: "failed", failures: [{ file: "code/current.ts" }] },
    { round: 301, state: "red", reason: "failed", failures: [{ file: "code/current.ts" }] },
    { round: 302, state: "red", reason: "failed", failures: [{ file: "code/current.ts" }] },
  ];
  // no windowSize ⇒ all history (the pre-fix behavior)
  assert.deepEqual(collectFailureFiles(rounds, []), ["code/old.ts", "code/current.ts"], "no window ⇒ all history");
  // windowSize = 3 (the current consecutive-red count) ⇒ only the current window's file
  assert.deepEqual(collectFailureFiles(rounds, [], 3), ["code/current.ts"], "window-sliced ⇒ current red cause only (the 239→~12 negative control)");
  assert.deepEqual(collectFailureFiles(rounds, [], 1), ["code/current.ts"], "a 1-round window still resolves the latest file");
});

test("AC6 — countUnattributedFailures counts no-file entries that collectFailureFiles must drop (30% round-130 drop rate → explicit)", () => {
  // Round 130 shape: 10 failures = 3 real (file) + 4 cascade + 3 no-file. The no-file entries are
  // structurally un-attributable to a task's Touches — but they must be COUNTED, not silently dropped.
  const rounds = [
    { round: 400, state: "red", reason: "failed",
      failures: [
        { file: "plugin/test/checker-cost.test.mjs" },
        { line: "✖ AC2 — ready-pool-check run 3x ... (no file)" },
        { line: "✖ AC1 — while the suite runs ... (no file)" },
      ],
      unattributed: [{ line: "✖ AC1 — while the suite runs ... (no file, mirror)" }],
    },
    { round: 401, state: "red", reason: "failed", failures: [{ file: "plugin/test/checker-cost.test.mjs" }] },
    { round: 402, state: "red", reason: "failed", failures: [{ file: "plugin/test/checker-cost.test.mjs" }] },
  ];
  // no-file in failures[] + unattributed[] segments of the CURRENT 3-round window:
  // round 400 has 2 no-file in failures[] + 1 in unattributed[] = 3 (rounds 401/402 all have files).
  assert.equal(countUnattributedFailures(rounds, [], [], 3), 3, "no-file entries counted (failures[] + unattributed[]), current window only");
  // state-level failures[] + unattributed[] feed the count too. A derived cascade entry (which HAS a
  // file) is NOT a no-file entry and is NOT counted here — it is listed in the state's `derived` field
  // instead (AC1) and excluded from failureFiles by construction.
  assert.equal(countUnattributedFailures(rounds, [{ line: "state no-file" }], [{ line: "state unattributed" }], 3),
    5, "state failures + unattributed no-file entries counted (3 round + 2 state)");
  // no windowSize ⇒ all rounds (backward-compatible behavior).
  assert.equal(countUnattributedFailures(rounds, [], [], undefined), 3);
});

test("AC2 — collectFailureFiles BOUNDS the state union to the current window (gap-full-suite-state-stale-no-writer: a stale state's failures are NOT injected forever)", () => {
  // The state file is a SINGLE-STATE file. When its writer is absent (the detached fan-in suite never
  // went through full-suite-runner.ts) it FREEZES at an old red's failures[] — the pre-fix unbounded
  // union injected those into every later suite-blocking computation with no expiry ("touched a
  // HISTORICAL failing file", not "touches the current red cause"). The fix: merge the state's
  // failures only when the state's own round falls INSIDE the current window (startedAt ≥ the window's
  // oldest round's startedAt).
  const rounds = [
    // the CURRENT 3-round red window (t200..t202) with the CURRENT failure file
    { round: 200, state: "red", reason: "failed", startedAt: "2026-08-18T00:00:00.000Z", failures: [{ file: "code/current.ts" }] },
    { round: 201, state: "red", reason: "failed", startedAt: "2026-08-18T00:05:00.000Z", failures: [{ file: "code/current.ts" }] },
    { round: 202, state: "red", reason: "failed", startedAt: "2026-08-18T00:10:00.000Z", failures: [{ file: "code/current.ts" }] },
  ];
  const staleFailures = [{ file: "code/stale.ts" }];

  // negative control: a STALE state (startedAt older than the whole window) is NOT unioned.
  assert.deepEqual(
    collectFailureFiles(rounds, staleFailures, 3, "2026-08-17T23:00:00.000Z"),
    ["code/current.ts"],
    "stale state (older than the window) is EXCLUDED — its failures are not injected",
  );
  // positive control: a state whose round is INSIDE the window (≥ the oldest round) IS unioned.
  assert.deepEqual(
    collectFailureFiles(rounds, staleFailures, 3, "2026-08-18T00:00:00.000Z"),
    ["code/current.ts", "code/stale.ts"],
    "in-window state (≥ the window's oldest round) IS unioned",
  );
  // backward compat: no stateStartedAt ⇒ unconditional union (the pre-fix behavior for unknown state).
  assert.deepEqual(
    collectFailureFiles(rounds, staleFailures, 3),
    ["code/current.ts", "code/stale.ts"],
    "no state timestamp ⇒ backward-compat unconditional union",
  );
  // no window ⇒ all-history (backward-compat), regardless of stateStartedAt.
  assert.deepEqual(
    collectFailureFiles(rounds, staleFailures, undefined, "2026-08-17T23:00:00.000Z"),
    ["code/current.ts", "code/stale.ts"],
    "no window ⇒ all-history union (stateStartedAt ignored)",
  );
  // the SAME bound on the no-file count (countUnattributedFailures).
  assert.equal(
    countUnattributedFailures(rounds, [{ line: "state no-file" }], [], 3, "2026-08-17T23:00:00.000Z"),
    0,
    "stale state no-file entries are NOT counted either (same defect class, same bound)",
  );
  assert.equal(
    countUnattributedFailures(rounds, [{ line: "state no-file" }], [], 3, "2026-08-18T00:00:00.000Z"),
    1,
    "in-window state no-file entries ARE counted",
  );
});

test("computeSuiteBlocking: red window + Touches hit ⇒ task flagged; negative controls (AC2/AC4)", () => {
  const tasks = new Map([
    ["gap-watchdog", { status: "ready", body: "## Touches\n- code/wd.ts" }],
    ["gap-plain", { status: "ready", body: "## Touches\n- code/plain.ts" }],
    ["gap-done-wd", { status: "done", body: "## Touches\n- code/wd.ts" }], // landed work — never re-prioritized
  ]);
  const expand = (globs) => new Set(globs); // concrete declared paths resolve to themselves

  const redRounds = Array.from({ length: 3 }, (_, i) => ({ round: 200 + i, state: "red", reason: "failed", failures: [{ file: "code/wd.ts" }] }));
  const r = computeSuiteBlocking({ rounds: redRounds, stateFailures: [], tasks, expand });
  assert.equal(r.consecutiveRed, 3);
  assert.equal(r.windowActive, true);
  assert.ok(r.ids.has("gap-watchdog"), "failure file hits the watchdog task's Touches ⇒ flagged");
  assert.ok(!r.ids.has("gap-plain"), "unrelated task not flagged");
  assert.ok(!r.ids.has("gap-done-wd"), "a done task (work already landed) is never suite-blocking");

  // negative: only 2 consecutive red rounds (below the default min 3) ⇒ nothing flagged.
  const short = computeSuiteBlocking({ rounds: redRounds.slice(0, 2), stateFailures: [], tasks, expand });
  assert.equal(short.windowActive, false);
  assert.equal(short.ids.size, 0, "below-min window ⇒ no suite-blocking");

  // negative: 3 red rounds but the failure points at an untouched file ⇒ nothing flagged.
  const unrelated = computeSuiteBlocking({
    rounds: Array.from({ length: 3 }, () => ({ state: "red", reason: "failed", failures: [{ file: "code/unrelated.ts" }] })),
    stateFailures: [],
    tasks,
    expand,
  });
  assert.equal(unrelated.windowActive, true);
  assert.equal(unrelated.ids.size, 0, "failure file hits nobody's Touches ⇒ nothing flagged");

  // negative: 3 red rounds but NO failure detail anywhere ⇒ window active, no attribution.
  const noFail = computeSuiteBlocking({ rounds: Array.from({ length: 3 }, () => ({ state: "red", reason: "failed" })), stateFailures: [], tasks, expand });
  assert.equal(noFail.windowActive, true);
  assert.equal(noFail.ids.size, 0);

  // negative: last round green resets the window ⇒ nothing flagged.
  const green = computeSuiteBlocking({ rounds: [...redRounds, { round: 203, state: "green" }], stateFailures: [], tasks, expand });
  assert.equal(green.windowActive, false);
  assert.equal(green.ids.size, 0);
});

test("computeSuiteBlocking: round-record failures attribute cross-round + bare-basename shape normalized (AC3 — gap-suite-round-record-missing-failures-field)", () => {
  const tasks = new Map([
    ["gap-script", { status: "ready", body: "## Touches\n- plugin/scripts/send-keys-verified.sh" }],
    ["gap-other", { status: "ready", body: "## Touches\n- plugin/scripts/unrelated.ts" }],
  ]);
  const expand = (globs) => new Set(globs); // concrete declared paths resolve to themselves

  // round-210 carries a BARE BASENAME (`send-keys-verified.sh`), round-212 a REPO-RELATIVE path —
  // the exact shape inconsistency the task notes. BOTH must attribute the same full-path touch.
  const mixedRounds = [
    { round: 210, state: "red", reason: "failed", failures: [{ file: "send-keys-verified.sh" }] },
    { round: 211, state: "red", reason: "failed", failures: [{ file: "send-keys-verified.sh" }] },
    { round: 212, state: "red", reason: "failed", failures: [{ file: "plugin/scripts/send-keys-verified.sh" }] },
  ];
  const r = computeSuiteBlocking({ rounds: mixedRounds, stateFailures: [], tasks, expand });
  assert.equal(r.consecutiveRed, 3);
  assert.equal(r.windowActive, true);
  assert.ok(r.ids.has("gap-script"), "bare-basename failure file attributes to the full-path touch (round-210 form normalized)");
  assert.ok(!r.ids.has("gap-other"), "unrelated task not flagged");

  // Two FULL repo-relative paths sharing only a basename must NOT over-attribute (a/foo.ts vs b/foo.ts).
  const dirTasks = new Map([
    ["gap-a", { status: "ready", body: "## Touches\n- a/foo.ts" }],
    ["gap-b", { status: "ready", body: "## Touches\n- b/foo.ts" }],
  ]);
  const fullPathRounds = Array.from({ length: 3 }, () => ({ state: "red", reason: "failed", failures: [{ file: "a/foo.ts" }] }));
  const r2 = computeSuiteBlocking({ rounds: fullPathRounds, stateFailures: [], tasks: dirTasks, expand });
  assert.ok(r2.ids.has("gap-a"), "exact full-path match attributes");
  assert.ok(!r2.ids.has("gap-b"), "same basename in a different directory does NOT over-attribute a full-path failure");

  // Cross-round attribution: the failure detail lives ONLY in an OLD round (round-208); the two
  // LATER rounds carry no failures. The red window must still attribute via the old round's record
  // (the task's whole point — historical rounds attributable, not just the current state file).
  const crossRound = [
    { round: 208, state: "red", reason: "failed", failures: [{ file: "plugin/scripts/send-keys-verified.sh" }] },
    { round: 209, state: "red", reason: "failed" },
    { round: 210, state: "red", reason: "failed" },
  ];
  const r3 = computeSuiteBlocking({ rounds: crossRound, stateFailures: [], tasks, expand });
  assert.equal(r3.consecutiveRed, 3);
  assert.ok(r3.ids.has("gap-script"), "an old round's recorded failure attributes across the red window (round-record reverse-lookup)");
});

test("exemptFromSuiteBlocking / isSuiteFixTask: suite-fix marker + failure-hit AND-gate (AC2/AC3 reverse control)", () => {
  const suiteFixTask = {
    id: "gap-install-family-tests",
    frontmatterRaw: "id: gap-install-family-tests\ntitle: install family flake rotate under full-suite\nstatus: ready",
    body: "## Proposal\nfix the install-family suite flake — this task IS the suite fix.\n## Touches\n- plugin/test/install-family.test.mjs",
  };
  const serialInstall = {
    id: "gap-serial-phase-install-test-residue",
    frontmatterRaw: "id: gap-serial-phase-install-test-residue\ntitle: serial phase install test residue dependency\nstatus: ready",
    body: "## Proposal\nserial phase install residue — fix the ordering dependency.\n## Touches\n- plugin/test/serial-install.test.mjs",
  };
  // unrelated: no marker anywhere (id/title/Proposal) — a "fixture" title must NOT read as fix-intent,
  // and a Proposal that merely MENTIONS the suite (no fix-intent co-occurrence) must NOT exempt either
  // (the AC3 over-exemption case the end-to-end demo caught).
  const unrelated = {
    id: "gap-watchdog",
    frontmatterRaw: "id: gap-watchdog\ntitle: fixture gap-watchdog\nstatus: ready",
    body: "## Proposal\nwatch the dispatch pool and report health — nothing to do with the suite.\n## Touches\n- plugin/scripts/ready-pool-check.ts",
  };

  // AC2: the suite-fix family self-identifies (id + title carry install/suite).
  assert.equal(isSuiteFixTask(suiteFixTask, "gap-install-family-tests"), true, "gap-install-family id/title marker ⇒ suite-fix task");
  assert.equal(isSuiteFixTask(serialInstall, "gap-serial-phase-install-test-residue"), true, "gap-serial-phase-install id marker ⇒ suite-fix task");
  // AC3 reverse control: the unrelated task (no marker — "fixture" is NOT fix-intent) is NOT suite-fix.
  assert.equal(isSuiteFixTask(unrelated, "gap-watchdog"), false, "unrelated task carries no marker (fixture ≠ fix)");

  // The exemption is a TWO-condition AND: marker AND failure-hit. Both must hold.
  assert.equal(exemptFromSuiteBlocking(suiteFixTask, "gap-install-family-tests", true), true, "suite-fix task + real failure-hit ⇒ exempt (dispatchable)");
  assert.equal(exemptFromSuiteBlocking(serialInstall, "gap-serial-phase-install-test-residue", true), true, "serial-phase-install + failure-hit ⇒ exempt");
  assert.equal(exemptFromSuiteBlocking(unrelated, "gap-watchdog", true), false, "unrelated task + failure-hit ⇒ NOT exempt (stays blocked)");
  assert.equal(exemptFromSuiteBlocking(suiteFixTask, "gap-install-family-tests", false), false, "marker alone (no failure-hit) never exempts — not the one fixing THIS red");
});

test("computeSuiteBlocking: controlled-experiment round (laneCount ≠ default) excluded from consecutive-red (AC2/AC3 — gap-suite-blocking-experiment-rounds-count-toward-consecutive-red)", () => {
  // r268 was a one-off CONTROLLED EXPERIMENT (lane-8 comparison, --lane-count 8 vs the nproc-derived
  // default 4): its red is an experiment finding, not a regression — it must not push the consecutive-
  // red window. Mechanically identifiable: laneCount ≠ defaultLane. The `defaultLane` fixture default
  // (4) is hermetic — host-nproc independent; the experiment lane 8 is the r268 shape.
  const defaultLane = 4;
  const expLane = 8;
  const tasks = new Map([
    ["gap-wd", { status: "ready", body: "## Touches\n- code/wd.ts" }],
  ]);
  const expand = (globs) => new Set(globs);

  // isExperimentRound predicate: only an EXPLICIT non-default laneCount marks an experiment round.
  assert.equal(isExperimentRound({ state: "red", laneCount: expLane }, defaultLane), true, "laneCount ≠ default ⇒ experiment round");
  assert.equal(isExperimentRound({ state: "red", laneCount: defaultLane }, defaultLane), false, "laneCount === default ⇒ real round");
  assert.equal(isExperimentRound({ state: "red" }, defaultLane), false, "no laneCount (legacy row) ⇒ NOT an experiment round — keeps counting");

  // AC2: [experiment red, real red, real red] ⇒ consecutive_red = 2 (the experiment round does not
  // count) and the window (min 3) does NOT activate — the r268 lane-8 probe no longer pushes it to
  // activation (the r268+r269+r270 ⇒ 3-window self-lock case becomes r269+r270 ⇒ 2).
  const mixed = computeSuiteBlocking({
    rounds: [
      { round: 268, state: "red", reason: "failed", laneCount: expLane, failures: [{ file: "code/exp.ts" }] },
      { round: 269, state: "red", reason: "failed", laneCount: defaultLane, failures: [{ file: "code/wd.ts" }] },
      { round: 270, state: "red", reason: "failed", laneCount: defaultLane, failures: [{ file: "code/wd.ts" }] },
    ],
    stateFailures: [],
    tasks,
    expand,
    minRedWindow: 3,
    defaultLane,
  });
  assert.equal(mixed.consecutiveRed, 2, "[exp, real, real] ⇒ consecutive_red = 2 (experiment round excluded from the count)");
  assert.equal(mixed.windowActive, false, "2 < min 3 ⇒ window NOT active (the r268 case: self-lock released)");

  // AC3 negative-control shape: [real ×3] (all default lane) still counts 3 and activates the window.
  const real3 = computeSuiteBlocking({
    rounds: Array.from({ length: 3 }, (_, i) => ({ round: 271 + i, state: "red", reason: "failed", laneCount: defaultLane, failures: [{ file: "code/wd.ts" }] })),
    stateFailures: [],
    tasks,
    expand,
    minRedWindow: 3,
    defaultLane,
  });
  assert.equal(real3.consecutiveRed, 3, "[real ×3] ⇒ 3 (default-lane real reds still accumulate)");
  assert.equal(real3.windowActive, true);
  assert.ok(real3.ids.has("gap-wd"), "a real-red window still attributes the failure to the Touches-hitting task");

  // "skip" semantics pinned: an experiment round in the MIDDLE of real reds is transparent — it
  // neither counts nor breaks the window (the same rounds with a genuine green would reset to 0).
  const middle = computeSuiteBlocking({
    rounds: [
      { round: 275, state: "red", reason: "failed", laneCount: defaultLane, failures: [{ file: "code/wd.ts" }] },
      { round: 276, state: "red", reason: "failed", laneCount: expLane, failures: [{ file: "code/exp.ts" }] },
      { round: 277, state: "red", reason: "failed", laneCount: defaultLane, failures: [{ file: "code/wd.ts" }] },
    ],
    stateFailures: [],
    tasks,
    expand,
    minRedWindow: 3,
    defaultLane,
  });
  assert.equal(middle.consecutiveRed, 2, "experiment round in the middle is transparent (neither counts nor breaks)");
});

test("AC1 — deriveDefaultLane: the reference default is the runner's ACTUAL normal lane (mode of recorded laneCounts), not the checker's env (gap-ac84-suite-source-starvation-reader-disposition)", () => {
  // The defect: the checker's env derived defaultLaneCount()=8 while the runner ACTUALLY recorded
  // laneCount=16 (QUAY_MAX_OVERSUBSCRIPTION=2 at runner time vs 1 at checker time) ⇒ every normal
  // round looked like an experiment ⇒ consecutiveRed 恒 0. The fix derives the reference from the
  // records themselves — the MODE laneCount is what the runner used for its typical rounds.
  assert.equal(deriveDefaultLane([], 8), 8, "no records ⇒ fallback (the env-derived default)");
  assert.equal(deriveDefaultLane([{ state: "red", laneCount: 16 }, { state: "red", laneCount: 16 }, { state: "red", laneCount: 8 }], 8), 16,
    "mode of recorded laneCounts (16 appears twice) ⇒ 16 — the runner's actual normal lane");
  assert.equal(deriveDefaultLane([{ state: "red", laneCount: 8 }], 8), 8, "single lane ⇒ itself");
  // A doc-only SKIP (fullSuiteRan === false, laneCount ~1) is NOT a lane observation — no full suite ran.
  assert.equal(deriveDefaultLane([{ state: "green", laneCount: 16 }, { state: "green", laneCount: 16 }, { state: "green", laneCount: 1, fullSuiteRan: false }], 8), 16,
    "skip records do not pollute the mode");
  assert.equal(deriveDefaultLane([{ state: "green", fullSuiteRan: false }, { state: "green", fullSuiteRan: false }], 8), 8,
    "only skips ⇒ fallback");
  // A record with NO laneCount (legacy verification-round row) contributes nothing.
  assert.equal(deriveDefaultLane([{ state: "red" }, { state: "red", laneCount: 16 }], 8), 16, "legacy no-laneCount row contributes nothing");
});

test("AC1 — computeSuiteBlocking without explicit defaultLane derives the runner's actual lane (16): consecutiveRed is NON-ZERO and the window CAN activate; forced env default (8) keeps it 恒 0 (gap-ac84-suite-source-starvation-reader-disposition)", () => {
  // The real-repo shape: the runner records laneCount=16 for its normal rounds; the phantom tail is
  // 5 consecutive red rounds (rounds 208-212). With the checker's env-derived default (8) every normal
  // round was an experiment ⇒ consecutiveRed 0 / window_active false (structural failure since round
  // 24). After the fix (no explicit defaultLane ⇒ derive mode=16) the red tail counts.
  const tasks = new Map([
    ["gap-wd", { status: "ready", body: "## Touches\n- code/wd.ts" }],
  ]);
  const expand = (globs) => new Set(globs);
  const rounds = Array.from({ length: 5 }, (_, i) => ({ round: 208 + i, state: "red", reason: "failed", laneCount: 16, failures: [{ file: "code/wd.ts" }] }));

  // FIXED: no explicit defaultLane ⇒ derive the runner's actual normal lane (16) from the records.
  const fixed = computeSuiteBlocking({ rounds, stateFailures: [], tasks, expand, minRedWindow: 3 });
  assert.equal(fixed.consecutiveRed, 5, "AC1: default aligned to the runner's actual lane ⇒ consecutiveRed non-zero (the red tail counts)");
  assert.equal(fixed.windowActive, true, "AC1: window_active CAN become true");
  assert.deepEqual(fixed.ids.has("gap-wd") ? [...fixed.ids] : [], ["gap-wd"], "the red window attributes the failure to the Touches-hitting task");

  // DEFECT CONTROL: the OLD behavior — the checker's env default (8) forced explicitly — still
  // misclassifies every lane-16 round as an experiment ⇒ consecutiveRed 恒 0 / window inactive.
  const defect = computeSuiteBlocking({ rounds, stateFailures: [], tasks, expand, minRedWindow: 3, defaultLane: 8 });
  assert.equal(defect.consecutiveRed, 0, "control: forced env default (8) ⇒ consecutiveRed 0 — the pre-fix 恒 0 shape");
  assert.equal(defect.windowActive, false, "control: window stays inactive under the wrong default");
});

test("AC2 — per-task-suite-record red window: failedFiles attribute, green full-suite breaks, doc-only skip is NEUTRAL (gap-ac84-suite-source-starvation-reader-disposition)", () => {
  const tasks = new Map([
    ["gap-wd", { status: "ready", body: "## Touches\n- code/wd.ts" }],
  ]);
  const expand = (globs) => new Set(globs);
  // A per-task red record carries failedFiles (array of file strings), NOT the verification-round
  // `failures` ({file}) shape — collectFailureFiles must normalize BOTH.
  const red = computeSuiteBlocking({
    rounds: [
      { taskId: "t1", runId: "r1", state: "red", laneCount: 16, failedFiles: ["code/wd.ts"], fullSuiteRan: true },
      { taskId: "t2", runId: "r2", state: "red", laneCount: 16, failedFiles: ["code/wd.ts"], fullSuiteRan: true },
      { taskId: "t3", runId: "r3", state: "red", laneCount: 16, failedFiles: ["code/wd.ts"], fullSuiteRan: true },
    ],
    stateFailures: [],
    tasks,
    expand,
    minRedWindow: 3,
  });
  assert.equal(red.consecutiveRed, 3, "per-task red records count (failedFiles normalized)");
  assert.equal(red.windowActive, true);
  assert.deepEqual(red.failureFiles, ["code/wd.ts"], "failedFiles feed the failure-file set");
  assert.deepEqual(red.ids.has("gap-wd") ? [...red.ids] : [], ["gap-wd"], "per-task red window attributes via failedFiles");

  // A doc-only SKIP (fullSuiteRan === false — no full suite ran) is NEUTRAL: it must NOT break a red
  // window (a green skip says nothing about the suite), and must NOT add a red.
  const skip = computeSuiteBlocking({
    rounds: [
      { taskId: "t1", runId: "r1", state: "red", laneCount: 16, failedFiles: ["code/wd.ts"], fullSuiteRan: true },
      { taskId: "t2", runId: "r2", state: "red", laneCount: 16, failedFiles: ["code/wd.ts"], fullSuiteRan: true },
      { taskId: "t3", runId: "r3", state: "green", laneCount: 1, failedFiles: [], fullSuiteRan: false, skipReason: "doc-only-delta" },
    ],
    stateFailures: [],
    tasks,
    expand,
    minRedWindow: 3,
  });
  assert.equal(skip.consecutiveRed, 2, "a trailing doc-only skip neither counts nor breaks the red window (still 2 red)");
  assert.equal(skip.windowActive, false, "2 < min 3 ⇒ window stays inactive");

  // A GREEN full-suite record (fullSuiteRan:true) DOES break the window.
  const green = computeSuiteBlocking({
    rounds: [
      { taskId: "t1", runId: "r1", state: "red", laneCount: 16, failedFiles: ["code/wd.ts"], fullSuiteRan: true },
      { taskId: "t2", runId: "r2", state: "green", laneCount: 16, failedFiles: [], fullSuiteRan: true },
    ],
    stateFailures: [],
    tasks,
    expand,
    minRedWindow: 3,
  });
  assert.equal(green.consecutiveRed, 0, "a green full-suite record breaks the window");
  assert.equal(green.windowActive, false);
});

test("AC2 — consecutiveRedRounds on CONTROLLED per-task-suite records (fixture, not real ledger): all-green ⇒ 0; doc-only neutral; green breaks (gap-ready-pool-canary-test-isolation)", () => {
  // gap-ready-pool-canary-test-isolation: the previous version read the REAL shared ledger
  // (.quay/per-task-suite-records.jsonl) and hard-asserted consecutiveRed === 0 — a production-state
  // canary that breaks whenever the ledger contains INTERMEDIATE red records (a fan-in's first attempt
  // red, later green landing). The real ledger legitimately accumulates those, so the assertion was
  // stale (test-isolation defect — a test reading shared mutable production state). This fixture-based
  // version verifies the LOGIC with controlled inputs; the logic (AC84 design) keeps doc-only skips
  // NEUTRAL — an intermediate red stays red until a full-suite green breaks the window.
  const rec = (o) => ({ fullSuiteRan: true, laneCount: 16, state: "green", failedFiles: [], ...o });
  // All-green full-suite records ⇒ consecutiveRed 0.
  assert.equal(
    consecutiveRedRounds([rec({}), rec({}), rec({})]),
    0,
    "all-green full-suite records ⇒ no red window",
  );
  // A trailing red full-suite record counts.
  assert.equal(
    consecutiveRedRounds([rec({}), rec({ state: "red", failedFiles: ["x.ts"] })]),
    1,
    "trailing red full-suite ⇒ consecutiveRed 1",
  );
  // doc-only skip (fullSuiteRan:false) is NEUTRAL — neither counts nor breaks (AC84).
  assert.equal(
    consecutiveRedRounds([
      { taskId: "t1", fullSuiteRan: true, state: "red", failedFiles: ["x.ts"] },
      { taskId: "t2", fullSuiteRan: false, state: "green", failedFiles: [] }, // doc-only green — neutral
    ]),
    1,
    "doc-only green does NOT break the red window (AC84 neutral)",
  );
  // A full-suite GREEN DOES break the window.
  assert.equal(
    consecutiveRedRounds([
      rec({ state: "red", failedFiles: ["x.ts"] }),
      rec({}),
    ]),
    0,
    "full-suite green breaks the red window",
  );
  // Empty records ⇒ 0.
  assert.equal(consecutiveRedRounds([]), 0, "empty records ⇒ 0");
});

test("isDirectoryGlob: bare dir / dir/** / no-slash dir are directory globs; concrete files + file wildcards are not (AC2 — gap-suite-blocking-directory-glob-overbroad)", () => {
  // The crystallization Touches entry `plugin/test/（各 AC 测试）` is a bare trailing-slash directory.
  assert.equal(isDirectoryGlob("plugin/test/"), true, "trailing-slash bare directory");
  assert.equal(isDirectoryGlob("plugin/test/**"), true, "explicit dir/** form (what parseTouches turns plugin/test/ into)");
  assert.equal(isDirectoryGlob("plugin/test"), true, "no-slash bare directory token");
  assert.equal(isDirectoryGlob("plugin/**"), true, "whole-directory glob");
  assert.equal(isDirectoryGlob("**"), true, "all-files wildcard is directory-like (non-attributable)");
  assert.equal(isDirectoryGlob("code/wd.ts"), false, "concrete file");
  assert.equal(isDirectoryGlob("plugin/test/checker-cost.test.mjs"), false, "concrete file under a directory");
  assert.equal(isDirectoryGlob("plugin/test/*.test.mjs"), false, "file-scoped wildcard");
  assert.equal(isDirectoryGlob("send-keys-verified.sh"), false, "bare basename file");
});

test("computeSuiteBlocking: directory glob does NOT attribute; concrete failing filename still does (AC2/AC3 — gap-suite-blocking-directory-glob-overbroad)", () => {
  const tasks = new Map([
    // The crystallization shape: Touches carry concrete script files AND a `plugin/test/` directory
    // glob (各 AC 测试). A failure under plugin/test/ must NOT be attributed via the dir glob.
    ["gap-crystal-dir", { status: "ready", body: "## Touches\n- plugin/test/\n- plugin/scripts/capability-catalog.sh" }],
    // A task whose Touches name the CONCRETE failing file must still be attributed.
    ["gap-real-blocker", { status: "ready", body: "## Touches\n- plugin/test/checker-cost.test.mjs" }],
    // A task whose Touches name a FILE-SCOPED wildcard over the failing file must still be attributed.
    ["gap-wildcard", { status: "ready", body: "## Touches\n- plugin/test/*.test.mjs" }],
  ]);
  // A test expander mirroring the prod expandDeclaredTouches for the globs under test: concrete
  // paths resolve to themselves, file-scoped wildcards expand to the concrete file, and a dir glob
  // WOULD expand to the file — but computeSuiteBlocking must never let the dir glob reach expand.
  const expand = (globs) => {
    const set = new Set();
    for (const g of globs) {
      if (g === "plugin/test/*.test.mjs") set.add("plugin/test/checker-cost.test.mjs");
      else if (g === "plugin/test/**") set.add("plugin/test/checker-cost.test.mjs");
      else set.add(g);
    }
    return set;
  };

  const redRounds = Array.from({ length: 3 }, (_, i) => ({ round: 290 + i, state: "red", reason: "failed", failures: [{ file: "plugin/test/checker-cost.test.mjs" }] }));
  const r = computeSuiteBlocking({ rounds: redRounds, stateFailures: [], tasks, expand });
  assert.equal(r.windowActive, true);
  assert.ok(!r.ids.has("gap-crystal-dir"), "AC2: a directory glob (plugin/test/) does NOT attribute a failure under that directory");
  assert.ok(r.ids.has("gap-real-blocker"), "AC3: a task whose Touches name the concrete failing file is still a suite-blocker");
  assert.ok(r.ids.has("gap-wildcard"), "AC3: a file-scoped wildcard that covers the failing file still attributes");

  // The SAME task attributed when the failure hits one of its CONCRETE touches (only the dir glob is
  // inert — the concrete script touches still participate).
  const concreteHit = computeSuiteBlocking({
    rounds: Array.from({ length: 3 }, (_, i) => ({ round: 293 + i, state: "red", reason: "failed", failures: [{ file: "plugin/scripts/capability-catalog.sh" }] })),
    stateFailures: [],
    tasks,
    expand,
  });
  assert.ok(concreteHit.ids.has("gap-crystal-dir"), "a concrete touch of the same task still attributes when hit");
});

test("computeRelevance: suite-blocking flips blocking true + boosts value (AC2/AC3 unit)", () => {
  const empty = new Map();
  // without the signal: plain 1-touch task values at costBenefit 1, blocking false.
  const before = computeRelevance("gap-watchdog", { body: "plain\n## Touches\n- code/wd.ts" }, empty, empty);
  assert.equal(before.blocking, false);
  assert.equal(before.blocking_suite, false);
  assert.equal(before.value, 1);
  // with the signal: blocking flips, blocking_suite true, value = 2 (blocking) + 2 (suite) + 1 (cost) = 5.
  const after = computeRelevance("gap-watchdog", { body: "plain\n## Touches\n- code/wd.ts" }, empty, empty, new Set(["gap-watchdog"]));
  assert.equal(after.blocking, true, "suite-blocking flips the blocking axis true");
  assert.equal(after.blocking_suite, true);
  assert.equal(after.value, BLOCKING_WEIGHT + SUITE_BLOCKING_WEIGHT + 1);
  assert.match(after.reason, /suite-blocking Y/);
  // a different task in the set does not affect this one (id-scoped).
  const other = computeRelevance("gap-watchdog", { body: "plain\n## Touches\n- code/wd.ts" }, empty, empty, new Set(["gap-someone-else"]));
  assert.equal(other.blocking_suite, false);
  assert.equal(other.value, 1);
});

test("analyzeTasks: suite-blocking jumps ready_relevance; negative control unchanged (AC2/AC3/AC4)", (t) => {
  const root = makeWorkspace("suiteblock");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-plain-ready", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/plain.ts (new)"] }) });
  writeTask(root, "gap-watchdog", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/wd.ts (new)"] }) });

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 };

  // AC4 negative control FIRST: no verification-round / state file ⇒ no signal ⇒ ordering unchanged.
  // Both tasks are plain 1-touch ready tasks (value 1); alphabetical id tie-break puts gap-plain-ready
  // first.
  const before = analyzeTasks(opts);
  assert.equal(before.suite_blocking.window_active, false);
  assert.deepEqual(before.suite_blocking.tasks, []);
  assert.deepEqual(
    before.ready_relevance.map((e) => e.id),
    ["gap-plain-ready", "gap-watchdog"],
    "no red window ⇒ pre-signal ordering (id tie-break)",
  );
  for (const e of before.ready_relevance) assert.equal(e.blocking_suite, false);

  // AC2/AC3: a 3-consecutive-red window whose failures hit the watchdog task's Touches.
  writeRounds(root, Array.from({ length: 3 }, (_, i) => ({ round: 210 + i, state: "red", reason: "failed", fail: 1, failures: [{ file: "code/wd.ts", line: "x" }] })));
  const after = analyzeTasks(opts);
  assert.equal(after.suite_blocking.window_active, true);
  assert.equal(after.suite_blocking.consecutive_red, 3);
  assert.deepEqual(after.suite_blocking.failure_files, ["code/wd.ts"]);
  assert.deepEqual(after.suite_blocking.tasks, ["gap-watchdog"], "only the Touches-hitting task is suite-blocking");
  const watchdog = after.ready_relevance.find((e) => e.id === "gap-watchdog");
  assert.equal(watchdog.blocking, true, "suite-blocking flips blocking true in ready_relevance");
  assert.equal(watchdog.blocking_suite, true);
  assert.equal(watchdog.value, BLOCKING_WEIGHT + SUITE_BLOCKING_WEIGHT + 1);
  assert.equal(after.ready_relevance[0].id, "gap-watchdog", "suite-blocker jumps to the front of the ready pool ranking");
  assert.equal(after.ready_relevance.find((e) => e.id === "gap-plain-ready").blocking_suite, false, "unrelated task stays unflagged");

  // negative: last round green clears the window ⇒ ordering back to the pre-signal tie-break.
  writeRounds(root, [
    ...Array.from({ length: 3 }, () => ({ state: "red", reason: "failed", fail: 1, failures: [{ file: "code/wd.ts" }] })),
    { round: 213, state: "green", fail: 0 },
  ]);
  const green = analyzeTasks(opts);
  assert.equal(green.suite_blocking.window_active, false);
  assert.deepEqual(green.ready_relevance.map((e) => e.id), ["gap-plain-ready", "gap-watchdog"], "green round clears the window ⇒ no re-rank");
});

test("analyzeTasks: suite red ⇒ suite-fix family dispatchable, unrelated task still blocked (AC2/AC3 — gap-suite-blocking-self-lock-blocks-fix-family)", (t) => {
  const root = makeWorkspace("suitelock");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The suite-fix family — ids carry install/suite markers (the self-lock victims from the task's
  // empirical record: gap-install-family + gap-serial-phase-install were among the 22 blocked).
  writeTask(root, "gap-install-family-tests-rotate-flakes-under-full-suite", {
    status: "ready", labels: ["gap"],
    body: fourArtifactBody({ touches: ["- plugin/test/install-family.test.mjs (fix)"] }),
  });
  writeTask(root, "gap-serial-phase-install-test-residue-dependency", {
    status: "ready", labels: ["gap"],
    body: fourArtifactBody({ touches: ["- plugin/test/serial-install.test.mjs (fix)"] }),
  });
  // Unrelated task touching a failing suite file — no suite-fix marker — must stay blocked (AC3).
  writeTask(root, "gap-watchdog-unrelated", {
    status: "ready", labels: ["gap"],
    body: fourArtifactBody({ touches: ["- plugin/test/install-family.test.mjs"] }),
  });

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 };

  // 3 consecutive red rounds whose failure hits the suite infra file the fix-family touches.
  writeRounds(root, Array.from({ length: 3 }, (_, i) => ({ round: 220 + i, state: "red", reason: "failed", fail: 1, failures: [{ file: "plugin/test/install-family.test.mjs", line: "x" }] })));
  const r = analyzeTasks(opts);
  assert.equal(r.suite_blocking.window_active, true);
  assert.equal(r.suite_blocking.consecutive_red, 3);
  assert.ok(!r.suite_blocking.tasks.includes("gap-install-family-tests-rotate-flakes-under-full-suite"),
    "AC2: gap-install-family (suite-fix) stays dispatchable under the red window — self-lock broken");
  assert.ok(!r.suite_blocking.tasks.includes("gap-serial-phase-install-test-residue-dependency"),
    "AC2: gap-serial-phase-install (suite-fix) stays dispatchable");
  assert.ok(r.suite_blocking.tasks.includes("gap-watchdog-unrelated"),
    "AC3 reverse control: unrelated task touching the failing suite file is still blocked");
  // The exemption must NOT make the window vanish — the failing file is still reported.
  assert.deepEqual(r.suite_blocking.failure_files, ["plugin/test/install-family.test.mjs"]);
});

test("analyzeTasks: dir-glob Touches task is NOT suite-blocking in a red window; concrete-file task is (AC4 negative control — gap-suite-blocking-directory-glob-overbroad)", (t) => {
  const root = makeWorkspace("glob-neg");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The crystallization shape: Touches carry a concrete script AND the `plugin/test/` directory glob.
  writeTask(root, "gap-crystal-dir", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- plugin/test/", "- plugin/scripts/capability-catalog.sh"] }) });
  // A task whose Touches name the CONCRETE failing file under that directory.
  writeTask(root, "gap-real-blocker", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- plugin/test/checker-cost.test.mjs"] }) });
  // The directory must EXIST with the failing file on disk — otherwise the dir glob expands to an
  // empty set and the test cannot distinguish the fixed (dir glob filtered) from the buggy (dir glob
  // attributed) behavior. This mirrors the real repo where plugin/test/ is a real directory.
  fs.mkdirSync(path.join(root, "plugin", "test"), { recursive: true });
  fs.writeFileSync(path.join(root, "plugin", "test", "checker-cost.test.mjs"), "// fixture\n");
  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 };

  // 3 consecutive red rounds whose ONLY failing file is under plugin/test/ — the real-repo shape
  // where the crystallization task used to be a false suite-blocker.
  writeRounds(root, Array.from({ length: 3 }, (_, i) => ({ round: 320 + i, state: "red", reason: "failed", fail: 1, failures: [{ file: "plugin/test/checker-cost.test.mjs", line: "x" }] })));
  const r = analyzeTasks(opts);
  assert.equal(r.suite_blocking.window_active, true);
  assert.deepEqual(r.suite_blocking.tasks, ["gap-real-blocker"], "only the concrete-file task is suite-blocking — the dir-glob task is NOT (AC4 negative control)");
  const crystal = r.ready_relevance.find((e) => e.id === "gap-crystal-dir");
  assert.equal(crystal.blocking_suite, false, "the dir-glob task's blocking_suite stays false in a red window");
});

test("AC5: suite-blocking obligation recorded mechanically in the obligation ledger (JSONL)", (t) => {
  // The ledger is at <repoRoot>/orchestration/manager-obligation-ledger.jsonl — the AC5 deliverable:
  // the "suite-blocker can't get prioritized" obligation is now MECHANICALLY derivable (ready-pool-
  // check's blocking_suite field), recorded as a machine-readable JSONL row (not prose).
  const repoRoot = path.resolve(__dirname, "..", "..");
  const ledger = path.join(repoRoot, "orchestration", "manager-obligation-ledger.jsonl");
  assert.ok(fs.existsSync(ledger), "obligation ledger exists");
  const rows = fs.readFileSync(ledger, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const suite = rows.find((r) =>
    /SUITE-BLOCK|SUITE_BLOCK|BLOCKING.*SUITE|OB-BLOCKING-DEFECT-NOT-PRIORITIZED/i.test(String(r.id)) ||
    /blocking_suite/.test(String(r.reading || "") + String(r.note || "")) ||
    /suite.*阻塞|阻塞.*suite|连续红窗/i.test(String(r.reading || "") + String(r.note || "")));
  assert.ok(suite, "a suite-blocking obligation row exists in the ledger");
  for (const key of ["tick", "id", "condition", "reading", "note"]) {
    assert.ok(suite[key] !== undefined && suite[key] !== null && suite[key] !== "", `obligation row carries \`${key}\``);
  }
});

// ── PROSE-PREREQUISITE GAP (gap-prerequisite-gates-prose-invisible-to-mechanisms) ──────────────────
// A prerequisite written ONLY as prose (a `[[task-id]]` wikilink inside a "Do not dispatch until …
// lands / 前置" paragraph) is invisible to every mechanism path that reads relation edges
// (parent/children/depends_on). The detector makes it FAIL-CLOSED: a ready task with a prose prereq
// that has NO relation edge is excluded from the dispatchable pool, and a todo candidate with the
// same shape is ineligible for author→ready promotion.

const PREREQ_BODY = (prereqIds, { withEdge = false } = {}) => {
  const lines = [
    "**type:** execution",
    "## Proposal",
    "A real proposal paragraph that is definitely more than forty non-whitespace chars in total length.",
    `**Do not dispatch until all of these have landed**: ${prereqIds.map((p) => `[[${p}]]`).join(", ")}.`,
    "## Contract",
    "measure   ready_pool = `node plugin/scripts/ready-pool-check.ts` stdout 的 pool 字段",
    "band      ready_pool = true",
    "invoke    `node plugin/scripts/ready-pool-check.ts`",
    "control   ok",
    "resume    前置任务全 done 后才 dispatch",
    "## Acceptance Criteria",
    "- [ ] an AC item that is long enough to count as a real acceptance criterion box",
    "## Definition of Done",
    "standard DoD — the five clauses; meta-enforcer fixture-pinned, definitely long enough content.",
  ];
  return lines.join("\n");
};

test("ready task with prose prereq and NO relation edge ⇒ excluded from the pool (prose-prereq-no-edge)", (t) => {
  const root = makeWorkspace("prereq-ready");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The referenced prereq task exists (so the wikilink resolves) but has NO relation edge to the target.
  writeTask(root, "gap-prereq-a", { status: "done", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-no-edge", {
    status: "ready",
    labels: ["gap"],
    body: PREREQ_BODY(["gap-prereq-a"]),
  });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  const ex = r.excluded.find((e) => e.id === "gap-no-edge");
  assert.ok(ex, "prose-prereq-no-edge ready task must be in the excluded list");
  assert.ok(ex.reasons.some((s) => s.includes("前置")), `exclusion reason must carry the 前置 literal, got: ${ex.reasons.join(";")}`);
  assert.equal(r.ready.includes("gap-no-edge"), false, "the task must NOT be in the dispatchable ready pool");
});

test("prose prereq that IS a relation edge (depends_on) ⇒ NOT excluded; depsReady checks depends_on", (t) => {
  const root = makeWorkspace("prereq-edge");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-prereq-a", { status: "done", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-prereq-b", { status: "todo", labels: ["gap"], body: fourArtifactBody() });
  // The prose prereq is ALSO expressed as a depends_on edge (done) ⇒ no gap, stays dispatchable.
  writeTask(root, "gap-edged-ready", {
    status: "ready",
    labels: ["gap"],
    parent: null,
    children: [],
    body: PREREQ_BODY(["gap-prereq-a", "gap-prereq-b"]),
  });
  // Add depends_on AFTER writeTask by patching the file (writeTask has no dependsOn param).
  const file = path.join(root, "tasks", "gap-edged-ready.md");
  const raw = fs.readFileSync(file, "utf8").replace("parent: null", "depends_on:\n  - gap-prereq-a\n  - gap-prereq-b\nparent: null");
  fs.writeFileSync(file, raw);

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  assert.equal(r.ready.includes("gap-edged-ready"), true, "prose prereq ALSO expressed as an edge stays dispatchable");
  assert.equal(r.excluded.some((e) => e.id === "gap-edged-ready"), false);

  // depsReady: gap-prereq-a done + gap-prereq-b todo ⇒ the todo candidate is NOT deps-ready.
  writeTask(root, "gap-child-cand", { status: "todo", labels: ["gap"], parent: null, children: [], body: PREREQ_BODY([]) });
  const file2 = path.join(root, "tasks", "gap-child-cand.md");
  const raw2 = fs.readFileSync(file2, "utf8").replace("parent: null", "depends_on:\n  - gap-prereq-a\n  - gap-prereq-b\nparent: null");
  fs.writeFileSync(file2, raw2);
  const r2 = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  const cand = r2.candidates.find((c) => c.id === "gap-child-cand");
  assert.equal(cand.depsReady, false, "a depends_on entry not done ⇒ deps NOT ready (parent alone no longer the only dep)");
});

test("todo candidate with prose prereq and NO edge ⇒ ineligible for promotion (author→ready fail-closed)", (t) => {
  const root = makeWorkspace("prereq-promo");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-prereq-a", { status: "done", labels: ["gap"], body: fourArtifactBody() });
  // AC1 (gap-ac46-pool-criteria-in-gate): the candidate needs its C8 self-touch so it PASSES the
  // self-touch gate and the prose-prereq gap (not self-touch) becomes the blocking reason.
  writeTask(root, "gap-cand", {
    status: "todo",
    labels: ["gap"],
    parent: null,
    children: [],
    body: withSelfTouch(PREREQ_BODY(["gap-prereq-a"]), "gap-cand"),
  });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1, targetedId: "gap-cand" });
  assert.equal(r.targeted_promotion.eligible, false, "targeted promotion must reject prose-prereq-no-edge");
  assert.deepEqual(r.targeted_promotion.checks.prosePrereqGap, ["gap-prereq-a"], "the gap names the missing edge");
  const cand = r.candidates.find((c) => c.id === "gap-cand");
  assert.equal(cand.eligible, false, "bulk promotion must reject prose-prereq-no-edge");
  assert.deepEqual(cand.prosePrereqGap, ["gap-prereq-a"]);
});

// ── AC46 — pool-layer static criteria into the todo→ready gate + ready↔todo revaluation executor ──
// (tasks/gap-ac46-pool-criteria-in-gate-plus-revaluation-executor)
//   AC1  compound / self-touch / deps / touches-resolve / artifacts gate the todo→ready promotion
//        ITSELF (rejected at the gate with a reason, not deferred after entering the pool).
//   AC2  bidirectional revaluation executor: re-runs the static conditions on the ready pool; decay ⇒
//        ready.back="todo" auto-executes with a grep-able 阻碍原因 + 去向 record.
//   AC3  negative control: a clean pool revaluates to zero; a decayed task is reported explicitly
//        (never a silent stay).
//   AC5  production negative-control samples (real task bodies, 2026-08-13 定向晋升 operation):
//        compound + self-touch must be REJECTED, the three clean tasks ADMITTED.

test("SUPERSEDED_MARKER_RE: bold marker matches; bare word does not (position-based, hard-rule ②)", () => {
  assert.equal(SUPERSEDED_MARKER_RE.test("> **SUPERSEDED / 作废** premise deleted by a human ruling."), true, "bold marker matches");
  assert.equal(SUPERSEDED_MARKER_RE.test("**SUPERSEDED**"), true, "bare bold marker matches");
  assert.equal(SUPERSEDED_MARKER_RE.test("SUPERSEDED"), false, "bare word is NOT a marker");
  assert.equal(SUPERSEDED_MARKER_RE.test("the superseded-capability checker runs in CI"), false, "discussing the category is NOT a marker");
  assert.equal(SUPERSEDED_MARKER_RE.test("some superseded mechanism"), false, "lowercase word in prose is NOT a marker");
});

test("AC46 marker fix: a candidate DISCUSSING superseded is promotable; a candidate CARRYING the marker is not (both directions)", (t) => {
  const root = makeWorkspace("superseded-marker-fix");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "code", "a.ts"), "export const a = 1;\n");
  writeTask(root, "gap-discusses-superseded", gapTask("gap-discusses-superseded", {
    body: fourArtifactBody({
      touches: ["- code/a.ts", "- tasks/gap-discusses-superseded.md"],
      extra: "\nThe superseded-capability checker runs in the full-suite gate. This task is NOT superseded — it is live work.\n",
    }),
  }));
  writeTask(root, "gap-carries-marker", gapTask("gap-carries-marker", {
    body: fourArtifactBody({
      touches: ["- code/a.ts", "- tasks/gap-carries-marker.md"],
      extra: "\n> **SUPERSEDED / 作废** premise deleted by a human ruling.\n",
    }),
  }));
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 1, floorMult: 1 }); // floor 1, pool 0 → scan candidates
  const discusses = r.candidates.find((c) => c.id === "gap-discusses-superseded");
  const carries = r.candidates.find((c) => c.id === "gap-carries-marker");
  assert.ok(discusses, "discuss candidate is scanned");
  assert.equal(discusses.superseded, false, "discussing the word is NOT superseded (before the fix the bare word wrongly blocked it)");
  assert.equal(discusses.eligible, true, "discuss candidate is promotable");
  assert.ok(carries, "marker candidate is scanned");
  assert.equal(carries.superseded, true, "carrying the marker IS superseded");
  assert.equal(carries.eligible, false, "marker candidate is not promotable");
  // The marker candidate is recorded in `intercepted` with the superseded reason (traceable no-promotion).
  assert.ok(r.intercepted.some((i) => i.id === "gap-carries-marker" && i.reason === "superseded"), "superseded intercept recorded");
});

test("AC5 production negative control: the promotion gate rejects compound/self-touch samples and admits the clean three (real task bodies)", () => {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const tasksDir = path.join(repoRoot, "tasks");
  // reject self-touch sample = DIR-001: a REAL direction-recording task ("仅记录方向", no concrete
  // Touches) that structurally lacks its own tasks/DIR-001.md self-touch and is stable — the previous
  // sample (gap-worktree-node-modules-inconsistent-self-verify) was removed because A22's fix-
  // unqualified legitimately ADDED its self-touch (86dacd51); DIR-127 met the same fate (self-touch
  // added when prepared for dispatch, 2026-08-14) → both became false rejects. DIR-001 is a done
  // direction record (A22 never promotes done → can never gain a self-touch). Pick only tasks that
  // can never gain a self-touch (direction records, not execution candidates); verify with
  // buildTargetedPromotion before swapping.
  const rejectIds = ["gap-quay-has-never-self-hosted-its-own-cold-start", "DIR-001"];
  const admitIds = ["gap-spec11-stage2-retest-with-concurrency", "gap-slot-refill-clique-ignores-landed-touches", "gap-landing-target-branch-consistency-check"];
  // Build allTasks from the REAL task files (REAL statuses — a dependency that is done stays done, so
  // the gate's deps check resolves; the negative-control SAMPLES are real, never fabricated).
  const allTasks = new Map();
  for (const f of fs.readdirSync(tasksDir).filter((x) => x.endsWith(".md"))) {
    const id = f.replace(/\.md$/, "");
    const raw = fs.readFileSync(path.join(tasksDir, f), "utf8");
    const task = parseTask(raw);
    task.id = id;
    task.status = (raw.match(/^status:\s*(\S+)/m) || [])[1] || "";
    allTasks.set(id, task);
  }
  for (const id of rejectIds) {
    assert.ok(allTasks.has(id), `reject sample ${id} exists in the real store`);
    const task = { ...allTasks.get(id), status: "todo" }; // the promotion gate evaluates todo→ready
    const tp = buildTargetedPromotion(id, task, repoRoot, allTasks);
    assert.equal(tp.eligible, false, `${id} must be REJECTED by the gate`);
    if (id === "gap-quay-has-never-self-hosted-its-own-cold-start") {
      assert.equal(tp.checks.compound, true, `${id} is role:compound → rejected for compound`);
    } else {
      assert.equal(tp.checks.selfTouchOk, false, `${id} lacks its own self-touch → rejected for self-touch`);
    }
  }
  for (const id of admitIds) {
    assert.ok(allTasks.has(id), `admit sample ${id} exists in the real store`);
    const task = { ...allTasks.get(id), status: "todo" };
    const tp = buildTargetedPromotion(id, task, repoRoot, allTasks);
    assert.equal(tp.eligible, true, `${id} must be ADMITTED by the gate`);
    assert.equal(tp.checks.superseded, false, `${id} is not superseded (marker-fix direction: discussion ≠ marker)`);
    assert.equal(tp.checks.compound, false, `${id} is not compound`);
    assert.equal(tp.checks.selfTouchOk, true, `${id} has its self-touch`);
  }
});

test("AC1: compound and self-touch-missing todo candidates are rejected at the bulk promotion gate (not deferred after ready)", (t) => {
  const root = makeWorkspace("ac1-gate");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "code", "foo.ts"), "export const foo = 1;\n");
  writeTask(root, "gap-compound-candidate", gapTask("gap-compound-candidate", { role: "compound" }));
  // Bypass gapTask's self-touch injection on purpose: this fixture declares a resolving touch but
  // deliberately OMITS tasks/<id>.md — the C8 self-touch-missing case the gate must reject.
  writeTask(root, "gap-self-touch-missing", {
    status: "todo",
    labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/foo.ts"] }),
  });
  writeTask(root, "gap-clean-candidate", gapTask("gap-clean-candidate", {
    body: fourArtifactBody({ touches: ["- code/foo.ts", "- tasks/gap-clean-candidate.md"] }),
  }));
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 1, floorMult: 1 }); // floor 1, pool 0 → scan
  const compound = r.candidates.find((c) => c.id === "gap-compound-candidate");
  const selfTouch = r.candidates.find((c) => c.id === "gap-self-touch-missing");
  const clean = r.candidates.find((c) => c.id === "gap-clean-candidate");
  assert.ok(compound && selfTouch && clean, "all three candidates scanned");
  assert.equal(compound.eligible, false, "compound candidate is not promotable");
  assert.equal(compound.compound, true, "compound candidate carries the compound flag (blocking reason)");
  assert.equal(selfTouch.eligible, false, "self-touch-missing candidate is not promotable");
  assert.equal(selfTouch.selfTouchOk, false, "self-touch-missing candidate carries the selfTouchOk flag (blocking reason)");
  assert.equal(clean.eligible, true, "clean candidate stays promotable");
  // The blocking reasons are recorded in `intercepted` (traceable no-promotion, same discipline as retired).
  assert.ok(r.intercepted.some((i) => i.id === "gap-compound-candidate" && i.reason === "compound-not-dispatchable"), "compound intercept recorded");
  assert.ok(r.intercepted.some((i) => i.id === "gap-self-touch-missing" && i.reason === "self-touch-missing-c8"), "self-touch intercept recorded");
  assert.ok(!r.promotions.some((p) => p.id === "gap-compound-candidate"), "compound candidate never promoted");
  assert.ok(!r.promotions.some((p) => p.id === "gap-self-touch-missing"), "self-touch candidate never promoted");
  assert.ok(r.promotions.some((p) => p.id === "gap-clean-candidate"), "clean candidate is promoted");
});

test("AC2: revaluation detector — a clean ready pool revaluates to zero (negative control, no silent stay)", (t) => {
  const root = makeWorkspace("reval-clean");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "code", "a.ts"), "export const a = 1;\n");
  // Two clean ready tasks (self-touch present + touches resolve + four artifacts).
  writeTask(root, "gap-ready-a", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/a.ts", "- tasks/gap-ready-a.md"] }) });
  writeTask(root, "gap-ready-b", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/a.ts", "- tasks/gap-ready-b.md"] }) });
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.revaluation_count, 0, "clean ready pool ⇒ zero decayed tasks");
  assert.deepEqual(r.revaluation, [], "clean ready pool ⇒ empty revaluation array");
});

test("AC2: revaluation detector — a decayed ready task (superseded marker) is reported with reason + destination todo", (t) => {
  const root = makeWorkspace("reval-decay");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "code", "a.ts"), "export const a = 1;\n");
  writeTask(root, "gap-ready-superseded", { status: "ready", labels: ["gap"], body: "> **SUPERSEDED / 作废** premise deleted.\n\n" + fourArtifactBody({ touches: ["- code/a.ts", "- tasks/gap-ready-superseded.md"] }) });
  writeTask(root, "gap-ready-clean", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/a.ts", "- tasks/gap-ready-clean.md"] }) });
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.revaluation_count, 1, "one decayed ready task");
  const entry = r.revaluation.find((x) => x.id === "gap-ready-superseded");
  assert.ok(entry, "the superseded ready task is in revaluation");
  assert.ok(entry.reasons.includes("superseded"), "reason carries 'superseded'");
  assert.equal(entry.destination, "todo", "destination is the legal ready.back=todo");
  assert.ok(!r.revaluation.some((x) => x.id === "gap-ready-clean"), "the clean ready task is NOT revalued");
});

test("AC2: applyRevaluations writes ready→todo + a grep-able ## Revaluation body record; retreatReadyToTodo is fail-closed", (t) => {
  const root = makeWorkspace("reval-apply");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "code", "a.ts"), "export const a = 1;\n");
  writeTask(root, "gap-ready-decay", { status: "ready", labels: ["gap"], body: "> **SUPERSEDED / 作废** premise deleted.\n\n" + fourArtifactBody({ touches: ["- code/a.ts", "- tasks/gap-ready-decay.md"] }) });
  writeTask(root, "gap-ready-clean", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/a.ts", "- tasks/gap-ready-clean.md"] }) });

  const r = applyRevaluations({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.should_revaluate, true, "decayed tasks present ⇒ should_revaluate");
  assert.equal(r.applied_revaluations.length, 1, "one retreat written");
  const applied = r.applied_revaluations[0];
  assert.equal(applied.id, "gap-ready-decay");
  assert.equal(applied.ok, true);
  assert.equal(applied.from, "ready");
  assert.equal(applied.to, "todo");

  // The retreat is on disk: status flipped AND a ## Revaluation record (grep-able 阻碍原因 + 去向) appended.
  const after = fs.readFileSync(path.join(root, "tasks", "gap-ready-decay.md"), "utf8");
  assert.match(after, /^status:\s*todo\s*$/m, "status flipped ready → todo");
  assert.match(after, /## Revaluation/, "grep-able ## Revaluation record appended");
  assert.match(after, /去向：ready → todo/, "record carries the destination");
  assert.match(after, /阻碍原因：superseded/, "record carries the blocking reason");
  // The clean task is untouched.
  const cleanAfter = fs.readFileSync(path.join(root, "tasks", "gap-ready-clean.md"), "utf8");
  assert.match(cleanAfter, /^status:\s*ready\s*$/m, "clean ready task untouched");

  // retreatReadyToTodo fail-closed: a non-ready task / missing / no-frontmatter never write.
  writeTask(root, "gap-already-todo", { status: "todo", labels: ["gap"], body: fourArtifactBody() });
  const nr = retreatReadyToTodo(root, "gap-already-todo", ["x"]);
  assert.equal(nr.ok, false, "already-todo ⇒ fail closed");
  assert.equal(nr.reason, "not-ready");
  const miss = retreatReadyToTodo(root, "does-not-exist", ["x"]);
  assert.equal(miss.ok, false, "missing ⇒ fail closed");
  fs.writeFileSync(path.join(root, "tasks", "gap-no-fm.md"), "no frontmatter here");
  assert.equal(retreatReadyToTodo(root, "gap-no-fm", ["x"]).ok, false, "no-frontmatter ⇒ fail closed");
});

// ── MERGE-WORKTREE LIVENESS + SURFACE NARROWING (gap-merge-worktree-surface-lacks-liveness-overbroad) ──
// AC2/AC3/AC4: a mid-merge worktree must present a merge conflict surface ONLY while it shows
// direct-quantity liveness (a live process under it, or a commit within INFLIGHT_WORKTREE_STALE_MS)
// AND that surface must be ONLY the unmerged (`UU`) conflict paths — not the former full
// `git diff --name-only HEAD` delta that also listed every cleanly-merged change (a dead 3-file
// conflict read as a 121-file surface and locked out the whole dispatch pool, dispatchable_disjoint
// 0). The pure core (resolveMergeWorktreeSurfaces) is tested with INJECTED isMerge/conflictFiles/
// liveness (hermetic, no /proc/git); the production wiring (computeMergeWorktreeSurfaces) and the
// surface enumerator (unmergedConflictPaths) are tested against a REAL conflicted-merge git worktree.

function makeRealGitRepo(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rpc-git-${tag}-`));
  execFileSync("git", ["init", "-q", "-b", "master"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  return dir;
}

// Commit everything, optionally pinning the author+committer dates (GIT_COMMITTER_DATE is what
// `git log --format=%ct` reads, so pinning it makes a worktree's last-commit-time deterministic).
function gitCommit(dir, message, date) {
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", message], {
    cwd: dir,
    env: date ? { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : process.env,
  });
}

// A real mid-merge worktree: `conflict-a/b/c.md` conflict on BOTH branches (3 unmerged paths),
// `clean.md` changes only on master (merges cleanly, staged — the file the OLD full-delta surface
// listed but the unmerged-only surface must NOT). Returns { dir (main repo), wtPath (mid-merge) }.
function makeConflictedMergeWorktree(tag, date) {
  const dir = makeRealGitRepo(tag);
  fs.writeFileSync(path.join(dir, "conflict-a.md"), "base-a\n");
  fs.writeFileSync(path.join(dir, "conflict-b.md"), "base-b\n");
  fs.writeFileSync(path.join(dir, "conflict-c.md"), "base-c\n");
  fs.writeFileSync(path.join(dir, "clean.md"), "base-clean\n");
  gitCommit(dir, "base", date);
  // ours branch: change the three conflict files, leave clean.md untouched.
  execFileSync("git", ["checkout", "-q", "-b", "ours"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "conflict-a.md"), "ours-a\n");
  fs.writeFileSync(path.join(dir, "conflict-b.md"), "ours-b\n");
  fs.writeFileSync(path.join(dir, "conflict-c.md"), "ours-c\n");
  gitCommit(dir, "ours", date);
  // master (theirs): change the three conflict files AND clean.md.
  execFileSync("git", ["checkout", "-q", "master"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "conflict-a.md"), "theirs-a\n");
  fs.writeFileSync(path.join(dir, "conflict-b.md"), "theirs-b\n");
  fs.writeFileSync(path.join(dir, "conflict-c.md"), "theirs-c\n");
  fs.writeFileSync(path.join(dir, "clean.md"), "theirs-clean\n");
  gitCommit(dir, "theirs", date);
  // Worktree on ours, then merge master → 3 conflicts (a/b/c) + 1 clean merge (clean.md).
  const wtPath = path.join(dir, "..", `${path.basename(dir)}-wt`);
  execFileSync("git", ["worktree", "add", "-q", wtPath, "ours"], { cwd: dir });
  try {
    execFileSync("git", ["merge", "master"], { cwd: wtPath, stdio: ["ignore", "pipe", "pipe"] });
  } catch (_) {
    // A conflicted merge exits non-zero — expected; the worktree is left mid-conflict.
  }
  return { dir, wtPath };
}

test("resolveMergeWorktreeSurfaces: a DEAD mid-merge worktree (zero processes + stale commit) contributes no surface (AC2)", (t) => {
  const dir = makeWorkspace("merge-dead-pure");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const nowMs = 1_000_000_000_000; // arbitrary fixed "now"
  const wt = { path: path.join(dir, "..", "quay-worktrees", "gap-dead"), branch: "refs/heads/task/gap-dead" };
  const out = resolveMergeWorktreeSurfaces([wt], {
    root: dir,
    isMerge: () => true,
    conflictFiles: () => ["code/shared.md"],
    nowMs,
    liveness: () => ({ hasLiveProcess: false, lastCommitMs: nowMs - 2 * INFLIGHT_WORKTREE_STALE_MS }),
  });
  assert.equal(out.length, 0, "zero live processes + commit older than N ⇒ DEAD mid-merge ⇒ no surface");
});

test("resolveMergeWorktreeSurfaces: a LIVE mid-merge worktree (live process) keeps its surface regardless of commit age (AC2)", (t) => {
  const dir = makeWorkspace("merge-live-pure");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const nowMs = 1_000_000_000_000;
  const wt = { path: path.join(dir, "..", "quay-worktrees", "gap-live"), branch: "refs/heads/task/gap-live" };
  const out = resolveMergeWorktreeSurfaces([wt], {
    root: dir,
    isMerge: () => true,
    conflictFiles: () => ["code/shared.md"],
    nowMs,
    liveness: () => ({ hasLiveProcess: true, lastCommitMs: nowMs - 10 * INFLIGHT_WORKTREE_STALE_MS }),
  });
  assert.equal(out.length, 1, "a live process ⇒ surface kept even with a very old commit");
  assert.deepEqual(out[0].files, ["code/shared.md"], "the injected conflict surface is carried through");
});

test("resolveMergeWorktreeSurfaces: a non-merge worktree never contributes a surface (negative control)", (t) => {
  const dir = makeWorkspace("merge-nonmerge");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const wt = { path: path.join(dir, "..", "quay-worktrees", "gap-clean"), branch: "refs/heads/task/gap-clean" };
  const out = resolveMergeWorktreeSurfaces([wt], { root: dir, isMerge: () => false, conflictFiles: () => ["code/shared.md"] });
  assert.equal(out.length, 0, "a worktree with no merge in flight presents no merge surface");
});

test("unmergedConflictPaths: a conflicted merge returns ONLY the unmerged conflict paths, not the cleanly-merged delta (AC3)", (t) => {
  const { dir, wtPath } = makeConflictedMergeWorktree("narrow", new Date().toISOString());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const files = unmergedConflictPaths(wtPath).sort();
  assert.deepEqual(files, ["conflict-a.md", "conflict-b.md", "conflict-c.md"], "surface = the 3 unmerged paths, clean.md excluded");
});

test("computeMergeWorktreeSurfaces: a DEAD mid-merge worktree (stale commit + zero processes) is excluded from the surface (AC2 wiring)", (t) => {
  const { dir } = makeConflictedMergeWorktree("dead-wiring", "2020-01-01T00:00:00Z");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = computeMergeWorktreeSurfaces(dir);
  assert.equal(out.length, 0, "a dead mid-merge worktree must not present a merge surface");
});

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

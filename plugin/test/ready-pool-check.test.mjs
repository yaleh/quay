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
  computeRelevance,
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
  computeSuiteBlocking,
  consecutiveRedRounds,
  collectFailureFiles,
  isRedRound,
  readJsonLines,
  readVerificationRounds,
  readStateFailures,
  SUITE_BLOCKING_WEIGHT,
  RED_WINDOW_MIN_DEFAULT,
} from "../scripts/ready-pool-check.ts";
import { parseTask } from "../scripts/task-schema.ts";
import { taskWorkLanded } from "../scripts/task-status-drift-check.ts";
import { expandDeclaredTouches } from "../scripts/concurrent-batch-scheduler.ts";
import { walkFiles } from "../scripts/touches-orthogonality-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── fixture helpers ───────────────────────────────────────────────────────────────────────────────

function makeWorkspace(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "code"), { recursive: true });
  return dir;
}

function writeTask(root, id, { status = "todo", labels = [], parent = null, children = [], body }) {
  const fm = [
    "---",
    `id: ${id}`,
    `title: fixture ${id}`,
    `status: ${status}`,
    `labels:`,
    ...labels.map((l) => `  - ${l}`),
    `parent: ${parent}`,
    children.length > 0 ? "children:" : "children: []",
    ...children.map((c) => `  - ${c}`),
    "extra:",
    "  schema: v1",
    "---",
  ].join("\n");
  fs.writeFileSync(path.join(root, "tasks", `${id}.md`), `${fm}\n\n${body}`);
}

// A minimal contract-shape body carrying the four artifacts (Proposal / Contract / AC / DoD).
// `checkedAc` marks the first N AC boxes `- [x]` (default 0 — all unchecked, the fan-in merge shape).
function fourArtifactBody({ acBoxes = 4, touches = "", extra = "", checkedAc = 0 } = {}) {
  const acLines = Array.from({ length: acBoxes }, (_, i) =>
    i < checkedAc ? "- [x] an AC item that is long enough" : "- [ ] an AC item that is long enough");
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

function gapTask(id, opts) {
  return { id, status: "todo", labels: ["gap"], body: fourArtifactBody(opts), ...opts };
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
  // A MERGED DONE-FLIP ready task: work landed (Touches file exists on disk) AND ACs near-complete
  // (3/4 — the "verification-window" shape) → not-yet-flipped → not dispatchable.
  fs.writeFileSync(path.join(root, "code", "landed.ts"), "export const landed = 1;\n");
  writeTask(root, "gap-done-flip", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ checkedAc: 3, touches: ["- code/landed.ts (new)"] }),
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
  // DONE-FLIP: work landed AND ACs near-complete (3/4 — the verification-window shape) → excluded.
  writeTask(root, "gap-merged-done-flip", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ checkedAc: 3, touches: ["- code/landed.ts (new)"] }),
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
  // exists) AND ACs near-complete (3/4) → excluded (AC3).
  fs.writeFileSync(path.join(root, "code", "created.ts"), "export const created = 1;\n");
  writeTask(root, "gap-mod-done-flip", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ checkedAc: 3, touches: ["- code/existing.ts", "- code/created.ts (new)"] }),
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
  // merge "merge web-board: …" that modified code/board.ts → git-history fires; ACs near-complete
  // (3/4) → excluded as done-flip.
  writeTask(root, "gap-web-board-needs-an-inconsistency-verdict-it-does-not-have", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ checkedAc: 3, touches: ["- code/board.ts"] }),
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
    body: "## Acceptance Criteria\n- [x] done\n- [x] done\n- [ ] verify window\n## Touches\n- code/landed.ts (new)\n## Definition of Done\nstandard",
  };
  assert.equal(notYetFlipped(doneFlip, root), true, "merged near-complete ready task is a done-flip and must be excluded");

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
    body: "## Acceptance Criteria\n- [x] done\n- [x] done\n- [x] done\n- [ ] verify\n## Touches\n- code/landed.ts (new)\n## Definition of Done\nstandard",
  };
  assert.equal(notYetFlipped(landedDoneFlip, root), true, "landed near-complete (3/4) ready task is a done-flip → still excluded (AC3)");

  // Neither signal fires → stays in the pool.
  const pending = { status: "ready", body: fourArtifactBody({ touches: ["- code/never.ts"] }) };
  assert.equal(notYetFlipped(pending, root), false, "neither signal fires → stays in the pool");
});

// ── stuck-work vs done-flip (gap-ready-pool-worklanded-traps-stuck-work) ──────────────────────────
// The not-yet-flipped exclusion used to treat ANY workLanded task as "done, not yet flipped". But
// workLanded only means "some work landed" — a workLanded task whose ACs are far from complete
// (<50% checked) has REAL remaining implementation (stuck-work) and must stay dispatchable (AC2);
// only a workLanded task that is AC-complete or near-complete (>50% — the "verification-window"
// done-flip shape) is excluded (AC3). The threshold is STRICTLY > 0.5 so a task at exactly 50%
// (gap-session-liveness 4/8) returns to the pool (verification anchor (a)).

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
  // gap-dispatch shape: work landed and 5/6 ACs checked (only the verification window remains).
  writeTask(root, "gap-dispatch", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ acBoxes: 6, checkedAc: 5, touches: ["- code/landed.ts (new)"] }),
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

// ── AC4: negative controls (pool ≥ floor ⇒ no recommendation) ─────────────────────────────────────

test("pool >= floor ⇒ no promotions (even with qualified todo candidates)", (t) => {
  const root = makeWorkspace("neg-pool-full");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const id of ["gap-r1", "gap-r2", "gap-r3"]) {
    writeTask(root, id, { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  }
  // A fully-qualified todo candidate exists, but the pool is healthy.
  writeTask(root, "gap-candidate", gapTask("gap-candidate"));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 }); // floor 3
  assert.equal(r.pool, 3);
  assert.equal(r.floor, 3);
  assert.equal(r.deficit, 0);
  assert.deepEqual(r.promotions, [], "pool ≥ floor must never recommend");
  assert.deepEqual(r.candidates, [], "candidate scan is skipped when the pool is healthy");
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
  writeTask(root, "gap-unresolvable", gapTask("gap-unresolvable", {
    body: fourArtifactBody({ touches: ["- code/missing.ts"] }),
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
// leaves in todo (pool ≥ floor blocks refill) needs a SECOND, floor-INDEPENDENT operation: the
// OUTER picks the target per stage goal and `ready-pool-check --targeted <id>` MECHANICALLY
// validates it + emits the promote command. AC1 mechanical carrier (not a temporary manual op) ·
// AC2 floor-independent (pool ≥ floor still eligible) · AC3 bulk path byte-unchanged · the target's
// identity is the outer's stage-goal choice, never an input the checker reads.

test("--targeted: pool ≥ floor still promotes a mechanically-eligible todo (AC2 floor-independent)", (t) => {
  const root = makeWorkspace("targeted-floor");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Pool ≥ floor: cap 2, floorMult 1 ⇒ floor 2; two ready tasks ⇒ pool 2, deficit 0.
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  // The stage-goal target sits in todo — the bulk refill (deficit 0) would never recommend it.
  writeTask(root, "gap-target", gapTask("gap-target"));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 2, floorMult: 1, targetedId: "gap-target" });
  assert.equal(r.pool, 2);
  assert.equal(r.floor, 2);
  assert.ok(r.pool >= r.floor, "pool is at/above the floor");
  assert.equal(r.deficit, 0);
  assert.deepEqual(r.promotions, [], "bulk refill recommends nothing (pool ≥ floor)");
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

test("--apply heartbeat negative control: pool >= floor ⇒ zero writes (AC3)", (t) => {
  const root = makeWorkspace("apply-neg-pool");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r3", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-candidate", gapTask("gap-candidate")); // an eligible todo that must NOT be touched

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 }; // floor 3, pool 3
  const r = applyPromotions(opts);
  assert.equal(r.deficit, 0, "pool at floor");
  assert.equal(r.should_apply, false, "AC3: pool ≥ floor ⇒ no apply");
  assert.deepEqual(r.applied_promotions, [], "zero writes");
  const task = parseTask(fs.readFileSync(path.join(root, "tasks", "gap-candidate.md"), "utf8"));
  assert.match(task.frontmatterRaw, /^status:\s*todo$/m, "candidate must remain todo — no busy-work");
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

// ── Suite-blocking signal (tasks/gap-ready-relevance-blind-to-suite-blocking-signal) ────────────────
// AC2: computeRelevance reads the consecutive-red window (verification-round.jsonl ≥ N consecutive
//   red rounds) + the failure detail (full-suite-state.json failures[] / per-round failures) mapped
//   onto a task's declared ## Touches ⇒ blocking dynamically true / blocking_suite true / value +
//   SUITE_BLOCKING_WEIGHT. AC3: a suite-blocking task ranks FIRST in ready_relevance (and slot-refill
//   recommended — asserted in slot-refill.test.mjs). AC4 negative control: no red window / no failure
//   hit ⇒ ordering byte-identical. AC5: the obligation shape is recorded in the obligation ledger in
//   mechanically-checkable JSONL form.

function writeRounds(root, rows) {
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "verification-round.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n"));
}

function writeState(root, failures) {
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "full-suite-state.json"), JSON.stringify({ state: "red", reason: "failed", failures }));
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

test("computeSuiteBlocking: bare-directory glob does NOT attribute (AC2 — gap-suite-blocking-directory-glob-overbroad)", (t) => {
  // The reported defect: a task whose Touches include `plugin/test/` (a bare directory glob, the
  // full-width annotation stripped) was being flagged for EVERY failure under plugin/test/ because
  // DIR-106 Fix 3 turns it into `plugin/test/**` → the REAL fs-backed expander walks the whole
  // subtree, and any failure file under it matched. Only globs that pin down specific files may
  // attribute. The expander below is the PRODUCTION one (expandDeclaredTouches over a real walk),
  // so this test FAILS without the AC2 filter (a bare dir would expand to the failing file).
  const root = makeWorkspace("dirglob");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "plugin", "test"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "plugin", "test", "checker-cost.test.mjs"), "");
  fs.writeFileSync(path.join(root, "plugin", "scripts", "ready-pool-check.ts"), "");
  const expand = (globs) => expandDeclaredTouches(globs, root, walkFiles(root));

  const tasks = new Map([
    ["gap-crystallization", { status: "ready", body: "## Touches\n- plugin/test/（各 AC 测试）" }],
    ["gap-spec-file", { status: "ready", body: "## Touches\n- plugin/test/checker-cost.test.mjs" }],
  ]);
  const redRounds = Array.from({ length: 3 }, () => ({
    state: "red",
    reason: "failed",
    failures: [{ file: "plugin/test/checker-cost.test.mjs" }],
  }));
  const r = computeSuiteBlocking({ rounds: redRounds, stateFailures: [], tasks, expand });
  assert.equal(r.windowActive, true);
  assert.ok(!r.ids.has("gap-crystallization"), "bare-directory glob `plugin/test/` does NOT attribute a subtree failure (AC2)");
  assert.ok(r.ids.has("gap-spec-file"), "concrete file glob still attributes the same failure (AC3 non-regression)");

  // A task whose Touches are ONLY the directory glob is never suite-blocking.
  const onlyDir = new Map([
    ["gap-dir-only", { status: "ready", body: "## Touches\n- plugin/test/" }],
  ]);
  const r2 = computeSuiteBlocking({ rounds: redRounds, stateFailures: [], tasks: onlyDir, expand });
  assert.equal(r2.windowActive, true);
  assert.equal(r2.ids.size, 0, "a task declaring only a directory glob is not suite-blocking");

  // Mixed: directory glob + concrete file — the concrete file still attributes (real blocker preserved).
  const mixed = new Map([
    ["gap-mixed", { status: "ready", body: "## Touches\n- plugin/test/\n- plugin/scripts/ready-pool-check.ts" }],
  ]);
  const mixedRounds = Array.from({ length: 3 }, () => ({
    state: "red",
    reason: "failed",
    failures: [{ file: "plugin/scripts/ready-pool-check.ts" }],
  }));
  const r3 = computeSuiteBlocking({ rounds: mixedRounds, stateFailures: [], tasks: mixed, expand });
  assert.ok(r3.ids.has("gap-mixed"), "concrete file touch still attributes even alongside a directory glob (AC3)");
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
  writeState(root, [{ file: "code/wd.ts", line: "x" }]);
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

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
} from "../scripts/ready-pool-check.ts";
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

test("ready pool excludes fixture, PARKED, and not-yet-flipped ready tasks", (t) => {
  const root = makeWorkspace("excl");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-b", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "QENG-DEMO", { status: "ready", labels: ["fixture"], body: fourArtifactBody() });
  writeTask(root, "gap-parked", {
    status: "ready",
    labels: ["gap"],
    body: "> **PARKED (outer ruling, 2026-08-04) — execution suspended.**\n\n" + fourArtifactBody(),
  });
  // A MERGED-but-AC-all-unchecked ready task (the shape the old all-ACs-checked signal missed):
  // 0 ACs checked, but its declared Touches file exists on disk → work landed → not dispatchable.
  fs.writeFileSync(path.join(root, "code", "landed.ts"), "export const landed = 1;\n");
  writeTask(root, "gap-merged-not-flipped", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/landed.ts (new)"] }),
  });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.pool, 2, "pool should be gap-a + gap-b only");
  assert.deepEqual(r.ready.sort(), ["gap-a", "gap-b"]);

  const reasonsById = Object.fromEntries(r.excluded.map((e) => [e.id, e.reasons]));
  assert.deepEqual(reasonsById["QENG-DEMO"], ["fixture"]);
  assert.deepEqual(reasonsById["gap-parked"], ["parked"]);
  assert.ok(reasonsById["gap-merged-not-flipped"].includes("not-yet-flipped"), "merged-but-AC-unchecked ready task excluded");
});

// ── AC5/AC6: the "merged but AC all unchecked" shape the old all-ACs-checked signal missed ──────────
// Regression pin: pool must never count a merged task, and a truly-unstarted ready task stays.

test("pool excludes merged-but-AC-all-unchecked ready tasks and keeps truly-unstarted ones (AC5/AC6)", (t) => {
  const root = makeWorkspace("merged-shape");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The shape the old 11/11 missed: work LANDED (Touches file exists on disk) but ACs all unchecked.
  fs.writeFileSync(path.join(root, "code", "landed.ts"), "export const landed = 1;\n");
  writeTask(root, "gap-merged", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/landed.ts (new)"] }), // 0/4 AC checked
  });
  // A genuinely-unstarted ready task: Touches file does not exist, no resolving symbols → stays.
  writeTask(root, "gap-unstarted", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/does-not-exist.ts"] }),
  });
  writeTask(root, "gap-real", { status: "ready", labels: ["gap"], body: fourArtifactBody() });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.pool, 2, "pool must not count the merged-but-unchecked task");
  assert.deepEqual(r.ready.sort(), ["gap-real", "gap-unstarted"]);
  const reasonsById = Object.fromEntries(r.excluded.map((e) => [e.id, e.reasons]));
  assert.ok(reasonsById["gap-merged"].includes("not-yet-flipped"), "merged-but-unchecked ready task excluded");
  assert.ok(!reasonsById["gap-unstarted"], "truly-unstarted ready task stays in the pool");
});

// ── AC2/AC3/AC4 (gap-ready-pool-check-taskworklanded-overshoot-excludes-existing-file-tasks) ──────
// The taskWorkLanded touch signal overshot: "Touches file exists on master" fired for tasks that
// merely MODIFY an existing file, excluding them from the pool. Fix: only a task-CREATED file
// (`(new)` touch now existing) is landing evidence; an existing-file task is judged by its own
// symbols. AC2 (not-landed existing-file task stays in pool) + AC3 (landed one is excluded).

test("existing-file-modifying tasks: not-landed stays in the pool, landed is excluded (AC2/AC3)", (t) => {
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
  // LANDED: an existing-file task whose work HAS landed via a task-created file ((new) exists).
  fs.writeFileSync(path.join(root, "code", "created.ts"), "export const created = 1;\n");
  writeTask(root, "gap-mod-landed", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/existing.ts", "- code/created.ts (new)"] }),
  });
  writeTask(root, "gap-real", { status: "ready", labels: ["gap"], body: fourArtifactBody() });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.pool, 2, "pool must keep the not-landed existing-file task");
  assert.deepEqual(r.ready.sort(), ["gap-mod-not-landed", "gap-real"]);
  const reasonsById = Object.fromEntries(r.excluded.map((e) => [e.id, e.reasons]));
  assert.ok(!reasonsById["gap-mod-not-landed"], "not-landed existing-file task stays in the pool (AC2)");
  assert.ok(reasonsById["gap-mod-landed"].includes("not-yet-flipped"), "landed existing-file task excluded (AC3)");
});

// ── git-history landed signal (gap-ready-pool-taskworklanded-underdetects-prose-ac-merged-tasks) ──
// A prose-heavy-AC merged-not-flipped task (no resolvable symbols, no (new) touches) whose work
// landed via a fan-in merge that references it must be excluded from the dispatchable pool. These
// tests need a REAL git repo (the signal reads `git log master`), created inline (mkdtemp + the
// same t.after cleanup the other ready-pool tests use) so the R6 isolation checker sees the
// directory covered.

test("ready pool excludes a prose-heavy merged task via git-history (AC1/AC3)", (t) => {
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
  // A prose-heavy task whose AC yields no resolvable symbols and whose Touches are existing-file
  // paths (no (new)) — the shape that was under-detected (web-board). Its work lands via a fan-in
  // merge "merge web-board: …" that modified code/board.ts → git-history fires.
  writeTask(root, "gap-web-board-needs-an-inconsistency-verdict-it-does-not-have", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/board.ts"] }),
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

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  const byId = Object.fromEntries(r.excluded.map((e) => [e.id, e.reasons]));
  assert.ok(
    byId["gap-web-board-needs-an-inconsistency-verdict-it-does-not-have"]?.includes("not-yet-flipped"),
    "prose-heavy merged task excluded via the git-history signal (AC1/AC3)",
  );
  assert.equal(r.ready.includes("gap-web-board-needs-an-inconsistency-verdict-it-does-not-have"), false,
    "the landed task is NOT in the dispatchable pool");
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

  // notYetFlipped uses the LANDED-on-master signal, NOT AC checkbox state (the fan-in merges
  // without ticking ACs). A merged-but-AC-all-unchecked ready task is EXCLUDED.
  fs.writeFileSync(path.join(root, "code", "landed.ts"), "export const landed = 1;\n");
  const merged = {
    status: "ready",
    body: "## Acceptance Criteria\n- [ ] unchecked\n- [ ] still unchecked\n## Touches\n- code/landed.ts (new)\n## Definition of Done\nstandard",
  };
  assert.equal(notYetFlipped(merged, root), true, "merged-but-AC-unchecked ready task must be excluded");

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
// AC-complete-not-flipped). Fix: the not-yet-flipped signal is a UNION — taskWorkLanded (the
// merged-but-unchecked half, preserved) OR all_acs_checked && status==ready (the COMPLETION state,
// independent of writing style). AC1 positive control (AC-complete-but-not-flipped is surfaced) +
// AC2 union-not-replace (taskWorkLanded stays pure / landed-but-unchecked still excluded) + negative
// controls (partial / zero-checkbox / non-ready are NOT surfaced).

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

  // taskWorkLanded semantics preserved: a work-landed-but-AC-unchecked ready task is STILL excluded.
  const landedUnchecked = {
    status: "ready",
    body: "## Acceptance Criteria\n- [ ] unchecked\n## Touches\n- code/landed.ts (new)\n## Definition of Done\nstandard",
  };
  assert.equal(notYetFlipped(landedUnchecked, root), true, "landed-but-unchecked ready task still excluded (union-not-replace)");

  // Neither signal fires → stays in the pool.
  const pending = { status: "ready", body: fourArtifactBody({ touches: ["- code/never.ts"] }) };
  assert.equal(notYetFlipped(pending, root), false, "neither signal fires → stays in the pool");
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

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
} from "../scripts/ready-pool-check.ts";
import { parseTask } from "../scripts/task-schema.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── fixture helpers ───────────────────────────────────────────────────────────────────────────────

function makeWorkspace(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-${tag}-`));
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
    `labels:`,
    ...labels.map((l) => `  - ${l}`),
    `parent: ${parent}`,
    "extra:",
    "  schema: v1",
    "---",
  ].join("\n");
  fs.writeFileSync(path.join(root, "tasks", `${id}.md`), `${fm}\n\n${body}`);
}

// A minimal contract-shape body carrying the four artifacts (Proposal / Contract / AC / DoD).
function fourArtifactBody({ acBoxes = 4, touches = "", extra = "" } = {}) {
  const acLines = Array.from({ length: acBoxes }, () => "- [ ] an AC item that is long enough");
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

// ── CLI smoke: --root runs and prints a JSON pool field ──────────────────────────────────────────

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

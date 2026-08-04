// @test-group governance
// ready-pool-check.test.mjs — the ready-pool maintenance mechanism
// (tasks/gap-promotion-cadence-is-role-volition-not-product-mechanism). Promotion cadence used to
// live in an outer's VOLUNTARY AC-queue (role volition, lost on session/model change); this test
// pins the PRODUCT mechanism: computing the REAL ready pool (excluding not-yet-flipped / fixture /
// PARKED) and recommending todo→ready promotions in a DEFINED order (gap-* > DIR-*, touches-resolve
// first) when pool < 3.
//
// AC1 pool computation + recommendation-with-reason · AC2 tick-doc step · AC3 orchestrator sync
// AC4 negative controls (pool≥3 ⇒ no recommend; pool<3 + no qualified candidate ⇒ no recommend;
//   pool<3 + qualified candidate ⇒ recommend) · AC5 orderability (gap before DIR; resolve before not)
// AC6 node:test + @test-group governance · AC7 SPEC sustained-health dimension reference
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

// ── AC4: negative controls (pool ≥ 3 ⇒ no recommendation) ─────────────────────────────────────────

test("pool >= floor ⇒ no promotions (even with qualified todo candidates)", (t) => {
  const root = makeWorkspace("neg-pool-full");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const id of ["gap-r1", "gap-r2", "gap-r3"]) {
    writeTask(root, id, { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  }
  // A fully-qualified todo candidate exists, but the pool is healthy.
  writeTask(root, "gap-candidate", gapTask("gap-candidate"));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.pool, 3);
  assert.equal(r.deficit, 0);
  assert.deepEqual(r.promotions, [], "pool ≥ 3 must never recommend");
  assert.deepEqual(r.candidates, [], "candidate scan is skipped when the pool is healthy");
});

// ── AC4: pool < 3 + qualified candidate ⇒ recommend ──────────────────────────────────────────────

test("pool < floor with a qualified todo candidate ⇒ recommend it with a reason", (t) => {
  const root = makeWorkspace("pos-rec");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-candidate", gapTask("gap-candidate")); // no Touches → resolves trivially, no parent → deps ready

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.pool, 2);
  assert.equal(r.deficit, 1);
  assert.equal(r.promotions.length, 1);
  assert.equal(r.promotions[0].id, "gap-candidate");
  assert.match(r.promotions[0].reason, /touches resolve/);
  assert.match(r.promotions[0].reason, /four-artifacts complete/);
});

// ── AC4: pool < 3 + NO qualified candidate ⇒ no recommendation ───────────────────────────────────

test("pool < floor but no qualified candidate ⇒ no promotions", (t) => {
  const root = makeWorkspace("neg-no-qual");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });

  // Candidate fails four-artifacts (no DoD).
  writeTask(root, "gap-no-dod", gapTask("gap-no-dod", { body: fourArtifactBody().replace("## Definition of Done", "## Resolution") }));
  // Candidate fails deps (parent file missing → fail-closed, parent cannot be confirmed done).
  writeTask(root, "gap-child", { ...gapTask("gap-child"), parent: "gap-ghost-parent" });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.deficit, 1);
  assert.deepEqual(r.promotions, [], "no qualified candidate ⇒ nothing to recommend");
  const byId = Object.fromEntries(r.candidates.map((c) => [c.id, c]));
  assert.equal(byId["gap-no-dod"].eligible, false);
  assert.equal(byId["gap-no-dod"].missingArtifacts.includes("dod"), true);
  assert.equal(byId["gap-child"].eligible, false);
  assert.equal(byId["gap-child"].depsReady, false);
});

// ── AC4: pool < 3 + candidate whose Touches do not resolve ⇒ not recommended ─────────────────────

test("candidate with majority-missing Touches is not recommended", (t) => {
  const root = makeWorkspace("neg-touches");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  // Candidate declares touches on files that do not exist (no `(new)` tag).
  writeTask(root, "gap-missing-touch", gapTask("gap-missing-touch", {
    body: fourArtifactBody({ touches: ["- code/does-not-exist.ts", "- plugin/scripts/also-missing.ts"] }),
  }));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.deficit, 1);
  assert.deepEqual(r.promotions, []);
  const c = r.candidates.find((x) => x.id === "gap-missing-touch");
  assert.equal(c.touchesResolve, false);
  assert.equal(c.eligible, false);
});

// ── AC5: ordering — gap-* before DIR-* ────────────────────────────────────────────────────────────

test("candidate order: gap-* defect sorts before DIR-* capability", (t) => {
  const root = makeWorkspace("order-kind");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "DIR-new-cap", dirTask("DIR-new-cap"));
  writeTask(root, "gap-defect", gapTask("gap-defect"));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  const ids = r.candidates.map((c) => c.id);
  assert.deepEqual(ids, ["gap-defect", "DIR-new-cap"], "gap-* must sort before DIR-*");
  assert.equal(classifyKind("gap-defect"), "gap");
  assert.equal(classifyKind("DIR-new-cap"), "dir");
  assert.equal(classifyKind("ARCH-x"), "other");
});

// ── AC5: ordering — touches-resolvable before not ────────────────────────────────────────────────

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

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  const byId = Object.fromEntries(r.candidates.map((c) => [c.id, c]));
  assert.equal(byId["gap-resolvable"].touchesResolve, true);
  assert.equal(byId["gap-unresolvable"].touchesResolve, false);
  const idxResolvable = r.candidates.findIndex((c) => c.id === "gap-resolvable");
  const idxUnresolvable = r.candidates.findIndex((c) => c.id === "gap-unresolvable");
  assert.ok(idxResolvable < idxUnresolvable, "resolvable candidate must sort before non-resolvable");
});

// ── AC4/AC5: hard-cap floor constant is what the ticks use ───────────────────────────────────────

test("POOL_FLOOR is the documented healthy-pool floor", () => {
  assert.equal(POOL_FLOOR, 3);
});

// ── CLI smoke: --root runs and prints a JSON pool field ──────────────────────────────────────────

test("CLI smoke: --root produces JSON with a pool field (exit 0)", (t) => {
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
  assert.equal(typeof parsed.scanned, "number");
});

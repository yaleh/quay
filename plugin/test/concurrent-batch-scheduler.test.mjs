// @test-group governance
// concurrent-batch-scheduler.test.mjs — parseCandidate label exposure
// (gap-ac36-delivery-critical-priority-axis AC2): parseCandidate must read the candidate's
// frontmatter `labels` — via task-schema.ts's parseTask, the ONE lenient frontmatter parse
// (ADR-004 single-source — no second labels parser) — and expose a derived `deliveryCritical`
// boolean. slot-refill.ts's candidates.sort then ranks delivery-critical tasks as a SECOND axis
// (below blocking_suite, above id order). A candidate with no frontmatter / no such label must
// default conservative (labels=[], deliveryCritical=false) so legacy charters are unchanged.
//
// Run: scripts/test.sh plugin/test/concurrent-batch-scheduler.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseCandidate,
  // IN-FLIGHT WORKTREE DIRECT QUANTITY (tasks/gap-scheduler-inflight-detection-misses-fan-in-
  // worktree AC1): the pure open-worktree → {id, touches} resolver whose in-flight detection must
  // include a fan-in workflow / just-dispatched worktree via the `git worktree list` direct quantity
  // (not only the telemetry-bracket snapshot).
  resolveInFlightWorktrees,
  computeInFlightWorktreeTouches,
} from "../scripts/concurrent-batch-scheduler.ts";

// A quay-task-shaped charter with frontmatter `labels:` (block-list form) plus a body.
function taskText({ labels = [], body = "" }) {
  const fm = [
    "---",
    "id: t",
    "title: fixture",
    "status: ready",
    "labels:",
    ...labels.map((l) => `  - ${l}`),
    "---",
  ].join("\n");
  return `${fm}\n\n${body}`;
}

test("parseCandidate: legacy charter fragment (no frontmatter) ⇒ labels=[], deliveryCritical=false", () => {
  const c = parseCandidate("cand", "**type:** execution\n## Touches\n- x/a.js");
  assert.deepEqual(c.labels, []);
  assert.equal(c.deliveryCritical, false);
});

test("parseCandidate: block-list labels with delivery-critical ⇒ labels read + deliveryCritical=true", () => {
  const c = parseCandidate(
    "cand",
    taskText({ labels: ["gap", "delivery-critical"], body: "**type:** execution\n## Touches\n- x/a.js" }),
  );
  assert.deepEqual(c.labels, ["gap", "delivery-critical"]);
  assert.equal(c.deliveryCritical, true);
});

test("parseCandidate: block-list labels WITHOUT delivery-critical ⇒ deliveryCritical=false", () => {
  const c = parseCandidate("cand", taskText({ labels: ["gap"], body: "**type:** execution\n## Touches\n- x/a.js" }));
  assert.deepEqual(c.labels, ["gap"]);
  assert.equal(c.deliveryCritical, false);
});

test("parseCandidate: flow-list labels (labels: [gap, delivery-critical]) ⇒ deliveryCritical=true", () => {
  const text = [
    "---",
    "id: t",
    "title: fixture",
    "status: ready",
    "labels: [gap, delivery-critical]",
    "---",
    "",
    "**type:** execution",
    "## Touches",
    "- x/a.js",
  ].join("\n");
  const c = parseCandidate("cand", text);
  assert.deepEqual(c.labels, ["gap", "delivery-critical"]);
  assert.equal(c.deliveryCritical, true);
});

test("parseCandidate: existing fields unchanged when labels are added (id/touches/type/valueType)", () => {
  const c = parseCandidate(
    "cand",
    taskText({ labels: ["delivery-critical"], body: "**type:** learning\n## Touches\n- x/a.js\n- y/b.js" }),
  );
  assert.equal(c.id, "cand");
  assert.deepEqual(c.touches.globs, ["x/a.js", "y/b.js"]);
  assert.equal(c.type, "learning");
  assert.equal(c.valueType, "capability-growth");
  assert.equal(c.deliveryCritical, true);
});

// ── IN-FLIGHT WORKTREE DETECTION (gap-scheduler-inflight-detection-misses-fan-in-worktree) ─────────
// AC1: the in-flight detection must include a fan-in workflow / just-dispatched worktree via the
// `git worktree list` DIRECT quantity — the snapshot (telemetry brackets / historical in-flight id
// list) misses both. resolveInFlightWorktrees is the pure core; computeInFlightWorktreeTouches is its
// production wiring (listWorktrees + taskIdFromBranch).

function touchSectionBody(touches) {
  return [
    "**type:** execution",
    "## Proposal",
    "A proposal paragraph that is definitely more than forty non-whitespace chars.",
    "## Touches",
    ...touches,
    "## Acceptance Criteria",
    "- [ ] an acceptance criterion long enough to count",
    "## Definition of Done",
    "standard DoD — the five clauses; meta-enforcer fixture-pinned.",
  ].join("\n");
}

function makeWorktreeTasks(tag, taskDefs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cbs-wt-${tag}-`));
  const tasksDir = path.join(dir, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  for (const [id, touches] of Object.entries(taskDefs)) {
    fs.writeFileSync(path.join(tasksDir, `${id}.md`), touchSectionBody(touches));
  }
  return { dir, tasksDir };
}

test("resolveInFlightWorktrees: a fan-in worktree (task/<id> branch) resolves to its task id + touches (AC1)", (t) => {
  const { dir, tasksDir } = makeWorktreeTasks("fanin", {
    "gap-fanin": ["- code/shared.ts"],
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = resolveInFlightWorktrees(
    [
      { path: dir, branch: "refs/heads/develop" }, // main checkout
      { path: path.join(dir, "..", "quay-worktrees", "gap-fanin"), branch: "refs/heads/task/gap-fanin" },
    ],
    { root: dir, tasksDir },
  );
  assert.equal(out.length, 1, "exactly one in-flight worktree (the main checkout is excluded)");
  assert.equal(out[0].id, "gap-fanin");
  assert.deepEqual(out[0].touches.globs, ["code/shared.ts"]);
});

test("resolveInFlightWorktrees: non-task branches + missing task file + no Touches are excluded (fail-soft)", (t) => {
  const { dir, tasksDir } = makeWorktreeTasks("excl", {
    "gap-task": ["- code/a.ts"],
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = resolveInFlightWorktrees(
    [
      // integration / detached / non-task branches ⇒ not a task worktree
      { path: path.join(dir, "..", "wt-integration"), branch: "refs/heads/integration" },
      { path: path.join(dir, "..", "wt-detached"), branch: null },
      { path: path.join(dir, "..", "wt-feat"), branch: "refs/heads/feat/thing" },
      // task branch but the task file does not exist ⇒ blocks nothing
      { path: path.join(dir, "..", "wt-missing"), branch: "refs/heads/task/gap-ghost" },
      // task branch whose task declares no ## Touches ⇒ no usable conflict surface
      { path: path.join(dir, "..", "wt-notouch"), branch: "refs/heads/task/gap-notouch" },
    ],
    { root: dir, tasksDir },
  );
  assert.equal(out.length, 0, "none of the excluded shapes are in-flight task worktrees");
  // A task file WITHOUT a ## Touches section must not resolve (no declared conflict surface).
  fs.writeFileSync(path.join(tasksDir, "gap-notouch.md"), "**type:** execution\n## Proposal\nno touches declared\n");
  const out2 = resolveInFlightWorktrees(
    [{ path: path.join(dir, "..", "wt-notouch"), branch: "refs/heads/task/gap-notouch" }],
    { root: dir, tasksDir },
  );
  assert.equal(out2.length, 0, "a task worktree with no declared Touches blocks nothing");
});

test("resolveInFlightWorktrees: duplicate task/<id> worktrees dedup to one entry", (t) => {
  const { dir, tasksDir } = makeWorktreeTasks("dedup", {
    "gap-dup": ["- code/x.ts"],
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = resolveInFlightWorktrees(
    [
      { path: path.join(dir, "..", "wt-a"), branch: "refs/heads/task/gap-dup" },
      { path: path.join(dir, "..", "wt-b"), branch: "refs/heads/task/gap-dup" },
    ],
    { root: dir, tasksDir },
  );
  assert.equal(out.length, 1, "one task id ⇒ one in-flight entry");
  assert.equal(out[0].id, "gap-dup");
});

test("computeInFlightWorktreeTouches: a non-git root yields [] (fail-soft, never a fabricated block)", (t) => {
  const { dir, tasksDir } = makeWorktreeTasks("nogit", { "gap-nogit": ["- code/a.ts"] });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(computeInFlightWorktreeTouches(dir, tasksDir), []);
});

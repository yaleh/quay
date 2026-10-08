// @test-group engine
// ready-pool-check-transition-writes.test.mjs — GOAL-030 ② (gap-goal030-promotion-writes-via-kernel-
// transition): the promotion path's TWO status writes now go through the kernel's transition decision
// and leave a structured event behind.
//
// WHY THIS FILE EXISTS (and why the pinning tests matter): before this task, `applyPromotions`
// (todo→ready) and `applyRevaluations` (ready→todo) patched a task file's `status:` line directly and
// wrote NOTHING that said "this flip happened, executed by this code". The kernel module
// (packages/quay/src/kernel/task-transition.ts, GOAL-030 ①) introduced `decideTransition` (three-state:
// allow / refuse / not-evaluated), the `patchStatusField` primitive, and `appendTaskStatusEvent`. This
// file pins the WIRING:
//
//   AC1  a landed promotion appends exactly ONE event (kind=promote, todo→ready, actor
//        `ready-pool-check --apply`) under the workspace's own `.quay/`;
//   AC2  a landed retreat appends exactly ONE event (kind=retreat, ready→todo, actor
//        `ready-pool-check --revaluate-apply`);
//   AC3  the kernel gate is a REAL gate — an edge the table refuses (or cannot judge) writes NO byte
//        and NO event, and the verdict (`refuse` vs `not-evaluated`) stays distinguishable;
//   AC4  the events land ONLY in the workspace the run was pointed at (negative control: the repo's
//        own `.quay/` carrier is byte-identical before and after).
//
// The fixtures are REAL workspaces (a bare `tasks/` directory is not one — the CLI resolves against
// the `.quay/config.yml` provider map), which is what the task body's Plan requires.
//
// Run: scripts/test.sh plugin/test/ready-pool-check-transition-writes.test.mjs

import { test } from "node:test";
import {
  assert,
  execFileSync,
  fourArtifactBody,
  fs,
  gapTask,
  makeWorkspace,
  parseTask,
  path,
  setTaskStatus,
  __dirname,
  writeTask,
} from "./helpers/ready-pool-check-harness.mjs";

const SCRIPT = path.resolve(__dirname, "..", "scripts", "ready-pool-check.ts");
/** This checkout's own runtime carrier — the file a NON-workspace-scoped write would have hit. */
const REPO_EVENTS = path.resolve(__dirname, "..", "..", ".quay", "task-status-events.jsonl");

/** A REAL workspace: the harness's bare tasks/ + code/ dirs PLUS the `.quay/config.yml` provider map
 *  the CLI resolves against (裸 tasks 目录不是合法 workspace). */
function makeRealWorkspace(tag) {
  const root = makeWorkspace(tag);
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      "    path: ./packages/quay-native",
      "    tasks_dir: ./tasks",
      "    mcp_entry: [\"node\", \"./bin/quay-native.ts\", \"mcp\"]",
      "",
    ].join("\n"),
  );
  return root;
}

/** Run the repo's ready-pool-check against `root` and parse its JSON stdout. */
function runCheck(root, extraArgs) {
  const out = execFileSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", SCRIPT, "--root", root, "--cap", "3", "--floor-mult", "1", ...extraArgs],
    { encoding: "utf8" },
  );
  return JSON.parse(out);
}

const eventsPath = (root) => path.join(root, ".quay", "task-status-events.jsonl");

/** The workspace's transition-event records ([] when the carrier was never created). */
function readEvents(root) {
  const file = eventsPath(root);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

const statusOf = (root, id) => parseTask(fs.readFileSync(path.join(root, "tasks", `${id}.md`), "utf8")).frontmatterRaw.match(/^status:\s*(.*)$/m)[1].trim();

/** Snapshot the checkout's own carrier so a run that leaks out of its workspace is visible. */
function repoEventsSnapshot() {
  return fs.existsSync(REPO_EVENTS) ? fs.readFileSync(REPO_EVENTS, "utf8") : null;
}

test("promote edge: --apply flips todo→ready and appends exactly one promote event under the workspace's .quay/", (t) => {
  const root = makeRealWorkspace("transition-promote");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "code", "a.ts"), "export const a = 1;\n");
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-candidate", gapTask("gap-candidate"));
  assert.deepEqual(readEvents(root), [], "no carrier before the run (the fixture is clean)");
  const repoBefore = repoEventsSnapshot();

  const out = runCheck(root, ["--apply"]);

  assert.equal(out.should_apply, true, "the candidate is eligible ⇒ the heartbeat applies");
  assert.equal(out.applied_promotions.filter((p) => p.ok).length, 1, "exactly one promotion landed");
  assert.deepEqual(out.transition_refusals, [], "the legal todo→ready edge is never refused");
  assert.equal(statusOf(root, "gap-candidate"), "ready", "AC1: the flip is on disk");

  const events = readEvents(root);
  assert.equal(events.length, 1, "AC1: flips landed (1) ⇒ events appended (1) — the counts must be equal");
  const ev = events[0];
  assert.equal(ev.taskId, "gap-candidate");
  assert.equal(ev.from, "todo");
  assert.equal(ev.to, "ready");
  assert.equal(ev.kind, "promote", "AC1: the promote edge's kind comes from LIFECYCLE_EDGES");
  assert.equal(ev.actor, "ready-pool-check --apply", "the actor names the producing entry point");
  assert.ok(ev.writerModule.endsWith("packages/quay/src/kernel/task-transition.ts"), `writerModule is the kernel module, got ${ev.writerModule}`);
  assert.equal(typeof ev.pid, "number");
  assert.equal(ev.entry, fs.realpathSync(SCRIPT), "entry is the process entry (this run's realpath)");

  assert.equal(repoEventsSnapshot(), repoBefore, "AC4: the run wrote ONLY its own workspace's .quay/");
});

test("retreat edge: --revaluate-apply flips ready→todo and appends exactly one retreat event", (t) => {
  const root = makeRealWorkspace("transition-retreat");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "code", "a.ts"), "export const a = 1;\n");
  // A ready task whose static conditions decayed (the superseded marker) — the revaluation detector's
  // shape, reused from ready-pool-check-s20.
  writeTask(root, "gap-ready-decay", {
    status: "ready",
    labels: ["gap"],
    body: "> **SUPERSEDED / 作废** premise deleted.\n\n" + fourArtifactBody({ touches: ["- code/a.ts", "- tasks/gap-ready-decay.md"] }),
  });
  // A clean ready task — the negative control against a blanket retreat.
  writeTask(root, "gap-ready-clean", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/a.ts", "- tasks/gap-ready-clean.md"] }) });
  const repoBefore = repoEventsSnapshot();

  const out = runCheck(root, ["--revaluate-apply"]);

  assert.equal(out.should_revaluate, true, "the decayed ready task is detected");
  assert.equal(out.applied_revaluations.filter((r) => r.ok).length, 1, "exactly one retreat written");
  assert.deepEqual(out.transition_refusals, [], "the legal ready→todo edge is never refused");
  assert.equal(statusOf(root, "gap-ready-decay"), "todo", "AC2: the retreat is on disk");
  assert.equal(statusOf(root, "gap-ready-clean"), "ready", "the clean ready task is untouched");

  const events = readEvents(root);
  assert.equal(events.length, 1, "AC2: one retreat ⇒ one event");
  const ev = events[0];
  assert.equal(ev.taskId, "gap-ready-decay");
  assert.equal(ev.from, "ready");
  assert.equal(ev.to, "todo");
  assert.equal(ev.kind, "retreat", "AC2: the ready→todo edge's kind is retreat");
  assert.equal(ev.actor, "ready-pool-check --revaluate-apply");
  assert.equal(ev.reason, undefined, "no reason supplied ⇒ the key is ABSENT (缺值 = 未查), not empty");

  assert.equal(repoEventsSnapshot(), repoBefore, "AC4: the run wrote ONLY its own workspace's .quay/");
});

test("the kernel gate is a real gate: a refused / unjudgeable edge writes no byte and no event (AC3)", (t) => {
  const root = makeRealWorkspace("transition-refuse");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "todo", labels: ["gap"], body: fourArtifactBody() });

  // todo→superseded IS a declared edge, but a `legacy` one — decideTransition refuses it by default.
  const refused = setTaskStatus(root, "gap-a", "superseded");
  assert.equal(refused.ok, false, "AC3: a refused edge never writes");
  assert.equal(refused.verdict, "refuse");
  assert.equal(refused.from, "todo");
  assert.equal(refused.to, "superseded");
  assert.ok(refused.transitionReason.length > 0, "the refusal carries the kernel's reason");
  assert.equal(statusOf(root, "gap-a"), "todo", "AC3: the status line is untouched");

  // An UNKNOWN status is a DIFFERENT verdict (not-evaluated) — 硬规则 3/3b, never collapsed into refuse.
  const unjudgeable = setTaskStatus(root, "gap-a", "not-a-status");
  assert.equal(unjudgeable.ok, false);
  assert.equal(unjudgeable.verdict, "not-evaluated", "an unknown status is not a refusal — it was not evaluated");
  assert.equal(statusOf(root, "gap-a"), "todo");

  assert.deepEqual(readEvents(root), [], "AC3: neither a refusal nor an unevaluated pair is an event");
});

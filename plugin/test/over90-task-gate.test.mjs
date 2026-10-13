// @test-group engine
// over90-task-gate.test.mjs — the over-90m task-status gate's vocabulary correctness
// (gap-over90-task-gate-taskstatus-literal-unreachable-for-any-real-status-fix-or-retire,
// finding_id `open-semantic-discovery@2026-10-13T01:10:43.215Z#2`).
//
// THE FINDING. `taskStatusAllowsOver90m(root, taskId)` compares the task file's `status` frontmatter
// against the literal `"in-progress"`. That word is NOT a member of the single-source lifecycle
// vocabulary (`task-status.ts` TASK_STATUSES = todo|ready|done|needs-human|superseded, lockstepped
// with `packages/quay/src/abi.ts`), and no writer stores it as a task status — so the true-arm was
// unreachable for EVERY real task file, and the over-90m preemption path it gates
// (`supervisor-preempt-candidates.ts`'s candidate filter) could never fire for a task carrying a
// valid lifecycle word. The gate fired only through its absent-file fallback.
//
// THE FIX (AC0 ⇒ Plan B — retire with justification). AC0 established that NO currently-running
// mechanism invokes the candidate check or supervisor-preempt.sh (no systemd unit/timer, no crontab,
// no orchestration/manager-tick doc step, no recorded session invocation, no preemption ledger), so
// this is Plan B: the consumer chain is marked retired in its own header, the capability catalog's
// false "每轮" claim is corrected to "按需", and the UNIT-LEVEL LITERAL IS CORRECTED — the gate's
// mid-flight set is now DERIVED from TASK_STATUSES (`MID_FLIGHT_TASK_STATUSES`, empty by
// construction) so an out-of-vocabulary word can never again masquerade as a working branch, and the
// gate revives automatically if the vocabulary ever gains a word meaning "executing".
//
// AC1 — the failing-before/passing-after pair (RED against the pre-fix module, GREEN after; the
//   pre-fix RED is pasted in the task body).
// AC2 — the correct state after the fix, under Plan B: documented retirement, corrected literal, no
//   behavioral promise about production firing.
// AC3 — negative control on the EXISTING safety path: the 2026-08-05 false-positive class
//   (dead process / 0-commit worktree / status=ready) must stay excluded, before AND after — plus a
//   positive control so the control is not vacuous.
//
// Run: scripts/test.sh plugin/test/over90-task-gate.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.resolve(__dirname, "..", "scripts", "over90-task-gate.ts");
const STATUS = path.resolve(__dirname, "..", "scripts", "task-status.ts");
const TELEMETRY = path.resolve(__dirname, "..", "scripts", "fast-mode-telemetry.ts");
const CANDIDATES = path.resolve(__dirname, "..", "scripts", "supervisor-preempt-candidates.ts");

const GATE_SRC = fs.readFileSync(GATE, "utf8");

/** The module's LEADING COMMENT BLOCK — everything before the first top-level statement. Used so the
 *  "the retirement is documented in the header" assertions are POSITIONAL (hard rule 2): a note that
 *  merely appears anywhere in the file would not be a header note. */
const GATE_HEADER = GATE_SRC.slice(0, GATE_SRC.indexOf("\nimport "));

/** The body of `taskStatusAllowsOver90m` — the decision surface whose literals AC1 judges. */
function gateDecisionBody() {
  const at = GATE_SRC.indexOf("export function taskStatusAllowsOver90m(");
  assert.ok(at >= 0, "taskStatusAllowsOver90m is defined in over90-task-gate.ts");
  const end = GATE_SRC.indexOf("\n}", at);
  assert.ok(end > at, "the function body is closed");
  return GATE_SRC.slice(at, end);
}

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "over90-gate-root-"));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  return root;
}

function writeTaskFile(root, taskId, status) {
  fs.writeFileSync(
    path.join(root, "tasks", `${taskId}.md`),
    `---\nid: ${taskId}\nstatus: ${status}\n---\n## Plan\n- placeholder\n`,
    "utf8",
  );
}

/** Write a schema-valid telemetry start bracket backdated `minutesAgo` minutes for a task. */
async function writeBackdatedStart(root, taskId, minutesAgo) {
  const telemetry = await import(TELEMETRY);
  const ev = telemetry.buildStartEvent({
    taskId,
    runId: telemetry.generateRunId(taskId),
    executionCwd: root,
    baseCommit: null,
    recordedAtMs: Date.now() - minutesAgo * 60 * 1000,
  });
  telemetry.writeEvent(ev, root);
}

/** The reconcile probe verdict for a task whose executor is genuinely still around. */
const executorAlive = () => ({ gone: false, reason: "no-positive-done-evidence" });

// ── AC1: the failing-before / passing-after pair ──────────────────────────────────────────────────

test("AC1: the gate answers from the single-source vocabulary, never from an out-of-vocabulary literal", async () => {
  const { TASK_STATUSES } = await import(STATUS);
  const mod = await import(GATE);

  // (a) The finding's PREMISE, read off the single source rather than a copy of it: the lifecycle
  //     vocabulary has no member meaning "currently executing".
  assert.deepEqual(
    [...TASK_STATUSES],
    ["todo", "ready", "done", "needs-human", "superseded"],
    "premise: TASK_STATUSES is the five-word lifecycle vocabulary",
  );
  assert.ok(!TASK_STATUSES.includes("in-progress"), "premise: `in-progress` is not a task status");

  // (b) ⛔ THE FINDING. The gate's mid-flight set must be drawn FROM that vocabulary — a gate may not
  //     fire on a value its own vocabulary cannot produce. RED before the fix: there was no such set
  //     at all, the decision compared against the bare literal `"in-progress"`.
  const midFlight = mod.MID_FLIGHT_TASK_STATUSES;
  assert.ok(midFlight instanceof Set, "the mid-flight status set is exported (RED before the fix: absent)");
  for (const s of midFlight) {
    assert.ok(TASK_STATUSES.includes(s), `mid-flight status ${JSON.stringify(s)} is not in TASK_STATUSES`);
  }
  assert.equal(midFlight.size, 0, "no legal lifecycle word means 'executing' ⇒ the set is empty");

  // (c) The finding's exact PRODUCTION SHAPE, behaviorally: a real task file carrying a REAL, legal
  //     status, whose telemetry bracket is 95 minutes over budget. ⛔ RED before the fix on (d); this
  //     half records that the exclusion is unchanged by the fix (Plan B makes no production-firing
  //     promise) and is what the retired consumer chain can now only ever produce.
  const root = makeRoot();
  try {
    writeTaskFile(root, "gap-real-over", "ready");
    await writeBackdatedStart(root, "gap-real-over", 95);
    assert.equal(
      mod.taskStatusAllowsOver90m(root, "gap-real-over"),
      false,
      "a legal `ready` status answers the gate: not mid-flight",
    );
    const { listPreemptible } = await import(CANDIDATES);
    const { count } = await listPreemptible(root, { executorGone: executorAlive });
    assert.equal(count, 0, "…and it is excluded from the candidate list (the finding's exact shape)");

    // (d) ⛔ THE DEFECT, behaviorally. `in-progress` is not a task status, so the gate must not fire
    //     on it. RED before the fix: it returned `true` — i.e. it fired on a value TASK_STATUSES
    //     cannot contain, which is precisely what made the gate's real true-arm unreachable.
    writeTaskFile(root, "gap-out-of-vocab", mod.MID_FLIGHT_STATUS_WORD);
    assert.equal(
      mod.taskStatusAllowsOver90m(root, "gap-out-of-vocab"),
      false,
      "the gate must not fire on a status outside the single-source vocabulary",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1: the decision surface carries no task-status literal outside the vocabulary (position-based)", async () => {
  const { TASK_STATUSES } = await import(STATUS);
  const body = gateDecisionBody();
  // Hard rule 2: print what the predicate actually matched before judging on the count. The body
  // extracts string literals from the DECISION (position), so a word mentioned in the module's
  // comments or doc-block is not a hit.
  const literals = [...body.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  const outside = literals.filter((l) => !TASK_STATUSES.includes(l));
  assert.deepEqual(
    outside,
    [],
    `the decision body compares against a task-status literal outside the vocabulary: ${JSON.stringify(literals)}`,
  );
});

// ── AC2 (Plan B): the correct state after the fix ─────────────────────────────────────────────────

test("AC2 (Plan B): retirement documented in the header, literal corrected, no legal status fires", async () => {
  const { TASK_STATUSES } = await import(STATUS);
  const mod = await import(GATE);
  const root = makeRoot();
  try {
    // Every LEGAL status answers "not mid-flight" — the honest state: no lifecycle word means
    // "executing". (The status field answered; the answer is not "running".)
    for (const s of TASK_STATUSES) {
      writeTaskFile(root, "gap-legal", s);
      assert.equal(
        mod.taskStatusAllowsOver90m(root, "gap-legal"),
        false,
        `legal status ${JSON.stringify(s)} ⇒ the gate does not fire`,
      );
    }

    // The ONE surviving fire arm is the absent-file fallback — unchanged by this fix
    // (fail-closed toward KEEP/fire, the module's documented policy).
    fs.rmSync(path.join(root, "tasks", "gap-legal.md"), { force: true });
    assert.equal(mod.taskStatusAllowsOver90m(root, "gap-legal"), true, "missing task file ⇒ fire");

    // The word the retired implementation compared against is still not a task status — the
    // correction is that the gate no longer treats it as one.
    assert.equal(mod.MID_FLIGHT_STATUS_WORD, "in-progress", "the retired word is named, not silently dropped");
    assert.ok(!TASK_STATUSES.includes(mod.MID_FLIGHT_STATUS_WORD), "…and it is outside the vocabulary");

    // The retirement is DOCUMENTED in the module's own leading comment block (positional), carrying
    // the AC0 evidence and the finding id — so a reader cannot mistake the dead branch for a live one.
    assert.match(GATE_HEADER, /RETIRED \(AC0, 2026-10-13/, "the gate's header carries the retirement note");
    assert.match(GATE_HEADER, /open-semantic-discovery@2026-10-13T01:10:43\.215Z#2/, "…and the finding id");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC3: negative control on the EXISTING safety path (passes before AND after) ───────────────────

test("AC3 negative control: the 2026-08-05 false-positive class stays excluded", async () => {
  const mod = await import(CANDIDATES);
  const root = makeRoot();
  const noFileRoot = makeRoot();
  try {
    // The class the gate was BUILT to kill: a stale >90m timeout bracket whose task is not running.
    // (gap-over-90m-false-signal-source-reads-telemetry-not-task-status — dead process, 0-commit
    // worktree, status=ready; the os-anchor recurrence: status=ready + stale bracket.)
    for (const s of ["ready", "done", "needs-human", "superseded", "todo"]) {
      writeTaskFile(root, `gap-fp-${s}`, s);
      await writeBackdatedStart(root, `gap-fp-${s}`, 95);
    }
    const { count, preemptible } = await mod.listPreemptible(root, { executorGone: executorAlive });
    assert.equal(count, 0, "no task carrying a legal status becomes a candidate");
    assert.deepEqual(preemptible, [], "…and the candidate list is empty, not merely uncounted");

    // The landed arm is untouched and independent of the status gate (DoD: makeOver90ExecutorGone's
    // landed-evidence logic must not change).
    const landed = await mod.listPreemptible(root, { executorGone: () => ({ gone: true, reason: "branch-merged" }) });
    assert.equal(landed.count, 0, "a landed task is excluded by the reconcile probe, as before");

    // ⛔ POSITIVE CONTROL — the control above must not be vacuously green (hard rule 2's second half:
    // dry-run the predicate against a sample KNOWN to be true). The surviving absent-file arm DOES
    // produce a candidate, so "count 0" above is the gate working, not the predicate never matching.
    await writeBackdatedStart(noFileRoot, "gap-no-task-file", 95);
    const survivor = await mod.listPreemptible(noFileRoot, { executorGone: executorAlive });
    assert.equal(survivor.count, 1, "the absent-file fire arm still produces a candidate");
    assert.equal(survivor.preemptible[0].taskId, "gap-no-task-file");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(noFileRoot, { recursive: true, force: true });
  }
});

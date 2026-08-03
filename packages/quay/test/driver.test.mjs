// @test-group product
// QENG-4 — the `quay run` driver (autonomous loop AS CODE, capstone).
//
// Layered per docs/plans/11-quay-driver.md:
//   Phase A — pure module (driver.js) via direct import + a stub client and a
//             tmp logPath (mirrors lifecycle.test.mjs's Phase A stub-client
//             style). This is where the >=80% coverage lands.
//   Phase C — the real CLI (`node bin/quay.js run [--once]`) driven against a
//             disposable native-provider workspace whose .quay/config.yml is the
//             provider MAP form WITH mcp_entry (mirrors
//             gap-cli-gate-enforcement.test.mjs's makeWorkspace() EXACTLY — a
//             config missing mcp_entry crashes withProvider).
//
// Every loop-bearing test is BOUNDED (pre-created .quay/.stop, or
// maxIterations:1, or a guaranteed fixpoint) so it CANNOT hang. The AC3 POC is a
// self-contained temp-workspace fixture; it NEVER reads/runs/edits
// experiments/quay-perpetual-stream/**.
//
// Run: node --test --experimental-test-coverage packages/quay/test/driver.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

import { isActionable, scanActionable, runOnce, runLoop } from "../src/gate/driver.ts";
import { queryGateEvents } from "../src/gate/gate-event-store.ts";
import { makeTmpDir, makeTmpWorkspace } from "../../../plugin/test/helpers/tmp-workspace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const quayBin = path.join(__dirname, "..", "bin", "quay.ts");
const nativeBin = path.join(__dirname, "..", "..", "quay-native", "bin", "quay-native.ts");
const nativeProviderDir = path.dirname(nativeBin);

// ---------------------------------------------------------------------------
// Phase A harness — stub client + tmp logPath + tmp cfg.workspaceRoot
// (mirrors lifecycle.test.mjs's stub-client; extended to a multi-task board so
// scanActionable/runLoop's ordering + seen-subtraction can be exercised).
// ---------------------------------------------------------------------------

// tasks: [{ id, status, extra }]. taskCheck reads extra.acceptance:
//   "true" => pass, anything else => fail — matching the acceptance meter's
//   contract (a runnable command; here the meter value IS the verdict).
function stubClient(tasks) {
  const state = new Map(tasks.map((t) => [t.id, { ...t }]));
  return {
    async taskList({ status } = {}) {
      return {
        tasks: [...state.values()]
          .filter((t) => !status || t.status === status)
          .map((t) => ({ ...t })),
        malformed: [],
      };
    },
    async taskGet(id) {
      const t = state.get(id);
      return t ? { ...t } : null;
    },
    async taskCheck(id) {
      const m = state.get(id)?.extra?.acceptance;
      return { ok: m === "true", reason: m === "true" ? "ok" : "meter failed" };
    },
    async taskWrite({ id, status, expectedStatus }) {
      const t = state.get(id);
      if (expectedStatus && t.status !== expectedStatus) throw new Error("ConflictError");
      t.status = status;
      return { ...t };
    },
    _state: state,
  };
}

function tmpLog(tag) {
  const dir = makeTmpDir(`quay-qeng4-${tag}-`);
  return path.join(dir, "gate-events.jsonl");
}

// A disposable cfg.workspaceRoot for runLoop's sentinel path. `stop` pre-creates
// the .quay/.stop sentinel so the loop test is bounded (cannot hang). The shared
// helper registers cleanup so the /tmp dir is removed at the end of the file.
function tmpWorkspace(tag, { stop = false } = {}) {
  const workspaceRoot = makeTmpDir(`quay-qeng4-${tag}-ws-`);
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  if (stop) fs.writeFileSync(path.join(workspaceRoot, ".quay", ".stop"), "");
  return { workspaceRoot };
}

// process.exitCode is a shared global; runComplete (via runOnce/runLoop) sets it.
function resetExit() {
  process.exitCode = 0;
}

// ===========================================================================
// Phase A / Stage A1 — isActionable + scanActionable
// ===========================================================================

test("A1: isActionable — ready + non-empty meter => true", () => {
  assert.equal(isActionable({ id: "A", status: "ready", extra: { acceptance: "true" } }), true);
  assert.equal(isActionable({ id: "A", status: "ready", extra: { acceptance: "some-cmd --flag" } }), true);
});

test("A1: isActionable — ready but no/empty/whitespace meter => false", () => {
  assert.equal(isActionable({ id: "A", status: "ready", extra: {} }), false);
  assert.equal(isActionable({ id: "A", status: "ready", extra: { acceptance: "" } }), false);
  assert.equal(isActionable({ id: "A", status: "ready", extra: { acceptance: "   " } }), false);
  assert.equal(isActionable({ id: "A", status: "ready" }), false); // no extra at all
  assert.equal(isActionable({ id: "A", status: "ready", extra: { acceptance: 42 } }), false); // non-string
});

test("A1: isActionable — non-ready status is never actionable (even with a meter)", () => {
  assert.equal(isActionable({ id: "A", status: "todo", extra: { acceptance: "true" } }), false);
  assert.equal(isActionable({ id: "A", status: "done", extra: { acceptance: "true" } }), false);
  assert.equal(isActionable({ id: "A", status: "needs-human", extra: { acceptance: "true" } }), false);
});

test("A1: isActionable — null/undefined/garbage input is false (no throw)", () => {
  assert.equal(isActionable(null), false);
  assert.equal(isActionable(undefined), false);
  assert.equal(isActionable({}), false);
});

test("A1: scanActionable — filters meterless ready tasks, sorts by id ascending", async () => {
  const client = stubClient([
    { id: "C-3", status: "ready", extra: { acceptance: "true" } },
    { id: "C-1", status: "ready", extra: { acceptance: "true" } },
    { id: "C-2", status: "ready", extra: {} }, // meterless -> skipped
    { id: "C-4", status: "todo", extra: { acceptance: "true" } }, // not ready -> skipped
    { id: "C-0", status: "done", extra: { acceptance: "true" } }, // done -> skipped
  ]);
  assert.deepEqual(await scanActionable(client), ["C-1", "C-3"]);
});

test("A1: scanActionable — subtracts the `seen` set", async () => {
  const client = stubClient([
    { id: "C-1", status: "ready", extra: { acceptance: "true" } },
    { id: "C-2", status: "ready", extra: { acceptance: "true" } },
    { id: "C-3", status: "ready", extra: { acceptance: "true" } },
  ]);
  assert.deepEqual(await scanActionable(client, new Set(["C-2"])), ["C-1", "C-3"]);
  assert.deepEqual(await scanActionable(client, new Set(["C-1", "C-2", "C-3"])), []);
});

test("A1: scanActionable — empty board (or only-meterless) returns []", async () => {
  assert.deepEqual(await scanActionable(stubClient([])), []);
  assert.deepEqual(
    await scanActionable(stubClient([{ id: "C-1", status: "ready", extra: {} }])),
    []
  );
});

// ===========================================================================
// Phase A / Stage A2 — runOnce
// ===========================================================================

test("A2: runOnce pass-path — lowest actionable id, processed=id, ok=true, status=done", async () => {
  resetExit();
  const logPath = tmpLog("once-pass");
  const client = stubClient([
    { id: "R-2", status: "ready", extra: { acceptance: "true" } },
    { id: "R-1", status: "ready", extra: { acceptance: "true" } },
  ]);
  const r = await runOnce({ client, logPath });
  assert.deepEqual({ processed: r.processed, ok: r.ok }, { processed: "R-1", ok: true }); // lowest id
  assert.equal(client._state.get("R-1").status, "done");
  assert.equal(client._state.get("R-2").status, "ready", "only ONE task processed");
  const events = queryGateEvents(logPath, { pipeline_id: "R-1" });
  assert.deepEqual(events.map((e) => e.gate), ["acceptance", "complete"]);
  resetExit();
});

test("A2: runOnce fail-path — meter fails, ok=false, reason surfaced, task stays ready", async () => {
  resetExit();
  const logPath = tmpLog("once-fail");
  const client = stubClient([{ id: "R-1", status: "ready", extra: { acceptance: "false" } }]);
  const r = await runOnce({ client, logPath });
  assert.equal(r.processed, "R-1");
  assert.equal(r.ok, false);
  assert.equal(client._state.get("R-1").status, "ready", "status unchanged on meter fail");
  // --once has no `seen`: a re-run picks the SAME failing task again (by design).
  const r2 = await runOnce({ client, logPath });
  assert.equal(r2.processed, "R-1");
  assert.equal(r2.ok, false);
  resetExit();
});

test("A2: runOnce empty-board — processed=null (caller prints 'nothing to do')", async () => {
  resetExit();
  const client = stubClient([{ id: "R-1", status: "done", extra: { acceptance: "true" } }]);
  const r = await runOnce({ client, logPath: tmpLog("once-empty") });
  assert.deepEqual(r, { processed: null, ok: null, reason: null });
  resetExit();
});

// ===========================================================================
// Phase A / Stage A3 — runLoop (every case BOUNDED — cannot hang)
// ===========================================================================

test("A3: runLoop fixpoint — two passing tasks both completed, stopped=fixpoint", async () => {
  resetExit();
  const logPath = tmpLog("loop-fixpoint");
  const { workspaceRoot } = tmpWorkspace("loop-fixpoint");
  const client = stubClient([
    { id: "L-1", status: "ready", extra: { acceptance: "true" } },
    { id: "L-2", status: "ready", extra: { acceptance: "true" } },
  ]);
  const r = await runLoop({ client, cfg: { workspaceRoot }, logPath });
  assert.equal(r.stopped, "fixpoint");
  assert.deepEqual(r.completed, ["L-1", "L-2"]);
  assert.equal(r.iterations, 2);
  assert.equal(client._state.get("L-1").status, "done");
  assert.equal(client._state.get("L-2").status, "done");
  resetExit();
});

test("A3: runLoop sentinel — pre-created .quay/.stop => iterations:0, stopped:sentinel (no work)", async () => {
  resetExit();
  const logPath = tmpLog("loop-sentinel");
  const { workspaceRoot } = tmpWorkspace("loop-sentinel", { stop: true });
  const client = stubClient([{ id: "L-1", status: "ready", extra: { acceptance: "true" } }]);
  const r = await runLoop({ client, cfg: { workspaceRoot }, logPath });
  assert.equal(r.stopped, "sentinel");
  assert.equal(r.iterations, 0);
  assert.deepEqual(r.completed, []);
  assert.equal(client._state.get("L-1").status, "ready", "sentinel stops BEFORE any work");
  resetExit();
});

test("A3: runLoop anti-spin — a failing-meter task is attempted ONCE then fixpoint (NOT cap)", async () => {
  resetExit();
  const logPath = tmpLog("loop-antispin");
  const { workspaceRoot } = tmpWorkspace("loop-antispin");
  // One failing task + one passing task: the passing one completes, the failing
  // one is attempted once (stays ready) then subtracted via `seen` -> fixpoint.
  const client = stubClient([
    { id: "L-FAIL", status: "ready", extra: { acceptance: "false" } },
    { id: "L-PASS", status: "ready", extra: { acceptance: "true" } },
  ]);
  const r = await runLoop({ client, cfg: { workspaceRoot }, logPath });
  assert.equal(r.stopped, "fixpoint", "must reach fixpoint, NOT cap");
  assert.deepEqual(r.completed, ["L-PASS"]);
  assert.equal(r.iterations, 2, "each actionable id attempted exactly once");
  assert.equal(client._state.get("L-FAIL").status, "ready", "failing task left ready");
  assert.equal(client._state.get("L-PASS").status, "done");
  resetExit();
});

test("A3: runLoop cap — maxIterations bounds a spin, stopped=cap", async () => {
  resetExit();
  const logPath = tmpLog("loop-cap");
  const { workspaceRoot } = tmpWorkspace("loop-cap");
  // A client whose taskList ALWAYS returns a fresh actionable task (ignores
  // `seen` by never draining) forces the cap path deterministically.
  let n = 0;
  const client = {
    async taskList() {
      return { tasks: [{ id: `SPIN-${n++}`, status: "ready", extra: { acceptance: "true" } }], malformed: [] };
    },
    async taskGet(id) { return { id, status: "ready", extra: { acceptance: "true" } }; },
    async taskCheck() { return { ok: true, reason: "ok" }; },
    async taskWrite({ id, status }) { return { id, status }; },
  };
  const r = await runLoop({ client, cfg: { workspaceRoot }, logPath, maxIterations: 1 });
  assert.equal(r.stopped, "cap");
  assert.equal(r.iterations, 1);
  resetExit();
});

test("A3: runLoop empty-board — stopped=fixpoint, zero iterations", async () => {
  resetExit();
  const logPath = tmpLog("loop-empty");
  const { workspaceRoot } = tmpWorkspace("loop-empty");
  const client = stubClient([{ id: "L-1", status: "done", extra: { acceptance: "true" } }]);
  const r = await runLoop({ client, cfg: { workspaceRoot }, logPath });
  assert.deepEqual({ stopped: r.stopped, iterations: r.iterations, completed: r.completed }, {
    stopped: "fixpoint",
    iterations: 0,
    completed: [],
  });
  resetExit();
});

// ===========================================================================
// Phase C — real CLI against a native-provider workspace (AC1/AC2/AC3 POC)
// Provider MAP form WITH mcp_entry — mirrors gap-cli-gate-enforcement.test.mjs.
// ===========================================================================

function makeWorkspace(tag) {
  return makeTmpWorkspace(`quay-qeng4-${tag}`, { nativeBin, nativeProviderDir });
}

function runQuay(args, cwd) {
  try {
    const out = execFileSync("node", [quayBin, ...args], { encoding: "utf8", cwd });
    return { status: 0, stdout: out, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? String(err) };
  }
}

function runNative(args, tasksDir) {
  return execFileSync("node", [nativeBin, ...args], {
    encoding: "utf8",
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
}

const validSections =
  "## Proposal\nThis is a sufficiently long proposal section so the gate's minimum-content check passes cleanly.\n" +
  "## Plan\nThis is a sufficiently long plan section so the gate's minimum-content check passes cleanly.\n";
const acDodChecked =
  "## AC\n- [x] a sufficiently long acceptance criterion line for the minimum-content check\n" +
  "## DoD\n- [x] a sufficiently long definition-of-done line for the minimum-content check\n";

// Seed a `ready` task with a runnable acceptance meter (the meter IS what
// `quay run` gates on): passing = "true", failing = "false".
function seedReadyTask(id, tasksDir, workspaceRoot, meter) {
  runNative(["task", "create", id, "--title", id, "--status", "ready",
    "--body", validSections + acDodChecked], tasksDir);
  runQuay(["task", "edit", id, "--acceptance", meter], workspaceRoot);
}

// --- AC1: `quay run --once` drives one ready task end-to-end, exit 0 ----------

test("C [AC1]: `quay run --once` on a ready+passing-meter task → exit 0, task→done; re-run → nothing to do, exit 0", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac1");
  seedReadyTask("RUN-A", tasksDir, workspaceRoot, "true");

  const r = runQuay(["run", "--once"], workspaceRoot);
  assert.equal(r.status, 0, `expected exit 0; got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
  assert.match(r.stdout, /RUN-A: PASS — done/);
  const after = JSON.parse(runQuay(["task", "view", "RUN-A", "--json"], workspaceRoot).stdout);
  assert.equal(after.status, "done", "task must be advanced to done");

  // Re-run: RUN-A is now done, no other actionable task -> nothing to do, exit 0.
  const r2 = runQuay(["run", "--once"], workspaceRoot);
  assert.equal(r2.status, 0, `re-run expected exit 0; got ${r2.status}, stderr=${r2.stderr}`);
  assert.match(r2.stdout, /nothing to do/);
});

test("C [AC1]: determinism — with two actionable tasks the LOWEST id is selected", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac1-order");
  seedReadyTask("RUN-B2", tasksDir, workspaceRoot, "true");
  seedReadyTask("RUN-B1", tasksDir, workspaceRoot, "true");

  const r = runQuay(["run", "--once"], workspaceRoot);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /RUN-B1: PASS — done/); // lowest id first
  const b1 = JSON.parse(runQuay(["task", "view", "RUN-B1", "--json"], workspaceRoot).stdout);
  const b2 = JSON.parse(runQuay(["task", "view", "RUN-B2", "--json"], workspaceRoot).stdout);
  assert.equal(b1.status, "done");
  assert.equal(b2.status, "ready", "the higher id is left untouched by --once");
});

test("C [AC1]: `quay run --once` on a ready+FAILING-meter task → exit 0 (observation), task stays ready", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac1-fail");
  seedReadyTask("RUN-F", tasksDir, workspaceRoot, "false");

  const r = runQuay(["run", "--once"], workspaceRoot);
  // CRITICAL: a meter fail is a successful driver OBSERVATION — exit 0 (the
  // --once branch resets the exitCode=1 that runComplete set).
  assert.equal(r.status, 0, `--once must exit 0 even on a meter fail; got ${r.status}, stderr=${r.stderr}`);
  assert.match(r.stdout, /RUN-F: FAIL/);
  const after = JSON.parse(runQuay(["task", "view", "RUN-F", "--json"], workspaceRoot).stdout);
  assert.equal(after.status, "ready", "a failing meter leaves the task ready");
});

// --- AC2: `quay run` honors the stop sentinel + fixpoint, exit 0 -------------

test("C [AC2]: `quay run` with a pre-created .quay/.stop sentinel → clean exit 0, stop=sentinel", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac2-sentinel");
  seedReadyTask("RUN-S", tasksDir, workspaceRoot, "true"); // actionable, but sentinel wins
  fs.writeFileSync(path.join(workspaceRoot, ".quay", ".stop"), "");

  const r = runQuay(["run"], workspaceRoot);
  assert.equal(r.status, 0, `expected clean exit 0; got ${r.status}, stderr=${r.stderr}`);
  assert.match(r.stdout, /stop=sentinel/);
  const after = JSON.parse(runQuay(["task", "view", "RUN-S", "--json"], workspaceRoot).stdout);
  assert.equal(after.status, "ready", "sentinel stops before any work — task untouched");
});

test("C [AC2]: `quay run` with no actionable tasks → fixpoint, exit 0", () => {
  const { workspaceRoot } = makeWorkspace("ac2-fixpoint");
  const r = runQuay(["run"], workspaceRoot);
  assert.equal(r.status, 0, `fixpoint must exit 0; got ${r.status}, stderr=${r.stderr}`);
  assert.match(r.stdout, /stop=fixpoint/);
});

test("C [AC2]: `quay run` drives ALL actionable tasks to a fixpoint (exit 0)", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac2-drive");
  seedReadyTask("RUN-D1", tasksDir, workspaceRoot, "true");
  seedReadyTask("RUN-D2", tasksDir, workspaceRoot, "true");

  const r = runQuay(["run"], workspaceRoot);
  assert.equal(r.status, 0, `expected exit 0; got ${r.status}, stderr=${r.stderr}`);
  assert.match(r.stdout, /run: 2 completed in 2 iters \(stop=fixpoint\)/);
  for (const id of ["RUN-D1", "RUN-D2"]) {
    const t = JSON.parse(runQuay(["task", "view", id, "--json"], workspaceRoot).stdout);
    assert.equal(t.status, "done", `${id} must be done`);
  }
});

// --- exp5-M-GATE-CLI-ERROR-UX AC2 regression: exit-code leak on a fixpoint
// stop that included a failed task ------------------------------------------
//
// Reproduces this task's Finding 2 exactly: a 2-task board where ONE task has
// a real failing acceptance meter ("false") and the loop still reaches a
// clean `fixpoint` (not `cap`) after attempting it. BEFORE the fix, `run`
// leaked `process.exitCode = 1` from that failed task's `runComplete` call
// even though the driver's own inline comment says only the `cap` ceiling
// should be nonzero — this asserts the CORRECTED behavior: exit 0.

test("C [AC2 regression]: `quay run` exits 0 on a fixpoint stop that included a failed task (exit-code leak fix)", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac2-mixed-fixpoint");
  seedReadyTask("RUN-MIX-FAIL", tasksDir, workspaceRoot, "false"); // real failing meter
  seedReadyTask("RUN-MIX-PASS", tasksDir, workspaceRoot, "true");  // passes

  const r = runQuay(["run"], workspaceRoot);
  assert.equal(
    r.status,
    0,
    `fixpoint stop with a failed task along the way must still exit 0; got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`
  );
  assert.match(r.stdout, /FAIL — acceptance failed/);
  assert.match(r.stdout, /run: 1 completed in 2 iters \(stop=fixpoint\)/);

  const failTask = JSON.parse(runQuay(["task", "view", "RUN-MIX-FAIL", "--json"], workspaceRoot).stdout);
  assert.equal(failTask.status, "ready", "the failed task stays ready (attempted once, not retried)");
  const passTask = JSON.parse(runQuay(["task", "view", "RUN-MIX-PASS", "--json"], workspaceRoot).stdout);
  assert.equal(passTask.status, "done", "the other task still completes despite the earlier failure");
});

// --- AC3 (POC): one exp5 OUTER-LOOP ABSORB step as a `quay run --once` --------
// The analogy (prose only — NEVER reads/runs/edits experiments/quay-perpetual-
// stream/**): exp5's OUTER-LOOP ABSORB step advances a `ready` milestone task
// whose meter passes to `done`. `quay run --once` on a self-contained temp
// workspace fixture POC-1 {status:ready, extra.acceptance:"true"} does the SAME
// CLASS of board transition. Bounded (--once) — cannot hang.

test("C [AC3 POC]: `quay run --once` reproduces an exp5 ABSORB transition (ready+meter → done) on a self-contained fixture", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac3-poc");
  seedReadyTask("POC-1", tasksDir, workspaceRoot, "true");

  // Pre-state: ready.
  const before = JSON.parse(runQuay(["task", "view", "POC-1", "--json"], workspaceRoot).stdout);
  assert.equal(before.status, "ready");

  const r = runQuay(["run", "--once"], workspaceRoot);
  assert.equal(r.status, 0, `POC run must exit 0; got ${r.status}, stderr=${r.stderr}`);
  assert.match(r.stdout, /POC-1: PASS — done/);

  // Post-state: done — the same board transition an exp5 ABSORB step makes.
  const after = JSON.parse(runQuay(["task", "view", "POC-1", "--json"], workspaceRoot).stdout);
  assert.equal(after.status, "done", "taskGet(POC-1).status === 'done'");

  // A `complete` pass GateEvent was recorded (default log path in .quay/).
  const logFile = path.join(workspaceRoot, ".quay", "gate-events.jsonl");
  const events = queryGateEvents(logFile, { pipeline_id: "POC-1" });
  const complete = events.find((e) => e.gate === "complete");
  assert.ok(complete, `expected a 'complete' GateEvent; got ${JSON.stringify(events.map((e) => e.gate))}`);
  assert.equal(complete.verdict, "pass");
  assert.deepEqual(complete.payload, { from: "ready", to: "done" });
});

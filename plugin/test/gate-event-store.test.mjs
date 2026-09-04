// @test-group engine
// plugin/test/gate-event-store.test.mjs — gap-loop-completion-path-produces-zero-gateevents.
//
// Pins the loop's completion path writing GateEvents through the SAME gate engine the CLI
// uses. Regression: the loop completed tasks by writing `status: ready → done` into
// `tasks/<id>.md` directly (outer 1b "翻 done"), bypassing QENG — a loop-completed task
// produced ZERO GateEvents (gate-events.jsonl didn't even exist on ad-arm1/archguard
// TASK-81, while same-workspace CLI TEST-002 had 4: dod/promote/acceptance/complete pass).
//
// The fix routes the loop's ready→done flip through `plugin/scripts/loop-complete-task.ts`
// → QENG-3 `runCompleteLoop` (lifecycle.ts) → appendGateEvent to
// `<workspaceRoot>/.quay/gate-events.jsonl`, readable via `quay gate-log <task>`.
//
// Run: node --test plugin/test/gate-event-store.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { makeTmpWorkspace } from "./helpers/tmp-workspace.mjs";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "../../packages/quay/test/helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const quayBin = QUAY_CLI;
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(repoRoot, "packages", "quay-native", "bin");
const loopCompleteScript = path.join(repoRoot, "plugin", "scripts", "loop-complete-task.ts");

const validSections =
  "## Proposal\nThis is a sufficiently long proposal section so the gate's minimum-content check passes cleanly.\n" +
  "## Plan\nThis is a sufficiently long plan section so the gate's minimum-content check passes cleanly.\n";
const acDodChecked =
  "## AC\n- [x] a sufficiently long acceptance criterion line for the minimum-content check\n" +
  "## DoD\n- [x] a sufficiently long definition-of-done line for the minimum-content check\n";

function runNative(args, tasksDir) {
  return execFileSync("node", [nativeBin, ...args], {
    encoding: "utf8",
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
}

function runQuay(args, cwd) {
  try {
    const out = execFileSync("node", [quayBin, ...args], { encoding: "utf8", cwd });
    return { status: 0, stdout: out, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? String(err) };
  }
}

/** Run the loop-complete script (the outer 1b completion mechanism). */
function runLoopComplete(workspaceRoot, taskId, verifiedBy) {
  const args = ["--no-warnings", "--experimental-strip-types", loopCompleteScript, "--root", workspaceRoot, "--task", taskId];
  if (verifiedBy) args.push("--verified-by", verifiedBy);
  try {
    const out = execFileSync("node", args, { encoding: "utf8" });
    return { status: 0, stdout: out, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? String(err) };
  }
}

function viewTask(workspaceRoot, id) {
  return JSON.parse(runQuay(["task", "view", id, "--json"], workspaceRoot).stdout);
}

/** Read .quay/gate-events.jsonl (JSONL, one event per line) into an array. */
function readGateEvents(workspaceRoot) {
  const logPath = path.join(workspaceRoot, ".quay", "gate-events.jsonl");
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, "utf8")
    .split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l));
}

// ── AC2 + AC3: the loop completion path writes a `complete` pass GateEvent and gate-log reads it ──

test("AC2/AC3: loop-complete-task flips a ready task to done AND writes a complete pass event readable via gate-log", () => {
  const { workspaceRoot, tasksDir } = makeTmpWorkspace("loop-gateevent", { nativeBin, nativeProviderDir });
  runNative(["task", "create", "LGE-1", "--title", "loop-completed", "--status", "ready",
    "--body", validSections + acDodChecked], tasksDir);

  const r = runLoopComplete(workspaceRoot, "LGE-1", "verification-round-7 full-suite green + AC/DoD checked");
  assert.equal(r.status, 0, `expected exit 0; got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
  assert.match(r.stdout, /PASS — status=done \(loop\)/);

  // AC2: status is done AND the gate log file exists with a complete pass event.
  assert.equal(viewTask(workspaceRoot, "LGE-1").status, "done", "loop completion must flip status to done");
  const logPath = path.join(workspaceRoot, ".quay", "gate-events.jsonl");
  assert.ok(fs.existsSync(logPath), "gate-events.jsonl must exist after a loop completion");
  const events = readGateEvents(workspaceRoot);
  const complete = events.find((e) => e.pipeline_id === "LGE-1" && e.gate === "complete");
  assert.ok(complete, `expected a complete event for LGE-1; got ${JSON.stringify(events)}`);
  assert.equal(complete.verdict, "pass");
  assert.deepEqual(complete.payload, { from: "ready", to: "done", verifiedBy: "verification-round-7 full-suite green + AC/DoD checked" });

  // AC3: the event is queryable via `quay gate-log <task>` (the CLI read surface).
  const log = runQuay(["gate-log", "LGE-1", "--json"], workspaceRoot);
  assert.equal(log.status, 0, `gate-log failed: ${log.stderr}`);
  const logged = JSON.parse(log.stdout);
  assert.ok(logged.length >= 1, `expected >=1 gate-log event; got ${log.stdout}`);
  assert.ok(logged.some((e) => e.gate === "complete" && e.verdict === "pass"),
    `expected a complete pass event in gate-log; got ${log.stdout}`);
});

// ── AC2 negative: a non-ready task is NOT completed and writes NO event ──

test("AC2 negative: loop-complete-task on a todo task exits 1, status unchanged, no gate event written", () => {
  const { workspaceRoot, tasksDir } = makeTmpWorkspace("loop-gateevent-neg", { nativeBin, nativeProviderDir });
  runNative(["task", "create", "LGE-2", "--title", "still-todo", "--status", "todo",
    "--body", validSections + acDodChecked], tasksDir);

  const r = runLoopComplete(workspaceRoot, "LGE-2");
  assert.equal(r.status, 1, `expected exit 1; got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
  assert.match(r.stdout, /illegal transition: todo cannot complete \(must be ready\)/);
  assert.equal(viewTask(workspaceRoot, "LGE-2").status, "todo", "status unchanged on non-ready");
  const logPath = path.join(workspaceRoot, ".quay", "gate-events.jsonl");
  assert.equal(fs.existsSync(logPath), false, "no gate log written for a rejected completion");
});

// ── AC2 CLI-consistent: a loop task WITH a failing acceptance meter is NOT completed ──

test("AC2: loop-complete-task respects a present acceptance meter — failing meter → status stays ready", () => {
  const { workspaceRoot, tasksDir } = makeTmpWorkspace("loop-gateevent-meter", { nativeBin, nativeProviderDir });
  runNative(["task", "create", "LGE-3", "--title", "metered", "--status", "ready",
    "--body", validSections + acDodChecked], tasksDir);
  runQuay(["task", "edit", "LGE-3", "--acceptance", "false"], workspaceRoot);

  const r = runLoopComplete(workspaceRoot, "LGE-3");
  assert.equal(r.status, 1, `expected exit 1 (meter fail); got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
  assert.equal(viewTask(workspaceRoot, "LGE-3").status, "ready", "a failing meter must NOT be bypassed by the loop");
  const logPath = path.join(workspaceRoot, ".quay", "gate-events.jsonl");
  assert.ok(fs.existsSync(logPath), "the acceptance gate event is written even on fail");
  const events = readGateEvents(workspaceRoot);
  assert.equal(events.length, 1);
  assert.equal(events[0].gate, "acceptance");
  assert.equal(events[0].verdict, "fail");
});

// ── AC47 (gap-ac47-completion-predicate-consumer-fail-closed, AC4): the inner flip-done path refuses ─
// a task whose AC/DoD section it cannot READ (sectionFound:false) — the completion predicate must not
// silently pass a task with unverifiable AC/DoD (the DIR-014 fail-open: 5 unchecked boxes under a
// suffixed heading were judged complete). REFUSE and report 「AC/DoD 段未识别」, leave status unchanged.

test("AC47: loop-complete-task REFUSES flip-done when the AC/DoD section is unrecognized (sectionFound:false)", () => {
  const { workspaceRoot, tasksDir } = makeTmpWorkspace("loop-ac47-refuse", { nativeBin, nativeProviderDir });
  // A ready task whose AC/DoD headings are ABSENT/unregistered (a suffixed heading the SHAPE_SECTIONS
  // registry does not cover) — countCompletionCheckboxes sectionFound:false → the flip-done must fail
  // CLOSED, not silently pass (the completion predicate cannot verify its AC/DoD).
  const unreadableBody =
    "## Proposal\nA real proposal paragraph that is definitely more than forty non-whitespace chars.\n" +
    "## Acceptance Criteria (runnable — a variant NOT registered in SHAPE_SECTIONS)\n- [ ] an unchecked box\n" +
    "## Definition of Done (an unregistered variant)\nstandard DoD prose\n";
  runNative(["task", "create", "LGE-AC47", "--title", "unreadable-ac", "--status", "ready",
    "--body", unreadableBody], tasksDir);

  const r = runLoopComplete(workspaceRoot, "LGE-AC47");
  assert.equal(r.status, 1, `expected exit 1 (refused); got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
  assert.match(r.stderr, /AC\/DoD 段未识别/, `expected the 「AC/DoD 段未识别」 refusal; got stderr=${r.stderr}`);
  assert.equal(viewTask(workspaceRoot, "LGE-AC47").status, "ready", "status stays ready — the flip-done is refused");
  const logPath = path.join(workspaceRoot, ".quay", "gate-events.jsonl");
  assert.equal(fs.existsSync(logPath), false, "no gate event is written for a refused flip-done");
});

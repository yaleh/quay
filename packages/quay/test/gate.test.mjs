// @test-group product
// QENG-1 — gate engine + GateEvent log.
//
// Layered per the plan:
//   Phase A — pure modules (gate-event-store, registry, engine, gate-log) via
//             direct import + injected paths / stub clients (no CLI).
//   Phase C — the real CLI (`node bin/quay.js gate ...`) driven against a
//             disposable native-provider workspace, mirroring
//             gap-cli-gate-enforcement.test.mjs's makeWorkspace(): mkdtemp root
//             with a .quay/config.yml (native provider + tasks_dir) run with
//             cwd = workspaceRoot. This is required because `gate <task>` routes
//             through withProvider() -> loadConfig(), which needs a real config.
//
// Run: node --test --experimental-test-coverage packages/quay/test/gate.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

import { appendGateEvent, queryGateEvents } from "../src/gate/gate-event-store.ts";
import { gateRegistry, listGates } from "../src/gate/registry.ts";
import { runGate } from "../src/gate/engine.ts";
import { resolveGateLogPath, runGateLogQuery, DEFAULT_GATE_LOG_RELATIVE_PATH } from "../src/gate/gate-log.ts";
import { makeTmpDir, makeTmpWorkspace } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const quayBin = QUAY_CLI;
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpLog(tag) {
  const dir = makeTmpDir(`quay-qeng1-${tag}-`);
  return path.join(dir, "sub", "gate-events.jsonl"); // nested to exercise mkdirSync
}

function mkEvent(over = {}) {
  return {
    id: "id-" + Math.random().toString(36).slice(2),
    item_id: "T-1",
    pipeline_id: "T-1",
    gate: "dod",
    actor: "quay-cli",
    verdict: "pass",
    timestamp: "2026-01-01T00:00:00.000Z",
    payload: { reason: "ok" },
    ...over,
  };
}

// mirrors gap-cli-gate-enforcement.test.mjs makeWorkspace(); the shared helper also registers
// cleanup so the /tmp dirs are removed at the end of the file (gap-tmp-leak-is-live-r6-...).
function makeWorkspace(tag) {
  return makeTmpWorkspace(`quay-qeng1-${tag}`, { nativeBin, nativeProviderDir });
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

// Fixture bodies — both status:todo (author->ready gate). Each artifact section
// must exceed MIN_SECTION_CHARS (40 non-ws chars, store.js) to count as present.
const validSections =
  "## Proposal\nThis is a sufficiently long proposal section so the gate's minimum-content check passes cleanly.\n" +
  "## Plan\nThis is a sufficiently long plan section so the gate's minimum-content check passes cleanly.\n";
const acDodChecked =
  "## AC\n- [x] a sufficiently long acceptance criterion line for the minimum-content check\n" +
  "## DoD\n- [x] a sufficiently long definition-of-done line for the minimum-content check\n";
// gap-both-gates-read-one-signal-so-done-costs-nothing: an UNCHECKED AC box no
// longer fails author->ready (checked-state belongs to ready->done), so the
// old "violating" fixture (unchecked AC) is no longer violating. A genuine
// author->ready failure is now an AC section with NO machine-checkable
// checkboxes at all ("AC section has no checkboxes").
const acNoCheckbox =
  "## AC\nThis acceptance criteria section is written in prose only, with no machine-checkable checkbox lines at all, comfortably past forty non-whitespace characters.\n" +
  "## DoD\n- [x] a sufficiently long definition-of-done line for the minimum-content check\n";

// ===========================================================================
// Phase A / Stage A1 — gate-event-store
// ===========================================================================

test("A1: appendGateEvent creates parent dirs and writes one JSON line per call", () => {
  const logPath = tmpLog("a1-append");
  appendGateEvent(logPath, mkEvent({ id: "e1" }));
  appendGateEvent(logPath, mkEvent({ id: "e2" }));
  const lines = fs.readFileSync(logPath, "utf8").split("\n").filter((l) => l.length > 0);
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).id, "e1");
  assert.equal(JSON.parse(lines[1]).id, "e2");
});

test("A1: appendGateEvent is append-only — a reused id adds a new line, never rewrites", () => {
  const logPath = tmpLog("a1-appendonly");
  appendGateEvent(logPath, mkEvent({ id: "dup", verdict: "pass" }));
  appendGateEvent(logPath, mkEvent({ id: "dup", verdict: "fail" }));
  const events = queryGateEvents(logPath);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.verdict), ["pass", "fail"]);
});

test("A1: queryGateEvents on a missing file returns []", () => {
  assert.deepEqual(queryGateEvents(path.join(os.tmpdir(), "does-not-exist-" + Date.now(), "x.jsonl")), []);
});

test("A1: queryGateEvents AND-filters on pipeline_id, gate, actor and preserves append order", () => {
  const logPath = tmpLog("a1-filter");
  appendGateEvent(logPath, mkEvent({ id: "1", pipeline_id: "A", gate: "dod", actor: "cli" }));
  appendGateEvent(logPath, mkEvent({ id: "2", pipeline_id: "B", gate: "dod", actor: "cli" }));
  appendGateEvent(logPath, mkEvent({ id: "3", pipeline_id: "A", gate: "other", actor: "cli" }));
  appendGateEvent(logPath, mkEvent({ id: "4", pipeline_id: "A", gate: "dod", actor: "bot" }));

  assert.deepEqual(queryGateEvents(logPath, { pipeline_id: "A" }).map((e) => e.id), ["1", "3", "4"]);
  assert.deepEqual(queryGateEvents(logPath, { pipeline_id: "A", gate: "dod" }).map((e) => e.id), ["1", "4"]);
  assert.deepEqual(
    queryGateEvents(logPath, { pipeline_id: "A", gate: "dod", actor: "cli" }).map((e) => e.id),
    ["1"]
  );
});

test("A1: queryGateEvents filters on since/until (inclusive ISO string compare)", () => {
  const logPath = tmpLog("a1-time");
  appendGateEvent(logPath, mkEvent({ id: "old", timestamp: "2026-01-01T00:00:00.000Z" }));
  appendGateEvent(logPath, mkEvent({ id: "mid", timestamp: "2026-06-01T00:00:00.000Z" }));
  appendGateEvent(logPath, mkEvent({ id: "new", timestamp: "2026-12-01T00:00:00.000Z" }));
  assert.deepEqual(queryGateEvents(logPath, { since: "2026-06-01T00:00:00.000Z" }).map((e) => e.id), ["mid", "new"]);
  assert.deepEqual(queryGateEvents(logPath, { until: "2026-06-01T00:00:00.000Z" }).map((e) => e.id), ["old", "mid"]);
});

test("A1: queryGateEvents paginates with offset then limit, after filtering", () => {
  const logPath = tmpLog("a1-page");
  for (let i = 0; i < 5; i++) appendGateEvent(logPath, mkEvent({ id: String(i) }));
  assert.deepEqual(queryGateEvents(logPath, { offset: 1, limit: 2 }).map((e) => e.id), ["1", "2"]);
  assert.deepEqual(queryGateEvents(logPath, { offset: 4 }).map((e) => e.id), ["4"]);
  assert.deepEqual(queryGateEvents(logPath, { limit: 2 }).map((e) => e.id), ["0", "1"]);
});

// ===========================================================================
// Phase A / Stage A2 — registry + dod gate
// ===========================================================================

test("A2: listGates() includes 'dod'", () => {
  assert.ok(listGates().includes("dod"));
});

test("A2: dod gate maps taskCheck({ok:true}) -> {ok:true}", async () => {
  const stub = { taskCheck: async (id) => ({ id, ok: true, reason: "all good" }) };
  const r = await gateRegistry.dod({ id: "T-1" }, stub);
  assert.deepEqual(r, { ok: true, reason: "all good" });
});

test("A2: dod gate maps taskCheck({ok:false}) -> {ok:false} and passes reason through", async () => {
  const stub = { taskCheck: async (id) => ({ id, ok: false, reason: "0/1 AC checkboxes checked" }) };
  const r = await gateRegistry.dod({ id: "T-2" }, stub);
  assert.deepEqual(r, { ok: false, reason: "0/1 AC checkboxes checked" });
});

// ===========================================================================
// Phase A / Stage A3 — engine + gate-log resolver
// ===========================================================================

test("A3: runGate appends exactly one GateEvent whose verdict tracks ok (pass)", async () => {
  const logPath = tmpLog("a3-pass");
  const client = {
    taskGet: async (id) => ({ id, status: "todo" }),
    taskCheck: async (id) => ({ id, ok: true, reason: "eligible" }),
  };
  const res = await runGate({ client, id: "T-1", gate: "dod", logPath });
  assert.equal(res.ok, true);
  assert.equal(res.event.verdict, "pass");
  const events = queryGateEvents(logPath);
  assert.equal(events.length, 1);
  assert.equal(events[0].pipeline_id, "T-1");
  assert.equal(events[0].item_id, "T-1");
  assert.equal(events[0].gate, "dod");
  assert.equal(events[0].actor, "quay-cli");
  assert.equal(events[0].payload.reason, "eligible");
});

test("A3: runGate verdict is 'fail' when the gate fn returns ok:false", async () => {
  const logPath = tmpLog("a3-fail");
  const client = {
    taskGet: async (id) => ({ id }),
    taskCheck: async (id) => ({ id, ok: false, reason: "missing artifacts" }),
  };
  const res = await runGate({ client, id: "T-9", gate: "dod", logPath });
  assert.equal(res.ok, false);
  assert.equal(res.event.verdict, "fail");
  assert.equal(queryGateEvents(logPath)[0].verdict, "fail");
});

test("A3: runGate honors a custom actor", async () => {
  const logPath = tmpLog("a3-actor");
  const client = { taskGet: async (id) => ({ id }), taskCheck: async () => ({ ok: true, reason: "x" }) };
  await runGate({ client, id: "T-1", gate: "dod", logPath, actor: "unit-test" });
  assert.equal(queryGateEvents(logPath)[0].actor, "unit-test");
});

test("A3: runGate throws on an unknown gate", async () => {
  const client = { taskGet: async (id) => ({ id }), taskCheck: async () => ({ ok: true }) };
  await assert.rejects(
    () => runGate({ client, id: "T-1", gate: "nope", logPath: tmpLog("a3-unknown") }),
    /unknown gate: nope/
  );
});

test("A3: runGate throws when the task does not exist", async () => {
  const client = { taskGet: async () => null, taskCheck: async () => ({ ok: true }) };
  await assert.rejects(
    () => runGate({ client, id: "MISSING", gate: "dod", logPath: tmpLog("a3-missing") }),
    /no such task: MISSING/
  );
});

test("A3: resolveGateLogPath defaults to <workspaceRoot>/.quay/gate-events.jsonl and honors --file", () => {
  assert.equal(
    resolveGateLogPath("/ws"),
    path.join("/ws", DEFAULT_GATE_LOG_RELATIVE_PATH)
  );
  assert.equal(resolveGateLogPath("/ws", { file: "/tmp/g.jsonl" }), "/tmp/g.jsonl");
});

test("A3: runGateLogQuery maps CLI options onto queryGateEvents (pipelineId->pipeline_id, string offset/limit->int)", () => {
  const logPath = tmpLog("a3-logquery");
  appendGateEvent(logPath, mkEvent({ id: "1", pipeline_id: "P", gate: "dod" }));
  appendGateEvent(logPath, mkEvent({ id: "2", pipeline_id: "Q", gate: "dod" }));
  appendGateEvent(logPath, mkEvent({ id: "3", pipeline_id: "P", gate: "dod" }));
  const res = runGateLogQuery("/unused", { pipelineId: "P", gate: "dod", file: logPath, offset: "1", limit: "5" });
  assert.deepEqual(res.map((e) => e.id), ["3"]);
});

// ===========================================================================
// Phase C / Stage C1 — real CLI against a native-provider workspace (AC1-AC3)
// ===========================================================================

test("C1 [AC1]: `quay gate --list` prints registered gates and exits 0", () => {
  const { workspaceRoot } = makeWorkspace("aclist");
  const r = runQuay(["gate", "--list"], workspaceRoot);
  assert.equal(r.status, 0, `expected exit 0; got ${r.status}, stderr=${r.stderr}`);
  assert.ok(r.stdout.split("\n").includes("dod"), `expected 'dod' listed; got: ${r.stdout}`);
});

test("C1 [AC2]: `quay gate <compliant> --gate dod` exits 0; `<violating>` exits 1", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac2");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(["task", "create", "COMPLIANT", "--title", "Compliant fixture",
    "--status", "todo", "--body", validSections + acDodChecked], tasksDir);
  runNative(["task", "create", "VIOLATING", "--title", "Violating fixture",
    "--status", "todo", "--body", validSections + acNoCheckbox], tasksDir);

  const pass = runQuay(["gate", "COMPLIANT", "--gate", "dod", "--file", logFile], workspaceRoot);
  assert.equal(pass.status, 0, `expected compliant PASS (exit 0); got ${pass.status}, stdout=${pass.stdout}, stderr=${pass.stderr}`);
  assert.match(pass.stdout, /PASS/);

  const fail = runQuay(["gate", "VIOLATING", "--gate", "dod", "--file", logFile], workspaceRoot);
  assert.equal(fail.status, 1, `expected violating FAIL (exit 1); got ${fail.status}, stdout=${fail.stdout}, stderr=${fail.stderr}`);
  assert.match(fail.stdout, /FAIL/);
});

test("C1 [AC3]: each gate run appends a GateEvent; `gate-log --json` lists them, most-recent is pass", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac3");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(["task", "create", "COMPLIANT", "--title", "Compliant fixture",
    "--status", "todo", "--body", validSections + acDodChecked], tasksDir);

  runQuay(["gate", "COMPLIANT", "--gate", "dod", "--file", logFile], workspaceRoot);

  const log = runQuay(["gate-log", "COMPLIANT", "--json", "--file", logFile], workspaceRoot);
  assert.equal(log.status, 0, `expected exit 0; got ${log.status}, stderr=${log.stderr}`);
  const events = JSON.parse(log.stdout);
  assert.ok(events.length >= 1, `expected >=1 event; got ${log.stdout}`);
  assert.equal(events[events.length - 1].verdict, "pass");
  // gate-log is read-only: it filters by pipeline_id, so only this task's events.
  assert.ok(events.every((e) => e.pipeline_id === "COMPLIANT"));
});

test("C1: gate-log without --json prints one human line per event (read-only, non-JSON path)", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac3-human");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(["task", "create", "COMPLIANT", "--title", "Compliant fixture",
    "--status", "todo", "--body", validSections + acDodChecked], tasksDir);
  runQuay(["gate", "COMPLIANT", "--gate", "dod", "--file", logFile], workspaceRoot);
  const log = runQuay(["gate-log", "COMPLIANT", "--file", logFile], workspaceRoot);
  assert.equal(log.status, 0);
  assert.match(log.stdout, /dod pass/);
});

// QENG-2 (docs/plans/9-quay-acceptance-meter.md §4): the CLI default gate was
// changed from `dod` to `acceptance` — `quay gate X` (no --gate) now runs the
// task's runnable acceptance meter, fail-closed when unset. The engine's own
// `runGate({ gate = "dod" })` default is untouched (only programmatic callers
// hit it); explicit `--gate dod` still routes to QENG-1's dod gate (asserted by
// the C1 [AC2] test above and acceptance.test.mjs's dod-regression test). This
// test, which previously asserted the OLD `dod` CLI default, is updated to the
// new contract: no --gate + no acceptance meter => fail-closed (exit 1).
test("C1: `quay gate <task>` defaults to the acceptance gate when --gate is omitted (QENG-2)", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac2-default");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(["task", "create", "COMPLIANT", "--title", "Compliant fixture",
    "--status", "todo", "--body", validSections + acDodChecked], tasksDir);
  // No acceptance meter set => the default acceptance gate fails closed (exit 1).
  const r = runQuay(["gate", "COMPLIANT", "--file", logFile], workspaceRoot);
  assert.equal(r.status, 1, `expected acceptance default fail-closed (exit 1); got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
  assert.match(r.stdout, /no acceptance command defined/);
});

// --- exp5-M-GATE-CLI-ERROR-UX AC1: guarded errors are clean, no raw stack trace ---
// engine.js's `runGate` throws on an unknown gate name / missing task by design
// (the top-level catch USED to be the only handler, printing `err.stack` — a
// raw Node stack trace with `at Object.` / `    at ` frames). This asserts the
// FIXED behavior: a clean one-line message on stderr, exit 1, NO stack frames.
const STACK_FRAME_PATTERN = /\bat (Object\.|async |\S+\s\()/;

test("C [ERROR-UX]: `quay gate <id> --gate bogus` → clean `unknown gate: bogus` message, no stack trace", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("erruex-unknown-gate");
  runNative(["task", "create", "EU-1", "--title", "err ux fixture", "--status", "todo",
    "--body", validSections + acDodChecked], tasksDir);
  const r = runQuay(["gate", "EU-1", "--gate", "bogus"], workspaceRoot);
  assert.notEqual(r.status, 0, `expected nonzero exit; got ${r.status}`);
  assert.match(r.stderr, /^unknown gate: bogus\s*$/m, `expected exact clean message line; got stderr=${JSON.stringify(r.stderr)}`);
  assert.ok(!STACK_FRAME_PATTERN.test(r.stderr), `stderr must NOT contain a raw stack trace; got: ${r.stderr}`);
  assert.ok(!r.stderr.includes(".js:"), `stderr must not contain a file:line stack frame; got: ${r.stderr}`);
});

test("C [ERROR-UX]: `quay gate <nonexistent-id>` → clean `no such task: ...` message, no stack trace", () => {
  const { workspaceRoot } = makeWorkspace("erruex-missing-task");
  const r = runQuay(["gate", "NOPE-DOES-NOT-EXIST"], workspaceRoot);
  assert.notEqual(r.status, 0, `expected nonzero exit; got ${r.status}`);
  assert.match(r.stderr, /^no such task: NOPE-DOES-NOT-EXIST\s*$/m, `expected exact clean message line; got stderr=${JSON.stringify(r.stderr)}`);
  assert.ok(!STACK_FRAME_PATTERN.test(r.stderr), `stderr must NOT contain a raw stack trace; got: ${r.stderr}`);
});

// --- exp5-M-GATE-CLI-ARG-ORDER: flag-before-id must parse identically to id-first ---
// Bug: verb-less commands read `const id = sub` (raw argv[3]) and flags off
// parseFlags(rest). A leading flag lands in `sub` (misread as the id) AND its value
// is lost from the flag parse. Fix: re-parse [sub, ...rest] like `run` does.
test("C [ARG-ORDER]: `quay gate --gate dod <id>` (flag before id) == id-first order", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("argorder-gate");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(["task", "create", "COMPLIANT", "--title", "Compliant fixture",
    "--status", "todo", "--body", validSections + acDodChecked], tasksDir);
  // flag BEFORE the id — must behave identically to the documented id-first order,
  // and --gate dod must actually route to the dod gate (not be silently lost).
  const r = runQuay(["gate", "--gate", "dod", "COMPLIANT", "--file", logFile], workspaceRoot);
  assert.equal(r.status, 0, `flag-first should exit 0 PASS; got ${r.status}, stderr=${r.stderr}, stdout=${r.stdout}`);
  assert.match(r.stdout, /PASS/);
});

test("C [ARG-ORDER]: `quay gate-log` with NO id → explicit usage error (not silent empty)", () => {
  const { workspaceRoot } = makeWorkspace("argorder-gatelog-noid");
  const r = runQuay(["gate-log", "--gate", "acceptance"], workspaceRoot);
  assert.notEqual(r.status, 0, `missing id should be a usage error (nonzero); got ${r.status}, stdout=${r.stdout}`);
  assert.match(r.stderr + r.stdout, /missing required.*task-id|requires a .*task-id/i);
});

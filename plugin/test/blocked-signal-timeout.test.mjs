// @test-group engine
// blocked-signal-timeout.test.mjs — gap-blocked-signal-timeout-auto-escalation.
// A blocked signal (`.quay/inner-blocked.json`) that nobody consumes must NOT let inner wait
// forever (tonight's 92-minute false-block class: fake OVER90 / red-window leftover brackets wrote
// a block the outer never consumed). This file pins the CONSUMPTION TIMEOUT / auto-upgrade
// mechanism — `--timeout` (alias `--escalate-stale`) on inner-blocked-signal.ts + the
// `blocked-signal-check.sh --timeout` wrapper:
//   AC1  A blocked signal written and un-consumed for N minutes auto-escalates/archives
//        (升级/归档): the block file is removed, the wait duration lands in telemetry, an
//        escalation line is appended to `.quay/blocked-escalations.jsonl`, and the Contract
//        measure `bash <blocked-signal-check.sh> --timeout 2>&1 | grep -c '升级|归档|escalate'`
//        reads >= 1. Real-run: the fixture writes a 31-minute-old block (default 30m threshold).
//   AC1-  Negative control: a FRESH block (a consumed/young signal) is NOT escalated — the block
//        remains, no escalation log, measure = 0.
//   AC2  The 92-minute false-block shape is eliminated: a task whose OWN status is `ready` with a
//        stale timeout bracket (the os-anchor shape) does NOT fire a false over-90m
//        (`detectTaskOver90m` returns null — the source is gated by task status + reconcile), and
//        `--detect-stop` does NOT re-write a block for it (no re-freeze). The residual safety net
//        (`--timeout`) still archives ANY auto block that slipped through.
//   AC3  Cross-annotation: the mechanism is an independent one carried from
//        gap-telemetry-brackets-vs-subagents-no-slot-visibility AC9 — the script header and the
//        task's ## Carries / ## Contract cross-reference the carry.
//
// Run:
//   scripts/test.sh plugin/test/blocked-signal-timeout.test.mjs
//   node --test plugin/test/blocked-signal-timeout.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function _findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot find repo root: no .quay/config.yml found upward from " + startDir);
}
const REPO_ROOT = _findRepoRoot(__dirname);
const PLUGIN_SCRIPTS = path.join(REPO_ROOT, "plugin", "scripts");
const BLOCKED_CLI = path.join(PLUGIN_SCRIPTS, "inner-blocked-signal.ts");
const CHECK_SH = path.join(PLUGIN_SCRIPTS, "blocked-signal-check.sh");
const TELEMETRY_CLI = path.join(PLUGIN_SCRIPTS, "fast-mode-telemetry.ts");

const DEFAULT_THRESHOLD_MS = 30 * 60_000;

function makeTmpWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "blk-timeout-"));
}

function cleanup(tmpRoot) {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

function runBlockedCli(tmpRoot, ...args) {
  const res = spawnSync("node", ["--no-warnings", "--experimental-strip-types", BLOCKED_CLI, "--root", tmpRoot, ...args], {
    encoding: "utf8",
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/** The Contract measure verbatim: `bash <blocked-signal-check.sh> --timeout 2>&1 | grep -c '升级|归档|escalate'`. */
function runContractMeasure(tmpRoot) {
  const res = spawnSync("bash", [CHECK_SH, "--timeout", "--root", tmpRoot], { encoding: "utf8" });
  const combined = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const matches = combined.match(/升级|归档|escalate/g);
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "", count: matches ? matches.length : 0 };
}

async function importBlocked() {
  return import(BLOCKED_CLI);
}

async function importTelemetry() {
  return import(TELEMETRY_CLI);
}

function seedTaskFile(tmpRoot, taskId, status) {
  fs.mkdirSync(path.join(tmpRoot, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, "tasks", `${taskId}.md`), `---\nid: ${taskId}\nstatus: ${status}\n---\n`, "utf8");
}

test("AC1 — blocked-signal-check.sh --timeout auto-escalates a consumed-by-nobody stale block (Contract measure >= 1)", async () => {
  const mod = await importBlocked();
  const tmp = makeTmpWorkspace();
  try {
    const sinceMs = Date.now() - 31 * 60_000; // 31 min old > default 30 min threshold
    mod.writeBlockedRecord(tmp, mod.buildBlockedRecord({
      taskId: "gap-false-over90", reason: "task-over-90m", question: "abort?", sinceMs, source: "auto",
    }));
    const blockPath = path.join(tmp, ".quay", "inner-blocked.json");
    assert.ok(fs.existsSync(blockPath), "block present before timeout check");

    const m = runContractMeasure(tmp);
    assert.equal(m.status, 0, `blocked-signal-check.sh --timeout must exit 0: ${m.stderr}`);
    assert.ok(m.count >= 1, `Contract measure must be >= 1, got ${m.count}: ${m.stdout}${m.stderr}`);
    assert.match(m.stdout, /升级\/归档/, "escalation line must carry the 升级/归档 keyword");
    assert.match(m.stdout, /ESCALATED/, "escalation line must name the escalation");

    assert.ok(!fs.existsSync(blockPath), "stale block removed — inner cannot freeze indefinitely");
    const escPath = path.join(tmp, ".quay", "blocked-escalations.jsonl");
    assert.ok(fs.existsSync(escPath), "escalation log written");
    const esc = JSON.parse(fs.readFileSync(escPath, "utf8").trim().split("\n").pop());
    assert.equal(esc.taskId, "gap-false-over90");
    assert.equal(esc.reason, "task-over-90m");
    assert.ok(esc.durationMs >= 31 * 60_000, `wait duration recorded: ${esc.durationMs}`);
    const eventsDir = path.join(tmp, ".workflow-events");
    assert.ok(fs.existsSync(eventsDir), "telemetry event store exists");
    const blockedFiles = fs.readdirSync(eventsDir).filter((f) => f.startsWith("blk-"));
    assert.equal(blockedFiles.length, 1, "one blocked-wait telemetry event recorded on escalation");
  } finally {
    cleanup(tmp);
  }
});

test("AC1 — --timeout is a direct CLI alias of --escalate-stale", async () => {
  const mod = await importBlocked();
  const tmp = makeTmpWorkspace();
  try {
    const sinceMs = Date.now() - 31 * 60_000;
    mod.writeBlockedRecord(tmp, mod.buildBlockedRecord({
      taskId: "gap-alias", reason: "ruling-required", question: "rule?", sinceMs, source: "auto",
    }));
    const res = runBlockedCli(tmp, "--timeout", "--max-age-ms", String(DEFAULT_THRESHOLD_MS));
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /ESCALATED/, `--timeout must escalate, got: ${res.stdout}`);
    assert.ok(!fs.existsSync(path.join(tmp, ".quay", "inner-blocked.json")), "stale block removed via --timeout");
  } finally {
    cleanup(tmp);
  }
});

test("AC1 — negative control: a fresh (young/consumed) block is NOT escalated (measure = 0)", async () => {
  const mod = await importBlocked();
  const tmp = makeTmpWorkspace();
  try {
    mod.writeBlockedRecord(tmp, mod.buildBlockedRecord({
      taskId: "gap-fresh", reason: "ruling-required", question: "rule?", sinceMs: Date.now() - 2 * 60_000, source: "auto",
    }));
    const blockPath = path.join(tmp, ".quay", "inner-blocked.json");
    const m = runContractMeasure(tmp);
    assert.equal(m.status, 0, m.stderr);
    assert.equal(m.count, 0, `fresh block must NOT escalate (measure 0), got ${m.count}: ${m.stdout}`);
    assert.ok(fs.existsSync(blockPath), "fresh block remains in place");
    assert.ok(!fs.existsSync(path.join(tmp, ".quay", "blocked-escalations.jsonl")), "no escalation log for a fresh block");
  } finally {
    cleanup(tmp);
  }
});

test("AC2 — the 92-minute false-block shape is eliminated: status=ready task + stale bracket does NOT fire over-90m, and --detect-stop does not re-freeze inner", async () => {
  const mod = await importBlocked();
  const tele = await importTelemetry();
  const tmp = makeTmpWorkspace();
  try {
    // os-anchor false-block shape: task OWN status is `ready` (not in-progress) + a stale timeout
    // bracket (91 minutes) left open from a previous red window.
    seedTaskFile(tmp, "os-anchor", "ready");
    const old = Date.now() - 91 * 60_000;
    tele.writeEvent(tele.buildStartEvent({ taskId: "os-anchor", runId: tele.generateRunId("os-anchor"), recordedAtMs: old }), tmp);

    // (a) The false signal SOURCE is removed: no over-90m fires for the ready-status task.
    const cond = await mod.detectTaskOver90m(tmp);
    assert.equal(cond, null, `false over-90m must NOT fire for status=ready task, got: ${JSON.stringify(cond)}`);

    // (b) --detect-stop therefore does NOT write a block for it (no re-freeze on the same shape).
    const ds = runBlockedCli(tmp, "--detect-stop");
    assert.equal(ds.status, 0, ds.stderr);
    assert.match(ds.stdout, /no stop condition|no block/, `--detect-stop must find nothing: ${ds.stdout}`);
    assert.ok(!fs.existsSync(path.join(tmp, ".quay", "inner-blocked.json")), "no block written for the false shape");

    // (c) The residual safety net: even if a stale auto block slipped through, --timeout archives it.
    mod.writeBlockedRecord(tmp, mod.buildBlockedRecord({
      taskId: "os-anchor", reason: "task-over-90m", question: "abort?", sinceMs: old, source: "auto",
    }));
    const m = runContractMeasure(tmp);
    assert.ok(m.count >= 1, `residual stale block must escalate, got ${m.count}`);
    assert.ok(!fs.existsSync(path.join(tmp, ".quay", "inner-blocked.json")), "residual stale block archived");
  } finally {
    cleanup(tmp);
  }
});

test("AC3 — cross-annotation with gap-telemetry-brackets (the carry) is present in the mechanism and the task file", () => {
  const src = fs.readFileSync(BLOCKED_CLI, "utf8");
  assert.match(src, /gap-telemetry-brackets-vs-subagents-no-slot-visibility/, "script header names the AC9 carry");
  assert.match(src, /gap-blocked-signal-timeout-auto-escalation/, "script header names this independent mechanism");
  assert.match(src, /--timeout/, "script exposes the --timeout consumption-timeout surface");
  assert.match(src, /升级\/归档/, "script emits the 升级/归档 keyword the Contract measure greps");
  const taskFile = path.join(REPO_ROOT, "tasks", "gap-blocked-signal-timeout-auto-escalation.md");
  const task = fs.readFileSync(taskFile, "utf8");
  assert.match(task, /from:\s*gap-telemetry-brackets-vs-subagents-no-slot-visibility/, "task ## Carries names the source task");
  assert.match(task, /AC9/, "task ## Carries names AC9");
});

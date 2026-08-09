// @test-group engine
// closure-lag-check.test.mjs — tasks/gap-closure-pass-has-no-lag-signal.
// The outer's async closure pass ("1b. 异步收尾例程") flips implemented ready-tasks to done. It had
// NO lag signal: a "forced, every-tick" step could silently stop for hours and nothing would report
// it (observed 2026-08-09: 8.5h no outer:close, not-yet-flipped 42/51 = 82% — AC23 only checks the
// tick heartbeat, not the forced steps INSIDE the tick). This test pins the mechanical signal:
// plugin/scripts/closure-lag-check.sh.
//
// Coverage map (task ACs + Contract):
//   AC2 — closure-lag signal: not-yet-flipped > threshold ⇒ exit 1 + CLOSURE-LAG-WARN;
//         closure-pass overdue (trace older than --timeout, or trace MISSING with pending work) ⇒
//         exit 1 + WARN. Negative control: normal (below threshold + fresh trace) ⇒ exit 0 silent.
//   AC3 — execution verifiable: `--record --flipped <N>` writes .quay/closure-pass-last-run.json
//         with a timestamp (ranAt) + flip count (flipped); a consumer (the measure mode) reads it.
//   Contract measure — the exit code IS the signal (`bash plugin/scripts/closure-lag-check.sh`):
//         0 silent, 1 reported, 2 usage/environment error.
//   Contract invariant closure_pass_leaves_trace — every closure-pass execution writes the trace.
//   --json is measure-only and NEVER mutates (same contract as sync-lag-check --json).
//
// Fixtures are self-contained temp workspaces (tasks/ dir + .quay/); nothing in the real checkout
// is mutated (R3 test-isolation). `// @test-group engine` — an operational outer-loop mechanism.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const CHECK = join(repoRoot, "plugin", "scripts", "closure-lag-check.sh");

function run(args, opts = {}) {
  const res = spawnSync("bash", [CHECK, ...args], { encoding: "utf8", ...opts });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function makeWorkspace(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `closure-lag-${prefix}-`));
  mkdirSync(join(dir, "tasks"), { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

// A ready task with ALL ACs checked → ready-pool-check's notYetFlipped fires via the AC-checkbox
// signal (allAcsChecked), no git history needed (the temp workspace is not a git repo — the
// git-history index fails closed to empty, so workLanded is false; the AC path is deterministic).
function writeNotYetFlippedTask(root, id, acBoxes = 2) {
  const acLines = Array.from({ length: acBoxes }, (_, i) => `- [x] an AC item ${i} that is long enough`);
  const body = [
    "---",
    `id: ${id}`,
    `title: fixture ${id}`,
    "status: ready",
    "labels: []",
    "parent: null",
    "children: []",
    "extra: {}",
    "---",
    "",
    "**type:** execution",
    "",
    "## Proposal",
    "A real proposal paragraph that is definitely more than forty non-whitespace chars.",
    "",
    "## Acceptance Criteria",
    ...acLines,
    "",
    "## Definition of Done",
    "standard DoD",
    "",
  ].join("\n");
  writeFileSync(join(root, "tasks", `${id}.md`), body, "utf8");
}

function writeTrace(root, { ranAt, flipped = 0 }) {
  mkdirSync(join(root, ".quay"), { recursive: true });
  writeFileSync(
    join(root, ".quay", "closure-pass-last-run.json"),
    JSON.stringify({ ranAt, flipped, at: new Date(ranAt * 1000).toISOString() }) + "\n",
    "utf8",
  );
}

const nowEpoch = Math.floor(Date.now() / 1000);

// ── AC2: backlog over threshold ⇒ signal ──────────────────────────────────────────────────────────

test("AC2 — not-yet-flipped backlog over --threshold ⇒ exit 1 + CLOSURE-LAG-WARN", () => {
  const w = makeWorkspace("ac2a");
  try {
    writeNotYetFlippedTask(w, "GAP-A");
    writeNotYetFlippedTask(w, "GAP-B");
    const r = run(["--root", w, "--threshold", "1"]);
    assert.equal(r.status, 1, `backlog signal must exit 1:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /CLOSURE-LAG-WARN/);
    assert.match(r.stdout, /not-yet-flipped=2 > threshold=1/);
  } finally { cleanup(w); }
});

// ── AC2: closure-pass overdue (trace stale) ⇒ signal ─────────────────────────────────────────────

test("AC2 — closure-pass overdue (trace older than --timeout) ⇒ exit 1 + CLOSURE-LAG-WARN", () => {
  const w = makeWorkspace("ac2b");
  try {
    writeTrace(w, { ranAt: nowEpoch - 5000, flipped: 1 });
    const r = run(["--root", w, "--timeout", "1"]);
    assert.equal(r.status, 1, `overdue signal must exit 1:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /CLOSURE-LAG-WARN/);
    assert.match(r.stdout, /closure-pass-overdue/);
  } finally { cleanup(w); }
});

// ── AC2: trace missing with pending work ⇒ signal (the 8.5h-silent defect class) ──────────────────

test("AC2 — trace MISSING with pending closure work ⇒ exit 1 (closure-pass never ran)", () => {
  const w = makeWorkspace("ac2c");
  try {
    writeNotYetFlippedTask(w, "GAP-C");
    const r = run(["--root", w]);
    assert.equal(r.status, 1, `missing-trace-with-work must exit 1:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /CLOSURE-LAG-WARN/);
    assert.match(r.stdout, /closure-pass-never-ran/);
  } finally { cleanup(w); }
});

// ── Negative control: normal ⇒ silent (exit 0, no WARN) ──────────────────────────────────────────

test("negative control — below threshold + fresh trace ⇒ exit 0, silent", () => {
  const w = makeWorkspace("ctrl");
  try {
    writeNotYetFlippedTask(w, "GAP-D");
    writeTrace(w, { ranAt: nowEpoch - 5, flipped: 1 });
    const r = run(["--root", w, "--threshold", "30"]);
    assert.equal(r.status, 0, `normal state must exit 0:\n${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stdout, /CLOSURE-LAG-WARN/, "normal state must be silent");
    assert.match(r.stdout, /ok/);
  } finally { cleanup(w); }
});

// ── Negative control: trace missing but NO pending work ⇒ silent ─────────────────────────────────

test("negative control — trace missing with ZERO pending work ⇒ exit 0, silent", () => {
  const w = makeWorkspace("ctrl2");
  try {
    const r = run(["--root", w, "--threshold", "1"]);
    assert.equal(r.status, 0, `no-work no-trace must exit 0:\n${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stdout, /CLOSURE-LAG-WARN/);
  } finally { cleanup(w); }
});

// ── AC3: --record writes the trace; a consumer then sees a fresh pass ─────────────────────────────

test("AC3 — --record --flipped N writes timestamp + flip count; measure reads it fresh", () => {
  const w = makeWorkspace("ac3");
  try {
    writeNotYetFlippedTask(w, "GAP-E");
    const rec = run(["--root", w, "--record", "--flipped", "3"]);
    assert.equal(rec.status, 0, `--record must exit 0:\n${rec.stdout}${rec.stderr}`);
    assert.match(rec.stdout, /recorded closure-pass trace/);

    const tracePath = join(w, ".quay", "closure-pass-last-run.json");
    const parsed = JSON.parse(readFileSync(tracePath, "utf8"));
    assert.ok(typeof parsed.ranAt === "number" && Number.isInteger(parsed.ranAt), "ranAt is an epoch timestamp");
    assert.equal(parsed.flipped, 3, "flip count recorded");
    assert.ok(Math.abs(parsed.ranAt - nowEpoch) < 60, "trace timestamp is fresh");

    // A consumer (measure mode) now sees a FRESH pass even with pending work below the threshold.
    const fresh = run(["--root", w, "--threshold", "1"]);
    assert.equal(fresh.status, 0, `fresh trace + below-threshold must exit 0:\n${fresh.stdout}${fresh.stderr}`);
    assert.doesNotMatch(fresh.stdout, /CLOSURE-LAG-WARN/);
  } finally { cleanup(w); }
});

// ── Contract measure: --json reports the signal shape and NEVER mutates ───────────────────────────

test("--json reports the signal shape and never writes a trace", () => {
  const w = makeWorkspace("json");
  try {
    writeNotYetFlippedTask(w, "GAP-F");
    writeNotYetFlippedTask(w, "GAP-G");
    const fire = run(["--root", w, "--threshold", "1", "--json"]);
    assert.equal(fire.status, 1, `firing --json must exit 1:\n${fire.stdout}${fire.stderr}`);
    const j = JSON.parse(fire.stdout);
    assert.equal(j.not_yet_flipped, 2);
    assert.equal(j.backlog_over_threshold, true);
    assert.equal(j.closure_pass_last_run, null);
    assert.equal(j.signal, true);
    // --json never mutates: no trace file is created.
    const tracePath = join(w, ".quay", "closure-pass-last-run.json");
    assert.equal(existsSync(tracePath), false, "--json must not create the trace");

    // Normal state: --json exits 0 with signal=false.
    writeTrace(w, { ranAt: nowEpoch - 5, flipped: 1 });
    const ok = run(["--root", w, "--threshold", "30", "--json"]);
    assert.equal(ok.status, 0, `normal --json must exit 0:\n${ok.stdout}${ok.stderr}`);
    const j2 = JSON.parse(ok.stdout);
    assert.equal(j2.signal, false);
    assert.equal(j2.closure_pass_last_run, nowEpoch - 5);
    assert.equal(j2.last_flipped, 1);
  } finally { cleanup(w); }
});

// ── Usage / environment errors exit 2 ─────────────────────────────────────────────────────────────

test("usage/environment errors exit 2 (no --flipped, unknown arg, not a workspace)", () => {
  const w = makeWorkspace("err");
  try {
    const noFlipped = run(["--root", w, "--record"]);
    assert.equal(noFlipped.status, 2, "--record without --flipped must exit 2");
    assert.match(noFlipped.stderr, /--flipped/);

    const badArg = run(["--root", w, "--bogus"]);
    assert.equal(badArg.status, 2, "unknown argument must exit 2");
    assert.match(badArg.stderr, /unknown argument/);

    const notAWorkspace = join(w, "empty");
    mkdirSync(notAWorkspace, { recursive: true });
    const noTasks = run(["--root", notAWorkspace]);
    assert.equal(noTasks.status, 2, "not-a-workspace (no tasks/) must exit 2");
    assert.match(noTasks.stderr, /not a workspace/);
  } finally { cleanup(w); }
});

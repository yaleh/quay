// @test-group engine
// blocked-signal-parameterized.test.mjs —
// gap-ruling-required-only-covers-outer-to-inner-not-manager-to-outer: the "who-is-waiting"
// mechanism (inner-blocked-signal.ts screen observer) is generalized from ONE-DIRECTIONAL +
// HARDCODED (outer→inner only, .quay/inner-blocked.json, one reaction) into a PARAMETERIZED
// observation primitive. WHO is watched (--target), HOW MANY consecutive samples (--samples), and
// WHAT happens on detection (--action / --action-command) are caller-configured — inner/outer/manager
// are each observable with one call, not new code per direction.
//
// AC1 --target <name> ⇒ output .quay/blocked-signals/<target>.json (inner keeps the legacy
//     .quay/inner-blocked.json — backward compat negative control) · AC2 --samples <N> overridable
//     (default 3 preserved) · AC3 action plugin point (write-file / notify / command) · AC4
//     classifyPaneState's ENUMERATED_STATES stays CLOSED (ADR-016 — grep proof) · AC5 manager watches
//     outer via one configured call (waiting ⇒ reported; busy ⇒ not reported).
//
// Same discipline as ruling-required-wiring.test.mjs: NO terminal sessions/windows — the classifier
// is a pure function and pane fixtures are inline strings / temp files.
//
// Run:
//   scripts/test.sh plugin/test/blocked-signal-parameterized.test.mjs
//   node --test plugin/test/blocked-signal-parameterized.test.mjs

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
const CLI = path.join(REPO_ROOT, "plugin", "scripts", "inner-blocked-signal.ts");
const PANE_CLASSIFY = path.join(REPO_ROOT, "plugin", "scripts", "pane-state-classify.ts");

const INNER_BLOCKED_PATH = (root) => path.join(root, ".quay", "inner-blocked.json");
const TARGET_BLOCKED_PATH = (root, t) => path.join(root, ".quay", "blocked-signals", `${t}.json`);

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────

function makeTmpWorkspace(prefix = "blk-param-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(tmp) {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

function runCli(tmp, args, env = {}) {
  const res = spawnSync(
    "node",
    ["--no-warnings", "--experimental-strip-types", CLI, "--root", tmp, ...args],
    { encoding: "utf8", env: { ...process.env, ...env } },
  );
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function writePaneFile(tmp, name, text) {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, text, "utf8");
  return p;
}

function readBlocked(root, t) {
  const f = t === "inner" ? INNER_BLOCKED_PATH(root) : TARGET_BLOCKED_PATH(root, t);
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

function observerStatePath(root, t) {
  return t === "inner"
    ? path.join(root, ".quay", ".ruling-observer-state.json")
    : path.join(root, ".quay", "blocked-signals", `.${t}-observer-state.json`);
}

function readObserverState(root, t = "inner") {
  const f = observerStatePath(root, t);
  if (!fs.existsSync(f)) return { consecutiveNeedsInput: 0, updatedAtMs: 0 };
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

// ── Fixture pane texts (same shapes as ruling-required-wiring.test.mjs) ──────────────────────────────

const WAITING_INPUT_PANE = [
  "───────────────────────────────",
  "❯ ",
  "───────────────────────────────",
  "  ⏵⏵ bypass permissions on · 1 monitor · ↓ to manage",
].join("\n");

const BUSY_PANE = [
  "───────────────────────────────",
  "❯ ",
  "───────────────────────────────",
  "  ⏵⏵ bypass permissions on · 1 monitor · esc to interrupt · ↓ to manage",
].join("\n");

const PERMISSION_PANE = [
  "Quick safety check: Is this a project you created or one you trust?",
  "❯ 1. Yes, I trust this folder ✔",
  "  2. No, exit",
  "Enter to confirm · Esc to cancel",
].join("\n");

// ── AC1: --target parameterizes the output namespace ─────────────────────────────────────────────────

test("AC1 — --target outer writes .quay/blocked-signals/outer.json (not inner-blocked.json)", () => {
  const tmp = makeTmpWorkspace();
  try {
    const pane = writePaneFile(tmp, "perm.txt", PERMISSION_PANE);
    const res = runCli(tmp, ["--detect-stop", "--target", "outer", "--pane", pane, "--samples", "1"]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /signal=\.quay\/blocked-signals\/outer\.json/, "stdout must name the target's namespaced signal");
    assert.ok(fs.existsSync(TARGET_BLOCKED_PATH(tmp, "outer")), "outer block file must exist");
    assert.ok(!fs.existsSync(INNER_BLOCKED_PATH(tmp)), "inner-blocked.json must NOT be written for --target outer");
    const rec = readBlocked(tmp, "outer");
    assert.equal(rec.reason, "ruling-required");
    assert.equal(rec.taskId, "outer", "a non-inner target's record names the target, not fast-mode-loop");

    // Read-back via --read --target outer.
    const read = runCli(tmp, ["--read", "--target", "outer"]);
    assert.equal(read.status, 0, read.stderr);
    assert.equal(JSON.parse(read.stdout).reason, "ruling-required");
  } finally {
    cleanup(tmp);
  }
});

test("AC1 — --target manager writes .quay/blocked-signals/manager.json", () => {
  const tmp = makeTmpWorkspace();
  try {
    const pane = writePaneFile(tmp, "perm.txt", PERMISSION_PANE);
    const res = runCli(tmp, ["--detect-stop", "--target", "manager", "--pane", pane, "--samples", "1"]);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(fs.existsSync(TARGET_BLOCKED_PATH(tmp, "manager")), "manager block file must exist");
    assert.ok(!fs.existsSync(INNER_BLOCKED_PATH(tmp)), "inner must stay untouched");
    assert.equal(readBlocked(tmp, "manager").taskId, "manager");
  } finally {
    cleanup(tmp);
  }
});

test("AC1 — backward compat: --target inner (and the no-target default) still write .quay/inner-blocked.json", () => {
  const tmp = makeTmpWorkspace();
  try {
    const pane = writePaneFile(tmp, "perm.txt", PERMISSION_PANE);
    const explicit = runCli(tmp, ["--detect-stop", "--target", "inner", "--pane", pane, "--samples", "1"]);
    assert.equal(explicit.status, 0, explicit.stderr);
    assert.ok(fs.existsSync(INNER_BLOCKED_PATH(tmp)), "--target inner must keep the legacy path");
    assert.ok(!fs.existsSync(TARGET_BLOCKED_PATH(tmp, "inner")), "no blocked-signals/inner.json — inner is the legacy path");

    // Negative control: the default (no --target) is byte-for-behavior inner.
    const tmp2 = makeTmpWorkspace();
    try {
      const pane2 = writePaneFile(tmp2, "perm.txt", PERMISSION_PANE);
      runCli(tmp2, ["--detect-stop", "--pane", pane2, "--samples", "1"]);
      assert.ok(fs.existsSync(INNER_BLOCKED_PATH(tmp2)), "no --target ⇒ inner path (legacy default)");
    } finally {
      cleanup(tmp2);
    }
  } finally {
    cleanup(tmp);
  }
});

test("AC1 — an invalid --target fails closed (no file, exit 1)", () => {
  const tmp = makeTmpWorkspace();
  try {
    const res = runCli(tmp, ["--detect-stop", "--target", "../etc/passwd"]);
    assert.notEqual(res.status, 0, "a non-filename-safe target must fail closed");
    assert.match(res.stderr, /invalid --target/, "stderr must name the target problem");
    assert.ok(!fs.existsSync(INNER_BLOCKED_PATH(tmp)), "no inner block written");
  } finally {
    cleanup(tmp);
  }
});

// ── AC2: --samples parameterizes the consecutive-sample threshold ────────────────────────────────────

test("AC2 — --samples 2 fires after TWO consecutive waiting-input samples (not 3)", () => {
  const tmp = makeTmpWorkspace();
  try {
    const pane = writePaneFile(tmp, "wait.txt", WAITING_INPUT_PANE);
    const r1 = runCli(tmp, ["--detect-stop", "--target", "outer", "--pane", pane, "--samples", "2"]);
    assert.equal(r1.status, 0, r1.stderr);
    assert.match(r1.stdout, /branch=accumulating consecutive=1\/2/, `sample 1 accumulates: ${r1.stdout}`);
    assert.ok(!fs.existsSync(TARGET_BLOCKED_PATH(tmp, "outer")), "sample 1 must not write");

    const r2 = runCli(tmp, ["--detect-stop", "--target", "outer", "--pane", pane, "--samples", "2"]);
    assert.equal(r2.status, 0, r2.stderr);
    assert.match(r2.stdout, /branch=ruling-required consecutive=2\/2/, `sample 2 writes: ${r2.stdout}`);
    assert.ok(fs.existsSync(TARGET_BLOCKED_PATH(tmp, "outer")), "sample 2 must write the block");
  } finally {
    cleanup(tmp);
  }
});

test("AC2 — --samples 1 fires on the first observation; the default remains 3 (source constant)", async () => {
  const cli = await import(CLI);
  assert.equal(cli.RULING_REQUIRED_PANE_SAMPLES, 3, "the default stays 3 (AC2: default preserved)");
  const tmp = makeTmpWorkspace();
  try {
    const pane = writePaneFile(tmp, "wait.txt", WAITING_INPUT_PANE);
    const r1 = runCli(tmp, ["--detect-stop", "--target", "outer", "--pane", pane, "--samples", "1"]);
    assert.equal(r1.status, 0, r1.stderr);
    assert.match(r1.stdout, /branch=ruling-required consecutive=1\/1/, r1.stdout);
    assert.ok(fs.existsSync(TARGET_BLOCKED_PATH(tmp, "outer")), "--samples 1 ⇒ immediate block");
  } finally {
    cleanup(tmp);
  }
});

// ── AC3: action plugin point — the post-detect reaction is caller-configured ─────────────────────────

test("AC3 — --action notify reports the block without writing any file", () => {
  const tmp = makeTmpWorkspace();
  try {
    const pane = writePaneFile(tmp, "wait.txt", WAITING_INPUT_PANE);
    const res = runCli(tmp, ["--detect-stop", "--target", "outer", "--pane", pane, "--samples", "1", "--action", "notify"]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /detect-stop: BLOCKED ruling-required:/, "notify prints the BLOCKED line");
    assert.ok(!fs.existsSync(TARGET_BLOCKED_PATH(tmp, "outer")), "notify must NOT write the signal file");
    assert.ok(!fs.existsSync(INNER_BLOCKED_PATH(tmp)), "inner file must stay absent too");
  } finally {
    cleanup(tmp);
  }
});

test("AC3 — --action-command runs a caller-configured command with the condition in the environment", () => {
  const tmp = makeTmpWorkspace();
  try {
    const pane = writePaneFile(tmp, "wait.txt", WAITING_INPUT_PANE);
    const marker = path.join(tmp, "action-ran.txt");
    // The command receives BLOCKED_CONDITION_JSON (the full stop condition) and BLOCKED_SIGNAL_PATH.
    const cmd = `node -e 'const fs=require("fs");const c=JSON.parse(process.env.BLOCKED_CONDITION_JSON);fs.writeFileSync(process.env.ACTION_MARKER, c.reason+"|"+process.env.BLOCKED_SIGNAL_PATH+"|"+process.env.BLOCKED_TARGET)'`;
    const res = runCli(tmp, ["--detect-stop", "--target", "outer", "--pane", pane, "--samples", "1",
      "--action-command", cmd], { ACTION_MARKER: marker });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /action command executed/, res.stdout);
    assert.ok(fs.existsSync(marker), "the caller's command must have run");
    const written = fs.readFileSync(marker, "utf8");
    assert.equal(written, `ruling-required|${TARGET_BLOCKED_PATH(tmp, "outer")}|outer`,
      "the env carries the condition reason, the target signal path, and the target name");
    assert.ok(!fs.existsSync(TARGET_BLOCKED_PATH(tmp, "outer")), "command action must not also write the signal file");
  } finally {
    cleanup(tmp);
  }
});

test("AC3 — an invalid --action fails closed", () => {
  const tmp = makeTmpWorkspace();
  try {
    const res = runCli(tmp, ["--detect-stop", "--action", "delete-everything"]);
    assert.notEqual(res.status, 0, "a non-registered action must fail closed");
    assert.match(res.stderr, /invalid --action/);
  } finally {
    cleanup(tmp);
  }
});

test("AC3 — --action command without --action-command fails closed (no silent /bin/sh -c undefined)", () => {
  const tmp = makeTmpWorkspace();
  try {
    const res = runCli(tmp, ["--detect-stop", "--action", "command"]);
    assert.notEqual(res.status, 0, "--action command with no command must fail closed");
    assert.match(res.stderr, /requires --action-command/);
  } finally {
    cleanup(tmp);
  }
});

test("AC1 — .gitignore covers the non-inner namespaced signal dir (it must never dirty the tree)", () => {
  const gitignore = fs.readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8");
  assert.match(gitignore, /\.quay\/blocked-signals/, ".gitignore must contain the blocked-signals namespace");
});

// ── AC4: classifyPaneState's ENUMERATED_STATES stays CLOSED (ADR-016) ────────────────────────────────

test("AC4 — the pane-state classifier's ENUMERATED_STATES is unchanged (closed enum, ADR-016)", async () => {
  const src = fs.readFileSync(PANE_CLASSIFY, "utf8");
  // The enum is declared exactly once, with exactly the five ADR-016 states. A grep over the file
  // must surface the same line — the enum is NOT opened to new states by this task.
  const m = src.match(/const ENUMERATED_STATES = (\[[^\]]*\])/);
  assert.ok(m, "ENUMERATED_STATES must be declared");
  assert.deepEqual(JSON.parse(m[1].replace(/'/g, '"')), [
    "waiting-input",
    "permission-prompt",
    "busy",
    "error-banner",
    "unknown",
  ], "the five enumerated states are exactly the ADR-016 closed set");

  // Behavioral backstop: classifyPaneState still returns exactly those states for the fixtures.
  const { classifyPaneState } = await import(PANE_CLASSIFY);
  assert.equal(classifyPaneState(WAITING_INPUT_PANE).state, "waiting-input");
  assert.equal(classifyPaneState(BUSY_PANE).state, "busy");
  assert.equal(classifyPaneState(PERMISSION_PANE).state, "permission-prompt");
});

// ── AC5: manager watches outer via one configured call ───────────────────────────────────────────────

test("AC5 — manager watches outer: waiting outer pane ⇒ outer.json reported after N samples", () => {
  const tmp = makeTmpWorkspace();
  try {
    const pane = writePaneFile(tmp, "wait.txt", WAITING_INPUT_PANE);
    const env = { INNER_BLOCKED_RULING_SAMPLES: "3" }; // default threshold, exercised via the observer
    for (let i = 1; i <= 2; i++) {
      const r = runCli(tmp, ["--detect-stop", "--target", "outer", "--pane", pane], env);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, new RegExp(`branch=accumulating consecutive=${i}/3`), `sample ${i}: ${r.stdout}`);
      assert.ok(!fs.existsSync(TARGET_BLOCKED_PATH(tmp, "outer")), `sample ${i}: no block yet`);
    }
    const r3 = runCli(tmp, ["--detect-stop", "--target", "outer", "--pane", pane], env);
    assert.equal(r3.status, 0, r3.stderr);
    assert.match(r3.stdout, /branch=ruling-required consecutive=3\/3/, r3.stdout);
    const rec = readBlocked(tmp, "outer");
    assert.ok(rec, "outer.json must exist after 3 consecutive waiting samples");
    assert.equal(rec.reason, "ruling-required");
    assert.equal(rec.taskId, "outer");
    assert.match(rec.question, /outer pane has been waiting/, "the question names the OBSERVED layer (outer), not inner");
  } finally {
    cleanup(tmp);
  }
});

test("AC5 — negative control: an outer BUSY pane is NOT reported (and resets the counter)", () => {
  const tmp = makeTmpWorkspace();
  try {
    const waiting = writePaneFile(tmp, "wait.txt", WAITING_INPUT_PANE);
    const busy = writePaneFile(tmp, "busy.txt", BUSY_PANE);
    // Build a streak of 2 toward outer…
    runCli(tmp, ["--detect-stop", "--target", "outer", "--pane", waiting]);
    runCli(tmp, ["--detect-stop", "--target", "outer", "--pane", waiting]);
    assert.equal(readObserverState(tmp, "outer").consecutiveNeedsInput, 2, "outer streak built to 2");

    // …then a busy sample resets it and never writes.
    const res = runCli(tmp, ["--detect-stop", "--target", "outer", "--pane", busy]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /pane_decision=busy branch=reset/, res.stdout);
    assert.ok(!fs.existsSync(TARGET_BLOCKED_PATH(tmp, "outer")), "busy must not report outer as blocked");
    assert.equal(readObserverState(tmp, "outer").consecutiveNeedsInput, 0, "busy resets the outer counter");
  } finally {
    cleanup(tmp);
  }
});

test("AC5 — per-target observer state: inner and outer streaks are independent", () => {
  const tmp = makeTmpWorkspace();
  try {
    const waiting = writePaneFile(tmp, "wait.txt", WAITING_INPUT_PANE);
    const busy = writePaneFile(tmp, "busy.txt", BUSY_PANE);
    // Inner streak of 2.
    runCli(tmp, ["--detect-stop", "--pane", waiting]);
    runCli(tmp, ["--detect-stop", "--pane", waiting]);
    assert.equal(readObserverState(tmp, "inner").consecutiveNeedsInput, 2, "inner streak = 2");

    // Observing OUTER busy must reset ONLY the outer counter, never the inner one.
    runCli(tmp, ["--detect-stop", "--target", "outer", "--pane", busy]);
    assert.equal(readObserverState(tmp, "outer").consecutiveNeedsInput, 0, "outer counter reset");
    assert.equal(readObserverState(tmp, "inner").consecutiveNeedsInput, 2, "inner counter untouched");

    // Outer waiting starts its OWN streak from zero.
    const r = runCli(tmp, ["--detect-stop", "--target", "outer", "--pane", waiting]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /branch=accumulating consecutive=1\/3/, "outer streak starts fresh at 1");
    assert.equal(readObserverState(tmp, "outer").consecutiveNeedsInput, 1);
  } finally {
    cleanup(tmp);
  }
});

test("AC5 — non-inner targets do NOT run the inner-specific transcript composite (observation primitive only)", () => {
  // Watching outer/manager is the SCREEN observation primitive — the merge-conflict / transcript
  // composite / task-over-90m detectors are INNER-LAYER state and must not fire for a non-inner
  // target, even if a stale transcript is passed.
  const tmp = makeTmpWorkspace();
  try {
    const dir = makeTmpWorkspace("blk-param-tr-");
    try {
      const transcript = path.join(dir, "transcript.jsonl");
      fs.writeFileSync(transcript, "{}\n", "utf8");
      const t = new Date(Date.now() - 35 * 60 * 1000);
      fs.utimesSync(transcript, t, t);
      const res = runCli(tmp, ["--detect-stop", "--target", "outer", "--transcript", transcript]);
      assert.equal(res.status, 0, res.stderr);
      assert.match(res.stdout, /no stop condition/, "a non-inner target must not fire the transcript composite");
      assert.ok(!fs.existsSync(TARGET_BLOCKED_PATH(tmp, "outer")), "no outer block from the transcript composite");
    } finally {
      cleanup(dir);
    }
  } finally {
    cleanup(tmp);
  }
});

test("AC1/AC5 — --clear --target outer removes only the outer signal (per-target isolation) and resets its counter", () => {
  const tmp = makeTmpWorkspace();
  try {
    const pane = writePaneFile(tmp, "perm.txt", PERMISSION_PANE);
    // Assert BOTH inner and outer blocks.
    runCli(tmp, ["--detect-stop", "--pane", pane, "--samples", "1"]); // inner
    runCli(tmp, ["--detect-stop", "--target", "outer", "--pane", pane, "--samples", "1"]); // outer
    assert.ok(fs.existsSync(INNER_BLOCKED_PATH(tmp)), "inner block present");
    assert.ok(fs.existsSync(TARGET_BLOCKED_PATH(tmp, "outer")), "outer block present");

    const clear = runCli(tmp, ["--clear", "--target", "outer"]);
    assert.equal(clear.status, 0, clear.stderr);
    assert.ok(!fs.existsSync(TARGET_BLOCKED_PATH(tmp, "outer")), "outer cleared");
    assert.ok(fs.existsSync(INNER_BLOCKED_PATH(tmp)), "inner block untouched by --clear --target outer");
    assert.equal(readObserverState(tmp, "outer").consecutiveNeedsInput, 0, "outer counter reset");
  } finally {
    cleanup(tmp);
  }
});

// ── Contract measure (AC1) — the parameterized call is grep-able for the target namespace ─────────────

test("Contract measure — a --target outer invocation greps the 'blocked-signals/outer' namespace", () => {
  const tmp = makeTmpWorkspace();
  try {
    const pane = writePaneFile(tmp, "wait.txt", WAITING_INPUT_PANE);
    const res = runCli(tmp, ["--detect-stop", "--target", "outer", "--pane", pane, "--samples", "1"]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /blocked-signals\/outer/, "stdout must carry the target's namespace path");
  } finally {
    cleanup(tmp);
  }
});

// ── Candidate B (gap-last-pane-txt-has-no-writer): LIVE tmux capture when the --pane snapshot is stale/absent ──
//
// The dead-snapshot class: `.quay/last-pane.txt` had NO writer, so its stale bytes were classified
// busy / reset / 0/3 forever and A7 could never detect a stopped inner. Candidate B makes
// observePaneForRuling read a LIVE capture-pane when the snapshot is stale (> PANE_STALENESS_MS) or
// absent — eliminating the whole dead-snapshot class. These tests drive the observer DIRECTLY with a
// `liveCaptureFn` injection seam (the repo's "NO terminal sessions/windows" discipline) so the live
// fallback is exercised hermetically; the seam is the exact function `capturePaneLive` wraps.

// Reusable env-clearing helper: with these set to empty strings the CLI child cannot resolve any
// tmux target (env override empty, no orchestration/session-config.env in the tmp workspace), so a
// live capture is guaranteed unavailable — hermetic regardless of whether the test runner itself runs
// inside tmux.
function blankTmuxEnv() {
  return { SESSION_TMUX_SESSION: "", SESSION_TMUX_SOCKET: "", SESSION_TMUX_TARGET: "", INNER_BLOCKED_TMUX_TARGET: "" };
}

test("candidate B — a STALE pane file is never classified; the observer reads the LIVE capture instead (source=live)", async () => {
  const cli = await import(CLI);
  const tmp = makeTmpWorkspace();
  try {
    const pane = writePaneFile(tmp, "stale.txt", WAITING_INPUT_PANE);
    const t = new Date(Date.now() - 400 * 1000); // older than PANE_STALENESS_MS (300s)
    fs.utimesSync(pane, t, t);

    let liveCalls = 0;
    const obs = await cli.observePaneForRuling(tmp, {
      panePath: pane,
      nowMs: Date.now(),
      samples: 1,
      target: "outer",
      tmuxTarget: "quay-0:outer",
      liveCaptureFn: (target) => { liveCalls++; assert.equal(target, "quay-0:outer"); return WAITING_INPUT_PANE; },
    });
    assert.equal(obs.source, "live", "a stale snapshot must be attributed to the LIVE source");
    assert.equal(obs.state, "waiting-input", "the live pane is classified, not the stale bytes");
    assert.ok(obs.condition, "samples=1 ⇒ a ruling-required condition emerges from the live read");
    assert.equal(liveCalls, 1, "live capture invoked exactly once");
    assert.match(obs.condition.evidence.join("\n"), /pane source: live \(snapshot stale\/absent — live tmux capture\)/,
      "the evidence names the live source (the verification anchor for the dead-snapshot fix)");
  } finally {
    cleanup(tmp);
  }
});

test("candidate B — a FRESH pane file wins (source=file); live capture is NOT invoked", async () => {
  const cli = await import(CLI);
  const tmp = makeTmpWorkspace();
  try {
    const pane = writePaneFile(tmp, "fresh.txt", WAITING_INPUT_PANE); // fresh mtime
    let liveCalls = 0;
    const obs = await cli.observePaneForRuling(tmp, {
      panePath: pane,
      nowMs: Date.now(),
      samples: 1,
      target: "outer",
      tmuxTarget: "quay-0:outer",
      liveCaptureFn: () => { liveCalls++; return BUSY_PANE; },
    });
    assert.equal(obs.source, "file", "a fresh snapshot stays on the file source");
    assert.equal(obs.state, "waiting-input");
    assert.equal(liveCalls, 0, "live capture must NOT be invoked while the file is fresh (backward-safety)");
  } finally {
    cleanup(tmp);
  }
});

test("candidate B — STALE file + live capture unavailable ⇒ unreadable, counter reset, no condition (fail-closed)", async () => {
  const cli = await import(CLI);
  const tmp = makeTmpWorkspace();
  try {
    const pane = writePaneFile(tmp, "stale.txt", WAITING_INPUT_PANE);
    const t = new Date(Date.now() - 400 * 1000);
    fs.utimesSync(pane, t, t);

    // Build a streak of 2 toward outer first (via a fresh file so it registers).
    const fresh = writePaneFile(tmp, "fresh.txt", WAITING_INPUT_PANE);
    await cli.observePaneForRuling(tmp, { panePath: fresh, samples: 3, target: "outer" });
    await cli.observePaneForRuling(tmp, { panePath: fresh, samples: 3, target: "outer" });
    assert.equal(cli.readRulingObserverState(tmp, "outer").consecutiveNeedsInput, 2, "streak built to 2");

    // Now a stale file with a FAILING live capture ⇒ unreadable + counter reset, never busy-classified.
    const obs = await cli.observePaneForRuling(tmp, {
      panePath: pane,
      nowMs: Date.now(),
      samples: 3,
      target: "outer",
      tmuxTarget: "quay-0:outer",
      liveCaptureFn: () => null, // tmux unreachable / target pane missing
    });
    assert.equal(obs.source, null, "no source when both file and live fail");
    assert.equal(obs.state, "unreadable");
    assert.equal(obs.condition, null);
    assert.equal(cli.readRulingObserverState(tmp, "outer").consecutiveNeedsInput, 0,
      "stale + unavailable resets the counter — no false positive on stale data");
  } finally {
    cleanup(tmp);
  }
});

test("candidate B — ABSENT --pane file + live capture success ⇒ source=live (no dead-snapshot trust)", async () => {
  const cli = await import(CLI);
  const tmp = makeTmpWorkspace();
  try {
    const pane = path.join(tmp, "never-written.txt");
    let liveCalls = 0;
    const obs = await cli.observePaneForRuling(tmp, {
      panePath: pane,
      nowMs: Date.now(),
      samples: 1,
      target: "inner",
      tmuxTarget: "quay-0:inner",
      liveCaptureFn: (target) => { liveCalls++; assert.equal(target, "quay-0:inner"); return PERMISSION_PANE; },
    });
    assert.equal(obs.source, "live", "an absent snapshot falls back to live");
    assert.equal(obs.state, "permission-prompt", "a permission prompt is a needs-input sample (AC3)");
    assert.ok(obs.condition, "samples=1 ⇒ a stopped-at-prompt inner is DETECTABLE (blocked_detectable invariant)");
    assert.equal(liveCalls, 1);
  } finally {
    cleanup(tmp);
  }
});

test("candidate B — no panePath and no resolvable tmux target ⇒ unobserved no-op (live never guessed)", async () => {
  const cli = await import(CLI);
  const tmp = makeTmpWorkspace();
  try {
    // Blank every tmux/session env and use a tmp workspace with NO orchestration/session-config.env
    // ⇒ resolveTmuxTarget returns null ⇒ the live fallback is a no-op, never a guessed session.
    const saved = {};
    for (const k of ["SESSION_TMUX_SESSION", "SESSION_TMUX_SOCKET", "SESSION_TMUX_TARGET", "INNER_BLOCKED_TMUX_TARGET"]) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    try {
      const obs = await cli.observePaneForRuling(tmp, {
        nowMs: Date.now(),
        samples: 3,
        target: "inner",
        liveCaptureFn: () => { assert.fail("live capture must not run without a resolvable target"); },
      });
      assert.equal(obs.source, null);
      assert.equal(obs.state, "unobserved", "no pane source at all ⇒ unobserved, not inferred");
      assert.equal(obs.condition, null);
    } finally {
      for (const k of Object.keys(saved)) {
        if (saved[k] !== undefined) process.env[k] = saved[k]; else delete process.env[k];
      }
    }
  } finally {
    cleanup(tmp);
  }
});

test("candidate B — AC2 with a LIVE source: two consecutive live samples reach the threshold and write", async () => {
  const cli = await import(CLI);
  const tmp = makeTmpWorkspace();
  try {
    // The dead-snapshot defect was "always busy / always reset / never 3". With a live source the
    // observer must be able to ACCUMULATE across observations (blocked_detectable).
    let calls = 0;
    const obs1 = await cli.observePaneForRuling(tmp, {
      nowMs: Date.now(), samples: 2, target: "inner",
      tmuxTarget: "quay-0:inner",
      liveCaptureFn: () => { calls++; return WAITING_INPUT_PANE; },
    });
    assert.equal(obs1.state, "waiting-input");
    assert.equal(obs1.consecutive, 1, "first live sample accumulates 1/2");
    assert.equal(obs1.condition, null, "1/2 is not yet a block");

    const obs2 = await cli.observePaneForRuling(tmp, {
      nowMs: Date.now(), samples: 2, target: "inner",
      tmuxTarget: "quay-0:inner",
      liveCaptureFn: () => { calls++; return WAITING_INPUT_PANE; },
    });
    assert.equal(obs2.consecutive, 2, "second live sample reaches 2/2");
    assert.ok(obs2.condition, "a LIVE waiting pane is detectable after the threshold (blocked_detectable)");
    assert.equal(calls, 2, "two live captures, one per observation");
  } finally {
    cleanup(tmp);
  }
});

test("candidate B — busy is never a false positive from a LIVE source (busy_not_false_positive)", async () => {
  const cli = await import(CLI);
  const tmp = makeTmpWorkspace();
  try {
    const obs = await cli.observePaneForRuling(tmp, {
      nowMs: Date.now(), samples: 3, target: "inner",
      tmuxTarget: "quay-0:inner",
      liveCaptureFn: () => BUSY_PANE,
    });
    assert.equal(obs.state, "busy");
    assert.equal(obs.needsInput, false, "a busy live pane is never a needs-input sample");
    assert.equal(obs.condition, null, "busy never produces a ruling-required condition");
    assert.equal(cli.readRulingObserverState(tmp, "inner").consecutiveNeedsInput, 0, "busy resets the counter");
  } finally {
    cleanup(tmp);
  }
});

test("candidate B — CLI: a STALE --pane file with live unavailable ⇒ unreadable/reset (never busy/never block)", () => {
  const tmp = makeTmpWorkspace();
  try {
    const pane = writePaneFile(tmp, "stale.txt", WAITING_INPUT_PANE);
    const t = new Date(Date.now() - 400 * 1000);
    fs.utimesSync(pane, t, t);
    // Blank the tmux env so the child cannot resolve a live target → live capture guaranteed unavailable.
    const res = runCli(tmp, ["--detect-stop", "--target", "inner", "--pane", pane, "--samples", "3"], blankTmuxEnv());
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /pane_decision=unreadable branch=reset consecutive=0\/3/, res.stdout);
    assert.match(res.stdout, /no stop condition/, "a stale file with no live source must NOT produce a block");
    assert.ok(!fs.existsSync(INNER_BLOCKED_PATH(tmp)), "no block from a stale/unreadable pane");
  } finally {
    cleanup(tmp);
  }
});

test("candidate B — resolveTmuxTarget precedence: explicit env > session env > session-config.env > null (never a guess)", async () => {
  const cli = await import(CLI);
  const tmp = makeTmpWorkspace();
  const saved = {};
  for (const k of ["SESSION_TMUX_SESSION", "SESSION_TMUX_SOCKET", "SESSION_TMUX_TARGET", "INNER_BLOCKED_TMUX_TARGET"]) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  try {
    // 1) Nothing configured ⇒ null (the "NO guess" discipline — no invented session name).
    assert.equal(cli.resolveTmuxTarget(tmp, "inner"), null, "no config ⇒ null");

    // 2) SESSION_TMUX_SESSION env ⇒ "<session>:<target>".
    process.env.SESSION_TMUX_SESSION = "sess-a";
    assert.equal(cli.resolveTmuxTarget(tmp, "inner"), "sess-a:inner");
    assert.equal(cli.resolveTmuxTarget(tmp, "outer"), "sess-a:outer", "the role window names the observed target");

    // 3) SESSION_TMUX_TARGET (session-liveness explicit target override) wins over the session env.
    process.env.SESSION_TMUX_TARGET = "st-target";
    assert.equal(cli.resolveTmuxTarget(tmp, "inner"), "st-target");

    // 4) INNER_BLOCKED_TMUX_TARGET (the observer's own explicit override) wins over everything.
    process.env.INNER_BLOCKED_TMUX_TARGET = "explicit-sess:win";
    assert.equal(cli.resolveTmuxTarget(tmp, "inner"), "explicit-sess:win");

    // 5) No env ⇒ the <root>/orchestration/session-config.env file is the fallback.
    delete process.env.SESSION_TMUX_SESSION;
    delete process.env.SESSION_TMUX_TARGET;
    delete process.env.INNER_BLOCKED_TMUX_TARGET;
    const envFile = path.join(tmp, "orchestration", "session-config.env");
    fs.mkdirSync(path.dirname(envFile), { recursive: true });
    fs.writeFileSync(envFile, 'SESSION_TMUX_SESSION="from-file"\n', "utf8");
    assert.equal(cli.resolveTmuxTarget(tmp, "inner"), "from-file:inner");
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] !== undefined) process.env[k] = saved[k]; else delete process.env[k];
    }
  }
});

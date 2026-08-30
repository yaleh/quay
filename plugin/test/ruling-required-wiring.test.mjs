// @test-group engine
// ruling-required-wiring.test.mjs — gap-ruling-required-trigger-is-dead-code-never-wired-into-any-tick:
// the "ruling-required" trigger is re-wired from dead code (the `--transcript` composite was never
// passed by any production tick) to the SCREEN observer: `--detect-stop --pane <pane.txt>` classifies
// the pane's BOTTOM REGION via `classifyPaneState` (pure SHAPE classification — ADR-016 Amendment, no
// whole-screen hash) and, after N consecutive waiting-input / permission-prompt samples, writes
// `.quay/inner-blocked.json` with reason "ruling-required".
//
// AC1 production wiring exists (--pane → classifyPaneState → auto write) · AC2 structural latency
// bound = samples × poll (3 × 60s ≈ 3min ≤ 5min p100) · AC3 --transcript preserved but no longer the
// primary criterion · AC4 bidirectional negative control (busy ⇒ NOT written; waiting-input ⇒
// written) · AC5 no whole-screen hash anywhere in the wiring · AC7 node:test + @test-group
// governance.
//
// Outer ruling R3: this test NEVER creates or cleans up terminal sessions/windows — the classifier
// is a pure function and the pane fixtures are inline strings / temp files, so no tmux/pty is needed.
//
// Run:
//   QUAY_TEST_SKIP_STATIC_CHECKS=1 scripts/test.sh plugin/test/ruling-required-wiring.test.mjs
//   node --test plugin/test/ruling-required-wiring.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { classifyPaneState } from "../scripts/pane-state-classify.ts";

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
const TELEMETRY = path.join(REPO_ROOT, "plugin", "scripts", "fast-mode-telemetry.ts");

const BLOCKED_PATH = (root) => path.join(root, ".quay", "inner-blocked.json");
const OBSERVER_STATE_PATH = (root) => path.join(root, ".quay", ".ruling-observer-state.json");

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────

function makeTmpWorkspace(prefix = "ruling-wiring-") {
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

function readObserverState(root) {
  return JSON.parse(fs.readFileSync(OBSERVER_STATE_PATH(root), "utf8"));
}

async function importCli() {
  return import(CLI);
}

/**
 * Backdate a synthetic --task-start telemetry event so the transcript composite detector can observe
 * an in-progress task (same technique as inner-blocked-signal.test.mjs).
 */
async function writeBackdatedStartEvent(tmp, taskId, msAgo) {
  const telemetry = await import(TELEMETRY);
  const ev = telemetry.buildStartEvent({
    taskId,
    runId: telemetry.generateRunId(taskId),
    executionCwd: tmp,
    baseCommit: null,
    recordedAtMs: Date.now() - msAgo,
  });
  telemetry.writeEvent(ev, tmp);
}

/** A clean git workspace: one commit, clean tree, .gitignore for .workflow-events/ and .quay/. */
function makeCleanGitWorkspace() {
  const tmp = makeTmpWorkspace("ruling-wiring-git-");
  const git = (args) => spawnSync("git", ["-C", tmp, ...args], { encoding: "utf8" });
  const ok = (r, what) => { assert.equal(r.status, 0, `${what} failed: ${r.stderr}`); };
  ok(git(["init", "-q"]), "git init");
  ok(git(["config", "user.email", "test@test"]), "config email");
  ok(git(["config", "user.name", "test"]), "config name");
  fs.writeFileSync(path.join(tmp, ".gitignore"), ".workflow-events/\n.quay/\n", "utf8");
  fs.writeFileSync(path.join(tmp, "f.txt"), "base\n");
  ok(git(["add", "f.txt", ".gitignore"]), "add base");
  ok(git(["commit", "-qm", "base"]), "commit base");
  return { tmp };
}

/** A stale transcript in its OWN temp dir (never inside the git workspace — would poison the clean
 * tree). mtime backdated `msAgo`. Caller must cleanup(path.dirname(transcript)). */
function writeStaleTranscript(msAgo) {
  const dir = makeTmpWorkspace("ruling-wiring-tr-");
  const p = path.join(dir, "transcript.jsonl");
  fs.writeFileSync(p, "{}\n", "utf8");
  const t = new Date(Date.now() - msAgo);
  fs.utimesSync(p, t, t);
  return p;
}

// ── Fixture pane texts (inline — shapes from the recorded real panes in pane-state-classify) ─────────

const WAITING_INPUT_PANE = [
  "───────────────────────────────",
  "❯ ",
  "───────────────────────────────",
  "  ⏵⏵ bypass permissions on · 1 monitor · ↓ to manage",
].join("\n");

// A waiting-input pane whose session is waiting on its OWN background subagent — status area carries
// "← 1 agent". This is BENIGN IDLE, not "waiting for a human ruling" (outer ruling 2026-08-04).
const WAITING_INPUT_WITH_AGENT_PANE = [
  "───────────────────────────────",
  "❯ ",
  "───────────────────────────────",
  "  ⏵⏵ bypass permissions on · 1 monitor · ← 1 agent · ↓ to manage",
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

// ── AC1/AC2: waiting-input → N consecutive samples → ruling-required block ───────────────────────────

test("AC1/AC2 — a waiting-input pane writes ruling-required only after N consecutive samples", () => {
  const tmp = makeTmpWorkspace();
  try {
    const pane = writePaneFile(tmp, "waiting.txt", WAITING_INPUT_PANE);
    const env = { INNER_BLOCKED_RULING_SAMPLES: "3" };

    // Samples 1 and 2: the branch is "accumulating", no block is written, the counter advances.
    for (let i = 1; i <= 2; i++) {
      const res = runCli(tmp, ["--detect-stop", "--pane", pane], env);
      assert.equal(res.status, 0, res.stderr);
      assert.match(
        res.stdout,
        new RegExp(`pane_decision=waiting-input branch=accumulating consecutive=${i}/3`),
        `sample ${i} must print the accumulating branch: ${res.stdout}`,
      );
      assert.ok(!fs.existsSync(BLOCKED_PATH(tmp)), `sample ${i}: no block yet`);
      assert.equal(readObserverState(tmp).consecutiveNeedsInput, i, "counter advances one per sample");
    }

    // Sample 3: branch "ruling-required", block auto-written.
    const res = runCli(tmp, ["--detect-stop", "--pane", pane], env);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /pane_decision=waiting-input branch=ruling-required consecutive=3\/3/, res.stdout);
    assert.match(res.stdout, /STOP CONDITION — ruling-required/, res.stdout);
    assert.ok(fs.existsSync(BLOCKED_PATH(tmp)), "3rd consecutive sample must write the block");

    const rec = JSON.parse(fs.readFileSync(BLOCKED_PATH(tmp), "utf8"));
    assert.equal(rec.reason, "ruling-required");
    assert.equal(rec.source, "auto", "mechanically detected — not a manual assert");
    assert.equal(rec.taskId, "fast-mode-loop");
    assert.match(rec.question, /waiting for input/, "actionable question names the observed stall");
    assert.match(rec.question, /rule on what to do/, "actionable — what the outer must decide");
    assert.ok(rec.evidence.some((e) => /pane classified waiting-input/.test(e)), "evidence carries the classifier verdict");
    assert.ok(rec.evidence.some((e) => /bottom region/.test(e)), "evidence carries the bottom region (ADR-016 carve-out)");
  } finally {
    cleanup(tmp);
  }
});

test("AC1 — a permission-prompt pane produces ruling-required (the class ruling D names most important)", () => {
  const tmp = makeTmpWorkspace();
  try {
    const pane = writePaneFile(tmp, "perm.txt", PERMISSION_PANE);
    const env = { INNER_BLOCKED_RULING_SAMPLES: "1" };
    const res = runCli(tmp, ["--detect-stop", "--pane", pane], env);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /pane_decision=permission-prompt branch=ruling-required/, res.stdout);
    assert.ok(fs.existsSync(BLOCKED_PATH(tmp)), "a permission prompt must be caught immediately");
    const rec = JSON.parse(fs.readFileSync(BLOCKED_PATH(tmp), "utf8"));
    assert.equal(rec.reason, "ruling-required");
    assert.match(rec.question, /permission prompt/, "question names the dialog class");
  } finally {
    cleanup(tmp);
  }
});

test("AC4 — a waiting-input pane whose session is waiting on its OWN background agent (status '← 1 agent') is benign idle — no ruling-required", () => {
  // Outer ruling 2026-08-04: a real false positive was observed on the manager pane (waiting-input
  // with "← 1 agent" in the status area while its batch fan-in agent was running). Waiting for one's
  // own background subagent is NOT waiting for a human ruling — the sample must not count.
  const tmp = makeTmpWorkspace();
  try {
    const pane = writePaneFile(tmp, "waiting-agent.txt", WAITING_INPUT_WITH_AGENT_PANE);
    const env = { INNER_BLOCKED_RULING_SAMPLES: "3" };
    for (let i = 0; i < 3; i++) {
      const res = runCli(tmp, ["--detect-stop", "--pane", pane], env);
      assert.equal(res.status, 0, res.stderr);
      assert.match(
        res.stdout,
        /pane_decision=waiting-input branch=reset consecutive=0\/3/,
        `in-flight agent idle must never count a sample: ${res.stdout}`,
      );
      assert.ok(!fs.existsSync(BLOCKED_PATH(tmp)), `iteration ${i}: no block`);
    }
    assert.equal(readObserverState(tmp).consecutiveNeedsInput, 0, "waiting-for-agent idle never accumulates");
  } finally {
    cleanup(tmp);
  }
});

// ── AC4: negative control (bidirectional) ─────────────────────────────────────────────────────────────

test("AC4 — negative control: a busy pane (esc to interrupt) NEVER writes ruling-required and resets the counter", () => {
  const tmp = makeTmpWorkspace();
  try {
    const waiting = writePaneFile(tmp, "waiting.txt", WAITING_INPUT_PANE);
    const busy = writePaneFile(tmp, "busy.txt", BUSY_PANE);
    const env = { INNER_BLOCKED_RULING_SAMPLES: "3" };

    // Build a streak of 2 with the waiting pane, so the busy reset is actually observable.
    runCli(tmp, ["--detect-stop", "--pane", waiting], env);
    runCli(tmp, ["--detect-stop", "--pane", waiting], env);
    assert.equal(readObserverState(tmp).consecutiveNeedsInput, 2, "streak built to 2");

    const res = runCli(tmp, ["--detect-stop", "--pane", busy], env);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /pane_decision=busy branch=reset consecutive=0\/3/, res.stdout);
    assert.ok(!fs.existsSync(BLOCKED_PATH(tmp)), "busy must not write ruling-required");
    assert.equal(readObserverState(tmp).consecutiveNeedsInput, 0, "busy resets the rolling counter");

    // The waiting-input direction must write (the other half of the bidirectional control).
    runCli(tmp, ["--detect-stop", "--pane", waiting], env);
    runCli(tmp, ["--detect-stop", "--pane", waiting], env);
    runCli(tmp, ["--detect-stop", "--pane", waiting], env);
    assert.ok(fs.existsSync(BLOCKED_PATH(tmp)), "waiting-input direction MUST write after 3 samples");
  } finally {
    cleanup(tmp);
  }
});

test("AC4 — fail-closed: a missing pane file resets the counter and never writes a block", () => {
  const tmp = makeTmpWorkspace();
  try {
    const waiting = writePaneFile(tmp, "waiting.txt", WAITING_INPUT_PANE);
    const env = { INNER_BLOCKED_RULING_SAMPLES: "3" };
    runCli(tmp, ["--detect-stop", "--pane", waiting], env);
    runCli(tmp, ["--detect-stop", "--pane", waiting], env);
    assert.equal(readObserverState(tmp).consecutiveNeedsInput, 2);

    const res = runCli(tmp, ["--detect-stop", "--pane", path.join(tmp, "does-not-exist.txt")], env);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /pane_decision=unreadable branch=reset/, res.stdout);
    assert.ok(!fs.existsSync(BLOCKED_PATH(tmp)), "a missing pane file must not write a block");
    assert.equal(readObserverState(tmp).consecutiveNeedsInput, 0, "missing pane resets the counter");
  } finally {
    cleanup(tmp);
  }
});

test("AC4/AC2 — an explicit --clear resets the rolling counter", () => {
  const tmp = makeTmpWorkspace();
  try {
    const pane = writePaneFile(tmp, "waiting.txt", WAITING_INPUT_PANE);
    const env = { INNER_BLOCKED_RULING_SAMPLES: "3" };
    runCli(tmp, ["--detect-stop", "--pane", pane], env);
    runCli(tmp, ["--detect-stop", "--pane", pane], env);
    assert.equal(readObserverState(tmp).consecutiveNeedsInput, 2);
    const res = runCli(tmp, ["--clear"], env);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(readObserverState(tmp).consecutiveNeedsInput, 0, "--clear resets the observer counter");
  } finally {
    cleanup(tmp);
  }
});

test("AC4 — busy is a hard negative even against a stale transcript (live screen evidence beats the transcript heuristic)", async () => {
  // The AC9c false-positive shape: a stale transcript while the inner is GENUINELY busy. The pane
  // observer resolves it mechanically — a busy pane proves the inner is actively working, so
  // ruling-required must NOT be written by ANY detector (transcript composite included).
  const { tmp } = makeCleanGitWorkspace();
  let transcript;
  try {
    await writeBackdatedStartEvent(tmp, "gap-busy-stale", 35 * 60 * 1000);
    transcript = writeStaleTranscript(35 * 60 * 1000);
    const busy = writePaneFile(tmp, "busy.txt", BUSY_PANE);
    const env = { INNER_BLOCKED_RULING_SAMPLES: "3" };

    const res = runCli(tmp, ["--detect-stop", "--transcript", transcript, "--pane", busy], env);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /pane_decision=busy branch=reset/, res.stdout);
    assert.ok(!fs.existsSync(BLOCKED_PATH(tmp)), "a busy pane must suppress ruling-required even with a stale transcript");
  } finally {
    cleanup(tmp);
    if (transcript) cleanup(path.dirname(transcript));
  }
});

test("AC4/AC3 — an auto ruling-required block auto-clears once the pane returns to busy (release path)", () => {
  const tmp = makeTmpWorkspace();
  try {
    const waiting = writePaneFile(tmp, "waiting.txt", WAITING_INPUT_PANE);
    const busy = writePaneFile(tmp, "busy.txt", BUSY_PANE);
    const env = { INNER_BLOCKED_RULING_SAMPLES: "3" };
    for (let i = 0; i < 3; i++) runCli(tmp, ["--detect-stop", "--pane", waiting], env);
    assert.ok(fs.existsSync(BLOCKED_PATH(tmp)), "block written after 3 samples");

    const res = runCli(tmp, ["--detect-stop", "--pane", busy], env);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(!fs.existsSync(BLOCKED_PATH(tmp)), "busy ⇒ condition cleared ⇒ auto block removed");
    assert.match(res.stdout, /cleared/, "detect-stop reports the auto clear");
  } finally {
    cleanup(tmp);
  }
});

// ── AC3: --transcript preserved but no longer primary ────────────────────────────────────────────────

test("AC3 — the --transcript composite path is preserved and still writes ruling-required on its own (no --pane)", async () => {
  const { tmp } = makeCleanGitWorkspace();
  let transcript;
  try {
    const staleMinutes = 35; // > 30m transcript threshold, < 90m task-over-90m proxy
    await writeBackdatedStartEvent(tmp, "gap-ruling-transcript", staleMinutes * 60 * 1000);
    transcript = writeStaleTranscript(staleMinutes * 60 * 1000);

    const res = runCli(tmp, ["--detect-stop", "--transcript", transcript]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /STOP CONDITION — ruling-required/, `transcript composite must still fire: ${res.stdout}`);
    const rec = JSON.parse(fs.readFileSync(BLOCKED_PATH(tmp), "utf8"));
    assert.equal(rec.reason, "ruling-required");
    assert.match(rec.question, /transcript has not advanced/, "the transcript composite's own question");
  } finally {
    cleanup(tmp);
    if (transcript) cleanup(path.dirname(transcript));
  }
});

test("AC3 — with both --pane and --transcript, the pane observer is PRIMARY (its question wins, no double ruling-required)", async () => {
  // The pane fixture is a PERMISSION-PROMPT: it is a human-wait by definition, so it fires even with
  // an in-progress task bracket (telemetry), unlike a plain waiting-input which the in-flight
  // disambiguation would suppress. This proves the pane observer takes precedence over the transcript
  // composite when both could fire.
  const { tmp } = makeCleanGitWorkspace();
  let transcript;
  try {
    const staleMinutes = 35;
    await writeBackdatedStartEvent(tmp, "gap-ruling-both", staleMinutes * 60 * 1000);
    transcript = writeStaleTranscript(staleMinutes * 60 * 1000);
    const pane = writePaneFile(tmp, "perm.txt", PERMISSION_PANE);
    const env = { INNER_BLOCKED_RULING_SAMPLES: "1" }; // pane fires on the first observation

    const res = runCli(tmp, ["--detect-stop", "--transcript", transcript, "--pane", pane], env);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /pane_decision=permission-prompt branch=ruling-required/, res.stdout);
    // The transcript composite is suppressed when the pane already produced ruling-required —
    // exactly one STOP CONDITION line, and its question is the PANE's, not the transcript's.
    assert.match(res.stdout, /STOP CONDITION — ruling-required/, res.stdout);
    assert.doesNotMatch(res.stdout, /also: ruling-required/, "the transcript composite must be suppressed, not double-reported");

    const rec = JSON.parse(fs.readFileSync(BLOCKED_PATH(tmp), "utf8"));
    assert.equal(rec.reason, "ruling-required");
    assert.match(rec.question, /permission prompt/, "the pane observer is the primary criterion");
    assert.doesNotMatch(rec.question, /transcript has not advanced/, "the transcript question must not win when the pane fired");
  } finally {
    cleanup(tmp);
    if (transcript) cleanup(path.dirname(transcript));
  }
});

// ── AC5: no whole-screen hash anywhere in the wiring ─────────────────────────────────────────────────

test("AC5 — the wiring is a SHAPE classification, never a whole-screen hash (ADR-016 Amendment)", async () => {
  const cli = await importCli();
  const src = fs.readFileSync(CLI, "utf8");

  // The verdict source of truth is the shape classifier; the evidence carries the bottom region.
  assert.match(src, /classifyPaneState/, "the wiring must call the pure shape classifier");
  assert.match(src, /bottom region/, "the evidence carries the bottom region, not the whole screen");

  // No hash API enters the decision path (the word "md5" appears only in historical comments,
  // so assert on the API surface, not the word).
  assert.doesNotMatch(src, /createHash|\.digest\(|subtle\.digest|node:crypto|hashSync/, "no hash API in the wiring");

  // Behavioral backstop (AC7 hash-regression style): if the wiring had any hash/equality over the
  // whole pane, two DIFFERENT waiting-input panes would not be treated identically. Here they must
  // both classify waiting-input and both drive the same verdict.
  const variantA = WAITING_INPUT_PANE;
  const variantB = "completely different upper content\n".repeat(5) + "\n" + WAITING_INPUT_PANE;
  assert.equal(classifyPaneState(variantA).state, classifyPaneState(variantB).state, "same bottom region ⇒ same verdict regardless of upper content");
});

test("AC1 — .gitignore covers the pane observer's rolling counter (it must never dirty the clean tree)", () => {
  // The transcript composite requires a clean working tree; the observer state advances/resets every
  // 60s poll, so committing it would permanently dirty the tree. Same gitignored runtime-state family
  // as inner-blocked.json.
  const gitignore = fs.readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8");
  assert.match(gitignore, /\.ruling-observer-state\.json/, ".gitignore must contain the observer state file");
});

// @test-group lowconc
// @load-sensitive wall-clock
// session-liveness-target.test.mjs — the monitor watches the CONFIGURED target (the inner role
// window), not ITSELF (the outer pane that hosts it) — gap-session-liveness-monitor-watches-self-not-inner.
//
// ROOT CAUSE: with SESSION_TARGETS unset, the zero-config default resolves to <base>:outer — the
// monitor's OWN session (the pane that hosts it). The measured shape (2026-08-08): the outer's
// monitor reported pane_pid 2989418 (outer itself) instead of inner's 2989409, so SESSION-IDLE for
// the inner session was never delivered. The fix has two parts, both tested here:
//   * SESSION_TARGETS names the inner role window (three-column "<名字> <仓根> <tmux目标>"), so
//     session_pid resolves the INNER pane's claude pid — never the outer pane's, never the
//     monitor's own pid.
//   * SESSION_TRANSCRIPTS' name MUST equal the SESSION_TARGETS target name — transcript_for()
//     matches BY NAME. A name mismatch silently drops the transcript heartbeat (the monitor would
//     "watch the inner process but judge liveness by the outer heartbeat"); the startup
//     config-wiring audit WARNs on that shape.
//
// PART OF THE session-liveness test family (split-concurrency-safety: owns the /tmp prefix
// "session-liveness-tgt-", sweeps ONLY it — never a sibling file's active probe dir).
//
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — real processes
// + tmux timing; passes isolated under low load. Routed to the `lowconc` group (the hermetic-but-
// load-sensitive phase at concurrency 3).
//
// Run: scripts/test.sh session-liveness-target.test.mjs   /   node --test session-liveness-target.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  SCRIPT, tmuxAvailable,
  setProbeTmpPrefix, sessionLivenessAfter, tmux, isClaudePid,
  waitForAlive, makeHermeticProbe, makeTwoWindowSession,
  waitForSelfClaude, spawnMonitor, waitForOutput,
} from "./session-liveness-helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// OWN the /tmp probe prefix for this split file (see SPLIT CONCURRENCY SAFETY above).
setProbeTmpPrefix("session-liveness-tgt-");

after(() => {
  sessionLivenessAfter("session-liveness-tgt-");
});

test("T1 — SESSION_TARGETS (three-column) aims at the INNER role window: reports the inner pane_pid, never the outer pane's pid, never the monitor's own pid", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeTwoWindowSession("tgt-inner");
  try {
    // claude ONLY in the inner window (as the pane foreground process — claude-as-pane-process).
    tmux(["send-keys", "-t", "tgt-inner:inner", "exec -a claude-probe sleep 10000"], p.env);
    tmux(["send-keys", "-t", "tgt-inner:inner", "Enter"], p.env);
    assert.ok(await waitForSelfClaude(p.env, "tgt-inner:inner"), "the inner pane foreground must become the claude stand-in");
    const innerPid = tmux(["list-panes", "-t", "tgt-inner:inner", "-F", "#{pane_pid}"], p.env).stdout.trim();
    const outerPid = tmux(["list-panes", "-t", "tgt-inner:outer", "-F", "#{pane_pid}"], p.env).stdout.trim();
    assert.ok(innerPid && outerPid && innerPid !== outerPid, "inner and outer must be distinct panes");
    assert.ok(isClaudePid(innerPid), "the inner pane foreground must be the claude stand-in (control is real)");

    const once = spawnSync("bash", [SCRIPT, "--once"], {
      encoding: "utf8",
      env: { ...p.env, SESSION_ROOT: p.tmp, SESSION_TARGETS: `quay ${p.tmp} tgt-inner:inner` },
    });
    assert.equal(once.status, 0, `--once must exit 0:\n${once.stderr}`);
    assert.match(once.stdout, /SESSION-STATUS quay alive=1/,
      `the configured inner target must report alive:\n${once.stdout}`);
    assert.ok(once.stdout.includes(`pid=${innerPid}`),
      `must report the INNER window's pid (${innerPid}), not the outer's (${outerPid}):\n${once.stdout}`);
    assert.ok(!once.stdout.includes(`pid=${outerPid}`),
      `must NOT report the outer window's pid (${outerPid}) — the self-watch defect shape:\n${once.stdout}`);
    // the monitor's OWN bash pid must never be reported as the watched claude session.
    assert.ok(once.pid && !once.stdout.includes(`pid=${once.pid}`),
      `must NOT report the monitor's own pid (${once.pid}) as the watched session:\n${once.stdout}`);
  } finally {
    p.cleanup();
  }
});

test("T2 — negative control: aiming SESSION_TARGETS at the claude-less OUTER window reports alive=0 (does not pick up the inner pid when aimed elsewhere)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeTwoWindowSession("tgt-outer");
  try {
    // claude ONLY in the inner window; the OUTER window has a bare shell (no claude).
    tmux(["send-keys", "-t", "tgt-outer:inner", "exec -a claude-probe sleep 10000"], p.env);
    tmux(["send-keys", "-t", "tgt-outer:inner", "Enter"], p.env);
    assert.ok(await waitForSelfClaude(p.env, "tgt-outer:inner"), "the inner pane foreground must become the claude stand-in");
    const innerPid = tmux(["list-panes", "-t", "tgt-outer:inner", "-F", "#{pane_pid}"], p.env).stdout.trim();
    const outerPid = tmux(["list-panes", "-t", "tgt-outer:outer", "-F", "#{pane_pid}"], p.env).stdout.trim();
    assert.ok(innerPid && outerPid && innerPid !== outerPid, "inner and outer must be distinct panes");
    assert.ok(isClaudePid(innerPid), "the inner pane foreground must be the claude stand-in (control is real)");

    const once = spawnSync("bash", [SCRIPT, "--once"], {
      encoding: "utf8",
      env: { ...p.env, SESSION_ROOT: p.tmp, SESSION_TARGETS: `quay ${p.tmp} tgt-outer:outer` },
    });
    assert.equal(once.status, 0, `--once must exit 0:\n${once.stderr}`);
    assert.match(once.stdout, /SESSION-STATUS quay alive=0/,
      `a claude-less outer window must report alive=0 (the monitor must not watch its own/outer session by accident):\n${once.stdout}`);
    assert.ok(!once.stdout.includes(`pid=${innerPid}`),
      `must NOT report the inner pid (${innerPid}) when aimed at the outer window:\n${once.stdout}`);
  } finally {
    p.cleanup();
  }
});

test("T3 — SESSION_TRANSCRIPTS is wired BY NAME: a matched name makes the transcript the heartbeat (OVERDUE fires on a stale transcript); a MISMATCHED name is caught by the startup config-wiring WARN", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("tgt-xscript");
  const xscript = path.join(p.tmp, "session.jsonl");
  try {
    fs.writeFileSync(xscript, "{}\n");
    spawnSync("touch", ["-d", "3 hours ago", xscript], { encoding: "utf8" }); // stale transcript
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");

    // (a) MATCHED name: target name "quay" == transcript name "quay" → the transcript IS the
    //     heartbeat → a stale transcript fires SESSION-OVERDUE (the transcript is wired, not the
    //     outer tick-log default).
    const monOk = spawnMonitor(p.env, `quay ${p.tmp} ${p.session}`, { transcripts: `quay ${xscript}`, overdueMin: 1 });
    try {
      assert.ok(await waitForOutput(monOk, /SESSION-OVERDUE quay/, 6000),
        `matched transcript name must wire the transcript as the heartbeat (OVERDUE on stale):\n${monOk.output()}`);
    } finally {
      monOk.child.kill("SIGKILL");
      monOk.cleanup();
    }

    // (b) MISMATCHED name: transcript name "inner" ≠ target name "quay" → the startup audit WARNs
    //     (the exact failure shape that left the monitor watching itself while thinking it had a
    //     transcript heartbeat).
    const once = spawnSync("bash", [SCRIPT, "--once"], {
      encoding: "utf8",
      env: {
        ...p.env,
        SESSION_ROOT: p.tmp,
        SESSION_TARGETS: `quay ${p.tmp} ${p.session}`,
        SESSION_TRANSCRIPTS: `inner ${xscript}`,
      },
    });
    assert.equal(once.status, 0, `--once must exit 0:\n${once.stderr}`);
    assert.match(once.stderr, /WARN SESSION_TRANSCRIPTS 的名字「inner」不匹配任何 SESSION_TARGETS 目标名/,
      `a name-mismatched transcript config must be warned at startup (the silent half-blind shape):\n${once.stderr}`);
  } finally {
    p.cleanup();
  }
});

test("T4 — AC1: a caller's explicit unknown SESSION_TRANSCRIPTS name SURVIVES the env-file source and is WARNed (the manager 12:5x 'outer vs quay' silent-clobber shape) — gap-session-liveness-ignores-unknown-transcript-names", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("tgt-caller-unknown");
  const xscript = path.join(p.tmp, "session.jsonl");
  try {
    fs.writeFileSync(xscript, "{}\n");
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    // env file carries a VALID target name + a MATCHING transcript name — the exact shape that
    // would silently clobber the caller's explicit SESSION_TRANSCRIPTS WITHOUT the pin-restore
    // (the env-file source runs before the audit, so the caller's name never reached it).
    fs.mkdirSync(path.join(p.tmp, "orchestration"), { recursive: true });
    fs.writeFileSync(path.join(p.tmp, "orchestration", "session-liveness.env"),
      `SESSION_TARGETS="quay ${p.tmp} ${p.session}"\n` +
      `SESSION_TRANSCRIPTS="quay ${xscript}"\n`);
    // Caller passes an UNKNOWN transcript name and does NOT set SESSION_TARGETS → the env file
    // sources. The caller's "outer" must SURVIVE the source (pin-restore) and be WARNed by the
    // startup config-wiring audit — NOT silently clobbered by the env file's matching "quay".
    const env = { ...p.env, SESSION_ROOT: p.tmp, SESSION_TRANSCRIPTS: `outer ${xscript}` };
    delete env.SESSION_TARGETS;
    const once = spawnSync("bash", [SCRIPT, "--once"], { encoding: "utf8", env });
    assert.equal(once.status, 0, `--once must exit 0:\n${once.stderr}`);
    assert.match(once.stderr, /WARN SESSION_TRANSCRIPTS 的名字「outer」不匹配任何 SESSION_TARGETS 目标名/,
      `a caller-provided unknown transcript name must survive the env-file source and be WARNed (silent-clobber shape):\n${once.stderr}`);
  } finally {
    p.cleanup();
  }
});

test("T5 — AC2 negative control: transcript/heartbeat names that MATCH a target name produce ZERO WARN (legal config not harmed)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("tgt-matched-names");
  const xscript = path.join(p.tmp, "session.jsonl");
  try {
    fs.writeFileSync(xscript, "{}\n");
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    const once = spawnSync("bash", [SCRIPT, "--once"], {
      encoding: "utf8",
      env: {
        ...p.env,
        SESSION_ROOT: p.tmp,
        SESSION_TARGETS: `quay ${p.tmp} ${p.session}`,
        SESSION_TRANSCRIPTS: `quay ${xscript}`,
        SESSION_HEARTBEATS: `quay ${xscript}`,
      },
    });
    assert.equal(once.status, 0, `--once must exit 0:\n${once.stderr}`);
    assert.doesNotMatch(once.stderr, /WARN/,
      `all transcript/heartbeat names match a target name → must NOT warn (AC2 negative control):\n${once.stderr}`);
  } finally {
    p.cleanup();
  }
});

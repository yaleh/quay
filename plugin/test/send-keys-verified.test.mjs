// @test-group governance
// send-keys-verified.test.mjs — positive controls for the cross-project send-keys helper
// (plugin/scripts/send-keys-verified.sh). The manager was doing the delivery confirmation BY HAND
// every time it drove another session; this pins the mechanical version (orchestration/
// TOOLS-SESSION-HANDOFF.md todo #3 → cheap PREVENTION, deliberately NOT a detector for an
// irreproducible un-sent-input phenomenon: the one observed instance cleared itself and could
// never be distinguished from a gray ghost suggestion).
//
// Handoff rule 2 ("干跑没有输出不是证据") applies: every criterion has a known-triggering setup
// that must demonstrably fire, not silently return 0. The helper has three observable criteria:
//   - usage: missing args → exit 2, never a partial send.
//   - nonexistent target → tmux list-panes fails → exit 1 with a failure message (the manager's
//     named positive control: "造一个确定送不达的情形…确认助手真的报失败，而不是静默返回 0").
//   - input swallowed (stty -echo pane: keys go in, nothing redraws) → pane hash unchanged →
//     exit 1. Deterministic via a pane running `stty -echo; sleep 60`.
//   - delivery to a normal pane → exit 0 AND the text demonstrably lands (the sent command echoes
//     and runs: the pane later contains the sent marker).
//
// All panes live on an ISOLATED tmux socket (TMUX_TMPDIR) so the real quay-0/archguard-2/meta-cc-4
// sessions are untouchable; every mkdtemp tmpdir is removed in a finally (test-isolation R6).
//
// Run:
//   scripts/test.sh plugin/test/send-keys-verified.test.mjs
//   node --test plugin/test/send-keys-verified.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HELPER = path.resolve(__dirname, "..", "scripts", "send-keys-verified.sh");

const tmuxAvailable = (() => {
  try { return spawnSync("tmux", ["-V"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

// ── helpers ────────────────────────────────────────────────────────────────────────────────────────

function isolateTmuxEnv(sockDir) {
  const env = { ...process.env, TMUX_TMPDIR: sockDir };
  delete env.TMUX;
  return env;
}

function tmux(args, env) {
  const r = spawnSync("tmux", args, { encoding: "utf8", env });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function newHermetic() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skv-"));
  const sockDir = path.join(tmp, "sock");
  fs.mkdirSync(sockDir, { recursive: true });
  const env = isolateTmuxEnv(sockDir);
  return {
    tmp,
    env,
    cleanup() {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
    },
  };
}

function runHelper(env, args) {
  const r = spawnSync("bash", [HELPER, ...args], { encoding: "utf8", env });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// ── usage ───────────────────────────────────────────────────────────────────────────────────────────

test("missing arguments exit 2 with a usage message (never a partial send)", () => {
  const h = newHermetic();
  try {
    const r = runHelper(h.env, []);
    assert.equal(r.status, 2, `expected usage exit, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /用法/, `usage message expected:\n${r.stderr}`);
    const r2 = runHelper(h.env, ["some-target"]); // target but no text
    assert.equal(r2.status, 2, `expected usage exit for missing text, got ${r2.status}\n${r2.stderr}`);
  } finally {
    h.cleanup();
  }
});

// ── failure positive control: nonexistent target ───────────────────────────────────────────────────

test("a nonexistent target reports failure (exit 1), never a silent 0", { skip: tmuxAvailable ? false : "tmux not installed" }, () => {
  const h = newHermetic(); // fresh socket, no sessions → every target is nonexistent
  try {
    const r = runHelper(h.env, ["skv-no-such-session", "echo hi"]);
    assert.equal(r.status, 1, `must report failure, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /不存在|无法送达/, `must name the failure:\n${r.stderr}`);
  } finally {
    h.cleanup();
  }
});

// ── failure positive control: input swallowed (hash unchanged) ─────────────────────────────────────

test("an input-swallowing pane (stty -echo) reports failure (exit 1)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const h = newHermetic();
  const S = "skv-noecho";
  try {
    const n = tmux(["new-session", "-d", "-s", S, 'bash -c "stty -echo; sleep 60"'], h.env);
    assert.equal(n.status, 0, `new-session failed: ${n.stderr}`);
    await sleep(300);
    const r = runHelper(h.env, [S, "echo swallowed-123"]);
    assert.equal(r.status, 1, `must report undelivered, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /哈希未变|未送达/, `must name the failure:\n${r.stderr}`);
  } finally {
    h.cleanup();
  }
});

// ── success positive control: delivery lands ───────────────────────────────────────────────────────

test("delivery to a normal pane exits 0 and the text demonstrably lands", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const h = newHermetic();
  const S = "skv-ok";
  try {
    const n = tmux(["new-session", "-d", "-s", S, "bash"], h.env);
    assert.equal(n.status, 0, `new-session failed: ${n.stderr}`);
    await sleep(300);
    const before = tmux(["capture-pane", "-p", "-t", S], h.env).stdout;
    const marker = `echo skv-marker-${Date.now()}`;
    const r = runHelper(h.env, [S, marker]);
    assert.equal(r.status, 0, `must deliver, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /已送达/, `success line expected:\n${r.stdout}`);
    await sleep(300);
    const after = tmux(["capture-pane", "-p", "-t", S], h.env).stdout;
    assert.ok(after !== before, "pane content must have changed after the send");
    assert.match(after, /skv-marker/, "the sent command must have actually landed (echoed + ran)");
  } finally {
    h.cleanup();
  }
});

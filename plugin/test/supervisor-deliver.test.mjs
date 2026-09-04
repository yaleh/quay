// @test-group engine
// supervisor-deliver.test.mjs — the supervisor base layer's DELIVERY interface
// (tasks/gap-supervisor-base-layer-outside-sessions-architecture, AC5/AC5b/AC7).
//
// supervisor-deliver.sh is the ONE delivery implementation (step ③ of the landing order):
// deliver(target, payload) -> delivered|failed, expressed by intent, never by terminal verbs.
// The NBSP counterexample (2026-08-04) was "send-keys-reliable.sh broken for hours, 3 consumers
// all bypassed it, zero real-TUI test coverage" — the structural fix is (a) the narrow adapter
// every consumer calls and (b) a REAL TUI end-to-end test so the delivery path cannot silently rot.
//
// Coverage map (task ACs):
//   AC5  — real TUI e2e: an existing-session delivery (NBSP-prompt fixture) and a fresh-session
//          delivery (transcript absent → direct-send + bounded wait + pure verify) both end with
//          a content-matching REAL user message in the target transcript.
//   AC5b — the interface is by intent: the CLI contract (deliver a payload, learn delivered|failed)
//          is stable across the TUI→`claude -p` migration (only the adapter's inside changes).
//   AC7  — node:test + // @test-group engine.
//   AC2  — delegation, not invention: the adapter delegates to send-keys-reliable.sh +
//          transcript-delivery-check.ts (grep-asserted); it contains no whole-pane hash.
//
// The real-TUI carve-out (same discipline as send-keys-reliable.test.mjs): each e2e owns ONE
// dedicated fixture session with a per-run-unique name, cleaned up with a scoped
// `tmux kill-session -t <unique>` — never kill-server, never the loop's own sessions.
//
// Run: scripts/test.sh plugin/test/supervisor-deliver.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { newHermeticTmux } from "./helpers/hermetic-tmux.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "scripts", "supervisor-deliver.sh");
const RELIABLE = path.resolve(__dirname, "..", "scripts", "send-keys-reliable.sh");
const CHECKER = path.resolve(__dirname, "..", "scripts", "transcript-delivery-check.ts");


function userStringLine(content) {
  return JSON.stringify({
    parentUuid: "parent", isSidechain: false, type: "user", message: { role: "user", content },
    uuid: "uuid-user-1", timestamp: 1720000000000, permissionMode: "default", userType: "external",
  });
}

function uniqueName(prefix) {
  return `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The fixture's prompt bytes: ❯ (U+276F) + two NBSP (U+00A0) — an EMPTY Claude Code input box. */
const FIXTURE_PROMPT = "\\342\\235\\257\\302\\240\\302\\240";

/** A tiny "TUI": renders the NBSP prompt; on every submitted line appends a REAL user JSONL record
 * to the transcript (the receiver committing the typed text). */
function fixtureScriptSrc(transcriptPath) {
  return `#!/usr/bin/env bash
TRANSCRIPT="${transcriptPath}"
mkdir -p "$(dirname "$TRANSCRIPT")"
printf '${FIXTURE_PROMPT}'
while IFS= read -r line; do
  [ -n "$line" ] || continue
  printf '{"type":"user","message":{"role":"user","content":"%s"}}\\n' "$line" >> "$TRANSCRIPT"
  printf '${FIXTURE_PROMPT}'
done
`;
}

// ── usage / validation (no terminal surface) ─────────────────────────────────────────────────────

test("AC7: usage — missing target/payload/transcript-resolution exits 2 with a usage message", () => {
  const r0 = spawnSync("bash", [SCRIPT], { encoding: "utf8" });
  assert.equal(r0.status, 2, `no args → exit 2, got ${r0.status}\n${r0.stderr}`);
  assert.match(r0.stderr, /用法/);

  const r1 = spawnSync("bash", [SCRIPT, "some-target"], { encoding: "utf8" });
  assert.equal(r1.status, 2, `missing payload → exit 2, got ${r1.status}\n${r1.stderr}`);

  const r2 = spawnSync("bash", [SCRIPT, "some-target", "hello"], { encoding: "utf8" });
  assert.equal(r2.status, 2, `neither --transcript nor --root → exit 2, got ${r2.status}\n${r2.stderr}`);
  assert.match(r2.stderr, /--transcript/);
});

test("AC7: usage — --transcript and --root are mutually exclusive (exit 2)", () => {
  const r = spawnSync("bash", [SCRIPT, "t", "hello", "--transcript", "x.jsonl", "--root", "/tmp/x"], {
    encoding: "utf8",
  });
  assert.equal(r.status, 2, `mutually exclusive args → exit 2, got ${r.status}\n${r.stderr}`);
  assert.match(r.stderr, /二选一/);
});

test("AC2: delegation — the adapter names its two dependencies and contains no whole-pane hash", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.match(src, /send-keys-reliable\.sh/, "delegates to the hardened reliable-send procedure");
  assert.match(src, /transcript-delivery-check\.ts/, "verifies via the pure delivery checker");
  assert.match(src, /--can-receive/, "wires the pane-state-classify can-receive pre-flight (the delivery-path consumer of the can-receive probe)");
  // AC2 boundary: no hand-written send-keys logic beyond the fresh-path's three literal calls;
  // the whole-pane hash family (md5/sha1/cksum) stays dead — the verdict is never a hash.
  const words = [["md5", "sum"].join(""), ["sha1", "sum"].join(""), ["ck", "sum"].join("")];
  let total = 0;
  for (const w of words) total += (src.match(new RegExp(w, "g")) || []).length;
  assert.equal(total, 0, `forbidden hash-tool names appear ${total} time(s)`);
});

test("AC7: a MISSING pure checker exits 1 at startup (fail loud), never a silent broken delivery", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sup-deliver-checker-"));
  try {
    fs.copyFileSync(SCRIPT, path.join(dir, "supervisor-deliver.sh"));
    assert.ok(!fs.existsSync(path.join(dir, "transcript-delivery-check.ts")), "checker must be absent");
    const r = spawnSync("bash", [path.join(dir, "supervisor-deliver.sh"), "t", "text", "--transcript", "t.jsonl"], {
      encoding: "utf8",
    });
    assert.equal(r.status, 1, `missing checker must exit 1 (fail loud), got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /缺少校验器/);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

// ── AC5: REAL TUI e2e — existing session (--transcript, NBSP-prompt fixture) ─────────────────────

test("AC5 e2e: existing session (--transcript) — adapter delivers a payload, verified via the target transcript", { timeout: 90000 }, async (t) => {
  const tmuxV = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (tmuxV.error || tmuxV.status !== 0) {
    t.skip("tmux not available — skipping the real-TUI e2e");
    return;
  }
  const session = uniqueName("sup-deliver");
  const h = newHermeticTmux("sup-deliver-e2e-");
  const fixture = path.join(h.tmp, "fixture.sh");
  const transcript = path.join(h.tmp, "transcript.jsonl");
  fs.writeFileSync(fixture, fixtureScriptSrc(transcript), "utf8");
  // NOT fresh: seed the transcript so the existing-session (send-keys-reliable) path is taken.
  fs.writeFileSync(transcript, `${userStringLine("prior-session-message")}\n`, "utf8");
  const marker = `sup-deliver-marker-${process.pid}`;
  let result = null;
  try {
    const start = h.newSession(session, `bash ${fixture}`);
    assert.equal(start.status, 0, `tmux new-session failed: ${start.stderr}`);
    // Name the fixture window after the session so the drive-target-check gate sees a deterministic,
    // matching window name.
    assert.equal(h.tmx(["rename-window", "-t", `${session}:0`, session]).status, 0, `rename-window failed`);

    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      const cap = h.capture(session);
      if (cap.status === 0 && cap.stdout.includes("❯")) ready = true;
      else await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, "fixture pane should render the ❯ prompt");

    result = spawnSync("bash", [SCRIPT, session, marker, "--transcript", transcript], {
      encoding: "utf8",
      timeout: 90000,
      env: {
        ...h.env,
        DRIVE_EXPECT_WINDOW_NAME: session, // the fixture's window is named after the session (drive-target-check gate)
        SUPERVISOR_DELIVER_VERIFY_S: "20",
      },
    });
    assert.equal(result.status, 0, `supervisor-deliver.sh failed (exit ${result.status}):\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.match(result.stdout, /已送达/, `adapter should report delivery:\n${result.stdout}`);
    const transcriptText = fs.readFileSync(transcript, "utf8");
    assert.match(transcriptText, new RegExp(`"content":"${marker}"`), `marker should appear as a real user message in the transcript:\n${transcriptText}`);
  } finally {
    h.cleanup();
  }
});

// ── AC5: REAL TUI e2e — fresh session (transcript absent → direct-send + bounded wait + verify) ──

/** The welcome-screen ghost suggestion text rendered after the prompt on a brand-new session. */
const GHOST_WELCOME = 'Try "fix lint errors"';

/** A tiny "TUI" for the fresh-session e2e: renders the welcome ghost text; on every submitted line
 * appends a REAL user JSONL record to the transcript. The transcript file is ABSENT initially. */
function ghostFixtureScriptSrc(transcriptPath) {
  return `#!/usr/bin/env bash
TRANSCRIPT="${transcriptPath}"
mkdir -p "$(dirname "$TRANSCRIPT")"
printf '❯ ${GHOST_WELCOME}'
while IFS= read -r line; do
  [ -n "$line" ] || continue
  printf '{"type":"user","message":{"role":"user","content":"%s"}}\\n' "$line" >> "$TRANSCRIPT"
  printf '❯ ${GHOST_WELCOME}'
done
`;
}

/** A "TUI" that renders a BUSY pane for `flip` seconds (the `esc to interrupt` status flag), then
 * flips to an idle NBSP prompt. Any line typed during the busy phase is DISCARDED (`read -r -t
 * 0.1` — a real busy Claude TUI never commits keystrokes sent while it is thinking), so a pre-wait
 * send can never deliver: only a send AFTER the idle flip lands as a real user message.
 * `flip` < 0 → busy forever (never flips). */
function busyFixtureScriptSrc(transcriptPath, flip) {
  const flipBranch = flip >= 0
    ? `sleep "${flip}"
IFS= read -r -t 0.1 dropped 2>/dev/null || true
printf '\\033[2J\\033[H${FIXTURE_PROMPT}'`
    : `while :; do sleep 1; done`;
  return `#!/usr/bin/env bash
TRANSCRIPT="${transcriptPath}"
mkdir -p "$(dirname "$TRANSCRIPT")"
printf '${FIXTURE_PROMPT}'
printf '\\n  ⏵⏵ bypass permissions on · esc to interrupt · ↓ to manage'
${flipBranch}
while IFS= read -r line; do
  [ -n "$line" ] || continue
  printf '{"type":"user","message":{"role":"user","content":"%s"}}\\n' "$line" >> "$TRANSCRIPT"
  printf '${FIXTURE_PROMPT}'
done
`;
}

test("AC5 e2e: fresh session (transcript absent) — direct-send path creates the transcript and verifies delivery", { timeout: 90000 }, async (t) => {
  const tmuxV = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (tmuxV.error || tmuxV.status !== 0) {
    t.skip("tmux not available — skipping the real-TUI e2e");
    return;
  }
  const session = uniqueName("sup-fresh");
  const h = newHermeticTmux("sup-fresh-");
  const fixture = path.join(h.tmp, "fixture.sh");
  const transcript = path.join(h.tmp, "transcript.jsonl");
  fs.writeFileSync(fixture, ghostFixtureScriptSrc(transcript), "utf8");
  // Transcript deliberately ABSENT — a fresh session (nothing typed yet).
  const marker = `sup-fresh-marker-${process.pid}`;
  let result = null;
  try {
    const start = h.newSession(session, `bash ${fixture}`);
    assert.equal(start.status, 0, `tmux new-session failed: ${start.stderr}`);
    // Name the fixture window after the session so the drive-target-check gate sees a deterministic,
    // matching window name.
    assert.equal(h.tmx(["rename-window", "-t", `${session}:0`, session]).status, 0, `rename-window failed`);

    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      const cap = h.capture(session);
      if (cap.status === 0 && cap.stdout.includes(GHOST_WELCOME)) ready = true;
      else await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, "fixture pane should render the ghost welcome text");

    result = spawnSync("bash", [SCRIPT, session, marker, "--transcript", transcript], {
      encoding: "utf8",
      timeout: 90000,
      env: { ...h.env, DRIVE_EXPECT_WINDOW_NAME: session, SUPERVISOR_DELIVER_VERIFY_S: "20" },
    });
    assert.equal(result.status, 0, `fresh-session deliver failed (exit ${result.status}):\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.match(result.stdout, /fresh-session/, `adapter should report the fresh-session path:\n${result.stdout}`);
    assert.match(result.stdout, /已送达/, `adapter should report delivery:\n${result.stdout}`);
    assert.ok(fs.existsSync(transcript), "the send created the transcript file");
    const transcriptText = fs.readFileSync(transcript, "utf8");
    assert.match(transcriptText, new RegExp(`"content":"${marker}"`), `marker should appear as a real user message:\n${transcriptText}`);
  } finally {
    h.cleanup();
  }
});

// ── AC5: negative control — a nonexistent target fails loud (never a silent 0) ───────────────────

test("AC5 negative control: nonexistent tmux target → exit 1 (fail loud), nothing sent", { timeout: 30000 }, async (t) => {
  const tmuxV = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (tmuxV.error || tmuxV.status !== 0) {
    t.skip("tmux not available — skipping");
    return;
  }
  const h = newHermeticTmux("sup-neg-");
  const transcript = path.join(h.tmp, "transcript.jsonl");
  fs.writeFileSync(transcript, `${userStringLine("prior")}\n`, "utf8");
  try {
    // The deliver script's bare `tmux` resolves to the hermetic socket (h.env) — a nonexistent
    // target fails loud there exactly as it would anywhere, without touching the default server.
    const r = spawnSync("bash", [SCRIPT, uniqueName("no-such-target"), "marker", "--transcript", transcript], {
      encoding: "utf8",
      env: h.env,
    });
    assert.equal(r.status, 1, `nonexistent target must exit 1, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /不存在/);
  } finally {
    h.cleanup();
  }
});

// ── --root transcript resolution (auto-discovery) ────────────────────────────────────────────────

test("AC5: --root (re-spawn mode) waits for the NEW transcript NOT in the pre-send snapshot and verifies delivery through it", { timeout: 90000 }, async (t) => {
  const tmuxV = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (tmuxV.error || tmuxV.status !== 0) {
    t.skip("tmux not available — skipping the real-TUI e2e");
    return;
  }
  const session = uniqueName("sup-root");
  const h = newHermeticTmux("sup-root-");
  // The root whose slug the adapter derives. slug = root with '/' → '-'.
  const root = path.join(os.tmpdir(), `sup-root-proj-${process.pid}`);
  const slug = root.replace(/\//g, "-");
  const projDir = path.join(h.tmp, ".claude", "projects", slug);
  fs.mkdirSync(projDir, { recursive: true });
  // OLD session's transcript (in the pre-send snapshot — must NOT be the delivery target).
  const oldTranscript = path.join(projDir, "old-session.jsonl");
  fs.writeFileSync(oldTranscript, `${userStringLine("old-session-msg")}\n`, "utf8");
  // The re-spawned session writes to a NEW file that appears only on its first committed input.
  const newTranscript = path.join(projDir, "new-session.jsonl");

  const fixture = path.join(h.tmp, "fixture.sh");
  fs.writeFileSync(fixture, fixtureScriptSrc(newTranscript), "utf8");
  const marker = `sup-root-marker-${process.pid}`;
  let result = null;
  try {
    const start = h.newSession(session, `bash ${fixture}`);
    assert.equal(start.status, 0, `tmux new-session failed: ${start.stderr}`);
    // Name the fixture window after the session so the drive-target-check gate sees a deterministic,
    // matching window name.
    assert.equal(h.tmx(["rename-window", "-t", `${session}:0`, session]).status, 0, `rename-window failed`);
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      const cap = h.capture(session);
      if (cap.status === 0 && cap.stdout.includes("❯")) ready = true;
      else await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, "fixture pane should render the ❯ prompt");

    // The adapter (--root mode) must snapshot the OLD file, send, then wait for the NEW file.
    result = spawnSync("bash", [SCRIPT, session, marker, "--root", root], {
      encoding: "utf8",
      timeout: 90000,
      env: { ...h.env, HOME: h.tmp, DRIVE_EXPECT_WINDOW_NAME: session, SUPERVISOR_DELIVER_VERIFY_S: "20" },
    });
    assert.equal(result.status, 0, `--root deliver failed (exit ${result.status}):\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.match(result.stdout, /fresh-session/, `re-spawn mode should take the fresh path:\n${result.stdout}`);
    assert.match(result.stdout, /已送达/, `adapter should report delivery:\n${result.stdout}`);
    assert.ok(fs.existsSync(newTranscript), "the NEW transcript was created by the send");
    const newText = fs.readFileSync(newTranscript, "utf8");
    assert.match(newText, new RegExp(`"content":"${marker}"`), `marker should appear in the NEW transcript:\n${newText}`);
    // The OLD transcript must NOT have received the marker (the delivery target was the new file).
    const oldText = fs.readFileSync(oldTranscript, "utf8");
    assert.doesNotMatch(oldText, new RegExp(marker), `old session transcript must not receive the payload:\n${oldText}`);
  } finally {
    h.cleanup();
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

// ── can-receive pre-flight (gap-supervisor-deliver-no-wait-for-idle-retry) ───────────────────────
// The existing-session path delegates to send-keys-reliable.sh, which owns the can-receive
// pre-flight — so a busy target is waited on (bounded) and delivered once idle, NOT an immediate
// FAIL. The env vars flow through the delegation (RELIABLE_CAN_RECEIVE_WAIT_S/Poll). AC2 (wiring) +
// AC2/AC3 e2e.

test("AC2/AC3 e2e: adapter delegates the can-receive pre-flight — a BUSY target is waited on then delivered (not an immediate FAIL)", { timeout: 90000 }, async (t) => {
  const tmuxV = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (tmuxV.error || tmuxV.status !== 0) {
    t.skip("tmux not available — skipping the real-TUI e2e");
    return;
  }
  const session = uniqueName("sup-busy");
  const h = newHermeticTmux("sup-busy-");
  const fixture = path.join(h.tmp, "busy-fixture.sh");
  const transcript = path.join(h.tmp, "transcript.jsonl");
  fs.writeFileSync(transcript, `${userStringLine("prior-session-message")}\n`, "utf8");
  // Busy for 3s, then flips to idle. A pre-wait send (typed during busy) is DISCARDED by the
  // fixture, so this test passes ONLY if the pre-flight waited for the flip before sending.
  fs.writeFileSync(fixture, busyFixtureScriptSrc(transcript, 3), "utf8");
  const marker = `sup-busy-marker-${process.pid}`;
  let result = null;
  try {
    const start = h.newSession(session, `bash ${fixture}`);
    assert.equal(start.status, 0, `tmux new-session failed: ${start.stderr}`);
    assert.equal(h.tmx(["rename-window", "-t", `${session}:0`, session]).status, 0, `rename-window failed`);
    let busy = false;
    for (let i = 0; i < 100 && !busy; i++) {
      const cap = h.capture(session);
      if (cap.status === 0 && cap.stdout.includes("esc to interrupt")) busy = true;
      else await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(busy, "fixture pane should render the busy flag");

    result = spawnSync("bash", [SCRIPT, session, marker, "--transcript", transcript], {
      encoding: "utf8",
      timeout: 90000,
      env: {
        ...h.env,
        DRIVE_EXPECT_WINDOW_NAME: session,
        SUPERVISOR_DELIVER_VERIFY_S: "20",
        RELIABLE_CAN_RECEIVE_WAIT_S: "15", // flows through the delegation to send-keys-reliable.sh
        RELIABLE_CAN_RECEIVE_POLL_S: "1",
      },
    });
    assert.equal(result.status, 0, `adapter busy-wait deliver failed (exit ${result.status}):\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.match(result.stdout, /已送达/, `adapter should report delivery:\n${result.stdout}`);
    assert.match(result.stdout + result.stderr, /可接收/, `should show the can-receive pre-flight ran:\n${result.stdout}${result.stderr}`);
    const transcriptText = fs.readFileSync(transcript, "utf8");
    assert.match(transcriptText, new RegExp(`"content":"${marker}"`), `marker should appear as a real user message:\n${transcriptText}`);
  } finally {
    h.cleanup();
  }
});

// ── AC2/AC3: cross-host delivery (tasks/gap-supervisor-deliver-cross-host-target-support) ─────────
// The gap: supervisor-deliver.sh:155/157/159 were LOCAL tmux send-keys and the checker read the
// transcript with a LOCAL fs.readFileSync — a target on ANOTHER host (e.g. ad-arm1) structurally
// could not be driven. These tests drive the REAL ssh-forwarding code path with a hermetic mock-ssh
// (SUPERVISOR_DELIVER_SSH → fixtures/mock-ssh.sh) that emulates a remote tmux + transcript: the
// PRODUCTION scripts/checker/classifier run exactly the commands they would against real ssh, the
// mock records each call and materializes a REAL user message in the transcript — so "delivered" is
// still the target-transcript content match, never pane echo (ADR-016, AC3 判据不降级).

function mockSshEnv({ transcript, windowName = "inner", pane = "❯", home } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sup-cross-"));
  const log = path.join(tmp, "mock.log");
  const env = {
    ...process.env,
    SUPERVISOR_DELIVER_SSH: path.resolve(__dirname, "fixtures", "mock-ssh.sh"),
    SUPERVISOR_DELIVER_MOCK_LOG: log,
    SUPERVISOR_DELIVER_MOCK_TRANSCRIPT: transcript || "",
    SUPERVISOR_DELIVER_MOCK_WINDOW: windowName,
    SUPERVISOR_DELIVER_MOCK_PANE: pane,
    SUPERVISOR_DELIVER_MOCK_HOME: home || tmp,
    SUPERVISOR_DELIVER_VERIFY_S: "12",
    SUPERVISOR_DELIVER_CAN_RECEIVE_WAIT_S: "3",
    SUPERVISOR_DELIVER_CAN_RECEIVE_POLL_S: "1",
  };
  return { tmp, log, env };
}

function crossHostSends(log) {
  return log.split("\n").filter((l) => l.includes("tmux send-keys"));
}

test("AC2 cross-host fresh path: <host>:<tmux-target> drives 3 SEPARATE ssh send-keys (C-u / -l / Enter) against the STRIPPED target, and the remote transcript verifies delivered", { timeout: 60000 }, () => {
  const transcript = path.join(os.tmpdir(), `cross-fresh-${process.pid}-${Date.now()}.jsonl`);
  const h = mockSshEnv({ transcript, windowName: "outer" });
  const payload = `cross-fresh-marker-${process.pid} 你好 world`;
  try {
    const r = spawnSync(
      "bash",
      [SCRIPT, "ad-arm1.wan.hwang.men:archguard-0:outer", payload, "--transcript", transcript],
      { encoding: "utf8", timeout: 55000, env: { ...h.env, DRIVE_EXPECT_WINDOW_NAME: "outer" } },
    );
    assert.equal(r.status, 0, `cross-host fresh deliver failed (exit ${r.status}):\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.match(r.stdout, /已送达/, `adapter should report delivery:\n${r.stdout}`);
    // Three SEPARATE ssh send-keys invocations — the "三次分开调用" contract, forwarded over ssh.
    const log = fs.readFileSync(h.log, "utf8");
    const sends = crossHostSends(log);
    assert.equal(sends.length, 3, `three send-keys ssh calls expected, got ${sends.length}:\n${log}`);
    assert.match(sends[0], / C-u /, `1st send-keys is C-u:\n${sends[0]}`);
    assert.match(sends[1], / -l "/, `2nd send-keys is the literal-text send:\n${sends[1]}`);
    assert.match(sends[2], / Enter /, `3rd send-keys is Enter:\n${sends[2]}`);
    for (const line of log.split("\n")) {
      if (!line) continue;
      assert.match(line, /^HOST=ad-arm1\.wan\.hwang\.men /, `every ssh call goes to the target host:\n${line}`);
      assert.doesNotMatch(line, /ad-arm1\.wan\.hwang\.men:archguard-0/, `tmux target must have the host stripped:\n${line}`);
    }
    // The delivered criterion is the REMOTE transcript's committed content — the payload really
    // landed as a user message (the mock materialized it from the base64-forwarded -l payload).
    const text = fs.readFileSync(transcript, "utf8");
    assert.match(text, new RegExp(`"content":"${payload}"`), `payload should be a real user message in the remote transcript:\n${text}`);
  } finally {
    try { fs.rmSync(transcript, { force: true }); } catch { /* best-effort */ }
    try { fs.rmSync(h.tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

test("AC2 --host <fqdn> flag form drives the same ssh-forwarded delivery", { timeout: 60000 }, () => {
  const transcript = path.join(os.tmpdir(), `cross-flag-${process.pid}-${Date.now()}.jsonl`);
  const h = mockSshEnv({ transcript, windowName: "outer" });
  const payload = `cross-flag-marker-${process.pid} 你好`;
  try {
    const r = spawnSync(
      "bash",
      [SCRIPT, "archguard-0:outer", payload, "--host", "ad-arm1.wan.hwang.men", "--transcript", transcript],
      { encoding: "utf8", timeout: 55000, env: { ...h.env, DRIVE_EXPECT_WINDOW_NAME: "outer" } },
    );
    assert.equal(r.status, 0, `--host deliver failed (exit ${r.status}):\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.match(r.stdout, /已送达/, `adapter should report delivery:\n${r.stdout}`);
    const log = fs.readFileSync(h.log, "utf8");
    assert.equal(crossHostSends(log).length, 3, `three send-keys ssh calls expected:\n${log}`);
    assert.ok(log.includes("HOST=ad-arm1.wan.hwang.men"), `host from --host reaches ssh:\n${log}`);
    const text = fs.readFileSync(transcript, "utf8");
    assert.match(text, new RegExp(`"content":"${payload}"`), `payload should land in the remote transcript:\n${text}`);
  } finally {
    try { fs.rmSync(transcript, { force: true }); } catch { /* best-effort */ }
    try { fs.rmSync(h.tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

test("AC2/AC3 existing-session cross-host: supervisor-deliver delegates to send-keys-reliable over ssh (remote baseline stat + clear loop + literal send + Enter + remote verify)", { timeout: 60000 }, () => {
  const transcript = path.join(os.tmpdir(), `cross-existing-${process.pid}-${Date.now()}.jsonl`);
  fs.writeFileSync(transcript, `${userStringLine("prior-session-msg")}\n`, "utf8"); // NOT fresh → the 5-step path
  const h = mockSshEnv({ transcript, windowName: "inner" });
  const payload = `cross-existing-marker-${process.pid} 你好`;
  try {
    const r = spawnSync(
      "bash",
      [SCRIPT, "ad-arm1.wan.hwang.men:archguard-0:inner", payload, "--transcript", transcript],
      {
        encoding: "utf8",
        timeout: 55000,
        env: {
          ...h.env,
          DRIVE_EXPECT_WINDOW_NAME: "inner",
          RELIABLE_DELIVERY_VERIFY_S: "12",
          RELIABLE_DELIVERY_FIRST_S: "3",
          RELIABLE_DELIVERY_POLL_S: "1",
          RELIABLE_CLEAR_MAX: "3",
          RELIABLE_STABLE_TIMEOUT_S: "2",
        },
      },
    );
    assert.equal(r.status, 0, `cross-host existing deliver failed (exit ${r.status}):\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.match(r.stdout, /已送达/, `adapter should report delivery:\n${r.stdout}`);
    const log = fs.readFileSync(h.log, "utf8");
    assert.ok(log.includes("stat -c %s"), `baseline is a REMOTE stat over ssh:\n${log}`);
    assert.ok(log.includes("tmux send-keys -t archguard-0:inner -l "), `literal send over ssh against the stripped target:\n${log}`);
    assert.ok(log.includes("tmux send-keys -t archguard-0:inner Enter"), `Enter over ssh:\n${log}`);
    assert.ok(log.includes("cat "), `verify reads the remote transcript via ssh cat:\n${log}`);
    const text = fs.readFileSync(transcript, "utf8");
    assert.match(text, new RegExp(`"content":"${payload}"`), `payload should land in the remote transcript:\n${text}`);
  } finally {
    try { fs.rmSync(transcript, { force: true }); } catch { /* best-effort */ }
    try { fs.rmSync(h.tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

test("AC3 negative control: cross-host delivered is NOT pane echo — when the payload never materializes in the remote transcript the adapter FAILS (no false delivered from a 'looks idle' pane)", { timeout: 60000 }, () => {
  const transcript = path.join(os.tmpdir(), `cross-neg-${process.pid}-${Date.now()}.jsonl`);
  // MOCK_TRANSCRIPT empty → the mock's tmux still reports a waiting-input pane (capture-pane → ❯),
  // but it NEVER writes the payload to a transcript. A degraded "delivered" (pane echo) would pass;
  // the real criterion (remote transcript content) must FAIL.
  const h = mockSshEnv({ transcript: "", windowName: "outer" });
  const payload = `cross-neg-marker-${process.pid}`;
  try {
    const r = spawnSync(
      "bash",
      [SCRIPT, "ad-arm1.wan.hwang.men:archguard-0:outer", payload, "--transcript", transcript],
      { encoding: "utf8", timeout: 55000, env: { ...h.env, DRIVE_EXPECT_WINDOW_NAME: "outer" } },
    );
    assert.equal(r.status, 1, `undelivered cross-host must fail (exit 1), got ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.match(r.stderr + r.stdout, /FAIL|未出现|未送达/, `must report the undelivered bound, never a false delivered:\n${r.stdout}\n${r.stderr}`);
    assert.doesNotMatch(r.stdout + r.stderr, /已送达/, `must NOT report delivered when the remote transcript lacks the payload:\n${r.stdout}\n${r.stderr}`);
    assert.ok(!fs.existsSync(transcript), "nothing may land in a transcript the mock did not receive");
  } finally {
    try { fs.rmSync(transcript, { force: true }); } catch { /* best-effort */ }
    try { fs.rmSync(h.tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

test("AC2/AC3 --root cross-host: re-spawn discovery finds the NEW remote transcript NOT in the pre-send snapshot and verifies delivery through it", { timeout: 60000 }, () => {
  // The "remote home" (MOCK_HOME) holds ~/.claude/projects/<slug> with an OLD transcript; the mock
  // writes the NEW transcript on the -l send. --root must snapshot the OLD, send, then discover the
  // NEW (not in the snapshot) on the remote.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sup-cross-root-"));
  const home = path.join(tmp, "remote-home");
  const root = path.join(os.tmpdir(), `cross-root-proj-${process.pid}`);
  const slug = root.replace(/\//g, "-");
  const projDir = path.join(home, ".claude", "projects", slug);
  fs.mkdirSync(projDir, { recursive: true });
  const oldTranscript = path.join(projDir, "old-session.jsonl");
  fs.writeFileSync(oldTranscript, `${userStringLine("old-session-msg")}\n`, "utf8");
  const newTranscript = path.join(projDir, "new-session.jsonl");
  const h = mockSshEnv({ transcript: newTranscript, windowName: "outer", home });
  const payload = `cross-root-marker-${process.pid} 你好`;
  try {
    const r = spawnSync(
      "bash",
      [SCRIPT, "ad-arm1.wan.hwang.men:archguard-0:outer", payload, "--root", root],
      { encoding: "utf8", timeout: 55000, env: { ...h.env, DRIVE_EXPECT_WINDOW_NAME: "outer" } },
    );
    assert.equal(r.status, 0, `--root cross-host deliver failed (exit ${r.status}):\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.match(r.stdout, /fresh-session/, `--root takes the fresh path:\n${r.stdout}`);
    assert.match(r.stdout, /已送达/, `adapter should report delivery:\n${r.stdout}`);
    assert.ok(fs.existsSync(newTranscript), "the NEW remote transcript was created by the send");
    const newText = fs.readFileSync(newTranscript, "utf8");
    assert.match(newText, new RegExp(`"content":"${payload}"`), `payload should appear in the NEW remote transcript:\n${newText}`);
    const oldText = fs.readFileSync(oldTranscript, "utf8");
    assert.doesNotMatch(oldText, new RegExp(payload), `the OLD remote transcript must NOT receive the payload:\n${oldText}`);
    const log = fs.readFileSync(h.log, "utf8");
    assert.ok(log.includes("ls ~/.claude/projects/"), `--root remote discovery lists the remote transcripts dir:\n${log}`);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});


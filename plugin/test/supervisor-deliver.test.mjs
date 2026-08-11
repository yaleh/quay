// @test-group governance
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
//   AC7  — node:test + // @test-group governance.
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

// ── Governance self-skip (AC7 @test-group governance) ─────────────────────────────────────────────
if (process.env.QUAY_TEST_GROUPS && !process.env.QUAY_TEST_GROUPS.split(",").includes("governance")) {
  test("governance group skipped", { skip: "set QUAY_TEST_GROUPS=governance to run" }, () => {});
} else {

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

// ── can-receive gate (gap-supervisor-deliver-no-wait-for-idle-retry) ───────────────────────────────
// The one-shot send→verify→failed behavior failed immediately when the target was busy. The fix
// judges the target pane state (pane-state-classify.ts) BEFORE sending and BOUNDED-WAITS for a
// busy target to turn waiting-input. These two real-TUI controls prove:
//   * AC3 positive — a busy target that turns idle is WAITED for (not one-shot failed) and then
//     delivered; the delivery elapsed ≥ the busy phase and stderr reports the bounded wait.
//   * AC3 negative — a target that stays busy past the bound is NEVER sent into: bounded wait,
//     FAIL loud (needs human), and the marker never reaches the transcript.
// Both use the existing-session path (seeded transcript → delegates to send-keys-reliable.sh),
// which is where the can-receive gate lives (send-keys-reliable.sh step 0.2).

/** Busy-then-idle fixture: renders a Claude Code BUSY status line ("esc to interrupt") for
 * `busySeconds`, then clears the pane to a bare waiting-input prompt and commits sent lines to the
 * transcript (the receiver turning idle — the exact busy→idle transition the gate must wait for). */
function busyThenIdleFixtureSrc(transcriptPath, busySeconds) {
  return `#!/usr/bin/env bash
TRANSCRIPT="${transcriptPath}"
mkdir -p "$(dirname "$TRANSCRIPT")"
printf '❯ \\n───────────────────────────────\\n  ⏵⏵ bypass permissions on · esc to interrupt · ↓ to manage\\n'
sleep ${busySeconds}
printf '\\033[2J\\033[H'
printf '❯ '
while IFS= read -r line; do
  [ -n "$line" ] || continue
  printf '{"type":"user","message":{"role":"user","content":"%s"}}\\n' "$line" >> "$TRANSCRIPT"
  printf '❯ '
done
`;
}

/** Busy-forever fixture: renders a BUSY status line and stays busy indefinitely (never reads
 * stdin) — the "target never becomes idle" bound-exhaustion case. */
function busyForeverFixtureSrc(transcriptPath) {
  return `#!/usr/bin/env bash
TRANSCRIPT="${transcriptPath}"
mkdir -p "$(dirname "$TRANSCRIPT")"
printf '❯ \\n───────────────────────────────\\n  ⏵⏵ bypass permissions on · esc to interrupt · ↓ to manage\\n'
sleep 1000000
`;
}

test("AC3 positive: a BUSY target is bounded-waited until it turns idle, then the payload is delivered (NOT a one-shot fail)", { timeout: 90000 }, async (t) => {
  const tmuxV = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (tmuxV.error || tmuxV.status !== 0) {
    t.skip("tmux not available — skipping the real-TUI e2e");
    return;
  }
  const session = uniqueName("sup-busy-wait");
  const h = newHermeticTmux("sup-busy-wait-");
  const fixture = path.join(h.tmp, "fixture.sh");
  const transcript = path.join(h.tmp, "transcript.jsonl");
  const BUSY_S = 5;
  fs.writeFileSync(fixture, busyThenIdleFixtureSrc(transcript, BUSY_S), "utf8");
  // NOT fresh: seed the transcript so the existing-session (send-keys-reliable) path is taken.
  fs.writeFileSync(transcript, `${userStringLine("prior-session-message")}\n`, "utf8");
  const marker = `sup-busy-wait-marker-${process.pid}`;
  let result = null;
  let startedAt = 0;
  try {
    const start = h.newSession(session, `bash ${fixture}`);
    assert.equal(start.status, 0, `tmux new-session failed: ${start.stderr}`);
    // Name the fixture window after the session so the drive-target-check gate passes.
    assert.equal(h.tmx(["rename-window", "-t", `${session}:0`, session]).status, 0, `rename-window failed`);

    // Wait (bounded) for the fixture pane to render the BUSY status line.
    let busy = false;
    for (let i = 0; i < 100 && !busy; i++) {
      const cap = h.capture(session);
      if (cap.status === 0 && cap.stdout.includes("esc to interrupt")) busy = true;
      else await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(busy, "fixture pane should render the busy status line");

    startedAt = Date.now();
    result = spawnSync("bash", [SCRIPT, session, marker, "--transcript", transcript], {
      encoding: "utf8",
      timeout: 90000,
      env: {
        ...h.env,
        DRIVE_EXPECT_WINDOW_NAME: session,
        SUPERVISOR_DELIVER_VERIFY_S: "20",
        RELIABLE_WAIT_IDLE_S: "15",
        RELIABLE_WAIT_IDLE_POLL_S: "1",
      },
    });
    const elapsedMs = Date.now() - startedAt;

    // It must WAIT, not one-shot fail: the delivery consumed at least the busy phase (~BUSY_S).
    assert.ok(elapsedMs >= (BUSY_S - 2) * 1000, `delivery should have waited ~${BUSY_S}s, elapsed ${elapsedMs}ms`);
    // The gate must REPORT the bounded wait (it saw a non-waiting-input state), then deliver.
    assert.match(result.stderr, /有界等待/, `the gate must report the bounded wait:\n${result.stderr}`);
    assert.equal(result.status, 0, `busy→idle deliver failed (exit ${result.status}):\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.match(result.stdout, /已送达/, `adapter should report delivery:\n${result.stdout}`);
    const transcriptText = fs.readFileSync(transcript, "utf8");
    assert.match(transcriptText, new RegExp(`"content":"${marker}"`), `marker should appear as a real user message:\n${transcriptText}`);
  } finally {
    h.cleanup();
  }
});

test("AC3 negative control: a target that stays BUSY past the bound is NEVER sent into — bounded wait, then FAIL loud with no transcript mutation", { timeout: 90000 }, async (t) => {
  const tmuxV = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (tmuxV.error || tmuxV.status !== 0) {
    t.skip("tmux not available — skipping the real-TUI e2e");
    return;
  }
  const session = uniqueName("sup-busy-fail");
  const h = newHermeticTmux("sup-busy-fail-");
  const fixture = path.join(h.tmp, "fixture.sh");
  const transcript = path.join(h.tmp, "transcript.jsonl");
  fs.writeFileSync(fixture, busyForeverFixtureSrc(transcript), "utf8");
  fs.writeFileSync(transcript, `${userStringLine("prior-session-message")}\n`, "utf8");
  const marker = `sup-busy-fail-marker-${process.pid}`;
  const WAIT_IDLE_S = 5;
  let result = null;
  let startedAt = 0;
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
    assert.ok(busy, "fixture pane should render the busy status line");

    startedAt = Date.now();
    result = spawnSync("bash", [SCRIPT, session, marker, "--transcript", transcript], {
      encoding: "utf8",
      timeout: 90000,
      env: {
        ...h.env,
        DRIVE_EXPECT_WINDOW_NAME: session,
        SUPERVISOR_DELIVER_VERIFY_S: "20",
        RELIABLE_WAIT_IDLE_S: String(WAIT_IDLE_S),
        RELIABLE_WAIT_IDLE_POLL_S: "1",
      },
    });
    const elapsedMs = Date.now() - startedAt;

    // The bounded wait was consumed (not an instant fail), then it failed LOUD for a human.
    assert.ok(elapsedMs >= WAIT_IDLE_S * 1000, `must wait the full bound (${WAIT_IDLE_S}s), elapsed ${elapsedMs}ms`);
    assert.equal(result.status, 1, `busy-forever must exit 1 (fail loud), got ${result.status}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /未转 waiting-input/, `must report the never-idle outcome:\n${result.stderr}`);
    assert.match(result.stderr, /fail loud/, `must fail loud (needs human), never pretend success:\n${result.stderr}`);
    // Nothing was sent into the busy pane — the marker must NOT reach the transcript.
    const transcriptText = fs.readFileSync(transcript, "utf8");
    assert.doesNotMatch(transcriptText, new RegExp(marker), `marker must NOT reach a busy target's transcript:\n${transcriptText}`);
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

} // end governance group

// @test-group governance
// send-keys-reliable.test.mjs — pure-function tests for the reliable-send delivery verdict
// (tasks/gap-reliable-send-crystallize-the-five-failure-modes-into-a-script).
//
// The reliable-send procedure (plugin/scripts/send-keys-reliable.sh) implements the five-step
// algorithm from orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md. Its five measured
// failure modes all live on the SENDING side; the most error-prone piece — the delivery verdict
// (fault mode 5) — is a PURE function in plugin/scripts/transcript-delivery-check.ts: given a
// transcript fragment + sent text it answers whether a REAL user message whose content matches
// the sent text appeared. This test exercises that pure function and the CLI contract ONLY.
//
// outer ruling R3 (the kill-server family crashed two machines): the PURE-function tests below
// NEVER create or clean up terminal sessions/windows, and never invoke tmux. Everything is a
// string fixture (pure function) or a temp .jsonl file (CLI). No tmux server, no pty, no fake TUI
// (ruling E pattern — the dangerous test surface is structurally absent for the pure part).
//
// AC2 CARVE-OUT (gap-send-keys-reliable-nbsp-empty-check-is-broken-for-any-input-box +
// gap-send-keys-reliable-welcome-screen-ghost-drive-fails): the e2e tests at the bottom DO spawn
// dedicated tmux fixture sessions — the NBSP-empty-input-box defect and the welcome-screen
// ghost-text defect live ONLY in the clear loop's behavior on a real TUI, which no string fixture
// can reach, and this is a user-facing contract (CLAUDE.md test-layer strategy item 1: ≥1 REAL e2e
// check against the shipped artifact). The carve-out owns exactly TWO sessions (one per scenario),
// each with a per-run-unique name, cleaned up with a scoped `tmux kill-session -t <unique>` —
// never kill-server, never a shared/attached session, never the loop's own sessions.
//
// AC4 pure function, imported directly · AC5 negative controls (absent message ⇒ not delivered;
// present-but-mismatched ⇒ not delivered) · AC7 zero hash (script + test contain zero
// occurrences of the three hash-tool names ruling F killed — the whole-pane hash family stays
// dead) · AC8 node:test + @test-group governance · plus the ## Contract `measure` CLI path and
// the fault-4 "NEW message only" baseline semantics.
//
// Run: scripts/test.sh plugin/test/send-keys-reliable.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  checkTranscriptDelivered,
  extractUserTextCandidates,
  hasUserMessages,
  tailFromByteOffset,
} from "../scripts/transcript-delivery-check.ts";

import { newHermeticTmux } from "./helpers/hermetic-tmux.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "scripts", "send-keys-reliable.sh");
const CHECKER = path.resolve(__dirname, "..", "scripts", "transcript-delivery-check.ts");

// ── Governance self-skip (AC8 @test-group governance) ─────────────────────────────────────────────
// In a DEFAULT (product,engine) run this file reports `skipped`, not absent (ADR-019 decision #1
// precedent); it runs in full when invoked explicitly (QUAY_TEST_GROUPS unset) or with
// `--group governance`.
if (process.env.QUAY_TEST_GROUPS && !process.env.QUAY_TEST_GROUPS.split(",").includes("governance")) {
  test("governance group skipped", { skip: "set QUAY_TEST_GROUPS=governance to run" }, () => {});
} else {

// ── realistic transcript line shapes (mirrors ~/.claude/projects/<slug>/<session>.jsonl) ─────────

/** A realistic USER message whose content is a plain string (the shape produced when text is
 * typed into the input box and submitted). */
function userStringLine(content, { marker = "uuid-user-1", timestamp = 1720000000000 } = {}) {
  return JSON.stringify({
    parentUuid: "parent", isSidechain: false, type: "user", message: { role: "user", content },
    uuid: marker, timestamp, permissionMode: "default", userType: "external",
  });
}

/** A realistic USER message whose content is an array of blocks (tool results fed back into the
 * context — injected context, NOT typed input, and must never count as delivery). */
function userArrayLine(blocks, { marker = "uuid-array-1" } = {}) {
  return JSON.stringify({
    parentUuid: "parent", type: "user", message: { role: "user", content: blocks }, uuid: marker,
    timestamp: 1720000000000,
  });
}

function assistantLine(content) {
  return JSON.stringify({ parentUuid: "parent", type: "assistant", message: { role: "assistant", content }, uuid: "uuid-asst-1", timestamp: 1720000000000 });
}

// ── AC4: the pure function ─────────────────────────────────────────────────────────────────────────

test("AC4: delivered when a REAL user message (string content) contains the sent text", () => {
  const fragment = userStringLine("send-keys-marker-123 hello") + "\n" + assistantLine("ok") + "\n";
  const v = checkTranscriptDelivered(fragment, "send-keys-marker-123");
  assert.equal(v.delivered, true);
  assert.ok(v.matchedLine && v.matchedLine.includes("send-keys-marker-123"), "matchedLine names the message");
});

test("AC4: delivered when a user message array carries a text block with the sent text", () => {
  const fragment = userArrayLine([{ type: "text", text: "echo reliable-marker" }]) + "\n";
  assert.equal(checkTranscriptDelivered(fragment, "reliable-marker").delivered, true);
});

test("AC4: delivered is a pure function — no tmux, no file access, no side effects", () => {
  // It must be callable with a bare string (never a path/stream), returning a verdict object.
  const v = checkTranscriptDelivered(userStringLine("x"), "x");
  assert.equal(typeof v.delivered, "boolean");
  assert.equal(Object.keys(v).length >= 1, true);
});

test("AC5 negative control: an empty transcript is not delivered", () => {
  assert.equal(checkTranscriptDelivered("", "anything").delivered, false);
});

test("AC5 negative control: a transcript with user messages but NONE matching the sent text is not delivered (含但内容不匹配)", () => {
  const fragment = userStringLine("hello world") + "\n" + userStringLine("another message") + "\n";
  assert.equal(checkTranscriptDelivered(fragment, "unique-marker-XYZ").delivered, false);
});

test("AC5 negative control: the sent text inside an ASSISTANT message does not count — only a real USER message", () => {
  const fragment = assistantLine("unique-marker-XYZ") + "\n";
  assert.equal(checkTranscriptDelivered(fragment, "unique-marker-XYZ").delivered, false);
});

test("AC5 negative control: the sent text inside a tool_result block does not count — injected context is not a typed user message", () => {
  const fragment = userArrayLine([{ type: "tool_result", tool_use_id: "toolu_1", content: "unique-marker-XYZ" }]) + "\n";
  assert.equal(checkTranscriptDelivered(fragment, "unique-marker-XYZ").delivered, false);
});

test("AC5 negative control: an empty sent text can never be delivered", () => {
  assert.equal(checkTranscriptDelivered(userStringLine("anything"), "   ").delivered, false);
});

test("robustness: malformed JSONL lines are skipped without crashing, and a real line still matches", () => {
  const fragment = "not json at all\n{broken\n" + userStringLine("real marker here") + "\n";
  assert.equal(checkTranscriptDelivered(fragment, "real marker here").delivered, true);
});

test("semantics: matching is a content CONTAINS check, not a whole-line equality (CRYSTALLIZED doc's 匹配（或包含）)", () => {
  const fragment = userStringLine("please run: echo reliable-marker and then stop") + "\n";
  assert.equal(checkTranscriptDelivered(fragment, "reliable-marker").delivered, true);
});

test("extractUserTextCandidates: only real user-typed text is extracted, never assistant or tool_result-only records", () => {
  const fragment =
    userStringLine("typed text") + "\n" +
    assistantLine("assistant text") + "\n" +
    userArrayLine([{ type: "tool_result", content: "tool text" }]) + "\n";
  const cands = extractUserTextCandidates(fragment);
  assert.equal(cands.length, 1, "exactly one candidate — the typed user string");
  assert.equal(cands[0].text, "typed text");
});

test("tailFromByteOffset: the delivery poll only sees content appended after the baseline (fault 4's NEW-message rule)", () => {
  const first = userStringLine("old-marker");
  const second = userStringLine("new-marker");
  const full = first + "\n" + second + "\n";
  const baseline = Buffer.byteLength(first + "\n", "utf8");
  const tail = tailFromByteOffset(full, baseline);
  assert.ok(tail.includes("new-marker"), "appended message is in the tail");
  assert.ok(!tail.includes("old-marker"), "pre-baseline message is excluded from the tail");
  assert.equal(tailFromByteOffset(full, 0), full);
});

// ── AC1: fresh-session detection (welcome-screen ghost text → skip the clear loop) ────────────────

test("AC1 pure: hasUserMessages — an empty/assistant-only transcript is FRESH (zero user messages)", () => {
  assert.equal(hasUserMessages(""), false, "empty transcript is fresh");
  assert.equal(hasUserMessages(assistantLine("hi") + "\n"), false, "assistant-only transcript is fresh");
  assert.equal(hasUserMessages(userArrayLine([{ type: "tool_result", content: "x" }]) + "\n"), false, "tool-result-only user record is injected context, not typed input — still fresh");
});

test("AC1 pure: hasUserMessages — a real user string (or text block) makes the session NOT fresh", () => {
  assert.equal(hasUserMessages(userStringLine("hello") + "\n"), true);
  assert.equal(hasUserMessages(userArrayLine([{ type: "text", text: "echo x" }]) + "\n"), true);
});

// ── ## Contract measure CLI path ───────────────────────────────────────────────────────────────────

function runCli(args) {
  return spawnSync("node", ["--experimental-strip-types", CHECKER, ...args], { encoding: "utf8" });
}

function withTempJsonl(content, fn) {
  const tmp = path.join(os.tmpdir(), `skr-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(tmp, content, "utf8");
  try {
    return fn(tmp);
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort */ }
  }
}

test("CLI measure: a matching real user message → stdout delivered: true, exit 0", () => {
  withTempJsonl(userStringLine("cli-marker-777") + "\n", (file) => {
    const r = runCli(["--check", file, "--text", "cli-marker-777"]);
    assert.equal(r.status, 0, `exit 0 expected, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /delivered: true/);
  });
});

test("CLI measure: no matching evidence → stdout state: unknown, exit 3 (three-state contract — NOT a bare FAIL)", () => {
  withTempJsonl(userStringLine("hello") + "\n", (file) => {
    const r = runCli(["--check", file, "--text", "absent-marker-999"]);
    assert.equal(r.status, 3, `exit 3 (unknown) expected, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /state: unknown/);
    assert.match(r.stdout, /delivered: false/);
  });
});

test("CLI measure: --start baseline excludes a pre-existing identical message (fault 4 NEW-message rule)", () => {
  const first = userStringLine("same-marker");
  const second = userStringLine("same-marker");
  const full = first + "\n" + second + "\n";
  const baseline = Buffer.byteLength(first + "\n", "utf8");
  withTempJsonl(full, (file) => {
    // Without a baseline, the old identical message matches → delivered.
    const noBaseline = runCli(["--check", file, "--text", "same-marker"]);
    assert.equal(noBaseline.status, 0, "whole-file scan sees the pre-existing message");
    // With a baseline after it, only the appended copy counts → still delivered (it is a new one).
    const withBaseline = runCli(["--check", file, "--start", String(baseline), "--text", "same-marker"]);
    assert.equal(withBaseline.status, 0, "baseline scan still sees the appended message");
  });
});

test("CLI measure: missing transcript file → exit 2 (fail loud, never a silent false)", () => {
  const r = runCli(["--check", path.join(os.tmpdir(), "no-such-file.jsonl"), "--text", "x"]);
  assert.equal(r.status, 2, `exit 2 expected, got ${r.status}\n${r.stdout}\n${r.stderr}`);
});

test("CLI usage: missing --text → exit 2", () => {
  const r = runCli(["--check", "whatever.jsonl"]);
  assert.equal(r.status, 2, `exit 2 expected, got ${r.status}\n${r.stdout}\n${r.stderr}`);
});

test("CLI fresh: --is-fresh on an empty transcript → fresh: true, exit 0", () => {
  withTempJsonl("", (file) => {
    const r = runCli(["--is-fresh", file]);
    assert.equal(r.status, 0, `exit 0 expected, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /fresh: true/);
  });
});

test("CLI fresh: --is-fresh on an assistant-only transcript → fresh: true, exit 0", () => {
  withTempJsonl(assistantLine("hi") + "\n", (file) => {
    const r = runCli(["--is-fresh", file]);
    assert.equal(r.status, 0, `exit 0 expected, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /fresh: true/);
  });
});

test("CLI fresh: --is-fresh on a transcript with a real user message → fresh: false, exit 1", () => {
  withTempJsonl(userStringLine("hello") + "\n", (file) => {
    const r = runCli(["--is-fresh", file]);
    assert.equal(r.status, 1, `exit 1 expected, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /fresh: false/);
  });
});

test("CLI fresh: --is-fresh on a MISSING transcript → fresh: true, exit 0 (brand-new session has no file yet)", () => {
  const r = runCli(["--is-fresh", path.join(os.tmpdir(), "no-such-fresh-file.jsonl")]);
  assert.equal(r.status, 0, `fresh for absent file, got ${r.status}\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /fresh: true/);
});

// ── the reliable-send script: only the no-terminal surfaces ────────────────────────────────────────

test("script: missing arguments exit 2 with a usage message, before any tmux call", () => {
  const r = spawnSync("bash", [SCRIPT], { encoding: "utf8" });
  assert.equal(r.status, 2, `usage exit expected, got ${r.status}\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /用法/, `usage message expected:\n${r.stderr}`);
  const r2 = spawnSync("bash", [SCRIPT, "some-target"], { encoding: "utf8" });
  assert.equal(r2.status, 2, `missing-text usage exit expected, got ${r2.status}\n${r2.stderr}`);
  const r3 = spawnSync("bash", [SCRIPT, "some-target", "hello"], { encoding: "utf8" });
  assert.equal(r3.status, 2, `missing-jsonl usage exit expected, got ${r3.status}\n${r3.stderr}`);
});

test("script: the file exists, is executable, and step 5 delegates to the pure checker (the design's wiring)", () => {
  const st = fs.statSync(SCRIPT);
  assert.ok(st.isFile(), "script exists");
  assert.ok((st.mode & 0o111) !== 0, "script is executable");
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.ok(src.includes("transcript-delivery-check.ts"), "step 5 delegates to the pure delivery check");
  assert.ok(src.includes("C-u"), "step 1 uses the C-u clear mechanism");
  // AC1 wiring: fresh-session detection must consult the pure `--is-fresh` checker mode.
  assert.match(src, /--is-fresh/, "fresh-session detection delegates to the pure --is-fresh verdict");
  assert.match(src, /fresh_session/, "script carries a fresh-session branch");
  assert.match(src, /SKIP/, "the fresh branch skips the clear loop");
});

test("AC4: a MISSING checker exits 1 at startup (fail-loud), never a silent broken delivery (gap-laydown-derivation-is-sensitive-to-reference-spelling-dependency-closure)", () => {
  // Reproduce the pre-fix defect's environment: the script present, the pure checker absent (the
  // laydown derivation's spelling-sensitivity once shipped exactly this). The script must FAIL LOUD
  // at startup — not assign CHECKER and silently fail every later poll.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skr-checker-"));
  try {
    fs.copyFileSync(SCRIPT, path.join(dir, "send-keys-reliable.sh"));
    assert.ok(!fs.existsSync(path.join(dir, "transcript-delivery-check.ts")), "checker must be absent");
    const r = spawnSync("bash", [path.join(dir, "send-keys-reliable.sh"), "tgt", "text", "t.jsonl"], {
      encoding: "utf8",
    });
    assert.equal(r.status, 1, `missing checker must exit 1 (fail loud), got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /缺少校验器/, `must name the missing checker:\n${r.stderr}`);
    assert.match(r.stderr, /transcript-delivery-check\.ts/, `must name the missing checker path:\n${r.stderr}`);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

// ── AC7: zero hash (the family ruling F killed stays dead) ────────────────────────────────────────

test("AC7: script and test contain zero occurrences of the three hash-tool names (grep = 0)", () => {
  // Assembled so this very assertion can scan the file it lives in without counting itself.
  const words = [["md5", "sum"].join(""), ["sha1", "sum"].join(""), ["ck", "sum"].join("")];
  const targets = [SCRIPT, path.join(__dirname, "send-keys-reliable.test.mjs")];
  let total = 0;
  for (const t of targets) {
    const src = fs.readFileSync(t, "utf8");
    for (const w of words) {
      total += (src.match(new RegExp(w, "g")) || []).length;
    }
  }
  assert.equal(total, 0, `forbidden hash-tool names appear ${total} time(s) across script+test`);
});

// ── AC1/AC2: REAL end-to-end — the clear loop on a REAL TUI ───────────────────────────────────────
// The pure-function tests above never spawn a pane, yet BOTH clear-loop defects live ONLY in
// behavior on a REAL TUI: (AC2) an EMPTY Claude Code input box renders as `❯` + NBSP (U+00A0,
// bytes c2 a0), which the old `[:space:]` check judged non-empty → CLEAR_MAX fail loud; (AC1) a
// FRESH session's welcome screen renders `❯ Try "..."` — REAL visible text after the prompt that
// C-u can never remove, so the clear loop must be SKIPPED entirely (transcript has zero user
// messages). This is a user-facing contract (CLAUDE.md test-layer strategy item 1: ≥1 REAL
// end-to-end check against the shipped artifact). The carve-out owns exactly two dedicated fixture
// sessions (unique names), drives each once, and cleans up with a scoped `tmux kill-session -t
// <unique>` — never kill-server, never a shared session. If tmux is unavailable the tests skip
// cleanly.

/** Unique-per-run tmux session / tmp names (the AC1/AC2 carve-out owns exactly two sessions). */
function uniqueName(prefix) {
  return `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The fixture's prompt bytes: ❯ (U+276F, UTF-8 E2 9D AF) + two NBSP (U+00A0, UTF-8 C2 A0) — the
 * exact bytes of an EMPTY Claude Code input box after the `❯` (bash octal escapes, passed through
 * the fixture's `printf` format string). */
const FIXTURE_PROMPT = "\\342\\235\\257\\302\\240\\302\\240";

/** A tiny "TUI" for the e2e: renders the NBSP prompt, and on every submitted line appends a REAL
 * user JSONL record to the transcript (the receiver committing the typed text). */
function fixtureScriptSrc(transcriptPath) {
  return `#!/usr/bin/env bash
TRANSCRIPT="${transcriptPath}"
printf '${FIXTURE_PROMPT}'
while IFS= read -r line; do
  [ -n "$line" ] || continue
  printf '{"type":"user","message":{"role":"user","content":"%s"}}\\n' "$line" >> "$TRANSCRIPT"
  printf '${FIXTURE_PROMPT}'
done
`;
}

test("AC2 e2e: NBSP-prompt fixture pane on an ALREADY-ACTIVE (non-fresh) session is judged EMPTY — clear loop exits fast (CLEAR_MAX=2), text delivered via transcript", { timeout: 90000 }, async (t) => {
  const tmuxV = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (tmuxV.error || tmuxV.status !== 0) {
    t.skip("tmux not available — skipping the real-TUI e2e");
    return;
  }
  const session = uniqueName("skr-e2e");
  const h = newHermeticTmux("skr-e2e-");
  const fixture = path.join(h.tmp, "fixture.sh");
  const transcript = path.join(h.tmp, "transcript.jsonl");
  fs.writeFileSync(fixture, fixtureScriptSrc(transcript), "utf8");
  // NOT fresh: seed the transcript with a prior user message so the fresh-session skip does NOT
  // fire — this forces the script through the NBSP clear-loop path (AC2 regression protection).
  fs.writeFileSync(transcript, `${userStringLine("prior-session-message")}\n`, "utf8");
  const marker = `skr-e2e-marker-${process.pid}`;
  let result = null;
  let cap = null;
  try {
    const start = h.newSession(session, `bash ${fixture}`);
    assert.equal(start.status, 0, `tmux new-session failed: ${start.stderr}`);
    // Name the fixture window after the session so the drive-target-check gate (which requires the
    // window name to equal DRIVE_EXPECT_WINDOW_NAME) sees a deterministic, matching window name.
    assert.equal(h.tmx(["rename-window", "-t", `${session}:0`, session]).status, 0, `rename-window failed`);

    // Wait (bounded) for the fixture pane to render the NBSP prompt.
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      cap = h.capture(session);
      if (cap.status === 0 && cap.stdout.includes("❯")) ready = true;
      else await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, `fixture pane should render the ❯ prompt (capture: ${cap?.stdout ?? ""})`);

    result = spawnSync("bash", [SCRIPT, session, marker, transcript], {
      encoding: "utf8",
      timeout: 90000,
      env: {
        ...h.env,
        DRIVE_EXPECT_WINDOW_NAME: session, // the fixture's window is renamed to the session (drive-target-check gate)
        RELIABLE_CLEAR_MAX: "2",          // if the NBSP empty-check regresses, the clear loop exhausts at 2 and fails loud
        RELIABLE_STABLE_TIMEOUT_S: "3",
        RELIABLE_DELIVERY_FIRST_S: "3",
        RELIABLE_DELIVERY_VERIFY_S: "15",
        RELIABLE_DELIVERY_POLL_S: "1",
      },
    });
    assert.equal(result.status, 0, `send-keys-reliable.sh failed (exit ${result.status}):\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.match(result.stdout, /已送达/, `script should report delivery:\n${result.stdout}`);
    // The clear loop must have been exercised, not skipped: the fresh-session skip line is ABSENT.
    assert.doesNotMatch(result.stdout, /SKIP 清屏循环/, `non-fresh session must walk the clear loop, not the fresh skip:\n${result.stdout}`);
    const transcriptText = fs.readFileSync(transcript, "utf8");
    assert.match(transcriptText, new RegExp(`"content":"${marker}"`), `marker should appear as a real user message in the transcript:\n${transcriptText}`);
  } finally {
    h.cleanup();
  }
});

// ── gap-drive-sent-to-manager-pane-not-inner: fail-closed wrong-target pre-verify ────────────────
// The 2026-08-10 incident: the outer drove `quay-0:0.0` — window 0 was claude (the MANAGER), not
// inner — and 6 send-keys in 2 dispatches all landed in the manager's input box. The fix: the
// drive-target-check gate (wired into step 0 of send-keys-reliable.sh) fails closed before ANY
// send when the target's window name is not the expected one. These tests prove (a) a non-inner
// window name → exit 1 + nothing sent, and (b) a numeric index → exit 1 even when it would resolve
// to the right window.

test("AC3 fail-closed: a target whose window name != expected (default inner) is REJECTED before any send — nothing lands in the transcript", { timeout: 90000 }, async (t) => {
  const tmuxV = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (tmuxV.error || tmuxV.status !== 0) {
    t.skip("tmux not available — skipping the real-TUI e2e");
    return;
  }
  const session = uniqueName("skr-wrong");
  const h = newHermeticTmux("skr-wrong-");
  const fixture = path.join(h.tmp, "fixture.sh");
  const transcript = path.join(h.tmp, "transcript.jsonl");
  fs.writeFileSync(fixture, fixtureScriptSrc(transcript), "utf8");
  // NOT fresh: seed the transcript so the delivery-poll path is reachable (had a send occurred).
  fs.writeFileSync(transcript, `${userStringLine("prior-session-message")}\n`, "utf8");
  const marker = `skr-wrong-marker-${process.pid}`;
  let result = null;
  try {
    const start = h.newSession(session, `bash ${fixture}`);
    assert.equal(start.status, 0, `tmux new-session failed: ${start.stderr}`);
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      const cap = h.capture(session);
      if (cap.status === 0 && cap.stdout.includes("❯")) ready = true;
      else await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, "fixture pane should render the ❯ prompt");

    // DRIVE_EXPECT_WINDOW_NAME deliberately NOT set → default `inner`. The fixture window is named
    // after the session (`skr-wrong-...`), NOT inner → the gate must fail closed.
    result = spawnSync("bash", [SCRIPT, session, marker, transcript], {
      encoding: "utf8",
      timeout: 30000,
      env: { ...h.env },
    });
    assert.equal(result.status, 1, `wrong window name must exit 1 (fail closed), got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.match(result.stderr, /前置校验/, `must name the pre-verify gate:\n${result.stderr}`);
    // Nothing was sent: the marker must NOT appear in the transcript.
    const transcriptText = fs.readFileSync(transcript, "utf8");
    assert.doesNotMatch(transcriptText, new RegExp(`"content":"${marker}"`), `nothing may be sent to a non-inner window:\n${transcriptText}`);
  } finally {
    h.cleanup();
  }
});

test("AC3 fail-closed: a numeric-index target (quay-0:0.0) is REJECTED by the gate before any tmux/send — even for an existing session whose window 0 would match", { timeout: 30000 }, async (t) => {
  const tmuxV = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (tmuxV.error || tmuxV.status !== 0) {
    t.skip("tmux not available — skipping");
    return;
  }
  const session = uniqueName("skr-numidx");
  const h = newHermeticTmux("skr-numidx-");
  const transcript = path.join(h.tmp, "transcript.jsonl");
  fs.writeFileSync(transcript, `${userStringLine("prior")}\n`, "utf8");
  try {
    // A single-window session whose window 0 is named `inner` — a numeric index quay-0:0 WOULD
    // resolve to the right window, but discipline ① says the numeric index is retired regardless.
    const start = h.newSession(session, `tmux rename-window -t ${session}:0 inner; sleep 30`);
    assert.equal(start.status, 0, `tmux new-session failed: ${start.stderr}`);
    const r = spawnSync("bash", [SCRIPT, `${session}:0`, "marker-numidx", transcript], {
      encoding: "utf8",
      timeout: 30000,
      env: { ...h.env, DRIVE_EXPECT_WINDOW_NAME: "inner" },
    });
    assert.equal(r.status, 1, `numeric-index target must exit 1 (fail closed), got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /数字索引/, `must name the numeric-index rejection:\n${r.stderr}`);
    const transcriptText = fs.readFileSync(transcript, "utf8");
    assert.doesNotMatch(transcriptText, /marker-numidx/, `nothing may be sent via a numeric index:\n${transcriptText}`);
  } finally {
    h.cleanup();
  }
});

// ── AC1: REAL end-to-end — fresh welcome-screen ghost text → clear loop SKIPPED ───────────────────
/** The welcome-screen ghost suggestion text: a REAL visible string rendered after the `❯` prompt on
 * a brand-new Claude Code session. It is NOT removable input (C-u cannot clear it) — the clear loop
 * would judge it non-empty and exhaust CLEAR_MAX. */
const GHOST_WELCOME = 'Try "fix lint errors"';

/** A tiny "TUI" for the AC1 e2e: renders the welcome-screen ghost suggestion after the prompt, and
 * on every submitted line appends a REAL user JSONL record to the transcript (the receiver
 * committing the typed text). The transcript file is ABSENT initially — a brand-new session. */
function ghostFixtureScriptSrc(transcriptPath) {
  return `#!/usr/bin/env bash
TRANSCRIPT="${transcriptPath}"
printf '❯ ${GHOST_WELCOME}'
while IFS= read -r line; do
  [ -n "$line" ] || continue
  printf '{"type":"user","message":{"role":"user","content":"%s"}}\\n' "$line" >> "$TRANSCRIPT"
  printf '❯ ${GHOST_WELCOME}'
done
`;
}

test("AC1 e2e: fresh welcome-screen ghost text (`❯ Try \"fix lint errors\"`) — clear loop SKIPPED (CLEAR_MAX=2, would fail loud if not skipped), text delivered via transcript", { timeout: 90000 }, async (t) => {
  const tmuxV = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (tmuxV.error || tmuxV.status !== 0) {
    t.skip("tmux not available — skipping the real-TUI e2e");
    return;
  }
  const session = uniqueName("skr-ghost");
  const h = newHermeticTmux("skr-ghost-");
  const fixture = path.join(h.tmp, "fixture.sh");
  const transcript = path.join(h.tmp, "transcript.jsonl");
  fs.writeFileSync(fixture, ghostFixtureScriptSrc(transcript), "utf8");
  // Transcript is deliberately ABSENT — a fresh session (nothing typed yet).
  const marker = `skr-ghost-marker-${process.pid}`;
  let result = null;
  try {
    const start = h.newSession(session, `bash ${fixture}`);
    assert.equal(start.status, 0, `tmux new-session failed: ${start.stderr}`);
    // Name the fixture window after the session so the drive-target-check gate sees a deterministic,
    // matching window name.
    assert.equal(h.tmx(["rename-window", "-t", `${session}:0`, session]).status, 0, `rename-window failed`);

    // Wait (bounded) for the fixture pane to render the ghost welcome text.
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      const cap = h.capture(session);
      if (cap.status === 0 && cap.stdout.includes(GHOST_WELCOME)) ready = true;
      else await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, `fixture pane should render the ghost welcome text`);

    result = spawnSync("bash", [SCRIPT, session, marker, transcript], {
      encoding: "utf8",
      timeout: 90000,
      env: {
        ...h.env,
        DRIVE_EXPECT_WINDOW_NAME: session, // the fixture's window is named after the session (drive-target-check gate)
        RELIABLE_CLEAR_MAX: "2",          // if the fresh-skip regresses, the clear loop exhausts at 2 against the ghost text and fails loud
        RELIABLE_STABLE_TIMEOUT_S: "3",
        RELIABLE_DELIVERY_FIRST_S: "3",
        RELIABLE_DELIVERY_VERIFY_S: "15",
        RELIABLE_DELIVERY_POLL_S: "1",
      },
    });
    assert.equal(result.status, 0, `fresh welcome drive failed (exit ${result.status}) — the clear loop must be SKIPPED:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    // Contract `measure`: a fresh welcome drive must NOT fail loud (no 'fail loud', no CLEAR_MAX).
    assert.doesNotMatch(result.stdout + result.stderr, /fail loud|CLEAR_MAX/, `fresh welcome drive must not fail loud:\n${result.stdout}${result.stderr}`);
    // The fresh-skip branch was taken (transcript had no user message).
    assert.match(result.stdout, /SKIP 清屏循环/, `fresh session must take the skip branch:\n${result.stdout}`);
    assert.match(result.stdout, /已送达/, `script should report delivery:\n${result.stdout}`);
    const transcriptText = fs.readFileSync(transcript, "utf8");
    assert.match(transcriptText, new RegExp(`"content":"${marker}"`), `marker should appear as a real user message in the transcript:\n${transcriptText}`);
  } finally {
    h.cleanup();
  }
});

} // end governance self-skip else

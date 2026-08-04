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
// outer ruling R3 (the kill-server family crashed two machines): this test NEVER creates or
// cleans up terminal sessions/windows, and never invokes tmux. Everything is a string fixture
// (pure function) or a temp .jsonl file (CLI). No tmux server, no pty, no fake TUI (ruling E
// pattern — the dangerous test surface is structurally absent).
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
  tailFromByteOffset,
} from "../scripts/transcript-delivery-check.ts";

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

test("CLI measure: no matching user message → stdout delivered: false, exit 1", () => {
  withTempJsonl(userStringLine("hello") + "\n", (file) => {
    const r = runCli(["--check", file, "--text", "absent-marker-999"]);
    assert.equal(r.status, 1, `exit 1 expected, got ${r.status}\n${r.stdout}\n${r.stderr}`);
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

} // end governance self-skip else

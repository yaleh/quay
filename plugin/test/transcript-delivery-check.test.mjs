// @test-group engine
// transcript-delivery-check.test.mjs — THREE-STATE delivery verdict tests for
// plugin/scripts/transcript-delivery-check.ts (gap-send-keys-reliable-false-fail-on-long-text-paste).
//
// The reliable-send delivery verdict is a PURE function in transcript-delivery-check.ts. It used
// to be TWO-state (delivered / not-delivered) and ONLY recognized `type=user` + `message.role=user`
// pure-string records — so a successful LONG-TEXT/PASTE delivery (which lands as ZERO type=user
// records: only `type=queue-operation` enqueue/remove + `type=attachment` queued_command) was
// reported as FAIL. Every past downstream error came from reading the third state (unknown) as the
// first meaning (delivered-failed). This file pins the THREE-STATE verdict:
//
//   AC2  long-text/queue-operation+attachment form  → DELIVERED (not FAIL, not UNKNOWN)
//   AC3  real discard (remove-without-materialization; role=all zero-hit shape) → FAILED/UNKNOWN,
//        distinguishable from DELIVERED; DELIVERED is never misreported as discard (negative control)
//   AC4  existing success form (type=user pure-string) still DELIVERED; existing known-failure
//        forms (assistant-only, tool_result-only, mismatched, empty sent text) still classified
//        as NOT delivered
//
// Run: node --no-warnings --experimental-strip-types --test plugin/test/transcript-delivery-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  checkTranscriptDelivered,
  extractDeliveryEvidence,
  extractUserTextCandidates,
  tailFromByteOffset,
} from "../scripts/transcript-delivery-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHECKER = path.resolve(__dirname, "..", "scripts", "transcript-delivery-check.ts");

// ── realistic transcript line shapes (mirrors ~/.claude/projects/<slug>/<session>.jsonl) ─────────

function userStringLine(content) {
  return JSON.stringify({ type: "user", message: { role: "user", content }, isSidechain: false });
}

function userArrayLine(blocks) {
  return JSON.stringify({ type: "user", message: { role: "user", content: blocks }, isSidechain: false });
}

function assistantLine(content) {
  return JSON.stringify({ type: "assistant", message: { role: "assistant", content }, isSidechain: false });
}

/** The manager's REAL 05:39 long-text/paste delivery shape (zero type=user pure-string records):
 * queue-operation enqueue → queue-operation remove → attachment queued_command, all carrying the
 * full sent content. */
function longTextDeliveryShape(content) {
  return [
    { type: "queue-operation", operation: "enqueue", timestamp: "2026-08-08T05:39:23.157Z", sessionId: "s", content },
    { type: "queue-operation", operation: "remove", timestamp: "2026-08-08T05:39:42.590Z", sessionId: "s", content },
    { type: "attachment", isSidechain: false, attachment: { type: "queued_command", prompt: content, commandMode: "task-notification", timestamp: "2026-08-08T05:39:42.726Z" } },
  ].map((o) => JSON.stringify(o)).join("\n");
}

function queueOp(op, content) {
  return JSON.stringify({ type: "queue-operation", operation: op, timestamp: "2026-08-08T05:50:01.000Z", sessionId: "s", content });
}

// ── AC2: the false-FAIL reproduction — long-text/queue-operation+attachment must be DELIVERED ────

test("AC2: long-text delivery shape (queue-operation + attachment, ZERO type=user) is DELIVERED, not FAIL", () => {
  const fragment = longTextDeliveryShape("两条我自己的错 long-paste-marker-901");
  const v = checkTranscriptDelivered(fragment, "long-paste-marker-901");
  assert.equal(v.state, "delivered", `state must be delivered, got ${v.state}`);
  assert.equal(v.delivered, true);
  assert.equal(v.failed, false, "a real delivery must never be misreported as discard (negative control)");
  assert.equal(v.unknown, false);
  assert.ok(v.matchedLine && v.matchedLine.includes("long-paste-marker-901"), "matchedLine names the evidence");
});

test("AC2: queue-operation + attachment matches on a CONTENT-SUFFIX needle (contains, not equality)", () => {
  const fragment = longTextDeliveryShape("[管理者→外层] 补验请求 candidate: README source-install fix marker-42 end");
  const v = checkTranscriptDelivered(fragment, "marker-42");
  assert.equal(v.state, "delivered");
});

test("AC2: an attachment record alone (isSidechain=false, queued_command prompt) is DELIVERED", () => {
  const attachmentOnly = JSON.stringify({ type: "attachment", isSidechain: false, attachment: { type: "queued_command", prompt: "paste-attachment-marker-333", commandMode: "task-notification" } });
  const v = checkTranscriptDelivered(attachmentOnly, "paste-attachment-marker-333");
  assert.equal(v.state, "delivered");
});

test("AC2: an isSidechain=true attachment is NOT delivery evidence (manager's 非 sidechain criterion)", () => {
  const sidechainAttachment = JSON.stringify({ type: "attachment", isSidechain: true, attachment: { type: "queued_command", prompt: "sidechain-marker-444", commandMode: "task-notification" } });
  const v = checkTranscriptDelivered(sidechainAttachment, "sidechain-marker-444");
  assert.equal(v.state, "unknown", "sidechain context must never count as delivered");
});

test("AC2: enqueue-only (still pending) is UNKNOWN, never FAILED and never DELIVERED", () => {
  const pending = queueOp("enqueue", "pending-marker-555") + "\n";
  const v = checkTranscriptDelivered(pending, "pending-marker-555");
  assert.equal(v.state, "unknown");
  assert.equal(v.failed, false, "a message still in the queue is not a discard");
  assert.equal(v.delivered, false, "a message still in the queue is not delivered");
});

// ── AC3: real discard is distinguishable from DELIVERED ─────────────────────────────────────────

test("AC3: real discard signature (enqueue then remove, never materialized) is FAILED", () => {
  const discard = queueOp("enqueue", "discard-marker-777") + "\n" + queueOp("remove", "discard-marker-777") + "\n";
  const v = checkTranscriptDelivered(discard, "discard-marker-777");
  assert.equal(v.state, "failed");
  assert.equal(v.failed, true);
  assert.equal(v.delivered, false);
});

test("AC3: remove-without-materialization alone is FAILED (the discard signature persists)", () => {
  const removeOnly = queueOp("remove", "discard-marker-777") + "\n";
  const v = checkTranscriptDelivered(removeOnly, "discard-marker-777");
  assert.equal(v.state, "failed");
});

test("AC3: no evidence at all (the manager's role=all zero-hit shape) is UNKNOWN, distinct from DELIVERED", () => {
  // The 3rd sample (this defect report) reported FAIL and role=all verified zero hits — the sent
  // text appears NOWHERE. That must be UNKNOWN (check first), NOT a bare FAIL and NOT delivered.
  const fragment = assistantLine("unrelated content") + "\n" + userStringLine("hello world") + "\n";
  const v = checkTranscriptDelivered(fragment, "absent-marker-999");
  assert.equal(v.state, "unknown");
  assert.equal(v.delivered, false);
  assert.equal(v.failed, false);
});

test("AC3 negative control: DELIVERED evidence beats a same-content discard record (never misreported as discard)", () => {
  // The real 05:39 shape writes remove BEFORE the attachment (same timestamp). The verdict must be
  // DELIVERED whenever a materialized form exists, even alongside a matching remove.
  const fragment = queueOp("enqueue", "dual-marker-123") + "\n" + queueOp("remove", "dual-marker-123") + "\n" + userStringLine("dual-marker-123 typed") + "\n";
  const v = checkTranscriptDelivered(fragment, "dual-marker-123");
  assert.equal(v.state, "delivered");
  assert.equal(v.failed, false);
});

// ── AC4: existing success form + existing known-failure forms still classified correctly ─────────

test("AC4: type=user pure-string delivery is still DELIVERED", () => {
  const fragment = userStringLine("classic-marker-111 hello") + "\n" + assistantLine("ok") + "\n";
  const v = checkTranscriptDelivered(fragment, "classic-marker-111");
  assert.equal(v.state, "delivered");
  assert.ok(v.matchedLine && v.matchedLine.includes("classic-marker-111"), "matchedLine names the message");
});

test("AC4: type=user array text block is still DELIVERED", () => {
  const fragment = userArrayLine([{ type: "text", text: "echo reliable-marker" }]) + "\n";
  assert.equal(checkTranscriptDelivered(fragment, "reliable-marker").state, "delivered");
});

test("AC4: assistant-only content matching the sent text is NOT delivered (welcome-screen ghost family)", () => {
  const fragment = assistantLine("welcome-screen-ghost-marker") + "\n";
  const v = checkTranscriptDelivered(fragment, "welcome-screen-ghost-marker");
  assert.equal(v.state, "unknown", "assistant content is not delivery evidence — UNKNOWN, never delivered");
});

test("AC4: tool_result-only content is NOT delivered (injected context, not typed input)", () => {
  const fragment = userArrayLine([{ type: "tool_result", tool_use_id: "toolu_1", content: "tool-result-marker" }]) + "\n";
  const v = checkTranscriptDelivered(fragment, "tool-result-marker");
  assert.equal(v.state, "unknown");
});

test("AC4: mismatched content (user message present, needle absent) is NOT delivered", () => {
  const fragment = userStringLine("hello world") + "\n";
  const v = checkTranscriptDelivered(fragment, "unique-marker-XYZ");
  assert.equal(v.state, "unknown");
  assert.equal(v.delivered, false);
});

test("AC4: empty sent text can never be delivered (hash-check family: absent needle)", () => {
  const v = checkTranscriptDelivered(userStringLine("anything"), "   ");
  assert.equal(v.state, "unknown");
  assert.equal(v.delivered, false);
});

test("AC4: empty transcript is not delivered", () => {
  const v = checkTranscriptDelivered("", "anything");
  assert.equal(v.state, "unknown");
  assert.equal(v.delivered, false);
});

test("AC4: malformed JSONL lines are skipped without crashing, and a real line still matches", () => {
  const fragment = "not json at all\n{broken\n" + userStringLine("real marker here") + "\n";
  assert.equal(checkTranscriptDelivered(fragment, "real marker here").state, "delivered");
});

test("AC4: matching is a content CONTAINS check (CRYSTALLIZED doc's 匹配（或包含）)", () => {
  const fragment = userStringLine("please run: echo reliable-marker and then stop") + "\n";
  assert.equal(checkTranscriptDelivered(fragment, "reliable-marker").state, "delivered");
});

// ── extractDeliveryEvidence: the forms are tagged correctly ─────────────────────────────────────

test("extractDeliveryEvidence: the long-text delivery shape yields user/attachment/queue-op evidence in order", () => {
  const fragment = longTextDeliveryShape("marker-abcdef") + "\n" + userStringLine("typed marker-abcdef") + "\n";
  const ev = extractDeliveryEvidence(fragment);
  const sources = ev.map((e) => e.source);
  assert.ok(sources.includes("queue-operation-enqueue"), "enqueue record tagged");
  assert.ok(sources.includes("queue-operation-remove"), "remove record tagged");
  assert.ok(sources.includes("attachment"), "attachment record tagged");
  assert.ok(sources.includes("user"), "user record tagged");
  assert.ok(ev.every((e) => e.text.includes("marker-abcdef") || e.text.includes("typed marker-abcdef")), "every evidence carries the content");
});

test("extractUserTextCandidates: still only real typed user text (regression — hasUserMessages/fresh depends on it)", () => {
  const fragment = userStringLine("typed text") + "\n" + assistantLine("assistant text") + "\n" + userArrayLine([{ type: "tool_result", content: "tool text" }]) + "\n";
  const cands = extractUserTextCandidates(fragment);
  assert.equal(cands.length, 1);
  assert.equal(cands[0].text, "typed text");
});

test("tailFromByteOffset: the delivery poll only sees content appended after the baseline (fault 4 NEW-message rule)", () => {
  const first = userStringLine("old-marker");
  const second = userStringLine("new-marker");
  const full = first + "\n" + second + "\n";
  const baseline = Buffer.byteLength(first + "\n", "utf8");
  const tail = tailFromByteOffset(full, baseline);
  assert.ok(tail.includes("new-marker"));
  assert.ok(!tail.includes("old-marker"));
  assert.equal(tailFromByteOffset(full, 0), full);
});

// ── CLI contract: three-state exit codes ────────────────────────────────────────────────────────

function runCli(args) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, ...args], { encoding: "utf8" });
}

function withTempJsonl(content, fn) {
  const tmp = path.join(os.tmpdir(), `tdc-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(tmp, content, "utf8");
  try {
    return fn(tmp);
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort */ }
  }
}

test("CLI: long-text delivery shape → state: delivered, exit 0 (the measure false_fail_repro contract)", () => {
  withTempJsonl(longTextDeliveryShape("cli-long-marker-777") + "\n", (file) => {
    const r = runCli(["--check", file, "--text", "cli-long-marker-777"]);
    assert.equal(r.status, 0, `exit 0 expected, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /state: delivered/);
    assert.match(r.stdout, /delivered: true/);
  });
});

test("CLI: real discard signature → state: failed, exit 1 (clear discard evidence)", () => {
  withTempJsonl(queueOp("enqueue", "cli-discard-marker") + "\n" + queueOp("remove", "cli-discard-marker") + "\n", (file) => {
    const r = runCli(["--check", file, "--text", "cli-discard-marker"]);
    assert.equal(r.status, 1, `exit 1 expected, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /state: failed/);
    assert.match(r.stdout, /delivered: false/);
  });
});

test("CLI: no evidence → state: unknown, exit 3 (distinct third state, NOT a bare FAIL)", () => {
  withTempJsonl(userStringLine("hello") + "\n", (file) => {
    const r = runCli(["--check", file, "--text", "absent-marker-999"]);
    assert.equal(r.status, 3, `exit 3 expected, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /state: unknown/);
    assert.match(r.stdout, /delivered: false/);
  });
});

test("CLI: --start baseline restricts the scan to appended content (fault 4 NEW-message rule)", () => {
  const first = userStringLine("same-marker");
  const second = userStringLine("same-marker");
  const full = first + "\n" + second + "\n";
  const baseline = Buffer.byteLength(first + "\n", "utf8");
  withTempJsonl(full, (file) => {
    const noBaseline = runCli(["--check", file, "--text", "same-marker"]);
    assert.equal(noBaseline.status, 0, "whole-file scan sees the pre-existing message");
    const withBaseline = runCli(["--check", file, "--start", String(baseline), "--text", "same-marker"]);
    assert.equal(withBaseline.status, 0, "baseline scan still sees the appended message");
  });
});

test("CLI: missing transcript file → exit 2 (fail loud, never a silent false)", () => {
  const r = runCli(["--check", path.join(os.tmpdir(), "no-such-file.jsonl"), "--text", "x"]);
  assert.equal(r.status, 2, `exit 2 expected, got ${r.status}\n${r.stdout}\n${r.stderr}`);
});

test("CLI usage: missing --text → exit 2", () => {
  const r = runCli(["--check", "whatever.jsonl"]);
  assert.equal(r.status, 2, `exit 2 expected, got ${r.status}\n${r.stdout}\n${r.stderr}`);
});

// ── CLI remote: --remote <host> (gap-supervisor-deliver-cross-host-target-support, AC3) ───────────
// The cross-host delivery's transcript lives on ANOTHER host — the CLI must read it via
// `ssh <host> cat <path>` (SUPERVISOR_DELIVER_SSH → the hermetic fixtures/mock-ssh.sh). The
// delivered verdict is STILL a content-matching REAL user message in the target transcript — the
// remote read only changes WHERE the bytes come from, never what counts as delivered (ADR-016).
const MOCK_SSH = path.resolve(__dirname, "fixtures", "mock-ssh.sh");
function runRemoteCli(args) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, ...args], {
    encoding: "utf8",
    env: { ...process.env, SUPERVISOR_DELIVER_SSH: MOCK_SSH },
  });
}

test("CLI remote: --check --remote returns the content-match verdict from the remote transcript (delivered not degraded)", () => {
  withTempJsonl(userStringLine("remote-marker-777") + "\n", (file) => {
    const r = runRemoteCli(["--check", file, "--text", "remote-marker-777", "--remote", "ad-arm1.wan.hwang.men"]);
    assert.equal(r.status, 0, `remote delivered expected exit 0, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /state: delivered/);
    assert.match(r.stdout, /delivered: true/);
  });
});

test("CLI remote: --check --remote still reports UNKNOWN (exit 3) when the remote transcript has no matching evidence", () => {
  withTempJsonl(userStringLine("hello") + "\n", (file) => {
    const r = runRemoteCli(["--check", file, "--text", "absent-remote-marker-999", "--remote", "ad-arm1.wan.hwang.men"]);
    assert.equal(r.status, 3, `remote unknown expected exit 3, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /state: unknown/);
    assert.match(r.stdout, /delivered: false/);
  });
});

test("CLI remote: --check --remote on a missing remote transcript → exit 2 (fail loud, never a silent false)", () => {
  const r = runRemoteCli(["--check", path.join(os.tmpdir(), "no-such-remote.jsonl"), "--text", "x", "--remote", "ad-arm1.wan.hwang.men"]);
  assert.equal(r.status, 2, `remote missing transcript expected exit 2, got ${r.status}\n${r.stdout}\n${r.stderr}`);
});

test("CLI remote: --is-fresh --remote on an ABSENT remote transcript is FRESH (ENOENT-equivalent → exit 0)", () => {
  const r = runRemoteCli(["--is-fresh", path.join(os.tmpdir(), "no-such-remote-fresh.jsonl"), "--remote", "ad-arm1.wan.hwang.men"]);
  assert.equal(r.status, 0, `remote absent fresh expected exit 0, got ${r.status}\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /fresh: true/);
});

test("CLI remote: --is-fresh --remote on a transcript with a real user message is NOT fresh (exit 1)", () => {
  withTempJsonl(userStringLine("hello") + "\n", (file) => {
    const r = runRemoteCli(["--is-fresh", file, "--remote", "ad-arm1.wan.hwang.men"]);
    assert.equal(r.status, 1, `remote non-fresh expected exit 1, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /fresh: false/);
  });
});

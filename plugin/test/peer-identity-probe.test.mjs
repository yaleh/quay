// @test-group product
// peer-identity-probe.test.mjs — pure-function tests for the peer-identity probe
// (tasks/gap-quay-server-lightweight-peer-identity-spike, Plan 2 / AC4 / AC6).
//
// Scope: the PURE parts only. The delivery measurements themselves (AC1/AC2/AC7) are live
// cross-session experiments whose readings live in .quay/peer-identity-probe-evidence.jsonl and
// docs/analysis/session-inbound-two-paths-2026-09-13.md — they cannot be reproduced by a unit test
// (a test that fabricated the frames would be the self-证 the task explicitly forbids).
//
// What IS asserted here are the invariants the measurements depend on:
//   - the record is built from REAL process facts and defaults to the HONEST agent value (AC5);
//   - OMIT/SET actually remove/override fields (AC4's enumeration rides on this);
//   - an unreadable fact yields null, never a fabricated value (hard rule 3b/6);
//   - the cleanup gate only touches our own pid / our own marker (AC6's shared-state safety).
//
// Run: scripts/test.sh plugin/test/peer-identity-probe.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  PROBE_MARKER,
  PROBE_MARKER_VALUE,
  DEFAULT_AGENT,
  buildEvidenceEntry,
  buildKeyRecord,
  buildPidDomain,
  buildSessionRecord,
  detectCcVersion,
  extractMessageText,
  extractWrapperAttrs,
  generateKeyFileId,
  generatePeerToken,
  isOwnRegistryFile,
  parseFrame,
  parsePidNamespaceLink,
  parseProcStart,
  readPidDomain,
  readProcStart,
  shouldCleanupFile,
  splitFrames,
  verifyAuthFrame,
} from "../scripts/peer-identity-probe.ts";

const FACTS = {
  pid: 424242,
  procStart: "283672050",
  pidDomain: "linux:c8452f83fffa26f523c8c8b075c452f4:pid:[4026531836]",
  cwd: "/home/yale/work/quay",
  startedAtMs: 1789273727088,
  sockPath: "/run/user/1000/cc-socks/424242.sock",
  version: "probe",
  ccVersion: "2.1.270",
};

// ── process-fact readers ──────────────────────────────────────────────────────────────────────────

test("parseProcStart reads field 22, tolerating a comm containing spaces and parens", () => {
  // /proc/<pid>/stat: field 2 is comm and MAY contain spaces/parens ⇒ split on the LAST ')'.
  const fields = Array.from({ length: 52 }, (_, i) => String(i + 1));
  fields[0] = "S"; // state = field 3 in stat numbering
  fields[19] = "283672050"; // starttime = field 22
  const stat = `424242 (node (worker) x) ${fields.join(" ")}`;
  assert.equal(parseProcStart(stat), "283672050");
});

test("parseProcStart returns null (not a made-up number) on unparseable input", () => {
  assert.equal(parseProcStart("no-paren-here"), null);
  assert.equal(parseProcStart("424242 (node) S"), null, "too few fields");
  assert.equal(parseProcStart(undefined), null, "non-string input");
  const fields = Array.from({ length: 52 }, () => "x");
  assert.equal(parseProcStart(`1 (n) ${fields.join(" ")}`), null, "non-numeric starttime");
});

test("readProcStart yields null when the read fails — never a fabricated identity", () => {
  const failing = { readFileSync: () => { throw new Error("ENOENT"); }, readlinkSync: () => "" };
  assert.equal(readProcStart(1234, failing), null);
});

test("readPidDomain yields null when machine-id is unreadable — never a fabricated domain", () => {
  const failing = { readFileSync: () => { throw new Error("ENOENT"); }, readlinkSync: () => "pid:[1]" };
  assert.equal(readPidDomain(failing), null);
});

test("pidDomain is built from the real machine-id + pid namespace inode", () => {
  assert.equal(parsePidNamespaceLink("pid:[4026531836]"), "4026531836");
  assert.equal(parsePidNamespaceLink("net:[4026531992]"), null);
  assert.equal(
    buildPidDomain("c8452f83fffa26f523c8c8b075c452f4", "4026531836"),
    "linux:c8452f83fffa26f523c8c8b075c452f4:pid:[4026531836]",
  );
});

// ── record construction (AC3/AC4 ride on this) ────────────────────────────────────────────────────

test("the record defaults to the HONEST agent value, never agent:'claude' (AC5)", () => {
  const rec = buildSessionRecord(FACTS);
  assert.equal(rec.agent, DEFAULT_AGENT);
  assert.equal(rec.agent, "quay");
  assert.notEqual(rec.agent, "claude", "default must not impersonate a Claude Code session");
  assert.equal(rec.name, `quay-server-${FACTS.pid}`);
  assert.match(String(rec.name), /quay-server/, "AC3 row (a): the honest name contains quay-server");
});

test("the record carries real process facts verbatim (nothing here needs forging)", () => {
  const rec = buildSessionRecord(FACTS);
  assert.equal(rec.pid, FACTS.pid);
  assert.equal(rec.procStart, FACTS.procStart);
  assert.equal(rec.pidDomain, FACTS.pidDomain);
  assert.equal(rec.messagingSocketPath, FACTS.sockPath, "the socket we actually listen on");
  assert.equal(rec.cwd, FACTS.cwd);
  assert.equal(rec.startedAt, FACTS.startedAtMs);
  assert.equal(rec[PROBE_MARKER], PROBE_MARKER_VALUE, "our own marker for the cleanup gate");
});

test("omit actually REMOVES the key after a JSON round-trip (AC4's strip rows)", () => {
  const rec = buildSessionRecord(FACTS, { omit: ["procStart", "name", "cwd"] });
  const rt = JSON.parse(JSON.stringify(rec));
  assert.equal("procStart" in rt, false, "procStart stripped ⇒ key absent on disk, not null");
  assert.equal("name" in rt, false);
  assert.equal("cwd" in rt, false);
  assert.equal(rt.pid, FACTS.pid, "unstripped fields survive");
});

test("set overrides a value, and the __DELETE__ sentinel strips instead of writing", () => {
  const rec = buildSessionRecord(FACTS, { set: { kind: "interactive", status: "__DELETE__" } });
  const rt = JSON.parse(JSON.stringify(rec));
  assert.equal(rt.kind, "interactive");
  assert.equal("status" in rt, false);
});

test("an empty-string agent is representable (AC3 row (b): 缺省/空)", () => {
  assert.equal(buildSessionRecord(FACTS, { agent: "" }).agent, "");
  assert.equal(buildSessionRecord(FACTS, { agent: null }).agent, null);
});

test("the key record carries the token and the SAME real facts used for liveness", () => {
  const key = buildKeyRecord(FACTS, "a".repeat(32));
  assert.equal(key.peerToken, "a".repeat(32));
  assert.equal(key.procStart, FACTS.procStart);
  assert.equal(key.pidDomain, FACTS.pidDomain);
});

// ── token generation ──────────────────────────────────────────────────────────────────────────────

test("peerToken is 32 hex (matching the real <pid>.*.key shape) and varies per call", () => {
  const a = generatePeerToken();
  const b = generatePeerToken();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, b, "fresh entropy each call");
  assert.match(generateKeyFileId(), /^[0-9a-f]{64}$/);
});

// ── frame handling ────────────────────────────────────────────────────────────────────────────────

test("splitFrames keeps a partial trailing line as rest (socket data is not line-aligned)", () => {
  const { lines, rest } = splitFrames('{"a":1}\n{"b":2}\n{"partial"');
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
  assert.equal(rest, '{"partial"');
});

test("splitFrames drops blank lines but the caller keeps non-JSON lines", () => {
  const { lines } = splitFrames('{"a":1}\n\n   \n{"b":2}\n');
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
});

test("parseFrame returns null for non-JSON / array / scalar — never a fake object", () => {
  assert.deepEqual(parseFrame('{"x":1}'), { x: 1 });
  assert.equal(parseFrame("not json"), null);
  assert.equal(parseFrame("[1,2]"), null);
  assert.equal(parseFrame("42"), null);
});

test("verifyAuthFrame distinguishes ok / mismatch / not-auth — the three real cases", () => {
  const tok = "a".repeat(32);
  assert.equal(verifyAuthFrame(JSON.stringify({ type: "auth", token: tok }), tok), "ok");
  // AC2 negative control ② lives here: the key's token differs from what the probe expects.
  assert.equal(verifyAuthFrame(JSON.stringify({ type: "auth", token: "f".repeat(32) }), tok), "mismatch");
  // The measured reality for the platform path: the sender writes a USER frame with NO auth frame
  // first (every delivered round's evidence reads authVerdict:"not-auth"). This must be a distinct
  // verdict from "ok", or a missing auth frame would look like a verified one (hard rule 3b).
  assert.equal(verifyAuthFrame(JSON.stringify({ type: "user", message: {} }), tok), "not-auth");
});

test("extractMessageText pulls the user content, null otherwise (never an empty-string stand-in)", () => {
  const line = JSON.stringify({ type: "user", message: { role: "user", content: "hello" } });
  assert.equal(extractMessageText(line), "hello");
  assert.equal(extractMessageText(JSON.stringify({ type: "auth", token: "x" })), null);
  assert.equal(extractMessageText(JSON.stringify({ type: "user", message: { content: 42 } })), null);
});

test("extractWrapperAttrs byte-copies the platform's wrapper attributes (AC1's report input)", () => {
  const content = '<cross-session-message from="uds:/run/user/1000/cc-socks/1.sock" from-name="quay-task-worker" from-mode="bypass">\nbody\n</cross-session-message>';
  assert.deepEqual(extractWrapperAttrs(content), {
    from: "uds:/run/user/1000/cc-socks/1.sock",
    "from-name": "quay-task-worker",
    "from-mode": "bypass",
  });
  assert.deepEqual(extractWrapperAttrs("no wrapper here"), {});
  assert.deepEqual(extractWrapperAttrs(undefined), {});
});

// ── AC6: the shared-state safety gate ─────────────────────────────────────────────────────────────

test("isOwnRegistryFile claims ONLY our own pid's files (both .json and .key)", () => {
  assert.equal(isOwnRegistryFile("424242.json", 424242), true);
  assert.equal(isOwnRegistryFile("424242.deadbeef.key", 424242), true);
  assert.equal(isOwnRegistryFile("999999.json", 424242), false, "another session's record is not ours");
  assert.equal(isOwnRegistryFile("4242420.json", 424242), false, "a pid that merely starts with ours is not ours");
});

test("shouldCleanupFile: other sessions' records are never swept (AC6 negative control)", () => {
  const otherRecord = JSON.stringify({ pid: 999999, name: "some-real-session", agent: "claude" });
  assert.equal(shouldCleanupFile("999999.json", otherRecord, 424242), false, "another session's live record");
  assert.equal(shouldCleanupFile("999999.deadbeef.key", otherRecord, 424242), false, "a .key is never touched by pid rule");
  // Our own files are always ours to remove.
  assert.equal(shouldCleanupFile("424242.json", null, 424242), true);
  assert.equal(shouldCleanupFile("424242.deadbeef.key", null, 424242), true);
  // A leftover record from a DEAD run of this probe is claimed by its marker, not by its pid.
  const orphan = JSON.stringify({ pid: 111, [PROBE_MARKER]: PROBE_MARKER_VALUE });
  assert.equal(shouldCleanupFile("111.json", orphan, 424242), true, "our marker lets a later run clean up");
  const unmarked = JSON.stringify({ pid: 111, name: "not-ours" });
  assert.equal(shouldCleanupFile("111.json", unmarked, 424242), false, "no marker ⇒ not ours");
});

// ── evidence ──────────────────────────────────────────────────────────────────────────────────────

test("buildEvidenceEntry stamps label/kind and keeps the payload verbatim", () => {
  const e = buildEvidenceEntry("run-x", "frame", { rawLine: '{"type":"auth"}' }, 1700000000000);
  assert.equal(e.label, "run-x");
  assert.equal(e.kind, "frame");
  assert.equal(e.rawLine, '{"type":"auth"}', "the RAW line survives — AC1 reads actual arriving bytes");
  assert.equal(e.ts, new Date(1700000000000).toISOString());
});

test("detectCcVersion returns null (not a guess) when the versions dir is absent", () => {
  assert.equal(detectCcVersion(path.join(os.tmpdir(), "definitely-not-a-home-xyz")), null);
});

test("the probe never spawns claude and never imports an LLM client", () => {
  const src = fs.readFileSync(new URL("../scripts/peer-identity-probe.ts", import.meta.url), "utf8");
  assert.equal(/child_process|spawnSync|execSync/.test(src), false, "no subprocess spawning at all");
  assert.equal(/anthropic|openai/i.test(src.replace(/ANTHROPIC_BASE_URL/g, "")), false, "no LLM client");
});

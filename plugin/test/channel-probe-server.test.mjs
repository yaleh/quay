// @test-group product
// channel-probe-server.test.mjs — pure-function tests for the Channels-path probe
// (tasks/gap-quay-server-lightweight-peer-identity-spike, Plan 8 / AC8 / AC9).
//
// Scope: the PURE parts. Whether a real Claude Code session actually receives a channel event
// (AC8/AC9/AC11) is a live experiment recorded in .quay/channel-probe-evidence.jsonl and
// docs/analysis/session-inbound-two-paths-2026-09-13.md — not reproducible as a unit test.
//
// What IS asserted: the contract the live experiment depends on is declared as the official
// reference requires (capabilities.experimental['claude/channel'] + notifications/claude/channel
// + a reply tool), and that malformed external input is REJECTED rather than silently turned into
// an empty event (hard rule 3b — an empty event would look like a delivered one).
//
// Run: scripts/test.sh plugin/test/channel-probe-server.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CHANNEL_CAPABILITY_KEY,
  CHANNEL_NOTIFICATION_METHOD,
  TOOL_INGEST,
  TOOL_REPLY,
  appendEvidence,
  buildCapabilities,
  buildChannelNotification,
  buildInstructions,
  buildToolEvidence,
  buildToolList,
  parsePushBody,
} from "../scripts/channel-probe-server.ts";

test("capabilities declare the channel key — the one thing that registers the listener", () => {
  const caps = buildCapabilities();
  const exp = caps.experimental;
  assert.equal(Object.prototype.hasOwnProperty.call(exp, CHANNEL_CAPABILITY_KEY), true);
  assert.equal(CHANNEL_CAPABILITY_KEY, "claude/channel");
  assert.deepEqual(exp[CHANNEL_CAPABILITY_KEY], {}, "the reference specifies exactly {}");
  assert.equal(Object.prototype.hasOwnProperty.call(caps, "tools"), true, "tools:{} enables the reply tool");
});

test("the notification method is the documented one and params carry content+meta", () => {
  const n = buildChannelNotification("build failed", { severity: "high", run_id: "1234" });
  assert.equal(n.method, CHANNEL_NOTIFICATION_METHOD);
  assert.equal(n.method, "notifications/claude/channel");
  assert.equal(n.params.content, "build failed");
  assert.deepEqual(n.params.meta, { severity: "high", run_id: "1234" });
});

test("parsePushBody accepts a well-formed external push", () => {
  const p = parsePushBody(JSON.stringify({ content: "hi", meta: { nonce: "abc", origin: "test" } }));
  assert.deepEqual(p, { content: "hi", meta: { nonce: "abc", origin: "test" } });
});

test("parsePushBody REJECTS malformed input instead of producing an empty event", () => {
  assert.equal(parsePushBody("not json"), null);
  assert.equal(parsePushBody("[1,2]"), null);
  assert.equal(parsePushBody('"scalar"'), null);
  assert.equal(parsePushBody("{}"), null, "no content ⇒ rejected, never an empty notification");
  assert.equal(parsePushBody(JSON.stringify({ content: "" })), null);
  assert.equal(parsePushBody(JSON.stringify({ content: "   " })), null, "blank content is not an event");
  assert.equal(parsePushBody(JSON.stringify({ content: 42 })), null);
});

test("meta keys that are not identifiers are dropped (the reference says they are ignored)", () => {
  const p = parsePushBody(JSON.stringify({
    content: "x",
    meta: { good_key: "v", "with-hyphen": "dropped", "1leading": "dropped", also_good: "w", numval: 7 },
  }));
  assert.deepEqual(p.meta, { good_key: "v", also_good: "w" }, "hyphen/leading-digit/non-string entries dropped");
});

test("meta is optional and omitted cleanly", () => {
  assert.deepEqual(parsePushBody(JSON.stringify({ content: "x" })), { content: "x", meta: {} });
});

test("the reply tool is declared with a required nonce (AC9's unique identifier)", () => {
  const tools = buildToolList();
  assert.deepEqual(tools.map((t) => t.name), [TOOL_REPLY, TOOL_INGEST]);
  const reply = tools.find((t) => t.name === TOOL_REPLY);
  assert.equal(reply.inputSchema.type, "object");
  assert.deepEqual(reply.inputSchema.required, ["nonce"]);
  assert.equal(reply.inputSchema.properties.nonce.type, "string");
});

test("tool evidence carries the nonce — the identifier AC9's verdict is read from", () => {
  const e = buildToolEvidence(TOOL_REPLY, { nonce: "CHANAN-4d7b2e91", text: "ack" }, 1700000000000);
  assert.equal(e.kind, "tool_call");
  assert.equal(e.tool, "reply");
  assert.equal(e.nonce, "CHANAN-4d7b2e91");
  assert.equal(e.args.text, "ack", "the full args are preserved");
});

test("tool evidence reports a MISSING nonce as null, not as a fabricated identifier", () => {
  const e = buildToolEvidence(TOOL_INGEST, { note: "no nonce here" });
  assert.equal(e.nonce, null, "null is distinguishable from a real nonce string");
});

test("instructions name both tools so the session knows what to call back with", () => {
  const ins = buildInstructions("quay-channel-probe");
  assert.match(ins, /<channel source="quay-channel-probe"/);
  assert.match(ins, new RegExp(TOOL_REPLY));
  assert.match(ins, new RegExp(TOOL_INGEST));
  assert.match(ins, /nonce/);
});

test("appendEvidence writes one JSON line per entry and never throws on a bad dir", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chan-probe-"));
  const p = path.join(dir, "nested", "evidence.jsonl");
  appendEvidence(p, { kind: "a" });
  appendEvidence(p, { kind: "b" });
  const lines = fs.readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines, [{ kind: "a" }, { kind: "b" }]);
  // best-effort: an unwritable path must not throw into the server's call path.
  // ⚠️ Use ENOTDIR (a path *through a regular file*), NOT a /proc path: `mkdirSync(recursive)` under
  // /proc HANGS on this host (measured — it wedged this very test for >12s until the runner was
  // killed). A regular file in the middle fails fast and deterministically everywhere.
  const blocker = path.join(dir, "regular-file");
  fs.writeFileSync(blocker, "not a directory");
  appendEvidence(path.join(blocker, "sub", "evidence.jsonl"), { kind: "c" });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the channel probe never spawns claude and never imports an LLM client", () => {
  const src = fs.readFileSync(new URL("../scripts/channel-probe-server.ts", import.meta.url), "utf8");
  assert.equal(/child_process|spawnSync|execSync/.test(src), false, "no subprocess spawning at all");
  assert.equal(/anthropic|openai/i.test(src), false, "no LLM client");
});

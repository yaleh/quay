// @test-group governance
// supervisor-bus-identity.test.mjs — the supervisor IDENTITY interface
// (tasks/gap-supervisor-message-bus-with-identity, supervisor step ⑤; AC6: node:test +
// @test-group governance).
//
// Exercises plugin/scripts/supervisor-bus-identity.sh:
//   Contract measure — `message_identity_reject = bash <带身份投递> claim-human-test stdout 的字段`:
//     the claim-human-test subcommand prints `identity_rejected=true` (band = reject) — an agent
//     message claiming from:"human" is REJECTED by the agent channel, proven mechanically.
//   AC4 tick mount point — the inbox-summary subcommand reads the manager inbox and reports
//     delivered/consumed/unread (AC3: delivered ≠ read, separate fields) plus one `unread:` line
//     per not-yet-consumed record — read-only, never writes a receipt.
//
// Run: scripts/test.sh plugin/test/supervisor-bus-identity.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "..", "scripts", "supervisor-bus-identity.sh");

/** Per-test hermetic temp root with a manager-inbox dir (cleaned up by the test's after hook). */
function tmpInbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quay-supervisor-bus-identity-"));
  const inbox = path.join(root, ".quay", "manager-inbox");
  fs.mkdirSync(inbox, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, inbox };
}

/** Write one delivered-but-unconsumed message record into the inbox. */
function writeDelivered(inbox, { id, seq, from, text }) {
  const record = {
    id,
    seq,
    target: "human",
    from,
    payload: { text },
    delivered: true,
    deliveredAt: "2026-08-06T00:00:00.000Z",
    consumed: false,
    consumedAt: null,
  };
  fs.writeFileSync(path.join(inbox, `${id}.json`), JSON.stringify(record, null, 2) + "\n", "utf8");
  return record;
}

// ── Contract measure — claim-human-test ─────────────────────────────────────────────────────────────

test("Contract — claim-human-test rejects an agent message claiming from:human (identity_rejected=true)", () => {
  const out = execFileSync("bash", [SCRIPT, "claim-human-test"], { encoding: "utf8" });
  const line = out.split("\n").find((l) => l.startsWith("identity_rejected="));
  assert.ok(line, `the measure field is on stdout: ${out}`);
  assert.match(line, /^identity_rejected=true/, `band = reject (agent cannot forge human): ${out}`);
});

test("Contract — the reject reason names the spoof (identity rejected … human … claimable)", () => {
  const out = execFileSync("bash", [SCRIPT, "claim-human-test"], { encoding: "utf8" });
  assert.match(out, /identity rejected/);
  assert.match(out, /human/);
  assert.match(out, /claimable/);
});

// ── AC4 tick mount point — inbox-summary ────────────────────────────────────────────────────────────

test("AC4 — inbox-summary reports delivered/consumed/unread with one unread line per message", (t) => {
  const { inbox } = tmpInbox(t);
  writeDelivered(inbox, { id: "msg-a", seq: 1, from: "manager", text: "please read" });
  writeDelivered(inbox, { id: "msg-b", seq: 2, from: "human", text: "replied here" });

  const out = execFileSync("bash", [SCRIPT, "inbox-summary", "--inbox", inbox], { encoding: "utf8" });
  const summary = out.split("\n").find((l) => l.startsWith("delivered="));
  assert.match(summary, /^delivered=2 consumed=0 unread=2$/);
  const unreadLines = out.split("\n").filter((l) => l.startsWith("unread: "));
  assert.equal(unreadLines.length, 2, "one unread line per not-yet-consumed message");
  assert.match(unreadLines[0], /seq=1 from=manager please read/);
  assert.match(unreadLines[1], /seq=2 from=human replied here/);
});

test("AC4 — inbox-summary is READ-ONLY: records stay unconsumed (consumption is the reader's act)", (t) => {
  const { inbox } = tmpInbox(t);
  writeDelivered(inbox, { id: "msg-a", seq: 1, from: "manager", text: "read only" });

  execFileSync("bash", [SCRIPT, "inbox-summary", "--inbox", inbox], { encoding: "utf8" });
  const rec = JSON.parse(fs.readFileSync(path.join(inbox, "msg-a.json"), "utf8"));
  assert.equal(rec.consumed, false, "inbox-summary does NOT write a receipt");
  assert.equal(rec.consumedAt, null);
});

test("AC4 — an absent inbox reports all-zero (the mount point never dies)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quay-supervisor-bus-identity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const inbox = path.join(root, ".quay", "manager-inbox"); // does NOT exist
  const out = execFileSync("bash", [SCRIPT, "inbox-summary", "--inbox", inbox], { encoding: "utf8" }).trim();
  assert.match(out, /^delivered=0 consumed=0 unread=0$/);
});

// ── non-JSON delivered files (gap-inbox-counter-disconnected-from-files) ─────────────────────────────
// The archguard reports are delivered as .md, NOT .json. The old counter filtered .endsWith(".json")
// AND `continue`-ed on a JSON.parse failure — double exclusion ⇒ delivered=0 while the dir held 6
// files. delivered must count EVERY file; a non-JSON file is delivered-but-unread unless a
// "<f>.consumed" sidecar (the AC4 trace) marks it handled.

test("AC2 — a non-JSON (.md) report counts as delivered with a file= unread line", (t) => {
  const { inbox } = tmpInbox(t);
  fs.writeFileSync(path.join(inbox, "archguard-20260806-101500Z.md"), "# archguard report\n", "utf8");
  const out = execFileSync("bash", [SCRIPT, "inbox-summary", "--inbox", inbox], { encoding: "utf8" });
  const summary = out.split("\n").find((l) => l.startsWith("delivered="));
  assert.match(summary, /^delivered=1 consumed=0 unread=1$/, `md report must be counted: ${summary}`);
  const unreadLines = out.split("\n").filter((l) => l.startsWith("unread: "));
  assert.equal(unreadLines.length, 1);
  assert.match(unreadLines[0], /file=archguard-20260806-101500Z\.md/);
});

test("AC4 — a <f>.consumed sidecar marks a non-JSON report consumed (delivered≠consumed trace)", (t) => {
  const { inbox } = tmpInbox(t);
  fs.writeFileSync(path.join(inbox, "archguard-20260806-101500Z.md"), "# archguard report\n", "utf8");
  fs.writeFileSync(path.join(inbox, "archguard-20260806-101500Z.md.consumed"), "consumed\n", "utf8");
  const out = execFileSync("bash", [SCRIPT, "inbox-summary", "--inbox", inbox], { encoding: "utf8" });
  const summary = out.split("\n").find((l) => l.startsWith("delivered="));
  assert.match(summary, /^delivered=1 consumed=1 unread=0$/, `sidecar → consumed: ${summary}`);
});

test("AC2 — mixed json + .md inbox reports both, one unread line each with its own identifier", (t) => {
  const { inbox } = tmpInbox(t);
  writeDelivered(inbox, { id: "msg-a", seq: 1, from: "manager", text: "please read" });
  fs.writeFileSync(path.join(inbox, "archguard-20260806-101500Z.md"), "# archguard report\n", "utf8");
  const out = execFileSync("bash", [SCRIPT, "inbox-summary", "--inbox", inbox], { encoding: "utf8" });
  const summary = out.split("\n").find((l) => l.startsWith("delivered="));
  assert.match(summary, /^delivered=2 consumed=0 unread=2$/);
  const unreadLines = out.split("\n").filter((l) => l.startsWith("unread: "));
  assert.equal(unreadLines.length, 2);
  assert.ok(unreadLines.some((l) => l.startsWith("unread: seq=1 from=manager please read")));
  assert.ok(unreadLines.some((l) => l.startsWith("unread: file=archguard-20260806-101500Z.md")));
});

// ── usage / fail-loud ───────────────────────────────────────────────────────────────────────────────

test("usage — an unknown subcommand fails loud (exit 2)", () => {
  let code = 0;
  let err = "";
  try {
    execFileSync("bash", [SCRIPT, "no-such-subcommand"], { encoding: "utf8" });
  } catch (e) {
    code = e.status;
    err = String(e.stderr ?? e.stdout ?? "");
  }
  assert.equal(code, 2, "unknown subcommand → exit 2");
  assert.match(err, /supervisor-bus-identity/);
});

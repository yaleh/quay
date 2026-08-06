// @test-group engine
// inbox-reader.test.mjs — the consumer mechanical mount point for the human channel's inbox
// (tasks/gap-message-bus-human-third-target-transport-agnostic, AC4/AC5/AC6).
//
// Exercises plugin/scripts/inbox-reader.sh:
//   AC4  the reader CONSUMES delivered-but-unread messages (marks them read with a receipt
//        timestamp) — the mount point that stops the inbox degenerating to "files on disk,
//        nobody reads".
//   AC5  the Contract measure `delivered_vs_read = bash <inbox-reader.sh> 2>&1 |
//        grep -c 'read\|consumed'` is >= 1 once a message is consumed, and stays stable on
//        re-run (idempotent receipt, never double-writes).
//   AC6  the fail-safe protocol line is emitted but contains NEITHER "read" NOR "consumed",
//        so it can never inflate the measure.
//
// Run: scripts/test.sh plugin/test/inbox-reader.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const READER = path.join(__dirname, "..", "scripts", "inbox-reader.sh");

/** Per-test hermetic temp root with a manager-inbox dir (cleaned up by the test's after hook). */
function tmpInbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quay-inbox-reader-test-"));
  const inbox = path.join(root, ".quay", "manager-inbox");
  fs.mkdirSync(inbox, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, inbox };
}

/** Write one delivered-but-unconsumed message record into the inbox. */
function writeDelivered(inbox, { id, seq, from }) {
  const record = {
    id,
    seq,
    target: "human",
    from,
    payload: { text: `hello from ${from}` },
    delivered: true,
    deliveredAt: "2026-08-06T00:00:00.000Z",
    consumed: false,
    consumedAt: null,
  };
  fs.writeFileSync(path.join(inbox, `${id}.json`), JSON.stringify(record, null, 2) + "\n", "utf8");
  return record;
}

function runReader(inbox, extraArgs = []) {
  const out = execFileSync("bash", [READER, "--inbox", inbox, ...extraArgs], {
    encoding: "utf8",
  });
  return out;
}

// ── AC4 — the reader is the mechanical mount point that consumes delivered messages ─────────────────

test("AC4 — the reader consumes delivered-but-unread messages and emits a 'read' line per message", (t) => {
  const { inbox } = tmpInbox(t);
  writeDelivered(inbox, { id: "msg-a", seq: 1, from: "outer" });
  writeDelivered(inbox, { id: "msg-b", seq: 2, from: "inner" });

  const out = runReader(inbox);
  const readLines = out.split("\n").filter((l) => l.startsWith("read "));
  assert.equal(readLines.length, 2, "one read line per consumed message");
  assert.match(readLines[0], /msg-a/);
  assert.match(readLines[1], /msg-b/);

  // The records are now marked consumed with a receipt timestamp.
  for (const id of ["msg-a", "msg-b"]) {
    const rec = JSON.parse(fs.readFileSync(path.join(inbox, `${id}.json`), "utf8"));
    assert.equal(rec.consumed, true);
    assert.ok(rec.consumedAt, "receipt timestamp recorded");
  }
});

test("AC4 — the reader is idempotent: re-running never double-writes, receipts stay stable", (t) => {
  const { inbox } = tmpInbox(t);
  writeDelivered(inbox, { id: "msg-a", seq: 1, from: "outer" });

  const first = runReader(inbox);
  assert.equal(first.split("\n").filter((l) => l.startsWith("read ")).length, 1);

  const second = runReader(inbox);
  assert.equal(second.split("\n").filter((l) => l.startsWith("read ")).length, 0, "no NEW read lines on re-run");
  assert.equal(second.split("\n").filter((l) => l.startsWith("consumed ")).length, 1, "the already-consumed receipt is reported");

  // File unchanged by re-run (no double-write): consumedAt from the first run is preserved.
  const rec = JSON.parse(fs.readFileSync(path.join(inbox, "msg-a.json"), "utf8"));
  assert.equal(rec.consumed, true);
});

test("AC4 — an absent inbox is created (the mount point self-installs) and an empty inbox reads zero", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quay-inbox-reader-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const inbox = path.join(root, ".quay", "manager-inbox"); // does NOT exist yet

  const out = runReader(inbox);
  assert.ok(fs.existsSync(inbox), "the mount point directory is created");
  assert.equal(out.split("\n").filter((l) => l.startsWith("read ")).length, 0, "empty inbox → zero read lines");
});

// ── AC5 — the Contract measure delivered_vs_read (grep -c 'read\|consumed') ─────────────────────────

test("AC5 — the Contract measure is >= 1 once consumed and stable on re-run", (t) => {
  const { inbox } = tmpInbox(t);
  writeDelivered(inbox, { id: "msg-a", seq: 1, from: "outer" });
  writeDelivered(inbox, { id: "msg-b", seq: 2, from: "inner" });

  const measure = () =>
    execFileSync("bash", ["-c", `bash '${READER}' --inbox '${inbox}' 2>&1 | grep -c 'read\\|consumed'`], {
      encoding: "utf8",
    }).trim();

  assert.equal(measure(), "2", "band delivered_vs_read >= 1 after the reader consumes 2 messages");
  assert.equal(measure(), "2", "measure is STABLE on re-run (receipts cumulative, no double-write)");
});

test("AC5 — --dry-run reports what WOULD be consumed without writing (records stay unconsumed)", (t) => {
  const { inbox } = tmpInbox(t);
  writeDelivered(inbox, { id: "msg-a", seq: 1, from: "outer" });

  const out = runReader(inbox, ["--dry-run"]);
  assert.equal(out.split("\n").filter((l) => l.startsWith("read ")).length, 1, "dry-run reports the read");

  const rec = JSON.parse(fs.readFileSync(path.join(inbox, "msg-a.json"), "utf8"));
  assert.equal(rec.consumed, false, "dry-run does NOT write a receipt");
});

test("AC5 — --json emits a parseable structured record of what was read", (t) => {
  const { inbox } = tmpInbox(t);
  writeDelivered(inbox, { id: "msg-a", seq: 1, from: "outer" });

  const out = runReader(inbox, ["--json"]);
  const parsed = JSON.parse(out);
  assert.equal(parsed.read, 1);
  assert.equal(parsed.messages.length, 1);
  assert.match(parsed.messages[0], /read msg-a/);
});

// ── AC6 — fail-safe protocol line never inflates the measure ────────────────────────────────────────

test("AC6 — the protocol line is emitted but contains neither 'read' nor 'consumed'", (t) => {
  const { inbox } = tmpInbox(t);
  writeDelivered(inbox, { id: "msg-a", seq: 1, from: "outer" });

  const out = runReader(inbox);
  const protocol = out.split("\n").find((l) => l.startsWith("measurement-protocol:"));
  assert.ok(protocol, "protocol line is emitted");
  assert.match(protocol, /exclusively through this inbox channel/);
  assert.doesNotMatch(protocol, /\bread\b|\bconsumed\b/, "protocol line must not contain read/consumed (measure integrity)");

  // Negative control: with ZERO messages the measure is 0 even though the protocol line exists —
  // the protocol line cannot manufacture a band pass.
  const { inbox: emptyInbox } = tmpInbox(t);
  const outEmpty = runReader(emptyInbox);
  const measureEmpty = outEmpty.split("\n").filter((l) => /\bread\b|\bconsumed\b/.test(l)).length;
  assert.equal(measureEmpty, 0, "empty inbox → measure 0; protocol line contributes nothing");
});

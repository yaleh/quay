// @test-group engine
// message-bus.test.mjs — transport-agnostic deliver()/observe() with human as the THIRD target
// (tasks/gap-message-bus-human-third-target-transport-agnostic).
//
// Exercises packages/quay/src/message-bus.ts:
//   AC1  deliver/observe are transport-agnostic — dispatch through a registered Transport;
//        swapping the transport for a target = registering a different one, never a bus rewrite.
//   AC2  human is the THIRD target of the SAME mechanism (TARGETS = inner/outer/human), not a
//        second system.
//   AC3  delivered ≠ consciousness-received — modeled separately (delivered vs consumed).
//   AC4  the consumer mechanical mount point is .quay/manager-inbox/ (delivered records land
//        there, and a reader can consume them) — delivery is not delivery without it.
//   AC5  AC12b measurability — every human message is a timestamped, seq-numbered, countable
//        record.
//   AC6  fail-safe — the measurement protocol reports measurement.valid=false while delivered >
//        consumed (the channel cannot confirm human reading; out-of-channel comm distorts the
//        unattended-interval estimate).
//
// Run: scripts/test.sh packages/quay/test/message-bus.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  TARGETS,
  managerInboxDir,
  outerInboxDir,
  readInboxRecords,
  computeInboxObservation,
  createFileInboxTransport,
  createSessionTransport,
  createTransportRegistry,
  deliver,
  observe,
  registerTransport,
  resetTransports,
  installDefaultTransports,
} from "../src/message-bus.ts";

/** Per-test hermetic temp root (cleaned up by the test's after hook). */
function tmpRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-message-bus-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INBOX_READER = path.join(__dirname, "..", "..", "..", "plugin", "scripts", "inbox-reader.sh");

// ── AC1 — transport-agnostic deliver/observe ────────────────────────────────────────────────────────

test("AC1 — deliver/observe dispatch through the registered transport; swapping transport = no bus rewrite", () => {
  const bus = createTransportRegistry();
  const seen = [];
  bus.register("human", {
    name: "mock-a",
    deliver(m) {
      seen.push(m);
      return { delivered: true, target: m.target, receiptId: "mock-a-1" };
    },
    observe() {
      return { busy: false, idle: true };
    },
  });
  const r = bus.deliver("human", { from: "outer", payload: { text: "hi" } });
  assert.equal(r.delivered, true);
  assert.equal(r.receiptId, "mock-a-1");
  assert.deepEqual(seen[0], { target: "human", from: "outer", payload: { text: "hi" } });
  assert.deepEqual(bus.observe("human"), { target: "human", busy: false, idle: true });

  // Swapping the transport for the SAME target: the bus entry points are unchanged; only the
  // registered transport differs (AC1 — SaaS later is a transport swap, not a rewrite).
  bus.register("human", {
    name: "mock-b",
    deliver: (m) => ({ delivered: true, target: m.target, transport: "mock-b" }),
    observe: () => ({ idle: false }),
  });
  assert.equal(bus.deliver("human", { from: "inner" }).transport, "mock-b");
  assert.deepEqual(bus.observe("human"), { target: "human", idle: false });
});

test("AC1 — register rejects an unknown target (the target set is closed to inner/outer/human)", () => {
  const bus = createTransportRegistry();
  assert.throws(() => bus.register("elf", { deliver() {}, observe() {} }), /unknown target/);
});

test("AC1 — deliver/observe on an unregistered target fail closed, never throw", () => {
  const bus = createTransportRegistry();
  const r = bus.deliver("human", { from: "outer" });
  assert.equal(r.delivered, false);
  assert.match(r.reason, /no transport registered/);
  const o = bus.observe("human");
  assert.equal(o.busy, null);
});

// ── AC2 — human is the THIRD target, same mechanism ─────────────────────────────────────────────────

test("AC2 — TARGETS = inner/outer/human; human routes through the SAME deliver()/observe() as inner", (t) => {
  assert.deepEqual([...TARGETS], ["inner", "outer", "human"]);

  const bus = createTransportRegistry();
  // Inter-layer target: a session transport with an injected adapter (the supervisor wires the
  // real send-keys/classifyPaneState adapters at step ③).
  const innerSeen = [];
  bus.register("inner", createSessionTransport({
    deliverFn: (m) => {
      innerSeen.push(m);
      return { delivered: true, target: m.target, transport: "session" };
    },
    observeFn: () => ({ busy: true, idle: false }),
  }));
  // Human target: the real file-inbox transport.
  const root = tmpRoot(t);
  bus.register("human", createFileInboxTransport({ inboxDir: managerInboxDir(root) }));

  const ri = bus.deliver("inner", { from: "outer", payload: { text: "drive" } });
  const rh = bus.deliver("human", { from: "outer", payload: { text: "please read" } });

  // SAME entry points, SAME returned shape; only the transport differs.
  assert.equal(ri.delivered, true);
  assert.equal(rh.delivered, true);
  assert.equal(ri.target, "inner");
  assert.equal(rh.target, "human");
  assert.equal(innerSeen[0].target, "inner");
  assert.deepEqual(bus.observe("inner"), { target: "inner", busy: true, idle: false });
  assert.equal(bus.observe("human").target, "human");
});

// ── AC3 — delivered ≠ consciousness-received, modeled separately ───────────────────────────────────

test("AC3 — a delivered human message is NOT yet consumed (delivered=true, consumed=false)", (t) => {
  const root = tmpRoot(t);
  const tx = createFileInboxTransport({ inboxDir: managerInboxDir(root) });
  const r = tx.deliver({ from: "outer", payload: { text: "hello human" } });
  assert.equal(r.delivered, true);

  const [rec] = readInboxRecords(managerInboxDir(root));
  assert.equal(rec.consumed, false);
  assert.equal(rec.delivered, true);
  const obs = tx.observe();
  assert.equal(obs.delivered, 1);
  assert.equal(obs.consumed, 0);
  assert.equal(obs.unread, 1);
});

test("AC3 — a consumed message is delivered AND read (receipt recorded), never re-read", (t) => {
  const root = tmpRoot(t);
  const inbox = managerInboxDir(root);
  const tx = createFileInboxTransport({ inboxDir: inbox });
  const { receiptId } = tx.deliver({ from: "inner", payload: { text: "receipt test" } });

  // The mount point (inbox-reader.sh) marks it consumed; here we simulate its write directly.
  const recPath = path.join(inbox, `${receiptId}.json`);
  const rec = JSON.parse(fs.readFileSync(recPath, "utf8"));
  rec.consumed = true;
  rec.consumedAt = "2026-08-06T00:00:01.000Z";
  fs.writeFileSync(recPath, JSON.stringify(rec, null, 2) + "\n", "utf8");

  const obs = tx.observe();
  assert.equal(obs.delivered, 1);
  assert.equal(obs.consumed, 1);
  assert.equal(obs.unread, 0);
  assert.equal(obs.last_consumed_at, "2026-08-06T00:00:01.000Z");
});

// ── AC4 — consumer mechanical mount point (.quay/manager-inbox/) ────────────────────────────────────

test("AC4 — managerInboxDir resolves under .quay/manager-inbox/ and deliver lands records there", (t) => {
  const root = tmpRoot(t);
  assert.equal(managerInboxDir(root), path.join(root, ".quay", "manager-inbox"));

  const tx = createFileInboxTransport({ inboxDir: managerInboxDir(root) });
  tx.deliver({ from: "outer", payload: { text: "mount point test" } });
  assert.equal(fs.existsSync(path.join(root, ".quay", "manager-inbox")), true);
  const files = fs.readdirSync(managerInboxDir(root)).filter((f) => f.endsWith(".json"));
  assert.equal(files.length, 1, "a delivered message lands as a JSON record in the inbox");
});

test("AC4 — a write failure is a FAILED delivery (deliver -> delivered|failed), never a throw", (t) => {
  const root = tmpRoot(t);
  const inbox = managerInboxDir(root);
  const tx = createFileInboxTransport({ inboxDir: inbox });
  fs.chmodSync(inbox, 0o555); // read-only — writes now fail (non-root); tmpRoot cleanup handles read-only dirs
  const r = tx.deliver({ from: "outer", payload: { text: "will fail" } });
  assert.equal(r.delivered, false);
  assert.match(r.reason, /write failed/);
});

test("AC4 — installDefaultTransports wires human → the real file-inbox mount point", (t) => {
  const root = tmpRoot(t);
  resetTransports();
  t.after(() => resetTransports());
  installDefaultTransports(root);

  const r = deliver("human", { from: "inner", payload: { text: "default wiring" } });
  assert.equal(r.delivered, true);
  assert.equal(fs.existsSync(path.join(root, ".quay", "manager-inbox", `${r.receiptId}.json`)), true);
  const o = observe("human");
  assert.equal(o.target, "human");
  assert.equal(o.delivered, 1);

  // inner STILL defaults to the session transport (adapters wired later by the supervisor) —
  // the change here is ONLY outer → file-inbox (manager→outer async, no session wait).
  const ri = deliver("inner", { from: "human", payload: { text: "drive" } });
  assert.equal(ri.delivered, false);
  assert.match(ri.reason, /session transport not configured/);

  // outer → file-inbox: manager→outer async delivery lands in .quay/outer-inbox/ (no session wait).
  const ro = deliver("outer", { from: "manager", payload: { text: "async to outer" } });
  assert.equal(ro.delivered, true);
  assert.equal(fs.existsSync(path.join(root, ".quay", "outer-inbox", `${ro.receiptId}.json`)), true);
});

// ── outer file-inbox (tasks/gap-outer-message-bus-needs-file-inbox-transport) ─────────────────────────

test("AC1/AC2 — outer file-inbox: manager→outer delivers with `from` preserved in a SEPARATE inbox", (t) => {
  const root = tmpRoot(t);
  resetTransports();
  t.after(() => resetTransports());
  installDefaultTransports(root);

  // manager → outer: an async delivery that must NOT wait on outer's session state (file inbox).
  const r = deliver("outer", { payload: { text: "async task note" } }, "manager");
  assert.equal(r.delivered, true);
  assert.equal(r.target, "outer");
  assert.equal(outerInboxDir(root), path.join(root, ".quay", "outer-inbox"));
  assert.equal(fs.existsSync(path.join(root, ".quay", "outer-inbox", `${r.receiptId}.json`)), true);

  // The record carries the sender identity (`from` is stamped by the bus on delivery, not
  // self-claimed via a bare-tmux send-keys that drops the field).
  const [rec] = readInboxRecords(outerInboxDir(root));
  assert.equal(rec.target, "outer");
  assert.equal(rec.from, "manager");
  assert.equal(rec.delivered, true);
  assert.equal(rec.consumed, false);

  // The outer channel is SEPARATE from the human channel: a manager→outer message must NOT
  // inflate the human channel's observation (observe("human") counts only manager-inbox records).
  const humanObs = observe("human");
  assert.equal(humanObs.delivered, 0, "outer messages never pollute the human channel's measurement");

  // observe("outer") reports the outer inbox's OWN delivered/consumed/unread.
  const outerObs = observe("outer");
  assert.equal(outerObs.target, "outer");
  assert.equal(outerObs.delivered, 1);
  assert.equal(outerObs.consumed, 0);
  assert.equal(outerObs.unread, 1);
});

// ── AC5 — AC12b measurability: timestamped, countable records ──────────────────────────────────────

test("AC5 — every human message is a timestamped, seq-numbered, countable record", (t) => {
  const root = tmpRoot(t);
  const tx = createFileInboxTransport({ inboxDir: managerInboxDir(root) });
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const r = tx.deliver({ from: "outer", payload: { text: `msg ${i}` } });
    ids.push(r.receiptId);
    assert.ok(Number.isInteger(r.seq), `seq is an integer: ${r.seq}`);
    assert.ok(!Number.isNaN(Date.parse(r.deliveredAt)), `deliveredAt is a parseable ISO timestamp: ${r.deliveredAt}`);
  }
  const records = readInboxRecords(managerInboxDir(root));
  assert.equal(records.length, 3, "countable: exactly 3 records");
  assert.deepEqual(records.map((r) => r.seq), [1, 2, 3], "seq is monotonic per inbox");
  assert.equal(records[0].id, ids[0]);
  assert.ok(records.every((r) => r.deliveredAt && r.deliveredAt.length > 0), "every record carries a timestamp");
  const obs = tx.observe();
  assert.equal(obs.delivered, 3);
  assert.equal(obs.consumed, 0);
  assert.equal(obs.unread, 3);
});

// ── AC6 — fail-safe: measurement protocol constrains "humans only use the channel" ─────────────────

test("AC2/AC3 — the deliver()/observe() target arg is authoritative over any target in the payload", (t) => {
  const root = tmpRoot(t);
  const bus = createTransportRegistry();
  bus.register("human", createFileInboxTransport({ inboxDir: managerInboxDir(root) }));
  // A misleading `target` in the message must NOT relabel the record to another channel.
  const r = bus.deliver("human", { target: "inner", from: "outer", payload: { text: "authority" } });
  assert.equal(r.delivered, true);
  assert.equal(r.target, "human");
  const [rec] = readInboxRecords(managerInboxDir(root));
  assert.equal(rec.target, "human", "the record is labeled with the channel it was delivered on");

  // observe: the arg wins over any target the transport echoes.
  const o = bus.observe("human");
  assert.equal(o.target, "human");
});

test("AC5 — rapid successive delivers produce UNIQUE ids and files (no silent overwrite)", (t) => {
  const root = tmpRoot(t);
  const tx = createFileInboxTransport({ inboxDir: managerInboxDir(root) });
  const ids = new Set();
  for (let i = 0; i < 20; i++) {
    ids.add(tx.deliver({ from: "outer", payload: { text: `burst ${i}` } }).receiptId);
  }
  assert.equal(ids.size, 20, "all 20 ids are unique (same-ms deliveries cannot collide)");
  const files = fs.readdirSync(managerInboxDir(root)).filter((f) => f.endsWith(".json"));
  assert.equal(files.length, 20, "20 files on disk — no delivery overwrote another");
});

test("AC4 — END-TO-END: deliver via the bus → consume via the inbox-reader script (the real mount point)", (t) => {
  const root = tmpRoot(t);
  const tx = createFileInboxTransport({ inboxDir: managerInboxDir(root) });
  tx.deliver({ from: "outer", payload: { text: "e2e 1" } });
  tx.deliver({ from: "inner", payload: { text: "e2e 2" } });
  tx.deliver({ from: "manager", payload: { text: "e2e 3" } });

  const out = execFileSync("bash", [INBOX_READER, "--inbox", managerInboxDir(root)], { encoding: "utf8" });
  const readLines = out.split("\n").filter((l) => l.startsWith("read "));
  assert.equal(readLines.length, 3, "the mount point reads all 3 delivered messages");

  const obs = tx.observe();
  assert.equal(obs.delivered, 3);
  assert.equal(obs.consumed, 3);
  assert.equal(obs.unread, 0);
  assert.equal(obs.measurement.valid, true, "all consumed → measurement protocol valid");
});

test("AC6 — measurement.valid is false while delivered > consumed (channel cannot confirm reading)", (t) => {
  const root = tmpRoot(t);
  const tx = createFileInboxTransport({ inboxDir: managerInboxDir(root) });
  tx.deliver({ from: "outer", payload: { text: "unread" } });

  const obs = tx.observe();
  assert.equal(obs.measurement.valid, false);
  assert.match(obs.measurement.reason, /not yet consumed/);

  // Consume everything → the protocol is valid again (but still contingent on the human using
  // ONLY this channel — the reason states the constraint).
  const [recPath] = fs.readdirSync(managerInboxDir(root)).map((f) => path.join(managerInboxDir(root), f));
  const rec = JSON.parse(fs.readFileSync(recPath, "utf8"));
  rec.consumed = true;
  rec.consumedAt = new Date().toISOString();
  fs.writeFileSync(recPath, JSON.stringify(rec, null, 2) + "\n", "utf8");

  const obs2 = tx.observe();
  assert.equal(obs2.measurement.valid, true);
  assert.match(obs2.measurement.reason, /exclusively this channel/);
});

test("AC6 — computeInboxObservation is a pure function over records (empty → idle false, valid true)", () => {
  const empty = computeInboxObservation([]);
  assert.equal(empty.delivered, 0);
  assert.equal(empty.consumed, 0);
  assert.equal(empty.unread, 0);
  assert.equal(empty.measurement.valid, true); // nothing unread ⇒ nothing to distort
  assert.equal(empty.idle, false);
});

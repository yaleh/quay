// @test-group governance
// message-bus-identity.test.mjs — the message bus carries WHO sent each message
// (tasks/gap-supervisor-message-bus-with-identity, supervisor step ⑤; AC6: node:test +
// @test-group governance).
//
// Exercises the identity formalization in packages/quay/src/message-bus.ts:
//   AC1  deliver(target, payload, from=<identity>) exists — the THIRD arg is the sender identity,
//        authoritative over any `from` smuggled inside the payload.
//   AC2  the receiving side can distinguish "human" from "agent-X" — an agent-channel message
//        claiming `from: "human"` is REJECTED before injection (fail-closed, never relayed).
//        Legitimate agent identities (inner/outer/manager) pass; an unknown identity is rejected.
//   AC3  deliver(human) separates "delivered" from "read" — the record carries delivered=true and
//        consumed=false; observe() reports both independently (a receipt, never an absence-inference).
//   AC4  the consumer's mechanical mount point is grep-visible in the tick docs (the loop step that
//        explicitly reads the inbox — "files on disk, nobody reads" cannot happen again).
//
// Run: scripts/test.sh packages/quay/test/message-bus-identity.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  IDENTITIES,
  AGENT_IDENTITIES,
  HUMAN_IDENTITY,
  isKnownIdentity,
  checkIdentityClaim,
  managerInboxDir,
  readInboxRecords,
  createFileInboxTransport,
  createSessionTransport,
  createTransportRegistry,
  deliver,
  registerTransport,
  resetTransports,
  installDefaultTransports,
} from "../src/message-bus.ts";

/** Per-test hermetic temp root (cleaned up by the test's after hook). */
function tmpRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-message-bus-identity-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");

// ── AC1 — deliver(target, payload, from=<identity>) ─────────────────────────────────────────────────

test("AC1 — the explicit `from` third arg carries the sender identity (authoritative over payload.from)", () => {
  const bus = createTransportRegistry();
  const seen = [];
  bus.register("inner", createSessionTransport({
    deliverFn: (m) => {
      seen.push(m);
      return { delivered: true, target: m.target };
    },
  }));

  // 3-arg form: deliver(target, payload, from)
  const r = bus.deliver("inner", { payload: { text: "drive" } }, "outer");
  assert.equal(r.delivered, true);
  assert.equal(seen[0].from, "outer", "the explicit third arg IS the sender identity");

  // A caller-smuggled `from` inside the payload is OVERRIDDEN by the explicit arg (authoritative).
  const r2 = bus.deliver("inner", { from: "inner", payload: { text: "who am i" } }, "manager");
  assert.equal(r2.delivered, true);
  assert.equal(seen[1].from, "manager", "the explicit arg wins over payload.from");
});

test("AC1 — the default `deliver` export also accepts the 3-arg from form", (t) => {
  const root = tmpRoot(t);
  resetTransports();
  t.after(() => resetTransports());
  installDefaultTransports(root);
  registerTransport("inner", createSessionTransport({
    deliverFn: (m) => {
      assert.equal(m.from, "manager", "the default deliver export threads the explicit from through");
      return { delivered: true };
    },
  }));
  const r = deliver("inner", { payload: { text: "hi" } }, "manager");
  assert.equal(r.delivered, true);
});

// ── AC2 — receiver distinguishes "human" from "agent-X"; the human-claiming agent is REJECTED ──────

test("AC2 — an agent message claiming from:human is REJECTED before injection (never relayed)", () => {
  const bus = createTransportRegistry();
  let injected = null;
  bus.register("inner", createSessionTransport({
    deliverFn: (m) => {
      injected = m;
      return { delivered: true };
    },
  }));

  const r = bus.deliver("inner", { payload: { text: "i am the human" } }, "human");
  assert.equal(r.delivered, false, "the spoof must be a FAILED delivery");
  assert.equal(r.rejectedIdentity, "human", "the rejected identity is named");
  assert.match(r.reason, /identity rejected/);
  assert.match(r.reason, /human/);
  assert.equal(injected, null, "the spoofed message NEVER reaches the deliverFn (fail-closed)");
});

test("AC2 — the identity gate is a pure, mechanically-testable predicate (checkIdentityClaim)", () => {
  const ok = checkIdentityClaim({ from: "outer", servedIdentities: AGENT_IDENTITIES });
  assert.equal(ok.ok, true);
  assert.equal(ok.identity, "outer");

  const humanClaim = checkIdentityClaim({ from: "human", servedIdentities: AGENT_IDENTITIES });
  assert.equal(humanClaim.ok, false);
  assert.equal(humanClaim.rejectedIdentity, "human");

  const unknownClaim = checkIdentityClaim({ from: "archguard", servedIdentities: AGENT_IDENTITIES });
  assert.equal(unknownClaim.ok, false);
  assert.equal(unknownClaim.rejectedIdentity, "archguard");
});

test("AC2 — legitimate agent identities (inner/outer/manager) pass the agent channel", () => {
  const bus = createTransportRegistry();
  const seen = [];
  bus.register("outer", createSessionTransport({
    deliverFn: (m) => {
      seen.push(m);
      return { delivered: true };
    },
  }));
  for (const who of AGENT_IDENTITIES) {
    const r = bus.deliver("outer", { payload: { text: "legit" } }, who);
    assert.equal(r.delivered, true, `agent identity ${who} is claimable on the agent channel`);
  }
  assert.equal(seen.length, AGENT_IDENTITIES.length);
});

test("AC2 — 'human' is excluded from AGENT_IDENTITIES (the spoof surface is closed by construction)", () => {
  assert.ok(AGENT_IDENTITIES.includes("inner"));
  assert.ok(AGENT_IDENTITIES.includes("outer"));
  assert.ok(AGENT_IDENTITIES.includes("manager"));
  assert.equal(AGENT_IDENTITIES.includes("human"), false, "an agent channel can never serve 'human'");
  assert.equal(HUMAN_IDENTITY, "human");
  assert.ok(IDENTITIES.includes("human"), "IDENTITIES names the full set (human is an identity like any agent)");
  assert.ok(isKnownIdentity("manager"));
  assert.equal(isKnownIdentity("archguard"), false);
});

// ── AC3 — deliver(human): delivered ≠ read, modeled separately (a receipt, never absence) ──────────

test("AC3 — deliver(human) returns delivery success with a timestamp; the record is NOT yet read", (t) => {
  const root = tmpRoot(t);
  const tx = createFileInboxTransport({ inboxDir: managerInboxDir(root) });
  const r = tx.deliver({ from: "manager", payload: { text: "please read me" } });

  assert.equal(r.delivered, true, "deliver(human) semantics = placed, NOT consciousness-received");
  assert.ok(r.deliveredAt, "the delivery success carries its own timestamp");
  assert.equal(r.consumed, undefined, "delivery success is NOT a read receipt");

  const [rec] = readInboxRecords(managerInboxDir(root));
  assert.equal(rec.delivered, true);
  assert.equal(rec.consumed, false, "the two facts are separate FIELDS on the same record");
  assert.equal(rec.consumedAt, null);

  const obs = tx.observe();
  assert.equal(obs.delivered, 1);
  assert.equal(obs.consumed, 0);
  assert.equal(obs.unread, 1, "delivered-but-unread is its own state");
});

test("AC3 — observe(human) reports delivered and consumed independently (no absence-inference)", (t) => {
  const root = tmpRoot(t);
  const inbox = managerInboxDir(root);
  const tx = createFileInboxTransport({ inboxDir: inbox });
  const { receiptId } = tx.deliver({ from: "outer", payload: { text: "receipt" } });

  // Mark the single record consumed (as inbox-reader.sh does on the human's read) — directly here.
  const recPath = path.join(inbox, `${receiptId}.json`);
  const rec = JSON.parse(fs.readFileSync(recPath, "utf8"));
  rec.consumed = true;
  rec.consumedAt = "2026-08-06T01:00:00.000Z";
  fs.writeFileSync(recPath, JSON.stringify(rec, null, 2) + "\n", "utf8");

  const obs = tx.observe();
  assert.equal(obs.delivered, 1);
  assert.equal(obs.consumed, 1, "read is a positive receipt (a reader consumed it), not inferred from silence");
  assert.equal(obs.unread, 0);
  assert.equal(obs.last_consumed_at, "2026-08-06T01:00:00.000Z");
});

// ── AC4 — the consumer's mechanical mount point is in the tick docs (grep-visible) ─────────────────

test("AC4 — the tick docs carry an explicit inbox-read step (the consumer mount point, grep-visible)", () => {
  // The DoD clause "收件箱有消费者挂载点（grep 可查 tick 流程读收件箱的步骤）" is pinned here: the
  // SHIPPED tick docs (plugin/loop/*.md — what quay-init lays down) must name the inbox read at a
  // defined tick step, so "files on disk, nobody reads" cannot regress silently.
  const tickDocs = [
    path.join(repoRoot, "plugin", "loop", "fast-mode-loop-tick.md"),
    path.join(repoRoot, "plugin", "loop", "orchestrator-loop-tick.md"),
  ];
  for (const doc of tickDocs) {
    assert.ok(fs.existsSync(doc), `tick doc exists: ${doc}`);
    const text = fs.readFileSync(doc, "utf8");
    assert.match(text, /manager-inbox|inbox|inbox-summary|inbox-reader/,
      `${path.basename(doc)} names the inbox at a tick step`);
    assert.match(text, /收件箱|inbox|manager-inbox/,
      `${path.basename(doc)} makes the inbox read explicit at a tick step`);
  }
});

// ── Contract measure — message_identity_reject via the supervisor-bus-identity.sh subcommand ──────

test("Contract — the claim-human-test subcommand prints identity_rejected=true (band = reject)", () => {
  const script = path.join(repoRoot, "plugin", "scripts", "supervisor-bus-identity.sh");
  const out = execFileSync("bash", [script, "claim-human-test"], { encoding: "utf8" }).trim();
  const line = out.split("\n").find((l) => l.startsWith("identity_rejected="));
  assert.ok(line, `a claim-human-test stdout field exists (Contract measure): ${out}`);
  assert.match(line, /^identity_rejected=true/, `the agent-claims-human spoof is REJECTED: ${out}`);
});

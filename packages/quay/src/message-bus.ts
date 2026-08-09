// message-bus.ts — the transport-agnostic message bus
// (tasks/gap-message-bus-human-third-target-transport-agnostic).
//
// DESIGN (single source: docs/proposals/quay-message-bus-human-in-the-network.md):
//   * deliver(target, msg) / observe(target) are the SAME two narrow interfaces across every
//     target — inter-layer (inner/outer) comms AND the human channel share ONE mechanism,
//     never two systems (AC2). The only thing that differs per target is the registered
//     Transport.
//   * Transport-agnostic (AC1): the bus dispatches through a Transport interface. Swapping a
//     transport (file inbox today → HTTP/WebSocket push for SaaS tomorrow) = registering a
//     different Transport, never a rewrite of the bus.
//   * Human is the THIRD target (AC2). Humans cannot be injected — they only come to read —
//     so `deliver(human, msg)` means "placed in the inbox", NOT "reached consciousness"
//     (AC3). The two are modeled separately: `delivered` (record written, timestamped) vs
//     `consumed` (a reader took a receipt). `observe(human)` reports both independently.
//   * CONSUMER MOUNT POINT FIRST (AC4): `.quay/manager-inbox/` previously failed as "3
//     messages on disk, nobody reads". The first-class consumer is plugin/scripts/
//     inbox-reader.sh — the mechanical reader that turns `delivered` records into `consumed`
//     receipts. Delivery without a mount point is not delivery.
//   * MEASURABILITY (AC12b/AC5): every human message is a timestamped, seq-numbered,
//     countable JSON record in the inbox.
//   * FAIL-SAFE (AC6): the measurement protocol must constrain "humans only use the
//     channel". `observe(human).measurement.valid` is false while delivered > consumed —
//     the channel cannot confirm reading, so the unattended-interval estimate is distorted
//     by any out-of-channel human communication.

import fs from "node:fs";
import path from "node:path";

// Process-global id-uniqueness counter: two deliver() calls in the SAME millisecond reading the
// same disk seq would otherwise produce identical ids, and the second write would silently
// overwrite the first (a delivered-but-lost message — the exact failure class this bus exists to
// eliminate). A per-process counter guarantees id uniqueness regardless of disk-read timing.
let _idCounter = 0;

// ── Targets ──────────────────────────────────────────────────────────────────────────────────────────

/** The three deliver()/observe() targets. Human is the THIRD target, same mechanism. */
export const TARGETS = Object.freeze(["inner", "outer", "human"]);

// ── Identity ─────────────────────────────────────────────────────────────────────────────────────────
// (tasks/gap-supervisor-message-bus-with-identity — supervisor step ⑤, sender identity.)
//
// A delivered message carries WHO sent it: `from` ∈ {human, manager, inner, outer}. The human
// channel (file-inbox) is bidirectional — the human's replies and the agents' notes share the same
// inbox. Agent channels (session transport — the inner/outer target) serve AGENT identities ONLY:
// "human" is not claimable there. That is the AC2 spoof gate: the incident that started this family
// (agent messages entering a session with userType:external, indistinguishable from the real user)
// is killed mechanically — an agent message that claims `from: "human"` is REJECTED before injection.

/** Every known sender identity. The human is an identity like any agent — the bus never special-cases
 *  "a message that talks like a human" because identity is a carried field, not a text property. */
export const IDENTITIES = Object.freeze(["human", "manager", "inner", "outer"]);

/** The human's identity — a named constant so callers never string-literal the spoof surface. */
export const HUMAN_IDENTITY = "human";

/** The identities an agent channel (session transport) serves. "human" is deliberately absent. */
export const AGENT_IDENTITIES = Object.freeze(["inner", "outer", "manager"]);

/** True when the given identity is a known one. */
export function isKnownIdentity(id) {
  return IDENTITIES.includes(id);
}

/**
 * Identity-claim gate (AC2: the receiving side can distinguish "human" from "agent-X").
 * A transport declares which sender identities it serves (`servedIdentities`). A message whose
 * `from` is not in that set is REJECTED before it is injected — fail-closed, never relayed.
 * The AC2 spoof — an agent message claiming `from: "human"` — is rejected because agent channels
 * (session transport) serve only agent identities. Returns { ok: true, identity } or
 * { ok: false, rejectedIdentity, reason } — mechanically testable, never a throw.
 */
export function checkIdentityClaim({ from, servedIdentities }) {
  const effective = from ?? null;
  if (effective === null) {
    return {
      ok: false,
      rejectedIdentity: null,
      reason: `identity rejected: no sender identity ('from') — deliver(target, payload, from=<identity>) requires one on an agent channel`,
    };
  }
  if (!servedIdentities.includes(effective)) {
    return {
      ok: false,
      rejectedIdentity: effective,
      reason: `identity rejected: '${effective}' is not a claimable sender identity for this channel (served: ${servedIdentities.join(", ")}) — an agent cannot forge another sender's identity`,
    };
  }
  return { ok: true, identity: effective };
}

/** The HUMAN target's mechanical mount point: `.quay/manager-inbox/` under the workspace root. */
export function managerInboxDir(root) {
  return path.join(root, ".quay", "manager-inbox");
}

/** The OUTER target's mechanical mount point: `.quay/outer-inbox/` under the workspace root.
 *  A SEPARATE inbox from the human channel — outer's messages must NOT pollute the human channel's
 *  delivered/consumed/unread measurement (observe("human") counts records in its OWN directory).
 *  (tasks/gap-outer-message-bus-needs-file-inbox-transport — outer is a file-inbox target like
 *  human, so manager→outer async delivery never waits on outer's session state.) */
export function outerInboxDir(root) {
  return path.join(root, ".quay", "outer-inbox");
}

// ── Record helpers (AC12b: every human message = timestamped, countable record) ──────────────────────

/**
 * Read every `.json` record in an inbox directory into a sorted (by seq) array. A malformed
 * record is skipped, never fatal — the reader (inbox-reader.sh) has its own resilience path.
 * @param {string} inboxDir
 * @returns {Array<object>}
 */
export function readInboxRecords(inboxDir) {
  if (!fs.existsSync(inboxDir)) return [];
  const records = [];
  for (const f of fs.readdirSync(inboxDir)) {
    if (!f.endsWith(".json")) continue;
    const p = path.join(inboxDir, f);
    try {
      records.push(JSON.parse(fs.readFileSync(p, "utf8")));
    } catch {
      // skip a malformed record — the reader reports it, the bus never dies on one
    }
  }
  return records.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

/**
 * Compute the human-channel observation from inbox records.
 *
 * `delivered` = records placed in the inbox; `consumed` = records a reader took a receipt on;
 * `unread` = delivered but not yet consumed (AC3: delivered ≠ consciousness-received).
 *
 * AC6 fail-safe: `measurement.valid` is false while `unread > 0` — the channel cannot confirm
 * human reading, so the unattended-interval estimate is vulnerable to out-of-channel human
 * communication (bypassing the channel OVERESTIMATES the unattended interval).
 * @param {Array<object>} records
 */
export function computeInboxObservation(records) {
  const delivered = records.length;
  const consumed = records.filter((r) => r.consumed === true).length;
  const unread = delivered - consumed;
  const lastDeliveredAt = records.length ? (records[records.length - 1].deliveredAt ?? null) : null;
  const consumedAtList = records.filter((r) => r.consumedAt).map((r) => r.consumedAt).sort();
  const lastConsumedAt = consumedAtList.length ? consumedAtList[consumedAtList.length - 1] : null;
  const valid = unread === 0;
  return {
    target: "human",
    busy: unread > 0,
    idle: delivered > 0 && unread === 0,
    blocked: false,
    last_at: lastDeliveredAt,
    last_consumed_at: lastConsumedAt,
    delivered,
    consumed,
    unread,
    measurement: {
      valid,
      reason: valid
        ? "all delivered messages consumed — unattended-interval estimate holds only while humans use exclusively this channel"
        : `${unread} delivered message(s) not yet consumed — the channel cannot confirm human reading; out-of-channel human communication distorts the unattended-interval estimate (AC6 fail-safe)`,
    },
  };
}

// ── Transports ────────────────────────────────────────────────────────────────────────────────────────

/**
 * File-inbox transport — the HUMAN target's transport. `deliver` writes a timestamped,
 * seq-numbered JSON record to `inboxDir`; `observe` reads the directory and reports
 * delivered/consumed/unread separately. This is the real, mechanical mount point.
 * @param {{ inboxDir: string }} opts
 */
export function createFileInboxTransport({ inboxDir }) {
  fs.mkdirSync(inboxDir, { recursive: true });
  // The human channel is bidirectional — the human's replies and every agent's notes share the
  // SAME inbox record (AC1: `from` carries the sender identity). All known identities (plus the
  // "unknown" omit-default) are claimable here; an explicitly-non-known `from` is a caller bug and
  // is rejected fail-closed rather than recorded as a mystery sender.
  const servedIdentities = [...IDENTITIES, "unknown"];
  return {
    name: "file-inbox",
    servedIdentities,
    deliver(message) {
      const from = message.from ?? "unknown";
      if (!servedIdentities.includes(from)) {
        return {
          delivered: false,
          rejectedIdentity: from,
          reason: `identity rejected: '${from}' is not a known sender identity (known: ${IDENTITIES.join(", ")}; 'unknown' when omitted)`,
        };
      }
      const records = readInboxRecords(inboxDir);
      const seq = records.reduce((m, r) => Math.max(m, r.seq ?? 0), 0) + 1;
      const deliveredAt = new Date().toISOString();
      _idCounter += 1;
      const id = `msg-${deliveredAt.replace(/[:.]/g, "-")}-${seq}-${_idCounter}`;
      const record = {
        id,
        seq,
        target: message.target ?? "human",
        from,
        payload: message.payload ?? {},
        delivered: true,
        deliveredAt,
        consumed: false,
        consumedAt: null,
      };
      try {
        fs.writeFileSync(path.join(inboxDir, `${id}.json`), JSON.stringify(record, null, 2) + "\n", "utf8");
      } catch (err) {
        // Contract: deliver -> delivered | failed. A write failure is a FAILED delivery, never a
        // throw — the caller can represent/retry it instead of crashing on an unwritable inbox.
        return { delivered: false, target: record.target, reason: `file-inbox write failed: ${err.message}` };
      }
      return { delivered: true, target: record.target, receiptId: id, seq, deliveredAt };
    },
    observe() {
      return computeInboxObservation(readInboxRecords(inboxDir));
    },
  };
}

/**
 * Session transport — the inter-layer (inner/outer) target's transport. The real adapter
 * (send-keys → transcript validation for deliver, classifyPaneState for observe) is wired by
 * the supervisor's delivery-centralization step (step ③); until then the transport reports
 * `delivered: false` / `busy: null` when no adapter is injected. This keeps the bus ONE
 * mechanism across all three targets — inner/outer deliver/observe through the SAME
 * deliver()/observe() entry points as human (AC2), with only the transport differing.
 * @param {{ deliverFn?: Function, observeFn?: Function }} [adapters]
 */
export function createSessionTransport({ deliverFn, observeFn } = { deliverFn: undefined, observeFn: undefined }) {
  // AC2 — agent channels serve AGENT identities only. "human" is NOT claimable here: this is the
  // channel where an agent message once impersonated the user (userType:external, indistinguishable
  // from the real human). The gate rejects the spoof BEFORE the deliverFn injects it, so a spoofed
  // identity never reaches the session. (An unconfigured session transport returns "not configured"
  // first — it cannot deliver anything, so the identity gate is moot until the adapter is wired.)
  const servedIdentities = AGENT_IDENTITIES;
  return {
    name: "session",
    servedIdentities,
    deliver(message) {
      if (!deliverFn) return { delivered: false, reason: "session transport not configured — supervisor delivery-centralization (step ③) wires the deliverFn adapter" };
      const claim = checkIdentityClaim({ from: message.from, servedIdentities });
      if (!claim.ok) return { delivered: false, rejectedIdentity: claim.rejectedIdentity, reason: claim.reason };
      return deliverFn({ ...message, from: claim.identity });
    },
    observe() {
      if (observeFn) return observeFn();
      return { busy: null, idle: null, blocked: null, last_at: null };
    },
  };
}

// ── Registry + entry points ──────────────────────────────────────────────────────────────────────────

/**
 * Create an isolated transport registry. The registry maps a target to its Transport and
 * exposes the two narrow interfaces `deliver(target, msg)` and `observe(target)`. Swapping a
 * transport for a target = `register(target, otherTransport)` — nothing else changes (AC1).
 */
export function createTransportRegistry() {
  const transports = new Map();
  return {
    register(target, transport) {
      if (!TARGETS.includes(target)) {
        throw new Error(`message-bus: unknown target '${target}' (expected one of ${TARGETS.join(", ")})`);
      }
      transports.set(target, transport);
    },
    get(target) {
      return transports.get(target) ?? null;
    },
    deliver(target: string, message: Record<string, unknown>, fromOrOpts: string | { from?: string } = {}) {
      const t = transports.get(target);
      if (!t) return { delivered: false, reason: `message-bus: no transport registered for target '${target}'` };
      // `target` is authoritative: the arg names the channel, and a caller-supplied `target` in
      // `message` must not relabel a record to a channel it was NOT delivered on (AC2/AC3 integrity).
      // AC1 — deliver(target, payload, from=<identity>): the THIRD arg is the sender identity,
      // authoritative over any `from` a caller smuggled inside `message`. Accepts either a bare
      // identity string (`deliver("inner", payload, "outer")`) or an opts object (`{ from }`).
      // `from` is carried on the record — computed BEFORE the spread so `msg` stays an ordinary
      // object literal (a spread of `object` erases the `from` property in TS's eyes).
      const opts = typeof fromOrOpts === "object" && fromOrOpts !== null ? fromOrOpts : {};
      const sender = typeof fromOrOpts === "string"
        ? fromOrOpts
        : (opts.from !== undefined ? opts.from : undefined);
      const msg = { ...message, target, ...(sender !== undefined ? { from: sender } : {}) };
      return t.deliver(msg, opts);
    },
    observe(target, opts = {}) {
      const t = transports.get(target);
      if (!t) return { target, busy: null, idle: null, blocked: null, last_at: null, reason: `message-bus: no transport registered for target '${target}'` };
      // Same authority rule: the target arg wins over any target a transport may echo back.
      return { ...t.observe(opts), target };
    },
    /** Test-only: clear all registered transports. */
    _clear() {
      transports.clear();
    },
  };
}

/** The module-level default bus — the repo-wide deliver()/observe() entry points. */
const defaultBus = createTransportRegistry();

export const registerTransport = defaultBus.register.bind(defaultBus);
export const getTransport = defaultBus.get.bind(defaultBus);
export const deliver = defaultBus.deliver.bind(defaultBus);
export const observe = defaultBus.observe.bind(defaultBus);

/** Test-only: clear the default bus's registered transports. */
export function resetTransports() {
  defaultBus._clear();
}

/**
 * Install the default transport wiring for a workspace root: human → the real file-inbox
 * (the mechanical mount point at `.quay/manager-inbox/`), inner → session transport
 * (adapters injected later by the supervisor), outer → its OWN file-inbox at `.quay/outer-inbox/`
 * (manager→outer async delivery no longer waits on outer's session state — the same
 * createFileInboxTransport the human channel already uses, registered for outer;
 * tasks/gap-outer-message-bus-needs-file-inbox-transport). Idempotent — safe to call repeatedly.
 * @param {string} root
 */
export function installDefaultTransports(root) {
  registerTransport("human", createFileInboxTransport({ inboxDir: managerInboxDir(root) }));
  registerTransport("inner", createSessionTransport());
  registerTransport("outer", createFileInboxTransport({ inboxDir: outerInboxDir(root) }));
}

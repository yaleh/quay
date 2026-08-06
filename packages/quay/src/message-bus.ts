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

/** The HUMAN target's mechanical mount point: `.quay/manager-inbox/` under the workspace root. */
export function managerInboxDir(root) {
  return path.join(root, ".quay", "manager-inbox");
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
  return {
    name: "file-inbox",
    deliver(message) {
      const records = readInboxRecords(inboxDir);
      const seq = records.reduce((m, r) => Math.max(m, r.seq ?? 0), 0) + 1;
      const deliveredAt = new Date().toISOString();
      _idCounter += 1;
      const id = `msg-${deliveredAt.replace(/[:.]/g, "-")}-${seq}-${_idCounter}`;
      const record = {
        id,
        seq,
        target: message.target ?? "human",
        from: message.from ?? "unknown",
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
  return {
    name: "session",
    deliver(message) {
      if (deliverFn) return deliverFn(message);
      return { delivered: false, reason: "session transport not configured — supervisor delivery-centralization (step ③) wires the deliverFn adapter" };
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
    deliver(target, message, opts = {}) {
      const t = transports.get(target);
      if (!t) return { delivered: false, reason: `message-bus: no transport registered for target '${target}'` };
      // `target` is authoritative: the arg names the channel, and a caller-supplied `target` in
      // `message` must not relabel a record to a channel it was NOT delivered on (AC2/AC3 integrity).
      return t.deliver({ ...message, target }, opts);
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
 * (the mechanical mount point at `.quay/manager-inbox/`), inner/outer → session transports
 * (adapters injected later by the supervisor). Idempotent — safe to call repeatedly.
 * @param {string} root
 */
export function installDefaultTransports(root) {
  registerTransport("human", createFileInboxTransport({ inboxDir: managerInboxDir(root) }));
  registerTransport("inner", createSessionTransport());
  registerTransport("outer", createSessionTransport());
}

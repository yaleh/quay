// Input-face audit trail (AC-004): every L1 (message) / L2 (keys) delivery
// attempt appends an audit record — success AND failure alike. "Only
// recording successes" is not an audit trail; it is exactly the gap the old
// tmux injection chain always had (design §5: "过去用 tmux 注入时，'这次投递
// 到底有没有到达' 没有任何留痕").
//
// A delivery record always carries who/when/target/payload-summary/
// delivered — the append happens in the SAME code path whether the socket
// write succeeded or the connection failed, so a failure can never simply
// skip writing. "Delivered" and "had an effect" are kept as two separate
// facts: this module only proves delivery; a first observed status change
// afterward is recorded as a correlated follow-up record via
// recordStatusChangeObserved(), appended once (if ever) observed — never
// invented, never required for the delivery record itself to be complete.

import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { decodeFrames, encodeCtrl, encodeData } from "./pty-frame.mjs";

// Exported (task fleet-agent-sessions-lifecycle-endpoint) so other L-level
// modules — lifecycle-audit.mjs's performLifecycleAction — can append to and
// summarize for the SAME audit ledger format instead of reimplementing
// either primitive.
export function appendAuditRecord(auditLogPath, record) {
  fs.mkdirSync(path.dirname(auditLogPath), { recursive: true });
  fs.appendFileSync(auditLogPath, JSON.stringify(record) + "\n");
}

// The audit trail must be safe to keep and read back without becoming a
// second copy of whatever was delivered — payloads can carry tokens or
// another session's conversation content. The summary is length + a short
// content hash (for correlation) + a bounded first-line preview, never the
// full payload. A Buffer (L2 raw terminal bytes, e.g. deliverKeys' `bytes`)
// is hashed and length-measured over its actual bytes rather than routed
// through JSON.stringify/utf8 first — those can silently reinterpret or
// mis-measure a byte sequence that isn't valid UTF-8.
export function summarizePayload(payload) {
  if (Buffer.isBuffer(payload)) {
    const hash = crypto.createHash("sha256").update(payload).digest("hex").slice(0, 12);
    const firstLine = payload.toString("latin1").split("\n")[0].slice(0, 80);
    return { length: payload.length, sha256_12: hash, firstLine };
  }
  const s = typeof payload === "string" ? payload : JSON.stringify(payload);
  const hash = crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);
  const firstLine = s.split("\n")[0].slice(0, 80);
  return { length: s.length, sha256_12: hash, firstLine };
}

/**
 * Attempt one delivery over a unix socket and unconditionally append an
 * audit record for it — the write to `auditLogPath` happens on every exit
 * path (connect-and-write success, connection error, write error, timeout).
 *
 * @param {"L1"|"L2"} level
 * @returns {Promise<object>} the audit record that was written
 */
export function deliver({ level, who, target, socketPath, payload, auditLogPath, timeoutMs = 2000 }) {
  const id = crypto.randomUUID();
  const when = new Date().toISOString();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (delivered, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {
        // already gone
      }
      const record = {
        id,
        level,
        who,
        when,
        target,
        payloadSummary: summarizePayload(payload),
        delivered,
        error: error ?? null,
        firstStatusChangeAt: null, // see recordStatusChangeObserved()
      };
      appendAuditRecord(auditLogPath, record);
      resolve(record);
    };

    const timer = setTimeout(() => finish(false, "timeout"), timeoutMs);
    const socket = net.createConnection(socketPath);

    socket.on("connect", () => {
      socket.write(typeof payload === "string" ? payload : JSON.stringify(payload), (err) => {
        if (err) finish(false, err.message);
        else finish(true, null);
      });
    });

    socket.on("error", (err) => {
      finish(false, err?.message ?? String(err));
    });
  });
}

/**
 * Attempt one L2 (keys) delivery over a pty.sock — the frame protocol from
 * design §A.2 / pty-frame.mjs, NOT the raw-bytes-over-the-wire L1 protocol
 * `deliver()` speaks. Connects, sends the CTRL auth frame `{t:"auth",
 * token:authToken}`, then — unless an explicit rejection (`auth-required` or
 * `error` CTRL frame) arrives first — sends the DATA frame carrying `bytes`
 * unmodified (0x03 and every other byte pass through untouched). Exactly
 * like `deliver()`, an audit record is appended on EVERY exit path: success,
 * connection failure, explicit auth-rejection, or timeout — reusing this
 * module's own `appendAuditRecord`/`summarizePayload`, never a second
 * implementation of either.
 *
 * There is no documented server->client "auth accepted" message (§A.2 only
 * documents rejection/heartbeat CTRL shapes), so acceptance is inferred by
 * absence: `authGraceMs` is a short window after the auth frame is flushed
 * during which an explicit rejection would already have arrived on a local
 * socket; if none shows up, the DATA frame is sent and the delivery is
 * `true`. A rejection arriving inside that window aborts BEFORE the DATA
 * frame is ever written — the fake pty-host in this task's own tests must
 * never observe a DATA frame following a rejection.
 *
 * @returns {Promise<object>} the audit record that was written
 */
export function deliverKeys({
  who,
  target,
  socketPath,
  authToken,
  bytes,
  auditLogPath,
  timeoutMs = 2000,
  authGraceMs = 50,
}) {
  const id = crypto.randomUUID();
  const when = new Date().toISOString();
  const dataBuffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

  return new Promise((resolve) => {
    let settled = false;
    let recvBuf = Buffer.alloc(0);
    let graceTimer = null;

    const finish = (delivered, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      try {
        socket.destroy();
      } catch {
        // already gone
      }
      const record = {
        id,
        level: "L2",
        who,
        when,
        target,
        payloadSummary: summarizePayload(dataBuffer),
        delivered,
        error: error ?? null,
        firstStatusChangeAt: null, // see recordStatusChangeObserved()
      };
      appendAuditRecord(auditLogPath, record);
      resolve(record);
    };

    const timer = setTimeout(() => finish(false, "timeout"), timeoutMs);
    const socket = net.createConnection(socketPath);

    socket.on("data", (chunk) => {
      recvBuf = Buffer.concat([recvBuf, chunk]);
      const { frames, rest } = decodeFrames(recvBuf);
      recvBuf = rest;
      for (const frame of frames) {
        if (frame.tag !== 1) continue; // only CTRL frames carry auth outcomes
        let ctrl;
        try {
          ctrl = JSON.parse(frame.payload.toString("utf8"));
        } catch {
          continue; // an unparsable CTRL frame is not a recognized rejection
        }
        if (ctrl?.t === "auth-required" || ctrl?.t === "error") {
          finish(false, `auth rejected: ${ctrl.t}${ctrl.message ? ` (${ctrl.message})` : ""}`);
          return;
        }
      }
    });

    socket.on("error", (err) => {
      finish(false, err?.message ?? String(err));
    });

    socket.on("connect", () => {
      socket.write(encodeCtrl({ t: "auth", token: authToken }), (err) => {
        if (err) {
          finish(false, err.message);
          return;
        }
        if (settled) return; // a rejection already arrived synchronously
        graceTimer = setTimeout(() => {
          if (settled) return; // a rejection arrived during the grace window
          socket.write(encodeData(dataBuffer), (err2) => {
            if (err2) finish(false, err2.message);
            else finish(true, null);
          });
        }, authGraceMs);
      });
    });
  });
}

/**
 * Append a follow-up record correlating a prior delivery with the first
 * status change observed after it. A caller-supplied fact, not guessed —
 * this module never invents a status change that wasn't actually observed.
 */
export function recordStatusChangeObserved(auditLogPath, deliveryId, observedAt) {
  appendAuditRecord(auditLogPath, { followUpOf: deliveryId, firstStatusChangeAt: observedAt });
}

/** Read every audit record (initial + any follow-up) for one delivery id. */
export function readAuditTrail(auditLogPath, deliveryId) {
  if (!fs.existsSync(auditLogPath)) return [];
  return fs
    .readFileSync(auditLogPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((record) => record.id === deliveryId || record.followUpOf === deliveryId);
}

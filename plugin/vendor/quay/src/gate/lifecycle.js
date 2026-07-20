// Lifecycle — the thin status-WRITING layer over the QENG-1/2 gate engine
// (QENG-3). quay's status model {todo, ready, done, needs-human} ARE the phases
// (proposal §Non-goals — no epicd Pipeline port); this module writes those
// statuses behind gate + legal-transition guards, plus an independent
// adjudication pass. No new gate logic, no Provider ABI change: it reuses
// `runGate` (engine.js) and `client.taskGet/taskWrite/taskCheck` only.
//
// The four verbs:
//   runComplete   — precondition status==="ready"; acceptance gate; on pass write done.
//   runAdjudicate — read-only independent audit; logs an `audit` GateEvent; never writes.
//   runPromote    — one legal forward step over TRANSITIONS (ready→done delegates to complete).
//   runRetreat    — one legal backward step; --reason required, recorded in the payload.
//
// Every status write passes `expectedStatus` = the pre-read status, making it a
// compare-and-swap (store.js ConflictError, QN-015) rather than last-writer-wins.

import { randomUUID } from "node:crypto";
import { runGate } from "./engine.js";
import { appendGateEvent } from "./gate-event-store.js";

/**
 * The legal-transition adjacency map. `forward` = promote target, `back` =
 * retreat target. Each forward edge is a gate `check()` already models; back
 * edges are single-step rework rollbacks. `needs-human` has NO automated edge
 * in or out — clearing it is a deliberate `quay task edit --status` write.
 *
 * @type {Record<string, { forward: string|null, back: string|null }>}
 */
export const TRANSITIONS = {
  todo: { forward: "ready", back: null },
  ready: { forward: "done", back: "todo" },
  done: { forward: null, back: "ready" },
  "needs-human": { forward: null, back: null },
};

/** @param {string} status @returns {string|null} next status, or null if terminal/unknown */
export function legalForward(status) {
  return TRANSITIONS[status]?.forward ?? null;
}

/** @param {string} status @returns {string|null} previous status, or null if none/unknown */
export function legalBack(status) {
  return TRANSITIONS[status]?.back ?? null;
}

/**
 * Throw on an illegal transition (a null edge). `dir` is "forward" | "back".
 * The message is exactly `illegal transition: <status> cannot <dir>` so the
 * CLI's top-level catch surfaces it verbatim (AC3).
 *
 * @param {string} status
 * @param {"forward"|"back"} dir
 */
export function assertTransition(status, dir) {
  const target = dir === "forward" ? legalForward(status) : legalBack(status);
  if (target === null) {
    throw new Error(`illegal transition: ${status} cannot ${dir}`);
  }
}

/** Assemble a QENG-1-shaped GateEvent (item_id == pipeline_id == task id). */
function mkLifecycleEvent({ id, gate, actor, verdict, payload }) {
  return {
    id: randomUUID(),
    item_id: id,
    pipeline_id: id,
    gate,
    actor,
    verdict,
    timestamp: new Date().toISOString(),
    payload,
  };
}

/**
 * `quay complete <task>` — precondition status==="ready"; run the acceptance
 * gate; on pass write status=done + log a `complete` pass event; on fail exit 1,
 * status UNCHANGED. Not-`ready` → exit 1, no gate, no write (store.write does not
 * enforce edges and acceptance is status-independent — the guard is load-bearing).
 *
 * @param {Object} args
 * @param {any} args.client
 * @param {string} args.id
 * @param {string} args.logPath
 * @param {string} [args.actor="quay-cli"]
 * @returns {Promise<{ok: boolean, reason: string}>}
 */
export async function runComplete({ client, id, logPath, actor = "quay-cli" }) {
  const task = await client.taskGet(id);
  if (!task) throw new Error(`no such task: ${id}`);
  if (task.status !== "ready") {
    const reason = `illegal transition: ${task.status} cannot complete (must be ready)`;
    console.log(reason);
    process.exitCode = 1;
    return { ok: false, reason };
  }

  const { ok, reason } = await runGate({ client, id, gate: "acceptance", logPath, actor });
  if (!ok) {
    console.log(`FAIL — ${reason}`);
    process.exitCode = 1;
    return { ok: false, reason };
  }

  await client.taskWrite({ id, status: "done", expectedStatus: "ready" });
  appendGateEvent(
    logPath,
    mkLifecycleEvent({ id, gate: "complete", actor, verdict: "pass", payload: { from: "ready", to: "done" } })
  );
  console.log("PASS — status=done");
  return { ok: true, reason };
}

/**
 * `quay adjudicate <task>` — independent, read-only audit pass. Records the
 * mechanical state it can observe (`client.taskCheck`) as an `audit` GateEvent,
 * WITHOUT delegating verdict authority to it. Never writes status; exit 0 always
 * (proposal §"record-only in v0").
 *
 * @param {Object} args
 * @param {any} args.client
 * @param {string} args.id
 * @param {string} args.logPath
 * @param {string} [args.actor="quay-cli"]
 * @returns {Promise<{ok: boolean, reason: string}>}
 */
export async function runAdjudicate({ client, id, logPath, actor = "quay-cli" }) {
  const task = await client.taskGet(id);
  if (!task) throw new Error(`no such task: ${id}`);
  const r = await client.taskCheck(id);
  appendGateEvent(
    logPath,
    mkLifecycleEvent({
      id,
      gate: "audit",
      actor,
      verdict: r.ok ? "pass" : "fail",
      payload: { reason: r.reason, observed_status: task.status },
    })
  );
  console.log(`AUDIT ${r.ok ? "pass" : "fail"} — ${r.reason}`);
  return { ok: r.ok, reason: r.reason };
}

/**
 * `quay promote <task>` — one legal forward step over TRANSITIONS. `ready→done`
 * delegates to runComplete (the single gate-guarded path to done); `todo→ready`
 * runs the `dod` author gate then writes. Illegal forward edge → throws.
 *
 * @param {Object} args
 * @param {any} args.client
 * @param {string} args.id
 * @param {string} args.logPath
 * @param {string} [args.actor="quay-cli"]
 * @returns {Promise<{ok: boolean, reason: string, to: string|null}>}
 */
export async function runPromote({ client, id, logPath, actor = "quay-cli" }) {
  const task = await client.taskGet(id);
  if (!task) throw new Error(`no such task: ${id}`);
  assertTransition(task.status, "forward");
  const next = legalForward(task.status);

  if (task.status === "ready") {
    const r = await runComplete({ client, id, logPath, actor });
    return { ...r, to: r.ok ? "done" : null };
  }

  // todo→ready: the author gate.
  const { ok, reason } = await runGate({ client, id, gate: "dod", logPath, actor });
  if (!ok) {
    console.log(`FAIL — ${reason}`);
    process.exitCode = 1;
    return { ok: false, reason, to: null };
  }
  await client.taskWrite({ id, status: next, expectedStatus: task.status });
  appendGateEvent(
    logPath,
    mkLifecycleEvent({ id, gate: "promote", actor, verdict: "pass", payload: { from: task.status, to: next } })
  );
  console.log(`PROMOTE ${task.status} → ${next}`);
  return { ok: true, reason, to: next };
}

/**
 * `quay retreat <task> --reason <r>` — one legal backward step over TRANSITIONS.
 * `--reason` is REQUIRED (it IS the deliverable of a retreat): missing/empty →
 * exit 1, no write. Illegal back edge → throws. No gate runs — retreat rolls
 * back regardless; the reason is recorded in the payload.
 *
 * @param {Object} args
 * @param {any} args.client
 * @param {string} args.id
 * @param {string} args.reason
 * @param {string} args.logPath
 * @param {string} [args.actor="quay-cli"]
 * @returns {Promise<{ok: boolean, to: string|null}>}
 */
export async function runRetreat({ client, id, reason, logPath, actor = "quay-cli" }) {
  if (typeof reason !== "string" || reason.trim() === "") {
    console.error("quay retreat: --reason <r> is required (the reason is the deliverable of a retreat)");
    process.exitCode = 1;
    return { ok: false, to: null };
  }
  const task = await client.taskGet(id);
  if (!task) throw new Error(`no such task: ${id}`);
  assertTransition(task.status, "back");
  const prev = legalBack(task.status);

  await client.taskWrite({ id, status: prev, expectedStatus: task.status });
  appendGateEvent(
    logPath,
    mkLifecycleEvent({ id, gate: "retreat", actor, verdict: "pass", payload: { from: task.status, to: prev, reason } })
  );
  console.log(`RETREAT ${task.status} → ${prev} (${reason})`);
  return { ok: true, to: prev };
}

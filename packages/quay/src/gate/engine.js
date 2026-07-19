// Gate engine — run a named gate against a task, append one GateEvent, return
// the verdict (QENG-1). Port of epicd `src/engine/adjudicate-gate.ts`, adapted
// to quay's provider store (proposal §"Engine").
//
// The engine never inspects `payload` beyond assembling it; it matches only on
// the gate fn's `{ ok, reason }` — the ABI-uniform fields every Provider's
// `taskCheck` returns.

import { randomUUID } from "node:crypto";
import { gateRegistry } from "./registry.js";
import { appendGateEvent } from "./gate-event-store.js";

/**
 * Run gate `gate` against task `id` via `client`, append one GateEvent to
 * `logPath`, and return the verdict + the appended event.
 *
 * Unknown gate name and missing task both throw (fail loud — the CLI's
 * top-level catch reports them).
 *
 * @param {Object} args
 * @param {any} args.client   provider client (taskGet / taskCheck)
 * @param {string} args.id    task id
 * @param {string} [args.gate="dod"]
 * @param {string} args.logPath
 * @param {string} [args.actor="quay-cli"]
 * @returns {Promise<{ ok: boolean, reason: string, event: import("./gate-event-store.js").GateEvent }>}
 */
export async function runGate({ client, id, gate = "dod", logPath, actor = "quay-cli" }) {
  const fn = gateRegistry[gate];
  if (!fn) throw new Error(`unknown gate: ${gate}`);
  const task = await client.taskGet(id);
  if (!task) throw new Error(`no such task: ${id}`);
  const { ok, reason } = await fn(task, client);
  const event = {
    id: randomUUID(),
    item_id: id,
    pipeline_id: id,
    gate,
    actor,
    verdict: ok ? "pass" : "fail",
    timestamp: new Date().toISOString(),
    payload: { reason },
  };
  appendGateEvent(logPath, event);
  return { ok, reason, event };
}

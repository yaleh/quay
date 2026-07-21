// Gate engine — run a named gate against a task, append one GateEvent, return
// the verdict (QENG-1). Port of epicd `src/engine/adjudicate-gate.ts`, adapted
// to quay's provider store (proposal §"Engine").
//
// The engine never inspects `payload` beyond assembling it; it matches only on
// the gate fn's `{ ok, reason }` — the ABI-uniform fields every Provider's
// `taskCheck` returns.

import { randomUUID } from "node:crypto";
import { resolveGate } from "./registry.ts";
import { appendGateEvent, type GateEvent } from "./gate-event-store.ts";
import type { Task } from "../abi.ts";

export interface RunGateArgs {
  /** provider client (taskGet / taskCheck) */
  client: {
    taskGet: (id: string) => Promise<Task | null>;
    taskCheck: (id: string) => Promise<{ ok: boolean; reason: string }>;
  };
  /** task id */
  id: string;
  gate?: string;
  logPath: string;
  actor?: string;
  workspaceRoot?: string;
}

export interface RunGateResult {
  ok: boolean;
  reason: string;
  event: GateEvent;
}

/**
 * Run gate `gate` against task `id` via `client`, append one GateEvent to
 * `logPath`, and return the verdict + the appended event.
 *
 * Unknown gate name and missing task both throw (fail loud — the CLI's
 * top-level catch reports them).
 *
 * DIR-035-B: gate resolution is now WORKSPACE-DATA-driven for anything beyond
 * the product's own built-ins (`registry.js#resolveGate`) — `workspaceRoot`
 * (when supplied, e.g. from `cfg.workspaceRoot` at the CLI layer) selects that
 * workspace's own `.quay/gates.yml`-declared gates; omitted, it falls back to
 * auto-discovery from `process.cwd()` (unchanged behavior for existing
 * in-process callers/tests that never threaded a workspaceRoot through).
 */
export async function runGate({ client, id, gate = "dod", logPath, actor = "quay-cli", workspaceRoot }: RunGateArgs): Promise<RunGateResult> {
  const fn = resolveGate(gate, workspaceRoot);
  if (!fn) throw new Error(`unknown gate: ${gate}`);
  const task = await client.taskGet(id);
  if (!task) throw new Error(`no such task: ${id}`);
  const { ok, reason } = await fn(task, client);
  const event: GateEvent = {
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

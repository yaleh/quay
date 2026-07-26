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
import { runGate } from "./engine.ts";
import { appendGateEvent, type GateEvent } from "./gate-event-store.ts";
import type { Task } from "../abi.ts";

interface ProviderClient {
  taskGet: (id: string) => Promise<Task | null>;
  taskWrite: (args: { id: string; status: string; expectedStatus: string }) => Promise<unknown>;
  taskCheck: (id: string) => Promise<{ ok: boolean; reason: string }>;
}

/**
 * The legal-transition adjacency map. `forward` = promote target, `back` =
 * retreat target. Each forward edge is a gate `check()` already models; back
 * edges are single-step rework rollbacks. `needs-human` has no forward edge
 * (clearing it forward requires a human `quay task edit --status`), but
 * retreat to `todo` is allowed — a human-resolved task can be rolled back
 * for a fresh attempt.
 */
export const TRANSITIONS: Record<string, { forward: string | null; back: string | null }> = {
  todo: { forward: "ready", back: null },
  ready: { forward: "done", back: "todo" },
  done: { forward: null, back: "ready" },
  "needs-human": { forward: null, back: "todo" },
};

/** next status, or null if terminal/unknown */
export function legalForward(status: string): string | null {
  return TRANSITIONS[status]?.forward ?? null;
}

/** previous status, or null if none/unknown */
export function legalBack(status: string): string | null {
  return TRANSITIONS[status]?.back ?? null;
}

/**
 * Throw on an illegal transition (a null edge). `dir` is "forward" | "back".
 * The message is exactly `illegal transition: <status> cannot <dir>` so the
 * CLI's top-level catch surfaces it verbatim (AC3).
 */
export function assertTransition(status: string, dir: "forward" | "back"): void {
  const target = dir === "forward" ? legalForward(status) : legalBack(status);
  if (target === null) {
    throw new Error(`illegal transition: ${status} cannot ${dir}`);
  }
}

interface LifecycleEventArgs {
  id: string;
  gate: string;
  actor: string;
  verdict: string;
  payload: unknown;
}

/** Assemble a QENG-1-shaped GateEvent (item_id == pipeline_id == task id). */
function mkLifecycleEvent({ id, gate, actor, verdict, payload }: LifecycleEventArgs): GateEvent {
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

export interface LifecycleArgs {
  client: ProviderClient;
  id: string;
  logPath: string;
  actor?: string;
}

export interface RetreatArgs extends LifecycleArgs {
  reason: string;
}

export interface LifecycleResult {
  ok: boolean;
  reason: string;
  /** exitCode mirrors what process.exitCode is/was set to (1 on error, 0 on success).
   *  Callers in long-running processes (MCP server) should reset process.exitCode
   *  after a lifecycle call and rely on this field for the logical result. */
  exitCode: number;
}

export interface PromoteResult extends LifecycleResult {
  to: string | null;
}

export interface RetreatResult {
  ok: boolean;
  to: string | null;
  /** exitCode mirrors what process.exitCode is/was set to (1 on error, 0 on success). */
  exitCode: number;
}

/**
 * `quay complete <task>` — precondition status==="ready"; run the acceptance
 * gate; on pass write status=done + log a `complete` pass event; on fail exit 1,
 * status UNCHANGED. Not-`ready` → exit 1, no gate, no write (store.write does not
 * enforce edges and acceptance is status-independent — the guard is load-bearing).
 */
export async function runComplete({ client, id, logPath, actor = "quay-cli" }: LifecycleArgs): Promise<LifecycleResult> {
  const task = await client.taskGet(id);
  if (!task) throw new Error(`no such task: ${id}`);
  if (task.status !== "ready") {
    const reason = `illegal transition: ${task.status} cannot complete (must be ready)`;
    console.log(reason);
    // @deprecated — process.exitCode set for CLI backward-compat; MCP callers should
    // read the returned exitCode field and reset process.exitCode after the call.
    process.exitCode = 1;
    return { ok: false, reason, exitCode: 1 };
  }

  const { ok, reason } = await runGate({ client, id, gate: "acceptance", logPath, actor });
  if (!ok) {
    console.log(`FAIL — ${reason}`);
    // @deprecated — process.exitCode set for CLI backward-compat; MCP callers should
    // read the returned exitCode field and reset process.exitCode after the call.
    process.exitCode = 1;
    return { ok: false, reason, exitCode: 1 };
  }

  await client.taskWrite({ id, status: "done", expectedStatus: "ready" });
  appendGateEvent(
    logPath,
    mkLifecycleEvent({ id, gate: "complete", actor, verdict: "pass", payload: { from: "ready", to: "done" } })
  );
  console.log("PASS — status=done");
  return { ok: true, reason, exitCode: 0 };
}

/**
 * `quay adjudicate <task>` — independent, read-only audit pass. Records the
 * mechanical state it can observe (`client.taskCheck`) as an `audit` GateEvent,
 * WITHOUT delegating verdict authority to it. Never writes status; exit 0 always
 * (proposal §"record-only in v0").
 */
export async function runAdjudicate({ client, id, logPath, actor = "quay-cli" }: LifecycleArgs): Promise<LifecycleResult> {
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
  return { ok: r.ok, reason: r.reason, exitCode: 0 };
}

/**
 * `quay promote <task>` — one legal forward step over TRANSITIONS. `ready→done`
 * delegates to runComplete (the single gate-guarded path to done); `todo→ready`
 * runs the `dod` author gate then writes. Illegal forward edge → throws.
 */
export async function runPromote({ client, id, logPath, actor = "quay-cli" }: LifecycleArgs): Promise<PromoteResult> {
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
    // @deprecated — process.exitCode set for CLI backward-compat; MCP callers should
    // read the returned exitCode field and reset process.exitCode after the call.
    process.exitCode = 1;
    return { ok: false, reason, to: null, exitCode: 1 };
  }
  await client.taskWrite({ id, status: next!, expectedStatus: task.status });
  appendGateEvent(
    logPath,
    mkLifecycleEvent({ id, gate: "promote", actor, verdict: "pass", payload: { from: task.status, to: next } })
  );
  console.log(`PROMOTE ${task.status} → ${next}`);
  return { ok: true, reason, to: next, exitCode: 0 };
}

/**
 * `quay retreat <task> --reason <r>` — one legal backward step over TRANSITIONS.
 * `--reason` is REQUIRED (it IS the deliverable of a retreat): missing/empty →
 * exit 1, no write. Illegal back edge → throws. No gate runs — retreat rolls
 * back regardless; the reason is recorded in the payload.
 */
export async function runRetreat({ client, id, reason, logPath, actor = "quay-cli" }: RetreatArgs): Promise<RetreatResult> {
  if (typeof reason !== "string" || reason.trim() === "") {
    console.error("quay retreat: --reason <r> is required (the reason is the deliverable of a retreat)");
    // @deprecated — process.exitCode set for CLI backward-compat; MCP callers should
    // read the returned exitCode field and reset process.exitCode after the call.
    process.exitCode = 1;
    return { ok: false, to: null, exitCode: 1 };
  }
  const task = await client.taskGet(id);
  if (!task) throw new Error(`no such task: ${id}`);
  assertTransition(task.status, "back");
  const prev = legalBack(task.status);

  await client.taskWrite({ id, status: prev!, expectedStatus: task.status });
  appendGateEvent(
    logPath,
    mkLifecycleEvent({ id, gate: "retreat", actor, verdict: "pass", payload: { from: task.status, to: prev, reason } })
  );
  console.log(`RETREAT ${task.status} → ${prev} (${reason})`);
  return { ok: true, to: prev, exitCode: 0 };
}

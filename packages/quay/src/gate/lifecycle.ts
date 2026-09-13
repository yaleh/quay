// Lifecycle — the thin status-WRITING layer over the QENG-1/2 gate engine
// (QENG-3). quay's status model {todo, ready, done, needs-human, superseded}
// ARE the phases (proposal §Non-goals — no epicd Pipeline port); this module
// writes those statuses behind gate + legal-transition guards, plus an
// independent adjudication pass. No new gate logic, no Provider ABI change:
// it reuses `runGate` (engine.js) and `client.taskGet/taskWrite/taskCheck` only.
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
import { readGatesConfig } from "./registry.ts";
import { appendGateEvent, type GateEvent } from "./gate-event-store.ts";
import { TASK_STATUS, type Task } from "../abi.ts";

interface ProviderClient {
  taskGet: (id: string) => Promise<Task | null>;
  taskWrite: (args: { id: string; status: string; expectedStatus: string; body?: string }) => Promise<unknown>;
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
  [TASK_STATUS.TODO]: { forward: TASK_STATUS.READY, back: null },
  [TASK_STATUS.READY]: { forward: TASK_STATUS.DONE, back: TASK_STATUS.TODO },
  [TASK_STATUS.DONE]: { forward: null, back: TASK_STATUS.READY },
  [TASK_STATUS.NEEDS_HUMAN]: { forward: null, back: TASK_STATUS.TODO },
  // `superseded` is a HARD terminal (outer ruling 2026-08-12): the task's
  // premise was deleted/voided and must not be revived — no forward edge, no
  // back edge. Resurrection requires a human re-filing a fresh task.
  [TASK_STATUS.SUPERSEDED]: { forward: null, back: null },
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
  /** criterion-cost meter (gap-no-criterion-records-its-own-cost-checker-cost-jsonl): the workspace
   *  root, threaded to runGate so lifecycle-driven gate executions also record their cost. Omitted
   *  for in-process/test callers → the gate recorder skips (no synthetic rows). */
  workspaceRoot?: string;
}

export interface RetreatArgs extends LifecycleArgs {
  reason: string;
}

/**
 * Does THIS workspace require the ADR-007 per-milestone dark-axis record on its ready→done path?
 * (gap-adr007-per-milestone-dark-axis-enforcement-gate)
 *
 * The switch is the workspace's own gate config: the same `adr:` list that already wires ADR-007's
 * INSTRUMENT-INTEGRITY gate (`adr-007` → git-lens-selfcheck.sh). Declaring an ADR in that list means
 * accepting that ADR's enforcement, and ADR-007's enforcement has two halves; `dark-axis` is the
 * second. There is deliberately no second config surface to keep in sync — one declaration, both
 * halves.
 *
 * Who this turns on for, concretely: this repo's own `.quay/config.yml` declares `ADR-007`, so the
 * predicate is LIVE here, which is the point (the ADR has been unenforced since 2026-07-20). The
 * disposable workspaces the test suite builds (~`makeTmpWorkspace`, a providers-only config with no
 * `gates:` section) declare no ADR at all, so the suite's lifecycle cases are unaffected.
 *
 * KNOWN LIMITATION (stated rather than papered over): `readGatesConfig` reports a malformed
 * `gates:` YAML as "no config" (loader.ts's documented fail-quiet contract), so a *syntax error*
 * inside a config that DID declare ADR-007 reads as "not declared" — enforcement silently off. The
 * distinction is not recoverable through that reader; fixing it belongs to the loader, not here.
 */
export function workspaceEnforcesDarkAxis(workspaceRoot?: string): boolean {
  if (!workspaceRoot) return false;
  try {
    const adrIds = readGatesConfig(workspaceRoot)?.adr ?? [];
    return adrIds.some((a) => /^ADR-007$/i.test(String(a).trim()));
  } catch {
    return false;
  }
}

/**
 * Run the `dark-axis` gate when the workspace requires it, as a FAIL-CLOSED precondition of the
 * ready→done landing (AC2/AC3). Returns the verdict to return, or null when the workspace does not
 * declare ADR-007 (or the gate passed — a pass still appends its own GateEvent via runGate, so the
 * "was this task judged on the dark axes?" question has a ledger answer, not just a status).
 */
async function enforceDarkAxis({ client, id, logPath, actor, workspaceRoot }: LifecycleArgs): Promise<LifecycleResult | null> {
  if (!workspaceEnforcesDarkAxis(workspaceRoot)) return null;
  const { ok, reason } = await runGate({ client, id, gate: "dark-axis", logPath, actor, workspaceRoot });
  if (ok) return null;
  console.log(`FAIL — ${reason}`);
  // @deprecated — process.exitCode set for CLI backward-compat; MCP callers should
  // read the returned exitCode field and reset process.exitCode after the call.
  process.exitCode = 1;
  return { ok: false, reason, exitCode: 1 };
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
export async function runComplete({ client, id, logPath, actor = "quay-cli", workspaceRoot }: LifecycleArgs): Promise<LifecycleResult> {
  const task = await client.taskGet(id);
  if (!task) throw new Error(`no such task: ${id}`);
  if (task.status !== TASK_STATUS.READY) {
    const reason = `illegal transition: ${task.status} cannot complete (must be ready)`;
    console.log(reason);
    // @deprecated — process.exitCode set for CLI backward-compat; MCP callers should
    // read the returned exitCode field and reset process.exitCode after the call.
    process.exitCode = 1;
    return { ok: false, reason, exitCode: 1 };
  }

  // ADR-007 per-milestone predicate — the dark-axis record is a PRECONDITION of landing, checked
  // before the acceptance meter: a task that has not consulted the dark axes must not reach the
  // point of being judged on L_T alone (the ADR's own forbidden outcome). No-op unless the
  // workspace declares ADR-007 — see workspaceEnforcesDarkAxis.
  const darkAxisFail = await enforceDarkAxis({ client, id, logPath, actor, workspaceRoot });
  if (darkAxisFail) return darkAxisFail;

  const { ok, reason } = await runGate({ client, id, gate: "acceptance", logPath, actor, workspaceRoot });
  if (!ok) {
    console.log(`FAIL — ${reason}`);
    // @deprecated — process.exitCode set for CLI backward-compat; MCP callers should
    // read the returned exitCode field and reset process.exitCode after the call.
    process.exitCode = 1;
    return { ok: false, reason, exitCode: 1 };
  }
  await client.taskWrite({ id, status: TASK_STATUS.DONE, expectedStatus: TASK_STATUS.READY });
  appendGateEvent(
    logPath,
    mkLifecycleEvent({ id, gate: "complete", actor, verdict: "pass", payload: { from: TASK_STATUS.READY, to: TASK_STATUS.DONE } })
  );
  console.log("PASS — status=done");
  return { ok: true, reason, exitCode: 0 };
}

export interface LoopCompleteArgs extends LifecycleArgs {
  /** loop verification evidence (verification-round-N full-suite green + AC/DoD
   *  checked by outer 1b). Recorded in the `complete` event payload. */
  verifiedBy?: string;
}

/**
 * `quay-loop complete <task>` — the loop's completion path AS the gate engine
 * (gap-loop-completion-path-produces-zero-gateevents). The outer async closure
 * pass (orchestrator-loop-tick.md step 1b "翻 done") routes its ready→done flip
 * through THIS instead of writing `status: done` directly, so a loop-completed
 * task records a `complete` pass GateEvent exactly like the CLI's `quay complete`
 * does — the loop's meter is runnable, not silently unasserted.
 *
 * CLI-consistency with `runComplete`:
 *   - precondition status === "ready"; not-ready → exit 1, NO gate, NO write.
 *   - when the task carries an acceptance meter it is RUN through the same
 *     `runGate` engine the CLI uses ("meter is runnable"); a fail keeps status
 *     unchanged (exit 1), exactly like `quay complete`.
 *   - a loop task with NO meter (the loop's acceptance is the verification-round,
 *     which the outer already confirmed) has `verifiedBy` recorded as the
 *     acceptance evidence instead.
 * On pass: write status=done (CAS `expectedStatus:"ready"`) + append a `complete`
 * pass event to `logPath` (`.quay/gate-events.jsonl`), readable via gate-log.
 */
export async function runCompleteLoop({ client, id, logPath, actor = "quay-loop", workspaceRoot, verifiedBy }: LoopCompleteArgs): Promise<LifecycleResult> {
  const task = await client.taskGet(id);
  if (!task) throw new Error(`no such task: ${id}`);
  if (task.status !== TASK_STATUS.READY) {
    const reason = `illegal transition: ${task.status} cannot complete (must be ready)`;
    console.log(reason);
    // @deprecated — process.exitCode set for CLI backward-compat; MCP callers should
    // read the returned exitCode field and reset process.exitCode after the call.
    process.exitCode = 1;
    return { ok: false, reason, exitCode: 1 };
  }

  // ADR-007 per-milestone predicate — same precondition as runComplete: the loop's completion path
  // must not be a way AROUND the dark-axis requirement (it exists so the loop's ready→done flip
  // records a GateEvent instead of writing status directly; a flip that skipped this check would be
  // exactly the L_T-only judgment ADR-007 forbids). No-op unless the workspace declares ADR-007.
  const darkAxisFail = await enforceDarkAxis({ client, id, logPath, actor, workspaceRoot });
  if (darkAxisFail) return darkAxisFail;

  const meter = (task.extra as Record<string, unknown>)?.acceptance;
  const hasMeter = typeof meter === "string" && meter.trim() !== "";
  let acceptanceReason = verifiedBy ?? "loop verification";
  if (hasMeter) {
    const gate = await runGate({ client, id, gate: "acceptance", logPath, actor, workspaceRoot });
    acceptanceReason = gate.reason;
    if (!gate.ok) {
      console.log(`FAIL — ${gate.reason}`);
      // @deprecated — process.exitCode set for CLI backward-compat; MCP callers should
      // read the returned exitCode field and reset process.exitCode after the call.
      process.exitCode = 1;
      return { ok: false, reason: gate.reason, exitCode: 1 };
    }
  }

  await client.taskWrite({ id, status: TASK_STATUS.DONE, expectedStatus: TASK_STATUS.READY });
  appendGateEvent(
    logPath,
    mkLifecycleEvent({
      id,
      gate: "complete",
      actor,
      verdict: "pass",
      payload: { from: TASK_STATUS.READY, to: TASK_STATUS.DONE, ...(verifiedBy ? { verifiedBy } : {}) },
    })
  );
  console.log("PASS — status=done (loop)");
  return { ok: true, reason: acceptanceReason, exitCode: 0 };
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
export async function runPromote({ client, id, logPath, actor = "quay-cli", workspaceRoot }: LifecycleArgs): Promise<PromoteResult> {
  const task = await client.taskGet(id);
  if (!task) throw new Error(`no such task: ${id}`);
  assertTransition(task.status, "forward");
  const next = legalForward(task.status);

  if (task.status === TASK_STATUS.READY) {
    const r = await runComplete({ client, id, logPath, actor, workspaceRoot });
    return { ...r, to: r.ok ? TASK_STATUS.DONE : null };
  }

  // todo→ready: the author gate.
  const { ok, reason } = await runGate({ client, id, gate: "dod", logPath, actor, workspaceRoot });
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
 * The `**RETREATED` / 搁置 marker (tasks/gap-retreated-state-not-mechanized) — the mechanical
 * "retreated / shelved" state a task carries after a retreat (load-induced red rollback that must
 * NOT be re-dispatched until the fix-scope gate lands and the marker is removed — 解除搁置).
 *
 * The DETECTION side lives in the plugin: plugin/scripts/ready-pool-check.ts defines the canonical
 * `RETREATED_MARKER_RE` (which slot-refill.ts reuses — single source, no parallel copy within the
 * plugin). THIS module is the WRITE side. Core stays dependency-free (engine.ts:23 — the Core
 * package must not import the plugin), so the detection anchor is reproduced here, NOT imported —
 * the writer's output must satisfy exactly the same line-start bold `**RETREATED` (optional
 * blockquote) anchor the reader tests. Position-based (hard-rule ②): only the bold line-start
 * MARKER matches — a prose mention of "retreated" is not a marker.
 */
export const RETREATED_MARKER_RE = /^\s*(?:>\s*)?\*\*RETREATED\b/im;

/** Prepend the `**RETREATED` / 搁置 marker to a task body (every retreat is a shelve — the reason
 *  is the retreat's deliverable, carried inline for traceability). Fail-open on non-string: a
 *  retreat still flips status; marking is best-effort over a present body, exactly like
 *  uncheckAcBoxes. Idempotent: a body already carrying the marker is returned unchanged (a
 *  re-retreat must not stack duplicate marker lines). */
function addRetreatedMarker(body: string, reason: string): string {
  if (typeof body !== "string") return body;
  if (RETREATED_MARKER_RE.test(body)) return body;
  // Collapse the reason to a single line — a retreat reason is user prose; newlines would break the
  // line-start marker anchor (the reader's `^` is per-line).
  const oneLine = reason.replace(/\s+/g, " ").trim();
  const marker = `> **RETREATED / 搁置（${oneLine}）**`;
  return `${marker}\n\n${body.replace(/^\s+/, "")}`;
}

/**
 * Uncheck every checked box in the task's `## Acceptance Criteria` section
 * (`- [x]` / `- [X]` → `- [ ]`) — the retreat done→ready semantic
 * (gap-not-yet-flipped-blocks-retreated-ac83-class). A retreat rolls a task
 * back from done; its ACs must reflect that its completion claim is void, so
 * slot-refill's not-yet-flipped guard (merged + AC>50% ⇒ landed ⇒ don't
 * re-dispatch) doesn't keep re-judging a retreated task as landed on stale
 * completion checkboxes.
 *
 * Recognizes the shape-aware AC heading family (the same forms the author→ready
 * gate accepts): `## AC`, `## AC（draft）`, `## AC (draft)`,
 * `## Acceptance Criteria`. A body with an unrecognized AC heading is returned
 * UNCHANGED (fails open — retreat still flips status; unchecking is best-effort
 * over recognized shapes, exactly like the gate's own shape dispatch).
 */
function uncheckAcBoxes(body: string): string {
  // Guard: task bodies are always strings on real Tasks, but stub/test clients
  // may construct a task without a `body` field — fail open (return as-is).
  if (typeof body !== "string") return body;
  const lines = body.split("\n");
  let inAc = false;
  const out: string[] = new Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line)) {
      inAc = /^##\s+(?:AC(?:（[^）]*）| \([^)]*\))?|Acceptance Criteria)\s*$/.test(line);
      out[i] = line;
      continue;
    }
    if (inAc && /^\s*-\s+\[[xX]\]/.test(line)) {
      out[i] = line.replace(/^(\s*-\s+)\[[xX]\]/, "$1[ ]");
      continue;
    }
    out[i] = line;
  }
  return out.join("\n");
}

/**
 * `quay retreat <task> --reason <r>` — one legal backward step over TRANSITIONS.
 * `--reason` is REQUIRED (it IS the deliverable of a retreat): missing/empty →
 * exit 1, no write. Illegal back edge → throws. No gate runs — retreat rolls
 * back regardless; the reason is recorded in the payload.
 *
 * AC83 (gap-not-yet-flipped-blocks-retreated-ac83-class): a done→ready retreat
 * ALSO unchecks the task's AC checkboxes — the retreat must not leave the body
 * "claiming" completion (e.g. AC 89% from fixture-injected evidence) when the
 * task is rolled back for re-verification. Only the done→ready edge touches
 * ACs; ready→todo / needs-human→todo roll back before completion, so their
 * (normally unchecked) ACs are left alone.
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

  const baseBody = task.status === TASK_STATUS.DONE ? uncheckAcBoxes(task.body) : task.body;
  // RETREATED WRITE SIDE (tasks/gap-wiring-C-retreat-write-side): the done→ready retreat writes the
  // `**RETREATED` / 搁置 marker (gap-retreated-state-not-mechanized) — the mechanical signal the
  // detection side (ready-pool-check `isRetreated` / slot-refill step-4 defer "retreated") reads.
  // A done→ready retreat leaves the task READY (a dispatch candidate) but SHELVED; the marker is
  // what keeps it out of dispatch until 解除搁置 (removing the marker line). Before this wiring the
  // write side was missing: 0 task files carried the marker and the detection side never saw a real
  // retreat. done→ready ALSO unchecks AC boxes (AC83). ready→todo / needs-human→todo roll back to
  // todo (NOT a dispatch candidate) so they write NO marker and NO body patch — retreat body
  // mutations stay edge-scoped (retreat-ac-uncheck.test.mjs pins ready→todo as a no-body-patch
  // edge; a non-shelved re-triage must be dispatchable again once re-promoted to ready).
  const body = task.status === TASK_STATUS.DONE ? addRetreatedMarker(baseBody, reason) : baseBody;
  await client.taskWrite({
    id,
    status: prev!,
    expectedStatus: task.status,
    ...(body !== task.body ? { body } : {}),
  });
  appendGateEvent(
    logPath,
    mkLifecycleEvent({ id, gate: "retreat", actor, verdict: "pass", payload: { from: task.status, to: prev, reason } })
  );
  console.log(`RETREAT ${task.status} → ${prev} (${reason})`);
  return { ok: true, to: prev, exitCode: 0 };
}

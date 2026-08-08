// supervisor-preempt-candidates.ts — the supervisor base layer's PREEMPTION CRITERION
// (tasks/gap-supervisor-step-4-preemption, 落地次序 step ④; SPEC-integration-architecture §4.4 #4).
//
// This module turns the supervisor's preemption criterion into a QUERYABLE-FACTS predicate, and
// the preemption ACTION into a deterministic composition of ALREADY-VALIDATED capabilities
// (AC5 — zero new invention):
//
//   * duration      → fast-mode-telemetry.ts's aggregate()/readAllEvents() (the telemetry bracket's
//                     startedAtMs is the authoritative "when did this task start" fact)
//   * no-progress   → inner-blocked-signal.ts's taskStatusAllowsOver90m() — the task's OWN status
//                     frontmatter is still `in-progress` (or the file is missing): "ledger 确认无
//                    真实推进" — the same gate gap-over-90m crystallized
//   * slot/landed   → reconcileInFlight() with makeOver90ExecutorGone() — a task whose work LANDED
//                     (branch merged / merge record) is done, not stuck; everything else is a
//                     legitimate preemption candidate (a genuine >90m no-progress task)
//   * process       → findExecutorPids() scans /proc for the runId needle (the same probe
//                     fast-mode-telemetry's processAlive() uses) — the ACTION targets only that
//                     task's own process group(s)
//
// OFF-LIMITS CRITERION (AC1): no line here reads task CONTENT (Proposal / Plan / AC / DoD body).
// The only task-file access is the `status` frontmatter field — a mechanical scalar, the same
// queryable fact gap-over-90m reads. A line that would need to "understand what a task is about"
// is overreach and must not be added.
//
// Boundary (AC4): performPreempt kills ONLY the process group(s) whose cmdline carries this
// task's runId needle — never `pkill`, never `kill-server`, never a blanket signal. A process in
// another project/session (different runId, different process group) is untouched by construction.
//
// Usage:
//   node --experimental-strip-types supervisor-preempt-candidates.ts --list --root <dir>
//       stdout: `preemptible: <count>` then one line per preemptible task. PURE READ.
//   node --experimental-strip-types supervisor-preempt-candidates.ts --preempt --taskId <id> --root <dir>
//       [--dry-run] [--grace-ms <ms>] [--ledger <path>]
//       Preempt one task: kill its subprocess tree + close its telemetry bracket + append a ledger
//       event. exit 0 = preempted, 1 = task not preemptible, 2 = usage.
//
// Test: plugin/test/supervisor-preempt-candidates.test.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";
import {
  readAllEvents,
  aggregate,
  reconcileInFlight,
  buildEndEvent,
  writeEvent,
  findRepoRoot,
} from "./fast-mode-telemetry.ts";
import {
  TASK_OVER_90M_MS,
  taskStatusAllowsOver90m,
  makeOver90ExecutorGone,
} from "./inner-blocked-signal.ts";

/** Fixed filename of the preemption ledger (sibling of the bus ledger, same gitignored `.quay/`). */
export const PREEMPT_LEDGER_FILENAME = "supervisor-preempt-ledger.jsonl";

/**
 * The preemption criterion — pure, injected-probe testable. Returns the set of tasks that are
 * deterministically preemptible RIGHT NOW, driven ONLY by queryable facts:
 *   1. a telemetry in-progress bracket (the slot/start fact);
 *   2. `nowMs − startedAtMs > TASK_OVER_90M_MS` (the DURATION fact — over the 90-minute budget);
 *   3. `taskStatusAllowsOver90m` — the task's own status is still `in-progress` (or the file is
 *      missing): no real progress has landed (the no-progress fact, same gate as gap-over-90m);
 *   4. the reconcile probe does NOT close it — a merged/landed task is done, not stuck.
 * @param {string} root
 * @param {object} [opts]
 * @param {number} [opts.nowMs]
 * @param {(rec: {taskId:string, runId:string, startedAtMs:number}) => {gone:boolean, reason?:string|null}} [opts.executorGone]
 *   — injected observable-executor probe (tests); default makeOver90ExecutorGone(root).
 * @returns {Promise<{preemptible: Array<{taskId:string, runId:string, startedAtMs:number, minutes:number, keepReason:string|null, reason:string}>, count:number}>}
 */
export async function listPreemptible(root, { nowMs = Date.now(), executorGone } = {}) {
  const events = [];
  for await (const e of readAllEvents(root)) events.push(e);
  const rep = aggregate(events, { nowMs });
  if (rep.inProgress.length === 0) return { preemptible: [], count: 0 };
  const probe = executorGone ?? makeOver90ExecutorGone(root);
  const { kept } = reconcileInFlight(rep.inProgress, { executorGone: probe });
  const preemptible = kept
    .filter((p) => nowMs - p.startedAtMs > TASK_OVER_90M_MS && taskStatusAllowsOver90m(root, p.taskId))
    .map((p) => ({
      taskId: p.taskId,
      runId: p.runId,
      startedAtMs: p.startedAtMs,
      minutes: Number(((nowMs - p.startedAtMs) / 60_000).toFixed(1)),
      keepReason: p.keepReason ?? null,
      reason: "timeout-no-progress",
    }))
    .sort((a, b) => a.taskId.localeCompare(b.taskId) || a.runId.localeCompare(b.runId));
  return { preemptible, count: preemptible.length };
}

/**
 * Find the preemptible candidate for one taskId (null when the task is NOT preemptible — the
 * positive-control shape: an actively-progressing task is rejected/ignored).
 * @param {string} root
 * @param {string} taskId
 * @param {object} [opts]
 * @returns {Promise<{taskId:string, runId:string, startedAtMs:number, minutes:number, keepReason:string|null, reason:string} | null>}
 */
export async function findPreemptibleCandidate(root, taskId, opts = {}) {
  const { preemptible } = await listPreemptible(root, opts);
  return preemptible.find((p) => p.taskId === taskId) ?? null;
}

/**
 * Scan /proc for processes whose cmdline carries this runId's needle — the SAME probe
 * fast-mode-telemetry's `processAlive` uses — but returns concrete {pid, pgid} pairs so the
 * ACTION can signal exactly those process groups. Empty array when no matching process is present.
 * @param {string} runId
 * @returns {Array<{pid:number, pgid:number}>}
 */
export function findExecutorPids(runId) {
  if (!runId || String(runId).length < 4) return [];
  const parts = String(runId).split("-");
  const needle = parts.length >= 2 ? parts.slice(-2).join("-") : String(runId);
  if (needle.length < 4) return [];
  let pids;
  try {
    pids = fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d));
  } catch {
    return [];
  }
  const out = [];
  for (const pidStr of pids) {
    try {
      const cmd = fs.readFileSync(`/proc/${pidStr}/cmdline`, "utf8").replace(/\0/g, " ");
      if (!cmd.includes(needle)) continue;
      const pid = Number(pidStr);
      let pgid = pid;
      try {
        // /proc/<pid>/stat: `pid (comm) state ppid pgrp session ...` — after the closing paren
        // of comm, field index 2 (0-based) is pgrp.
        const stat = fs.readFileSync(`/proc/${pidStr}/stat`, "utf8");
        const close = stat.lastIndexOf(")");
        const fields = close >= 0 ? stat.slice(close + 1).trim().split(/\s+/) : [];
        const pgrp = fields[2];
        if (pgrp && /^\d+$/.test(pgrp) && Number(pgrp) > 0) pgid = Number(pgrp);
      } catch {
        /* keep pgid = pid */
      }
      out.push({ pid, pgid });
    } catch {
      /* pid exited mid-scan */
    }
  }
  return out;
}

/**
 * Kill one process group (the subprocess tree bound to that group). SIGINT first (graceful — lets
 * the target tee up state), then SIGKILL after `graceMs`. This is the process-level equivalent of
 * `tmux kill-session -t <name>` (never `kill-server`): the group bound is the TARGET's own — a
 * process in another group (another project/session) is untouched (AC4 boundary).
 * @param {number} pgid
 * @param {number} [graceMs]
 * @returns {{signaled:boolean, killed:boolean}}
 */
export function killProcessGroup(pgid, graceMs = 150) {
  let signaled = false;
  let killed = false;
  try {
    process.kill(-pgid, "SIGINT");
    signaled = true;
  } catch {
    /* already gone */
  }
  if (graceMs > 0 && signaled) {
    // Sync sleep (Atomics.wait on a throwaway SAB) — never a busy spin.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, graceMs);
  }
  try {
    process.kill(-pgid, "SIGKILL");
    killed = true;
  } catch {
    killed = signaled; // SIGINT already took it down
  }
  return { signaled, killed };
}

/**
 * Append one preemption record to the pure-append ledger (`.quay/supervisor-preempt-ledger.jsonl`
 * by default). Never parses/re-reads the ledger — append only, the same shape as the bus ledger.
 * @param {string} ledgerPath
 * @param {object} record
 */
export function appendPreemptLedger(ledgerPath, record) {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, JSON.stringify(record) + "\n", "utf8");
}

/** Sync sleep helper (Atomics.wait). @param {number} ms */
function sleepMs(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Perform the deterministic preemption ACTION for one task:
 *   1. gate — the task must be in the preemptible set (queryable facts only). A task that is NOT
 *      over-budget / NOT status-in-progress / already landed is REJECTED (AC3 positive control:
 *      an actively-progressing task's preemption call is ignored).
 *   2. kill — signal the process group(s) whose cmdline carries the task's runId (AC2/AC4).
 *   3. close bracket — write a schema-valid telemetry end event (outcome "abandoned",
 *      reconcileReason "preempted") so the record leaves inProgress (AC2).
 *   4. ledger — append a pure-append ledger record {preemptedAtMs, taskId, runId, killedPids,
 *      outcome, reconcileReason, boundary} (AC2).
 * @param {string} root
 * @param {string} taskId
 * @param {object} [opts]
 * @param {number} [opts.nowMs]
 * @param {boolean} [opts.dryRun]
 * @param {number} [opts.graceMs]
 * @param {string|null} [opts.ledgerPath]
 * @param {(rec: {taskId:string, runId:string, startedAtMs:number}) => {gone:boolean, reason?:string|null}} [opts.executorGone]
 * @returns {Promise<object>}
 */
export async function performPreempt(
  root,
  taskId,
  { nowMs = Date.now(), dryRun = false, graceMs = 150, ledgerPath = null, executorGone } = {},
) {
  const cand = await findPreemptibleCandidate(root, taskId, { nowMs, executorGone });
  if (!cand) {
    return { ok: false, reason: "not-preemptible", taskId };
  }
  const pids = findExecutorPids(cand.runId);
  const pgids = [...new Set(pids.map((p) => p.pgid))];
  const killed = pgids.map((g) => ({ pgid: g, ...killProcessGroup(g, dryRun ? 0 : graceMs) }));

  const record = {
    preemptedAtMs: nowMs,
    taskId: cand.taskId,
    runId: cand.runId,
    minutes: cand.minutes,
    killedPids: pids.map((p) => p.pid),
    outcome: "abandoned",
    reconcileReason: "preempted",
    boundary: "process-group-of-runId",
  };

  const ledger = ledgerPath ?? path.join(root, ".quay", PREEMPT_LEDGER_FILENAME);

  if (!dryRun) {
    // Close the bracket: a schema-valid end event, routed to `reconciled[]` via reconcileReason.
    const ev = buildEndEvent({
      taskId: cand.taskId,
      runId: cand.runId,
      outcome: "abandoned",
      executionCwd: root,
      baseCommit: null,
      recordedAtMs: Date.now(),
      reconcileReason: "preempted",
    });
    writeEvent(ev, root);
    appendPreemptLedger(ledger, record);
  }

  return {
    ok: true,
    taskId: cand.taskId,
    runId: cand.runId,
    minutes: cand.minutes,
    dryRun,
    pids: pids.map((p) => p.pid),
    pgids,
    killed,
    bracketClosed: dryRun ? "dry-run" : true,
    ledger,
    record,
  };
}

function getArgValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

/**
 * CLI main.
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const args = argv.slice(2);
  const root = getArgValue(args, "--root") ?? findRepoRoot();
  const dryRun = args.includes("--dry-run");

  if (args.includes("--list") || args.includes("--list-preemptible") || args.includes("list-preemptible")) {
    const { preemptible, count } = await listPreemptible(root);
    console.log(`preemptible: ${count}`);
    for (const p of preemptible) {
      console.log(`  ${p.taskId}  ${p.runId}  ${p.minutes.toFixed(1)} min  ${p.reason}`);
    }
    return 0;
  }

  if (args.includes("--preempt") || args.includes("preempt-task")) {
    const taskId = getArgValue(args, "--taskId") ?? getArgValue(args, "--task") ?? args[args.indexOf("--preempt") + 1];
    if (!taskId) {
      console.error("supervisor-preempt-candidates: --preempt requires --taskId <id>");
      return 2;
    }
    const graceArg = getArgValue(args, "--grace-ms");
    const graceMs = graceArg !== undefined && Number.isFinite(Number(graceArg)) ? Number(graceArg) : 150;
    const ledgerPath = getArgValue(args, "--ledger") ?? null;
    const res = await performPreempt(root, taskId, { dryRun, graceMs, ledgerPath });
    if (!res.ok) {
      console.log(`preempt-task: ${taskId} NOT preemptible (${res.reason})`);
      return 1;
    }
    if (dryRun) {
      console.log(`preempt-task: [dry-run] would preempt ${taskId} (runId ${res.runId}, ${res.minutes} min, pids ${res.pids.join(",") || "none"})`);
    } else {
      console.log(`preempt-task: preempted ${taskId} (runId ${res.runId}, ${res.minutes} min)`);
      console.log(`  killed pgids: ${res.pgids.join(",") || "none (no matching process — bracket closed + ledger recorded)"}`);
      console.log(`  bracket closed: outcome=abandoned reconcileReason=preempted`);
      console.log(`  ledger: ${res.ledger}`);
    }
    return 0;
  }

  console.error(`supervisor-preempt-candidates: usage: --list [--root <dir>] | --preempt --taskId <id> [--root <dir>] [--dry-run] [--grace-ms <ms>] [--ledger <path>]`);
  return 2;
}

if (isDirectEntry(import.meta)) {
  main(process.argv).then((code) => process.exit(code));
}

#!/usr/bin/env node
// worker-fan-in-hooks.ts — the CROSS-CUTTING-STEP extension point of the mechanical fan-in.
// (tasks/gap-worker-fan-in-cross-cutting-hooks-not-covered-by-extension-point)
//
// THE DEFECT THIS EXISTS FOR. GOAL-909's `WorkerPool` extension point (AC-915) opened one axis:
// "a new OUTCOME-HANDLING unit can be registered from outside". Measured 2026-10-22 over the
// `worker-post-909` window (`024f9d7f2..HEAD`, baseline = the AC-915 landing), the centre files
// (`worker-driver.ts` + `worker-fan-in.ts`) still took 288 of the 307 newly added lines (93.8%).
// The two commits behind that growth — `e53aa1d3d` (slice-readings wiring) and the dark-axis
// predicate (`d88ad2db8`, `80d75e886`) — are NOT outcome-handling variants. They are
// CROSS-CUTTING steps that straddle the flip: they run immediately BEFORE `flipTaskDone`, or
// immediately AFTER it. The `WorkerPool` registry has no slot for that axis, so each one had to be
// written straight into `worker-fan-in.ts`. Same shape in a second code base (claudecodeui, same
// day): its driver refactor opened a registry for READINGS (leaves) while the orchestration SPINE
// (`startHost` / `bind` / `submit` / `interrupt`) stayed hard-wired, so `methodCount` sat at 86 and
// `outDegree` at 187. "扩展点只盖叶子、不盖主干" — two code bases, two systems, one shape.
//
// WHY A PHASE-ORDERED TABLE AND NOT "EXTRACT A FEW FUNCTIONS". R1 (extraction) leaves the ORDER in
// the centre, so the next cross-cutting step still edits the centre and the out-degree still climbs.
// Here the PHASE is the extension datum: a hook declares `phase: "pre-flip" | "post-flip"`, the
// runner walks `PHASE_ORDER`, and the centre names NO hook. Adding a third step is a `register` call
// in a leaf module — zero edits to `worker-fan-in.ts`.
//
// ⛔ THIS MODULE IS A LEAF: it imports nothing from `worker-fan-in.ts` (import-graph-check's
// `valueSccs` must stay flat). Everything it needs from the centre arrives through `FanInHookContext`
// (kernel sibling resolution, the two trace sinks). That is why the centre can re-export this
// module's dark-axis helpers for the existing test import face without creating a value cycle.
//
// FOUR-STATE DISCIPLINE (硬规则 3b): a hook's result is `{ ok }`, never "the hook exists". The
// positive arm of this task's acceptance is a COUNT (`triggered=1`), and an unregistered hook reads
// `triggered=0` — an absent hook and a broken dispatcher are distinguishable (`listFanInHooks()`).

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { classifyDarkAxisRecord, taskBodyOf, type DarkAxisVerdict } from "./dark-axis-record-check.ts";
import { workspaceEnforcesDarkAxis } from "../../packages/quay/src/gate/lifecycle.ts";

// ── The phase vocabulary (ONE definition — the runner, the built-ins and the tests share it) ──────

export const PHASE_ORDER = ["pre-flip", "post-flip"] as const;
export type FanInHookPhase = (typeof PHASE_ORDER)[number];

/** What a hook may return. `ok:false` REFUSES the flip; `reason` is carried into the fan-in verdict
 *  verbatim (the centre does `failClean(hook.name, reason)`). */
export interface FanInHookResult {
  ok: boolean;
  reason?: string | null;
  /** Structured readings for the hook's own step trace (never a place for the verdict). */
  details?: Record<string, unknown>;
}

/** Everything a hook gets from the centre. ⛔ No hook reaches back into the centre module — the
 *  capabilities below are the whole interface (this is what keeps the import graph acyclic). */
export interface FanInHookContext {
  root: string;
  task: string;
  worktree: string;
  mergeTarget: string;
  runId: string;
  /** Test seam forwarded from `MechanicalFanInOptions.darkAxisTaskFile` (production never sets it). */
  darkAxisTaskFile?: string;
  /** `["node", ...kernelSiblingArgv(name)]` — kernel resolution stays in ONE place (the centre). */
  spawnNodeSibling: (name: string) => string[];
  /** `.quay/fan-in-step-trace.jsonl` (the shared, cross-task carrier). */
  traceStep: (step: string, phase: "begin" | "end", extra?: Record<string, unknown>) => void;
  /** `.quay/fan-in-<task>-<runId>.log` (the per-run process log the web details page reads). */
  trace: (entry: Record<string, unknown>) => void;
  /** Both carriers at once (the suite/observation event shape). */
  traceSuiteEvent: (step: string, extra: Record<string, unknown>) => void;
}

export interface FanInHook {
  /** Stable identity: the fan-in step name a refusal is reported under. */
  name: string;
  phase: FanInHookPhase;
  run: (ctx: FanInHookContext) => FanInHookResult | Promise<FanInHookResult>;
}

export interface FanInHookExecution {
  name: string;
  phase: FanInHookPhase | "flip";
  ok: boolean;
  ms: number;
}

/** The runner's verdict. `step` is the name of the hook that refused (or `"flip-done"`). */
export interface FanInHookRun {
  ok: boolean;
  phase: FanInHookPhase | null;
  step: string | null;
  reason: string | null;
  executed: FanInHookExecution[];
}

// ── The registry: an ORDERED step table. Position IS the phase; insertion order inside a phase. ───

const registry: FanInHook[] = [];

/**
 * Register one cross-cutting step. Returns an unregister handle — tests use it instead of clearing
 * the whole table, so a test can never silently take the built-ins down with it.
 * A duplicate name is a programming error, not a replacement: silently overwriting would make
 * "the built-in is gone" and "the built-in still runs" indistinguishable at the call site.
 */
export function registerFanInHook(hook: FanInHook): () => void {
  if (registry.some((h) => h.name === hook.name)) {
    throw new Error(`registerFanInHook: a hook named "${hook.name}" is already registered`);
  }
  registry.push(hook);
  return () => {
    const i = registry.findIndex((h) => h.name === hook.name);
    if (i >= 0) registry.splice(i, 1);
  };
}

/** The registrations, in run order. A probe that is absent here is a NEGATIVE reading (count 0). */
export function listFanInHooks(): Array<{ name: string; phase: FanInHookPhase }> {
  return PHASE_ORDER.flatMap((p) => registry.filter((h) => h.phase === p)).map((h) => ({ name: h.name, phase: h.phase }));
}

/**
 * THE RUNNER — the centre's ONLY entry point into this extension point.
 *
 * Walks `PHASE_ORDER`; between the phases it calls `flip()` exactly once. The flip is not a hook:
 * the phases are defined RELATIVE to it, so it is the runner's fixed middle, not a registration.
 */
export async function runFanInHooks(
  ctx: FanInHookContext,
  flip: () => Promise<{ ok: boolean; reason?: string | null }>,
): Promise<FanInHookRun> {
  const executed: FanInHookExecution[] = [];
  for (const phase of PHASE_ORDER) {
    for (const hook of registry.filter((h) => h.phase === phase)) {
      const t0 = Date.now();
      let res: FanInHookResult;
      try {
        res = await hook.run(ctx);
      } catch (e) {
        // A throwing hook is a REFUSAL with its own reason, never a silent skip (硬规则 3b).
        res = { ok: false, reason: `hook "${hook.name}" threw: ${(e as Error)?.message ?? String(e)}` };
      }
      executed.push({ name: hook.name, phase, ok: res.ok, ms: Date.now() - t0 });
      if (!res.ok) {
        return { ok: false, phase, step: hook.name, reason: res.reason ?? `hook "${hook.name}" refused`, executed };
      }
    }
    if (phase === "pre-flip") {
      const flipped = await flip();
      executed.push({ name: "flip-done", phase: "flip", ok: flipped.ok, ms: 0 });
      if (!flipped.ok) {
        return { ok: false, phase, step: "flip-done", reason: flipped.reason ?? "flip failed", executed };
      }
    }
  }
  return { ok: true, phase: null, step: null, reason: null, executed };
}

// ── Built-in hook 1/2 — dark-axis predicate (PRE-flip) ───────────────────────────────────────────
//
// MOVED VERBATIM (behaviour unchanged) out of `worker-fan-in.ts`, where it was one of the two
// measurements behind this task's 93.8% reading. Ref: gap-mechanical-fan-in-flip-bypasses-adr007-
// dark-axis-predicate. The predicate's only other enforcement points are the lifecycle verbs
// (`runComplete`/`runCompleteLoop`/`runCompleteOutOfBand` → `enforceDarkAxis`); the PRODUCTION
// landing path is the mechanical flip, which patches frontmatter itself and never traverses them.
// ⛔ NOT a second implementation: `classifyDarkAxisRecord` is Core's single judgment and
// `taskBodyOf` is the CLI's single frontmatter stripper; the workspace switch is
// `workspaceEnforcesDarkAxis` — the SAME `gates.adr` declaration the ready→done verbs use.

/** The task-body classifier the mechanical flip uses, as a PATH-taking function so the AC3 evidence
 *  can drive it over a whole task population exactly as the CLI does.
 *
 *  A file that cannot be READ is `NOT-EVALUATED`, its own value (硬规则 3b): "could not look" must
 *  never wear the shape of a verdict about the body's content. This mirrors the CLI
 *  (`dark-axis-record-check.ts`: a missing task file ⇒ exit 2), which is why the two faces agree
 *  state-for-state over a read-only population (AC3). */
export function darkAxisVerdictForTaskFile(taskFile: string): DarkAxisVerdict {
  let text: string;
  try {
    text = fs.readFileSync(taskFile, "utf8");
  } catch (e) {
    return {
      state: "NOT-EVALUATED",
      readings: [],
      disclaimer: null,
      reason:
        `NOT-EVALUATED — the task body could not be read at ${taskFile}: ${(e as Error)?.message ?? String(e)}. ` +
        `An unreadable input is neither evidence of a record nor evidence of its absence (硬规则 3b).`,
    };
  }
  return classifyDarkAxisRecord(taskBodyOf(text));
}

/** The file the mechanical flip classifies: the WORKTREE's task file (the tree that is about to be
 *  merged), not the main checkout's copy — the body must be the one this landing carries. */
export function darkAxisTaskFileFor(worktree: string, task: string): string {
  return path.join(worktree, "tasks", `${task}.md`);
}

/** Map the four-state classification onto the gate ledger's three-value vocabulary
 *  (`GateVerdictKind`). ⛔ MISSING and NOT-EVALUATED stay DISTINGUISHABLE in the ledger: collapsing
 *  "nothing recorded" and "could not read" into one `fail` would recreate, one layer down, exactly
 *  the conflation `classifyDarkAxisRecord` was built to avoid (硬规则 3b). */
function darkAxisLedgerVerdict(state: DarkAxisVerdict["state"]): "pass" | "fail" | "not-evaluated" {
  if (state === "RECORDED" || state === "DISCLAIMED") return "pass";
  return state === "NOT-EVALUATED" ? "not-evaluated" : "fail";
}

/** Append the `dark-axis` GateEvent for ONE mechanical-flip judgment — via the SAME gate-event store
 *  the CLI/loop/complete writer uses (⛔ never a hand-rolled JSONL append). The event is what turns
 *  "complete / dark-axis ratio" into a directly readable quantity, so unlike the `complete` event
 *  (written after landing, where a failure must not block) this one is a PRECONDITION: its caller
 *  treats a write failure as a refusal to flip — a judgment that leaves no trace is
 *  indistinguishable from no judgment. actor is `quay-driver` (the fan-in's own identity, matching
 *  `appendCompleteGateEvent`'s default). */
export async function appendDarkAxisGateEvent(
  root: string,
  task: string,
  verdict: DarkAxisVerdict,
  ctx: { runId?: string } = {},
): Promise<{ ok: boolean; reason: string | null }> {
  try {
    const { appendGateEvent } = await import(
      "../../packages/quay/src/gate/gate-event-store.ts"
    ) as { appendGateEvent: (logPath: string, event: unknown) => void };
    appendGateEvent(path.join(root, ".quay", "gate-events.jsonl"), {
      id: randomUUID(),
      item_id: task,
      pipeline_id: task,
      gate: "dark-axis",
      actor: "quay-driver",
      verdict: darkAxisLedgerVerdict(verdict.state),
      timestamp: new Date().toISOString(),
      payload: {
        state: verdict.state,
        reason: `dark-axis (ADR-007 per-milestone predicate): ${verdict.reason}`,
        step: "mechanical-fan-in",
        ...(ctx.runId ? { runId: ctx.runId } : {}),
      },
    });
    return { ok: true, reason: null };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message ?? String(e) };
  }
}

/** PRE-flip built-in. RECORDED / DISCLAIMED ⇒ continue. MISSING ⇒ refuse, task stays `ready`.
 *  NOT-EVALUATED ⇒ refuse too, with its OWN reason (硬规则 3b) — never folded into MISSING, which
 *  would make "recorded nothing" and "could not read the record" the same failure.
 *  Every judgment leaves a `dark-axis` GateEvent (a write failure is itself a refusal). */
const darkAxisHook: FanInHook = {
  name: "dark-axis",
  phase: "pre-flip",
  async run(ctx) {
    if (!workspaceEnforcesDarkAxis(ctx.root)) {
      ctx.trace({
        step: "dark-axis-skip", exit: 0, wall_ms: 0, ok: true,
        reason: "workspace does not declare ADR-007 in gates.adr (workspaceEnforcesDarkAxis=false)",
      });
      return { ok: true, details: { skipped: true } };
    }
    const t0 = Date.now();
    ctx.traceStep("dark-axis", "begin");
    const taskFile = ctx.darkAxisTaskFile ?? darkAxisTaskFileFor(ctx.worktree, ctx.task);
    const verdict = darkAxisVerdictForTaskFile(taskFile);
    const event = await appendDarkAxisGateEvent(ctx.root, ctx.task, verdict, { runId: ctx.runId });
    const pass = verdict.state === "RECORDED" || verdict.state === "DISCLAIMED";
    const dur = Date.now() - t0;
    ctx.traceStep("dark-axis", "end", { ok: pass && event.ok, durationMs: dur, state: verdict.state, gateEvent: event.ok });
    ctx.trace({
      step: "dark-axis", exit: pass && event.ok ? 0 : 1, wall_ms: dur, ok: pass && event.ok,
      state: verdict.state,
      ...(pass && event.ok ? {} : { reason: event.ok ? `${verdict.state}: ${verdict.reason}` : `gate-event write failed: ${event.reason}` }),
    });
    // The ledger write is a PRECONDITION, not an observation: a judgment with no event cannot be
    // told apart from no judgment, which is the defect this step exists to close (⛔ fail-open).
    if (!event.ok) {
      return { ok: false, reason: `dark-axis GateEvent write failed: ${event.reason ?? "unknown"} — refusing the flip (an unrecorded judgment is not a judgment)` };
    }
    if (!pass) {
      return { ok: false, reason: `dark-axis (ADR-007 per-milestone predicate) refused the flip — ${verdict.state}: ${verdict.reason}` };
    }
    return { ok: true, details: { state: verdict.state } };
  },
};

// ── Built-in hook 2/2 — slice post reading (POST-flip) ───────────────────────────────────────────

/** fan-in 后的 slice post 读数（gap-slice-before-after-readings-at-dispatch-and-fanin）。
 *
 * WHY 在 flipTaskDone 之后、ff/cleanup 之前：post 必须读**合并树仍在世**的那棵树（develop 已并入
 * worktree，但 ff 还没把 worktree 拆掉）。这里是最后一个同时满足「树是合并后」「worktree 还在」的
 * 窗口；cleanup 之后只剩 `worktree-missing`（脚本会明说，⛔ 不回填主检出）。
 *
 * 前提：派发时的 baseline 已落盘（`.quay/slice-readings/<task>.json`）。没有 baseline 时**不 spawn**
 * ——一次没有基线的 post 无法绑定，只会写一条 `baseline-missing` 噪声记录。
 *
 * FAIL-OPEN（硬规则 12：观测不得成为落地的前置）：脚本缺失 / spawn 失败 / exit 3（NOT-EVALUATED）
 * 都不改本轮 fan-in 判定；读数与失败原因以一行 trace 落进 `.quay/fan-in-<task>-<runId>.log` 和
 * 共享 `.quay/fan-in-step-trace.jsonl`（指向 carrier 的一行指针）。脚本自身把 `evaluated:false` +
 * reason 写进 carrier（硬规则 3b），所以「没读到」不会与「delta=0」同形。 */
export function runSlicePostReading(
  root: string,
  task: string,
  worktree: string,
  spawnNodeSibling: (name: string) => string[],
): { ran: boolean; ok: boolean; evaluated: boolean | null; carrier: string | null; delta: Record<string, number | null> | null; reason: string | null } {
  if (process.env.QUAY_SLICE_READINGS === "0") return { ran: false, ok: true, evaluated: null, carrier: null, delta: null, reason: "disabled-by-env" };
  const carrier = path.join(root, ".quay", "slice-readings", `${task}.json`);
  if (!fs.existsSync(carrier)) return { ran: false, ok: true, evaluated: null, carrier: null, delta: null, reason: "no-baseline" };
  try {
    const argv = [...spawnNodeSibling("slice-readings.ts"), "--post", "--task-id", task, "--root", root, "--tree", worktree, "--json"];
    const [cmd, ...cmdArgs] = argv;
    const r = spawnSync(cmd, cmdArgs, { encoding: "utf8", timeout: 20 * 60_000, maxBuffer: 16 * 1024 * 1024 });
    const stdout = String(r.stdout ?? "").trim();
    let parsed: { evaluated?: unknown; reason?: unknown; delta?: unknown } | null = null;
    try {
      parsed = stdout === "" ? null : JSON.parse(stdout);
    } catch {
      parsed = null;
    }
    const evaluated = parsed !== null && typeof parsed.evaluated === "boolean" ? parsed.evaluated : null;
    const delta = parsed !== null && parsed.delta !== null && typeof parsed.delta === "object"
      ? (parsed.delta as Record<string, number | null>)
      : null;
    // exit 0 = evaluated; 3 = NOT-EVALUATED (a reading was written — still a useful trace); anything
    // else = the script itself did not produce a reading.
    const ok = r.status === 0 || r.status === 3;
    const reason =
      parsed !== null && typeof parsed.reason === "string" && parsed.reason !== ""
        ? parsed.reason
        : ok
          ? null
          : `slice-readings exited ${r.status ?? "?"}${r.stderr ? ` — ${String(r.stderr).split("\n").slice(-3).join(" ").trim()}` : ""}`;
    return { ran: true, ok, evaluated, carrier, delta, reason };
  } catch (e) {
    return { ran: false, ok: false, evaluated: null, carrier, delta: null, reason: `slice-post-spawn-failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** POST-flip built-in. FAIL-OPEN by contract: the reading is an observation, never a landing
 *  precondition (硬规则 12) — so this hook always returns `ok:true` and reports its state through
 *  the trace instead. */
const sliceReadingsPostHook: FanInHook = {
  name: "slice-readings-post",
  phase: "post-flip",
  run(ctx) {
    const t0 = Date.now();
    const post = runSlicePostReading(ctx.root, ctx.task, ctx.worktree, ctx.spawnNodeSibling);
    ctx.traceSuiteEvent("slice-readings-post", {
      wall_ms: Date.now() - t0,
      ok: post.ok && post.evaluated !== false,
      ran: post.ran,
      evaluated: post.evaluated,
      carrier: post.carrier,
      ...(post.reason !== null ? { reason: post.reason } : {}),
      ...(post.delta !== null ? { delta: post.delta } : {}),
    });
    return { ok: true, details: { ran: post.ran, evaluated: post.evaluated } };
  },
};

/** The built-in table. Registered at module load — i.e. OUTSIDE `worker-fan-in.ts`, which is the
 *  point of the whole exercise: the centre names none of these. */
export function installBuiltinFanInHooks(): string[] {
  const installed: string[] = [];
  for (const hook of [darkAxisHook, sliceReadingsPostHook]) {
    if (registry.some((h) => h.name === hook.name)) continue;
    registerFanInHook(hook);
    installed.push(hook.name);
  }
  return installed;
}

installBuiltinFanInHooks();

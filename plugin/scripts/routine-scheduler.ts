// routine-scheduler.mjs — DIR-051: the trigger logic for the loop-driver ROUTINE track. Pure,
// testable, and shipped WITH the plugin (${CLAUDE_PLUGIN_ROOT}/scripts/) so a consumer workspace can
// evaluate routine triggers without repo-local scripts (the DIR-049 lesson). Routines are declared in
// .quay/loop.yml `routines:` (validated by readLoopParams); this module decides which are DUE given
// the loop state. It NEVER dispatches or executes — the skill does that; this only answers "is it due".
//
// DIR-056: routines now support `probe: <name>` (new) in addition to `dispatch: <action>` (legacy).
// - probe:    look up ${CLAUDE_PLUGIN_ROOT}/probes/<name>.md → load spec → dispatch with objective prompt
// - dispatch: legacy magic-string action (preserved exactly — no behavior change)
// A routine with NEITHER probe nor dispatch is skipped with an error log (fail-closed for that routine,
// never for the loop).
//
// TWO-LAYER REWIRE (gap-probe-mechanism-dead-15-days-rewire-to-two-layer, 2026-08-06): the classic
// pipeline's `every(N)` used to fire on the retired ITERATION counter (ADR-022 deleted the milestone
// loop; two-layer fast mode has no iteration number). The trigger now fires on TWO-LAYER quantities:
//   - `every(N)`  → every N outer-loop TICKS (the cron-driven tick counter, orchestrator-loop-tick.md;
//                   the outer tick itself is time-paced, so every(N) is an N×tick-interval time cadence)
//   - `on(event)` → on a named event (unchanged)
// The CLI's `--iteration` flag is a deprecated alias for the new `--tick` counter (kept so the legacy
// loop-driver skill / run-routines workflow callers keep working); trigger LOGIC never reads an
// iteration concept anymore.
//
// Pure functions are exported and unit-tested; `main()` is a thin CLI over them.

import fs from "node:fs";
import { isDirectEntry } from "./gate-script-base.ts";

// ── parseTrigger ─────────────────────────────────────────────────────────────────────────────────
// "every(N)" → { kind: "every", n } ; "on(<event>)" → { kind: "on", event }. Throws on malformed
// (fail-closed — a routine with an unparseable trigger must never silently be treated as never/always).
// TWO-LAYER REWIRE: `every(N)` is the TICK-count trigger (every N outer-loop ticks), NOT the retired
// classic-loop iteration counter. The string grammar is unchanged (`every(N)` | `on(<event>)`), so
// readLoopParams' validation (packages/quay/src/loop-params.ts) stays in agreement.
export function parseTrigger(s) {
  const t = String(s).trim();
  let m = t.match(/^every\(\s*(\d+)\s*\)$/);
  if (m) {
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n < 1) throw new Error(`routine-scheduler: every(N) needs N>=1 (got ${m[1]})`);
    return { kind: "every", n };
  }
  m = t.match(/^on\(\s*([\w-]+)\s*\)$/);
  if (m) return { kind: "on", event: m[1] };
  throw new Error(`routine-scheduler: invalid trigger "${s}" — must be "every(N)" or "on(<event>)"`);
}

// ── isDue ────────────────────────────────────────────────────────────────────────────────────────
// state: { tick: number (>=0), event?: string }. every(N) fires when tick>0 and tick % N === 0
// (tick = the two-layer outer-loop tick counter). on(X) fires when state.event === X.
// Back-compat: if `state.tick` is absent but the legacy `state.iteration` is present (old
// loop-driver skill / run-routines workflow callers), the iteration value is read as the tick —
// trigger LOGIC no longer depends on any iteration concept.
export function isDue(trigger: any, state: { tick?: number; iteration?: number; event?: string } = {}) {
  const t = typeof trigger === "string" ? parseTrigger(trigger) : trigger;
  if (t.kind === "every") {
    const tickVal = state.tick !== undefined ? state.tick : state.iteration;
    const tick = Number(tickVal);
    return Number.isInteger(tick) && tick > 0 && tick % t.n === 0;
  }
  return state.event != null && state.event === t.event;
}

// ── dueRoutines ──────────────────────────────────────────────────────────────────────────────────
// routines: [{ name, trigger, dispatch?, probe? }]. Returns the subset whose trigger fires for
// `state`, in order. Validates that each due routine has at least one of dispatch/probe; logs an
// error and skips (never throws — the loop must never die from a bad routine entry).
export function dueRoutines(routines: any[], state: { tick?: number; iteration?: number; event?: string } = {}) {
  if (!Array.isArray(routines)) throw new Error("routine-scheduler: routines must be an array");
  return routines.filter((r) => isDue(r.trigger, state));
}

// ── resolveRoutineAction ─────────────────────────────────────────────────────────────────────────
// DIR-056: given a due routine, resolve what action to take.
// Returns: { kind: "dispatch", action: string }
//        | { kind: "probe", name: string, pluginRoot: string }
//        | { kind: "skip", reason: string }
// Never throws (fail-closed per routine, not per loop).
export function resolveRoutineAction(routine, pluginRoot) {
  const hasProbe = typeof routine.probe === "string" && routine.probe.trim();
  const hasDispatch = typeof routine.dispatch === "string" && routine.dispatch.trim();

  if (hasProbe) {
    // probe: takes priority; pluginRoot is required
    if (!pluginRoot || typeof pluginRoot !== "string") {
      return { kind: "skip", reason: `routine "${routine.name}": probe requires pluginRoot but none provided` };
    }
    return { kind: "probe", name: routine.probe.trim(), pluginRoot };
  }
  if (hasDispatch) {
    // legacy dispatch: path — exactly as before
    return { kind: "dispatch", action: routine.dispatch.trim() };
  }
  // neither — skip with error log
  return { kind: "skip", reason: `routine "${routine.name}": has neither 'probe' nor 'dispatch' — skipped (fix loop.yml)` };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
// Reads a routines JSON array + --tick N (the two-layer outer-loop tick counter) and/or --event X,
// prints the due routines (one per line). Exit 0 if any due (and lists them), 3 if none due (a
// distinct non-error signal so the caller can act), 2 on usage/parse error. The skill runs this each
// outer tick to decide what to fire.
//
// DIR-056: output line format:
//   DUE: <name> (<trigger>) → dispatch <action>       (legacy dispatch: path)
//   DUE: <name> (<trigger>) → probe <name>            (new probe: path)
//   SKIP: <name> (<trigger>) → <reason>               (neither dispatch nor probe)
function usage() { process.stderr.write("Usage: routine-scheduler.mjs [--tick N] [--iteration N (deprecated alias for --tick)] [--event X] [--plugin-root <dir>] <routines.json>\n"); }

export async function main(argv) {
  const args = argv.slice(2);
  const state: { tick?: number; iteration?: number; event?: string } = {};
  const files: string[] = [];
  let pluginRoot: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--tick") { state.tick = Number(args[++i]); continue; }
    if (args[i] === "--iteration") { state.iteration = Number(args[++i]); continue; } // DEPRECATED alias for --tick
    if (args[i] === "--event") { state.event = args[++i]; continue; }
    if (args[i] === "--plugin-root") { pluginRoot = args[++i]; continue; }
    files.push(args[i]);
  }
  if (files.length !== 1) { usage(); return 2; }
  if (!fs.existsSync(files[0])) { process.stderr.write(`ERROR: not found: ${files[0]}\n`); return 2; }
  let routines;
  try { routines = JSON.parse(fs.readFileSync(files[0], "utf8")); }
  catch (e) { process.stderr.write(`ERROR: not valid JSON: ${e.message}\n`); return 2; }
  let due;
  try { due = dueRoutines(routines, state); } catch (e) { process.stderr.write(`ERROR: ${e.message}\n`); return 2; }
  if (due.length === 0) { process.stdout.write("no routines due\n"); return 3; }
  for (const r of due) {
    const action = resolveRoutineAction(r, pluginRoot);
    if (action.kind === "dispatch") {
      process.stdout.write(`DUE: ${r.name} (${r.trigger}) → dispatch ${action.action}\n`);
    } else if (action.kind === "probe") {
      process.stdout.write(`DUE: ${r.name} (${r.trigger}) → probe ${action.name}\n`);
    } else {
      process.stderr.write(`SKIP: ${r.name} (${r.trigger}) → ${action.reason}\n`);
    }
  }
  return 0;
}

if (isDirectEntry(import.meta)) { main(process.argv).then((c) => process.exit(c)); }

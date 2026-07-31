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
// Pure functions are exported and unit-tested; `main()` is a thin CLI over them.

import fs from "node:fs";
import { isDirectEntry } from "./gate-script-base.ts";

// ── parseTrigger ─────────────────────────────────────────────────────────────────────────────────
// "every(N)" → { kind: "every", n } ; "on(<event>)" → { kind: "on", event }. Throws on malformed
// (fail-closed — a routine with an unparseable trigger must never silently be treated as never/always).
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
// state: { iteration: number (>=0), event?: string }. every(N) fires when iteration>0 and
// iteration % N === 0. on(X) fires when state.event === X.
export function isDue(trigger: any, state: { iteration?: number; event?: string } = {}) {
  const t = typeof trigger === "string" ? parseTrigger(trigger) : trigger;
  if (t.kind === "every") {
    const it = Number(state.iteration);
    return Number.isInteger(it) && it > 0 && it % t.n === 0;
  }
  return state.event != null && state.event === t.event;
}

// ── dueRoutines ──────────────────────────────────────────────────────────────────────────────────
// routines: [{ name, trigger, dispatch?, probe? }]. Returns the subset whose trigger fires for
// `state`, in order. Validates that each due routine has at least one of dispatch/probe; logs an
// error and skips (never throws — the loop must never die from a bad routine entry).
export function dueRoutines(routines: any[], state: { iteration?: number; event?: string } = {}) {
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
// Reads a routines JSON array + --iteration N and/or --event X, prints the due routines (one per line).
// Exit 0 if any due (and lists them), 3 if none due (a distinct non-error signal so the caller can act),
// 2 on usage/parse error. The skill runs this each iterate to decide what to fire.
//
// DIR-056: output line format:
//   DUE: <name> (<trigger>) → dispatch <action>       (legacy dispatch: path)
//   DUE: <name> (<trigger>) → probe <name>            (new probe: path)
//   SKIP: <name> (<trigger>) → <reason>               (neither dispatch nor probe)
function usage() { process.stderr.write("Usage: routine-scheduler.mjs [--iteration N] [--event X] [--plugin-root <dir>] <routines.json>\n"); }

export async function main(argv) {
  const args = argv.slice(2);
  const state: { iteration?: number; event?: string } = {};
  const files: string[] = [];
  let pluginRoot: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--iteration") { state.iteration = Number(args[++i]); continue; }
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

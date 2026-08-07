// routine-scheduler.ts — DIR-051: the trigger logic for the loop-driver ROUTINE track. Pure,
// testable, and shipped WITH the plugin (${CLAUDE_PLUGIN_ROOT}/scripts/) so a consumer workspace can
// evaluate routine triggers without repo-local scripts (the DIR-049 lesson). Routines are declared in
// .quay/config.yml `loop.routines:` / `.quay/loop.yml` `routines:` (validated by readLoopParams);
// this module decides which are DUE given the loop state. It NEVER dispatches or executes — the skill
// does that; this only answers "is it due".
//
// TRIGGERS — three kinds, aligned to quantities the TWO-LAYER fast mode actually has
// (gap-probe-mechanism-dead-15-days-rewire-to-two-layer; ADR-022 retired the classic iteration
// pipeline, so an iteration counter no longer exists):
//   every(N)      — iteration-count based (LEGACY back-compat; fires when the caller-supplied
//                    `--iteration` counter is a positive multiple of N — kept for the generic
//                    loop-driver skill / downstream workspaces; two-layer mode does NOT use it).
//   interval:<N>m — TIME based (two-layer quantity #1): fires when `now - lastRun(name) >= N` minutes.
//                    Requires `--last-run` state (`{ <name>: epochMs }`); never-ran => due.
//   on(<event>)   — EVENT based (two-layer quantity #2): fires when `--event X` matches.
// The two-layer tick itself supplies the cadence (inner tick 1200-1800s / outer cron */20): each tick
// runs this scheduler with `--now` + `--last-run`, and fires whatever is DUE. "Tick-count" (quantity
// #3) is the every(N) form with a caller-maintained counter.
//
// DIR-056: routines support `probe: <name>` (new) in addition to `dispatch: <action>` (legacy).
// - probe:    look up ${CLAUDE_PLUGIN_ROOT}/probes/<name>.md → load spec → dispatch with objective prompt
// - dispatch: legacy magic-string action (preserved exactly — no behavior change)
// A routine with NEITHER probe nor dispatch is skipped with an error log (fail-closed for that routine,
// never for the loop).
//
// Pure functions are exported and unit-tested; `main()` is a thin CLI over them.

import fs from "node:fs";
import { isDirectEntry } from "./gate-script-base.ts";

// ── parseTrigger ─────────────────────────────────────────────────────────────────────────────────
// "every(N)" → { kind: "every", n } ; "interval:<N>m" → { kind: "interval", minutes: N } ;
// "on(<event>)" → { kind: "on", event }. Throws on malformed (fail-closed — a routine with an
// unparseable trigger must never silently be treated as never/always).
export function parseTrigger(s) {
  const t = String(s).trim();
  let m = t.match(/^every\(\s*(\d+)\s*\)$/);
  if (m) {
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n < 1) throw new Error(`routine-scheduler: every(N) needs N>=1 (got ${m[1]})`);
    return { kind: "every", n };
  }
  m = t.match(/^interval:\s*(\d+)\s*m$/);
  if (m) {
    const minutes = Number(m[1]);
    if (!Number.isInteger(minutes) || minutes < 1) throw new Error(`routine-scheduler: interval:<N>m needs N>=1 (got ${m[1]})`);
    return { kind: "interval", minutes };
  }
  m = t.match(/^on\(\s*([\w-]+)\s*\)$/);
  if (m) return { kind: "on", event: m[1] };
  throw new Error(`routine-scheduler: invalid trigger "${s}" — must be "every(N)", "interval:<N>m", or "on(<event>)"`);
}

// ── isDue ────────────────────────────────────────────────────────────────────────────────────────
// state: { iteration?: number, event?: string, now?: number, lastRun?: number }.
//   every(N)     — fires when iteration > 0 and iteration % N === 0 (LEGACY iteration-based).
//   interval:<N>m — fires when now - lastRun >= N minutes; a routine that has NEVER run is DUE
//                  (lastRun missing/0 — first fire, so the track starts instead of waiting forever).
//   on(X)        — fires when state.event === X.
export function isDue(trigger: any, state: { iteration?: number; event?: string; now?: number; lastRun?: number } = {}) {
  const t = typeof trigger === "string" ? parseTrigger(trigger) : trigger;
  if (t.kind === "every") {
    const it = Number(state.iteration);
    return Number.isInteger(it) && it > 0 && it % t.n === 0;
  }
  if (t.kind === "interval") {
    const now = Number(state.now ?? Date.now());
    if (!Number.isFinite(now)) return false; // fail-closed: unparseable now → never due
    const lastRun = Number(state.lastRun);
    if (!Number.isFinite(lastRun) || lastRun <= 0) return true; // never ran → due (track starts)
    return now - lastRun >= t.minutes * 60_000;
  }
  return state.event != null && state.event === t.event;
}

// ── dueRoutines ──────────────────────────────────────────────────────────────────────────────────
// routines: [{ name, trigger, dispatch?, probe? }]. Returns the subset whose trigger fires for
// `state`, in order. `state.lastRun` is a per-routine map `{ <name>: epochMs }` (used by
// interval:<N>m triggers); the per-routine value is forwarded as `state.lastRun` to isDue.
export function dueRoutines(routines: any[], state: { iteration?: number; event?: string; now?: number; lastRun?: Record<string, number> } = {}) {
  if (!Array.isArray(routines)) throw new Error("routine-scheduler: routines must be an array");
  const lastRunMap = state.lastRun && typeof state.lastRun === "object" ? state.lastRun : {};
  return routines.filter((r) => isDue(r.trigger, { ...state, lastRun: lastRunMap[r.name] }));
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
// Reads a routines JSON array + trigger state (--iteration N and/or --event X, plus the two-layer
// TIME quantities --now <epoch-ms> and --last-run <json>), prints the due routines (one per line).
// Exit 0 if any due (and lists them), 3 if none due (a distinct non-error signal so the caller can act),
// 2 on usage/parse error. The skill runs this each tick/iterate to decide what to fire.
//
// DIR-056: output line format:
//   DUE: <name> (<trigger>) → dispatch <action>       (legacy dispatch: path)
//   DUE: <name> (<trigger>) → probe <name>            (new probe: path)
//   SKIP: <name> (<trigger>) → <reason>               (neither dispatch nor probe)
function usage() { process.stderr.write("Usage: routine-scheduler.mjs [--iteration N] [--event X] [--now <epoch-ms>] [--last-run <json>] [--plugin-root <dir>] <routines.json>\n"); }

export async function main(argv) {
  const args = argv.slice(2);
  const state: { iteration?: number; event?: string; now?: number; lastRun?: Record<string, number> } = {};
  const files: string[] = [];
  let pluginRoot: string | null = null;
  let lastRunPath: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--iteration") { state.iteration = Number(args[++i]); continue; }
    if (args[i] === "--event") { state.event = args[++i]; continue; }
    if (args[i] === "--now") { state.now = Number(args[++i]); continue; }
    if (args[i] === "--last-run") { lastRunPath = args[++i]; continue; }
    if (args[i] === "--plugin-root") { pluginRoot = args[++i]; continue; }
    files.push(args[i]);
  }
  if (files.length !== 1) { usage(); return 2; }
  if (!fs.existsSync(files[0])) { process.stderr.write(`ERROR: not found: ${files[0]}\n`); return 2; }
  let routines;
  try { routines = JSON.parse(fs.readFileSync(files[0], "utf8")); }
  catch (e) { process.stderr.write(`ERROR: not valid JSON: ${e.message}\n`); return 2; }
  // --last-run: optional per-routine last-run epoch-ms map; absent/malformed → {} (never ran → due).
  if (lastRunPath) {
    try {
      const raw = fs.readFileSync(lastRunPath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) state.lastRun = parsed;
    } catch (e) { process.stderr.write(`ERROR: --last-run not valid JSON: ${e.message}\n`); return 2; }
  }
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

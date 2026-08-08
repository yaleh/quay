#!/usr/bin/env node
// plugin/scripts/cap-from-gate.ts — the ADAPTIVE concurrency cap
// (gap-adaptive-concurrency-cap-tied-to-resource-gate →
//  gap-cap-from-gate-avg300-driven-by-claude-session-churn-structural-cap-2).
//
// The dispatch decision point (fast-mode-loop-tick.md step 4) calls this to compute the effective
// concurrency cap instead of a fixed number. Mechanism: read cpu pressure AT the dispatch point
// (via resource-gate.sh report mode — single source), map to a band, keep hysteresis so a single
// sample cannot flip the band, and cap at the band's configured number.
//
// SIGNAL SEMANTICS (changed 2026-08-08 by gap-cap-from-gate-avg300-driven-by-claude-session-churn-
// structural-cap-2): the signal is `some avg10`, NOT `some avg300`. The outer layer measured that
// `some avg300` (5-min window) is dominated by the claude session's resident churn — stable 50-55,
// always above the old WAIT=40 threshold — and barely responds to dispatch-class load (a 4-core
// full-load injection moved avg300 only +1.5pt while avg10 moved +26pt). An avg300-driven cap was
// therefore structurally pinned to WAIT (cap=2) and dispatch throttling could never lift it. `some
// avg10` is the responsive signal (measured +26pt under a 4-core injection). `full avg300` stays 0
// even under full saturation (the kernel's CPU full counter never increments on this system) and was
// REJECTED for losing overload protection. The churn baseline is excluded by RAISING the thresholds
// (WAIT=60 > measured baseline 42-54; EXTREME=85), not by subtracting a fixed number (the baseline
// drifts as sessions start/stop). Hysteresis (`samples` consecutive same-direction readings at the
// dispatch point, default 2) turns avg10's 10-second window into a slow-switching decision: the
// dispatch actuator is 25-min ticks / 15-90-min subagents, and 2 same-direction readings across
// dispatch points means sustained load, not a transient burst.
//
// MECHANISM / STRATEGY separation (manager correction 2026-08-05):
//   MECHANISM (this file — quay-shipped, downstream adopts via the upgrade channel, never re-invented):
//     - read cpu `some avg10` at the dispatch point (via resource-gate.sh report mode — single source)
//     - band thresholds (GO < 60, WAIT < 85, EXTREME >= 85) — mechanism constants
//     - hysteresis — `samples` consecutive same-direction readings before a switch (default 2)
//     - the band NUMBERS come from per-project config (below)
//   STRATEGY (per-project): `.quay/config.yml` `loop: concurrency_bands: {go, wait, extreme_wait}` —
//     quay default 5/2/1; archguard may set 4/2/1. Same mechanism, project-defined numbers.
//
// AC1 — read at the dispatch decision point (the tick doc calls this in step 4; no polling added).
// AC2 — reads cpu `some avg10` (responsive to real overload; the churn-dominated avg300 was measured
//       structurally dead — see above). avg10's 10s window is safe because hysteresis + the
//       dispatch-point sampling (25-min ticks) damp it into a slow switch.
// AC3 — hysteresis (negative control): one avg10 sample pointing to a new band does NOT switch;
//       only `samples` consecutive same-direction readings do.
// AC4 — bands configurable; numbers from config, defaults 5/2/1; config change takes effect.
// AC5 — resources empty (low avg10) => GO band => cap >= 3 (throughput above the old fixed 3).
// AC6 — high avg10 (e.g. another project saturating the host) => WAIT/EXTREME band => cap drops.
// AC8 — cross-referenced with resource-gate.sh (the signal) + concurrent-batch-scheduler.ts (the
//       disjointness gate that runs at the same decision point) + SPEC-isolation-and-resource-governance.
//
// Fail-closed: an unmeasurable signal (kernel without PSI) => EXTREME band (lowest cap) — a cap that
// silently stays high when its signal is unmeasurable is a quietly-lying instrument.
//
// Usage:
//   node --experimental-strip-types plugin/scripts/cap-from-gate.ts [--root <repo>] [--state <file>]
//       [--samples <n>]
//   # the Contract invocation form (thin bash wrapper):
//   bash plugin/scripts/cap-from-gate.sh [--root <repo>]
//
// Output (stdout): signal/band lines + a LAST `effective_cap=N` line the tick extracts. Exit 0 always
// (a detector/recommender, not a gate — the dispatch decision consumes the number).

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parse as parseYaml } from "yaml";
import { isDirectEntry } from "./gate-script-base.ts";

/** Default GO/WAIT/EXTREME caps when config declares no concurrency_bands. quay's default (5/2/1);
 *  a project overrides in `.quay/config.yml` `loop:concurrency_bands` (e.g. archguard 4/2/1). */
export const DEFAULT_BANDS = { go: 5, wait: 2, extreme_wait: 1 };

/** Band thresholds on cpu `some avg10` (mechanism constants). WAIT=60 sits ABOVE the measured
 *  claude-session churn baseline (some avg10 42-54, 2026-08-08 outer measurement) and BELOW the
 *  measured real-overload reading (a 4-core full-load injection pushed avg10 to 68) — that
 *  separation is what lets the signal distinguish "session churn" (GO) from "real overload" (WAIT).
 *  EXTREME=85 is the heavy-saturation regime. The original avg300 thresholds (40/70) were tuned to a
 *  signal that is structurally dead in this environment (gap-cap-from-gate-avg300-driven-by-claude-
 *  session-churn-structural-cap-2): avg300 stays 50-55 regardless of dispatch load. */
export const WAIT_THRESHOLD = 60;
export const EXTREME_THRESHOLD = 85;

/** Hysteresis width: consecutive same-direction readings required to switch bands. A single sample
 *  (still jittery near a threshold) must NOT flip the cap — the negative control (AC3). With the
 *  signal now `some avg10` (10s window), this is what keeps the decision slow: samples are taken at
 *  dispatch points (25-min ticks), so 2 same-direction readings = sustained load, not a transient. */
export const HYSTERESIS_SAMPLES_DEFAULT = 2;

export const STATE_FILE_NAME = "concurrency-cap-state.json";

export type BandName = "GO" | "WAIT" | "EXTREME";
export interface BandConfig { go: number; wait: number; extreme_wait: number; }
export interface CapState { band: BandName; consecutive: number; decided_at: string; }

function findRepoRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot find repo root: no .quay/config.yml found upward from " + startDir);
}

/** Parse the config.yml `loop: concurrency_bands:` block. Missing block => DEFAULT_BANDS. */
export function readBandsFromConfig(configPath: string): BandConfig {
  if (!fs.existsSync(configPath)) return { ...DEFAULT_BANDS };
  let doc: unknown;
  try {
    doc = parseYaml(fs.readFileSync(configPath, "utf8"));
  } catch {
    // Malformed config is NOT this helper's fail-closed domain (readLoopParams fail-closes on it);
    // a cap detector degrades to defaults rather than wedging dispatch on a YAML typo.
    return { ...DEFAULT_BANDS };
  }
  const loop = (doc as Record<string, any> | null)?.["loop"];
  const bands = loop?.["concurrency_bands"];
  if (!bands || typeof bands !== "object") return { ...DEFAULT_BANDS };
  const num = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : undefined);
  const b = bands as Record<string, unknown>;
  return {
    go: num(b.go) ?? DEFAULT_BANDS.go,
    wait: num(b.wait) ?? DEFAULT_BANDS.wait,
    extreme_wait: num(b.extreme_wait) ?? DEFAULT_BANDS.extreme_wait,
  };
}

/** Map a cpu stall reading (number) to the desired band. Unmeasurable => EXTREME (fail-closed). */
export function computeDesiredBand(cpuStall: number | null): BandName {
  if (cpuStall === null) return "EXTREME";
  if (cpuStall < WAIT_THRESHOLD) return "GO";
  if (cpuStall < EXTREME_THRESHOLD) return "WAIT";
  return "EXTREME";
}

/** Apply hysteresis. Given the current state and the raw desired band, return the EFFECTIVE band
 *  (current unless `samples` consecutive same-direction readings toward the desired band) plus the
 *  new consecutive count and whether the band switched. */
export function applyHysteresis(
  state: CapState | null,
  desired: BandName,
  samples: number,
): { band: BandName; consecutive: number; switched: boolean } {
  // Cold start (no prior decision): adopt the raw reading immediately — there is no history to be
  // consistent against. First decision, so `consecutive` starts at 0.
  if (!state) return { band: desired, consecutive: 0, switched: false };
  if (desired === state.band) {
    // Consistent with current band — reset the opposite-direction counter.
    return { band: state.band, consecutive: 0, switched: false };
  }
  const consecutive = (state.consecutive || 0) + 1;
  if (consecutive >= samples) {
    return { band: desired, consecutive: 0, switched: true };
  }
  return { band: state.band, consecutive, switched: false };
}

export function capForBand(bands: BandConfig, band: BandName): number {
  return band === "GO" ? bands.go : band === "WAIT" ? bands.wait : bands.extreme_wait;
}

export function loadState(file: string): CapState | null {
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw || typeof raw.band !== "string") return null;
    const band = raw.band === "GO" || raw.band === "WAIT" || raw.band === "EXTREME" ? raw.band : null;
    if (!band) return null;
    return {
      band,
      consecutive: Number.isInteger(raw.consecutive) ? raw.consecutive : 0,
      decided_at: typeof raw.decided_at === "string" ? raw.decided_at : "",
    };
  } catch {
    // Corrupt/partial state file → treat as no state (cold start). Never wedge dispatch on state I/O.
    return null;
  }
}

export function saveState(file: string, state: CapState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
}

/** Read the cpu `some avg10` signal from resource-gate.sh REPORT mode (single source — the gate
 *  owns the /proc/pressure/cpu read + its test seams). Returns null when UNMEASURABLE.
 *  NB: reads `some avg10`, NOT `some avg300` — the avg300 field is churn-dominated and structurally
 *  dead (see header comment, gap-cap-from-gate-avg300-driven-by-claude-session-churn-structural-cap-2). */
export function readCpuStallFromGate(repoRoot: string, env: NodeJS.ProcessEnv = process.env): number | null {
  const gate = path.join(repoRoot, "plugin", "scripts", "resource-gate.sh");
  const res = spawnSync("bash", [gate], { cwd: repoRoot, encoding: "utf8", env });
  if (res.status !== 0) {
    // report mode always exits 0 — a non-zero means the script itself is broken; fail closed.
    return null;
  }
  const m = `${res.stdout}\n${res.stderr}`.match(/cpu_stall\(some avg10\)=([0-9.]+|UNMEASURABLE)/);
  if (!m || m[1] === "UNMEASURABLE") return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

/** The full adaptive-cap decision. Returns the effective cap + the reasoning fields the tick/operator
 *  can print. `stateFile` defaults to <root>/.quay/concurrency-cap-state.json. */
export function computeEffectiveCap(opts: {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
  stateFile?: string;
  samples?: number;
  bands?: BandConfig;
}): {
  effective_cap: number;
  band: BandName;
  desired: BandName;
  consecutive: number;
  switched: boolean;
  cpu_stall: number | null;
  stateFile: string;
} {
  const repoRoot = opts.repoRoot;
  const env = opts.env ?? process.env;
  const stateFile = opts.stateFile ?? path.join(repoRoot, ".quay", STATE_FILE_NAME);
  const samples = opts.samples ?? HYSTERESIS_SAMPLES_DEFAULT;
  const bands = opts.bands ?? readBandsFromConfig(path.join(repoRoot, ".quay", "config.yml"));
  const cpuStall = readCpuStallFromGate(repoRoot, env);
  const desired = computeDesiredBand(cpuStall);
  const state = loadState(stateFile);
  const { band, consecutive, switched } = applyHysteresis(state, desired, samples);
  saveState(stateFile, { band, consecutive, decided_at: new Date().toISOString() });
  return {
    effective_cap: capForBand(bands, band),
    band,
    desired,
    consecutive,
    switched,
    cpu_stall: cpuStall,
    stateFile,
  };
}

function main(argv: string[]): number {
  let root: string | null = null;
  let stateFile: string | null = null;
  let samples = HYSTERESIS_SAMPLES_DEFAULT;
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = args[++i];
    else if (args[i] === "--state") stateFile = args[++i];
    else if (args[i] === "--samples") samples = Number(args[++i]);
    else if (args[i] === "--json") { /* accepted for Contract parity — output is the human+cap form */ }
    else {
      console.error(`usage: node cap-from-gate.ts [--root <repo>] [--state <file>] [--samples <n>]`);
      return 2;
    }
  }
  const repoRoot = root ? path.resolve(root) : findRepoRoot(process.cwd());
  const result = computeEffectiveCap({
    repoRoot,
    stateFile: stateFile ?? undefined,
    samples,
  });
  const avg = result.cpu_stall === null ? "UNMEASURABLE" : result.cpu_stall.toFixed(2);
  console.log(
    `signal: cpu_stall(some avg10)=${avg}  bands(go<${WAIT_THRESHOLD}, wait<${EXTREME_THRESHOLD}, extreme>=${EXTREME_THRESHOLD})`,
  );
  console.log(
    `band: ${result.band}  desired=${result.desired}  consecutive=${result.consecutive}/${samples}  switched=${result.switched ? "yes" : "no"}`,
  );
  console.log(`effective_cap=${result.effective_cap}`);
  return 0;
}

if (isDirectEntry(import.meta)) {
  process.exitCode = main(process.argv);
}

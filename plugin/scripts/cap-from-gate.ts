#!/usr/bin/env node
// plugin/scripts/cap-from-gate.ts — the ADAPTIVE concurrency cap (gap-adaptive-concurrency-cap-tied-to-resource-gate).
//
// The dispatch decision point (fast-mode-loop-tick.md step 4) calls this to compute the effective
// concurrency cap instead of a fixed number. The task's core constraint: signal and actuator time
// scales differ by 1-2 orders of magnitude (cpu pressure avg10 = 10s window vs a dispatch decision
// every 25-min tick / 15-90-min subagent), so a fixed cap or an avg10-reactive cap both mismatch the
// actuator. The correct shape: read `some avg300` (5-min window) AT the dispatch point (reuse the
// existing decision point — NO new polling), keep hysteresis so a single sample cannot flip the band.
//
// MECHANISM / STRATEGY separation (manager correction 2026-08-05):
//   MECHANISM (this file — quay-shipped, downstream adopts via the upgrade channel, never re-invented):
//     - read cpu `some avg300` at the dispatch point (via resource-gate.sh report mode — single source)
//     - band thresholds (GO < 40, WAIT < 70, EXTREME >= 70) — mechanism constants
//     - hysteresis — `samples` consecutive same-direction readings before a switch (default 2)
//     - the band NUMBERS come from per-project config (below)
//   STRATEGY (per-project): `.quay/config.yml` `loop: concurrency_bands: {go, wait, extreme_wait}` —
//     quay default 5/2/1; archguard may set 4/2/1. Same mechanism, project-defined numbers.
//
// AC1 — read at the dispatch decision point (the tick doc calls this in step 4; no polling added).
// AC2 — reads avg300 (5-min window), not avg10 — same order of magnitude as the dispatch rhythm.
// AC3 — hysteresis (negative control): one avg300 sample pointing to a new band does NOT switch;
//       only `samples` consecutive same-direction readings do.
// AC4 — bands configurable; numbers from config, defaults 5/2/1; config change takes effect.
// AC5 — resources empty (low avg300) => GO band => cap >= 3 (throughput above the old fixed 3).
// AC6 — high avg300 (e.g. another project saturating the host) => WAIT/EXTREME band => cap drops.
// AC8 — cross-referenced with resource-gate.sh (the signal) + concurrent-batch-scheduler.ts (the
//       disjointness gate that runs at the same decision point) + SPEC-isolation-and-resource-governance.
//
// Fail-closed: an unmeasurable avg300 (kernel without PSI) => EXTREME band (lowest cap) — a cap that
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

/** Band thresholds on cpu `some avg300` (mechanism constants — the GO/WAIT gate's own CPU_LIMIT=40
 *  is the GO/WAIT boundary; EXTREME = the heavy-saturation regime). */
export const WAIT_THRESHOLD = 40;
export const EXTREME_THRESHOLD = 70;

/** Hysteresis width: consecutive same-direction readings required to switch bands. A single avg300
 *  sample (still jittery near a threshold) must NOT flip the cap — the negative control (AC3). */
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

/** Map an avg300 reading (number) to the desired band. Unmeasurable => EXTREME (fail-closed). */
export function computeDesiredBand(avg300: number | null): BandName {
  if (avg300 === null) return "EXTREME";
  if (avg300 < WAIT_THRESHOLD) return "GO";
  if (avg300 < EXTREME_THRESHOLD) return "WAIT";
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

/** Read the cpu `some avg300` signal from resource-gate.sh REPORT mode (single source — the gate
 *  owns the /proc/pressure/cpu read + its test seams). Returns null when UNMEASURABLE. */
export function readAvg300FromGate(repoRoot: string, env: NodeJS.ProcessEnv = process.env): number | null {
  const gate = path.join(repoRoot, "plugin", "scripts", "resource-gate.sh");
  const res = spawnSync("bash", [gate], { cwd: repoRoot, encoding: "utf8", env });
  if (res.status !== 0) {
    // report mode always exits 0 — a non-zero means the script itself is broken; fail closed.
    return null;
  }
  const m = `${res.stdout}\n${res.stderr}`.match(/cpu_stall\(some avg300\)=([0-9.]+|UNMEASURABLE)/);
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
  avg300: number | null;
  stateFile: string;
} {
  const repoRoot = opts.repoRoot;
  const env = opts.env ?? process.env;
  const stateFile = opts.stateFile ?? path.join(repoRoot, ".quay", STATE_FILE_NAME);
  const samples = opts.samples ?? HYSTERESIS_SAMPLES_DEFAULT;
  const bands = opts.bands ?? readBandsFromConfig(path.join(repoRoot, ".quay", "config.yml"));
  const avg300 = readAvg300FromGate(repoRoot, env);
  const desired = computeDesiredBand(avg300);
  const state = loadState(stateFile);
  const { band, consecutive, switched } = applyHysteresis(state, desired, samples);
  saveState(stateFile, { band, consecutive, decided_at: new Date().toISOString() });
  return {
    effective_cap: capForBand(bands, band),
    band,
    desired,
    consecutive,
    switched,
    avg300,
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
  const avg = result.avg300 === null ? "UNMEASURABLE" : result.avg300.toFixed(2);
  console.log(
    `signal: cpu_stall(some avg300)=${avg}  bands(go<${WAIT_THRESHOLD}, wait<${EXTREME_THRESHOLD}, extreme>=${EXTREME_THRESHOLD})`,
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

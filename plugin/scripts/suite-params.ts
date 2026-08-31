#!/usr/bin/env node
// suite-params.ts — read + validate the `.quay/config.yml` `suite:` section (the suite-level knobs'
// config-file default). The SINGLE definition point for "what the 6 suite knobs default to from config".
//
// Task: gap-suite-knobs-config-file-priority (config < env < CLI).
//
// WHY THIS EXISTS: every suite knob was env-only (QUAY_PHASE_OVERLAP / QUAY_SERIAL_CONCURRENCY /
// QUAY_LOWCONC_CONCURRENCY / QUAY_MAX_CONCURRENT_SUITES / QUAY_MAX_OVERSUBSCRIPTION /
// QUERY_MAIN_TAIL_OVERLAP). A driver restart drops env, so an experiment knob injected via env is
// silently lost (2026-08-31: QUERY_MAIN_TAIL_OVERLAP=12 lost on driver stop → round 775 full-suite
// main-tail-overlap never fired). A config-file default survives restart; env/CLI stay as
// debug/one-off overrides.
//
// Contract: readSuiteParams(workspaceRoot) → SuiteParams | throws Error("FAIL-CLOSED: ...")
//   - No `.quay/config.yml` → returns {} (empty). The `suite:` section is OPTIONAL — a workspace
//     without one keeps its host-derived / env-only behavior (AC4 pass/fail-neutral).
//   - `.quay/config.yml` present but no `suite:` key → returns {} (same neutrality).
//   - `.quay/config.yml` present with a `suite:` key → CLOSED schema: the only valid keys are the 6
//     below; an UNKNOWN key, a WRONG-TYPED value, or an OUT-OF-RANGE value throws FAIL-CLOSED
//     (DIR-050 discipline — a malformed config must not silently degrade to env defaults; AC5).
//   - `.quay/config.yml` present but malformed YAML → throws FAIL-CLOSED (same as loop-params.ts).
//
// Priority (config < env < CLI) is NOT resolved here — this module only returns the config-file
// values. Consumers (scripts/test.sh, plugin/scripts/full-suite-runner.ts) promote each value into
// its env var ONLY when that env var is unset/empty (env wins), and their existing CLI-flag logic
// stays above env. That keeps ONE precedence chain, read at the single definition point.
//
// The 4 knobs with a FIXED default (phase_overlap / max_concurrent_suites / max_oversubscription /
// main_tail_overlap_lanes) are listed in the shipped `.quay/config.yml`. serial_concurrency /
// lowconc_concurrency default to a HOST-DERIVED value (os.availableParallelism() ÷ (S × P)), so they
// are CONFIGURABLE here but intentionally ABSENT from the shipped config — a literal would be a
// machine-spec-dependent literal (CLAUDE.md 硬规则 4 推论二).

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { isDirectEntry } from "./gate-script-base.ts";

/** The 6 suite knobs: config key → env key (the mapping from the task's Proposal table). */
export const SUITE_KNOBS = {
  phase_overlap: "QUAY_PHASE_OVERLAP",
  serial_concurrency: "QUAY_SERIAL_CONCURRENCY",
  lowconc_concurrency: "QUAY_LOWCONC_CONCURRENCY",
  max_concurrent_suites: "QUAY_MAX_CONCURRENT_SUITES",
  max_oversubscription: "QUAY_MAX_OVERSUBSCRIPTION",
  main_tail_overlap_lanes: "QUERY_MAIN_TAIL_OVERLAP",
} as const;

export type SuiteKnobKey = keyof typeof SUITE_KNOBS;

/** The typed config-file values. Every field is OPTIONAL — absent = "no config default for this
 *  knob" (the consumer falls through to its existing host-derived / literal default). */
export interface SuiteParams {
  phase_overlap?: number;
  serial_concurrency?: number;
  lowconc_concurrency?: number;
  max_concurrent_suites?: number;
  max_oversubscription?: number;
  main_tail_overlap_lanes?: number;
}

/** Per-knob schema: validator + a human-readable "must be …" clause for the FAIL-CLOSED message. */
const KNOB_SPEC: Record<SuiteKnobKey, { ok: (v: unknown) => boolean; must: string }> = {
  phase_overlap: { ok: (v) => v === 0 || v === 1, must: "0 (sequential) or 1 (overlap)" },
  serial_concurrency: { ok: (v) => typeof v === "number" && Number.isInteger(v) && v >= 1, must: "an integer >= 1" },
  lowconc_concurrency: { ok: (v) => typeof v === "number" && Number.isInteger(v) && v >= 1, must: "an integer >= 1" },
  max_concurrent_suites: { ok: (v) => typeof v === "number" && Number.isInteger(v) && v >= 1, must: "an integer >= 1" },
  max_oversubscription: { ok: (v) => typeof v === "number" && Number.isFinite(v) && v > 0, must: "a positive number" },
  main_tail_overlap_lanes: { ok: (v) => typeof v === "number" && Number.isInteger(v) && v >= 0, must: "an integer >= 0" },
};

/** Read and validate the suite: section. Throws Error("FAIL-CLOSED: …") on a malformed/mistyped
 *  section; returns {} when the section is absent (the OPTIONAL-section neutrality). */
export function readSuiteParams(workspaceRoot: string): SuiteParams {
  const configPath = path.join(workspaceRoot, ".quay", "config.yml");
  if (!fs.existsSync(configPath)) return {};

  let unified: unknown;
  try {
    unified = YAML.parse(fs.readFileSync(configPath, "utf8"));
  } catch (e: unknown) {
    throw new Error(`FAIL-CLOSED: .quay/config.yml is malformed YAML — ${(e as Error).message}`);
  }

  const suite = (unified && typeof unified === "object" ? (unified as Record<string, unknown>).suite : undefined) as unknown;
  if (suite === undefined || suite === null) return {}; // optional section absent → neutral
  if (typeof suite !== "object" || Array.isArray(suite)) {
    throw new Error(
      `FAIL-CLOSED: .quay/config.yml 'suite:' section must be a mapping of knob → value (got ${Array.isArray(suite) ? "array" : typeof suite})`
    );
  }

  const s = suite as Record<string, unknown>;
  // CLOSED schema: an unknown key is rejected (never silently ignored).
  for (const key of Object.keys(s)) {
    if (!(key in SUITE_KNOBS)) {
      throw new Error(
        `FAIL-CLOSED: .quay/config.yml 'suite:' has unknown key '${key}' — valid keys are ${Object.keys(SUITE_KNOBS).join(", ")}`
      );
    }
  }

  const out: SuiteParams = {};
  for (const key of Object.keys(SUITE_KNOBS) as SuiteKnobKey[]) {
    if (!(key in s)) continue;
    const spec = KNOB_SPEC[key];
    const v = s[key];
    if (!spec.ok(v)) {
      throw new Error(
        `FAIL-CLOSED: .quay/config.yml 'suite:${key}' value ${JSON.stringify(v)} is invalid — must be ${spec.must}`
      );
    }
    (out as Record<string, number>)[key] = v as number;
  }
  return out;
}

/** Map present params to their env-var string values — the config values a consumer promotes into
 *  env (env wins: the consumer only applies a value where the env var is unset/empty). */
export function suiteParamsToEnv(params: SuiteParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(SUITE_KNOBS) as SuiteKnobKey[]) {
    const v = params[key];
    if (v !== undefined) out[SUITE_KNOBS[key]] = String(v);
  }
  return out;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────

const usage = `suite-params.ts — read the .quay/config.yml 'suite:' section (suite knob config-file defaults)

Usage:
  node --experimental-strip-types suite-params.ts --json [--root <dir>]
      print the typed SuiteParams as JSON ({} = no suite: section).
  node --experimental-strip-types suite-params.ts --shell [--root <dir>]
      print shell assignment lines, one per PRESENT knob, of the form
        QUAY_X="\${QUAY_X:-<value>}"
      (env wins over config — the :- form leaves an already-set env var untouched). Safe to \`eval\`:
      var names are the fixed 6-knob whitelist and values are schema-validated numbers.

Exit codes: 0 ok; 1 FAIL-CLOSED (malformed suite: section — the suite must not silently degrade).`;

function flagVal(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}

function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage + "\n");
    return 0;
  }
  const root = path.resolve(flagVal(args, "--root") ?? process.cwd());
  let params: SuiteParams;
  try {
    params = readSuiteParams(root);
  } catch (e: unknown) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 1;
  }

  if (args.includes("--shell")) {
    for (const key of Object.keys(SUITE_KNOBS) as SuiteKnobKey[]) {
      const v = params[key];
      if (v === undefined) continue;
      process.stdout.write(`${SUITE_KNOBS[key]}="\${${SUITE_KNOBS[key]}:-${v}}"\n`);
    }
    return 0;
  }
  process.stdout.write(JSON.stringify(params, null, 2) + "\n");
  return 0;
}

if (isDirectEntry(import.meta, undefined, "suite-params")) {
  process.exitCode = main(process.argv);
}

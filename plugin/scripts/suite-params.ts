#!/usr/bin/env node
// suite-params.ts — read + validate the `.quay/config.yml` `suite:` section (the suite-level knobs'
// config-file default). The SINGLE definition point for "what the 7 suite knobs default to from config".
//
// Task: gap-suite-knobs-config-file-priority (config < env < CLI).
//
// WHY THIS EXISTS: every suite knob was env-only (QUAY_PHASE_OVERLAP / QUAY_SERIAL_CONCURRENCY /
// QUAY_LOWCONC_CONCURRENCY / QUAY_MAX_CONCURRENT_SUITES / QUAY_MAX_OVERSUBSCRIPTION). A driver restart
// drops env, so an experiment knob injected via env is silently lost. A config-file default survives
// restart; env/CLI stay as debug/one-off overrides.
//
// Contract: readSuiteParams(workspaceRoot) → SuiteParams | throws Error("FAIL-CLOSED: ...")
//   - No `.quay/config.yml` → returns {} (empty). The `suite:` section is OPTIONAL — a workspace
//     without one keeps its host-derived / env-only behavior (AC4 pass/fail-neutral).
//   - `.quay/config.yml` present but no `suite:` key → returns {} (same neutrality).
//   - `.quay/config.yml` present with a `suite:` key → CLOSED schema: the only valid keys are
//     SUITE_KNOBS' keys; an UNKNOWN key, a WRONG-TYPED value, or an OUT-OF-RANGE value throws FAIL-CLOSED
//     (DIR-050 discipline — a malformed config must not silently degrade to env defaults; AC5).
//   - `.quay/config.yml` present but malformed YAML → throws FAIL-CLOSED (same as loop-params.ts).
//
// Priority (config < env < CLI) is NOT resolved here — this module only returns the config-file
// values. Consumers (scripts/test.sh, plugin/scripts/full-suite-runner.ts) promote each value into
// its env var ONLY when that env var is unset/empty (env wins), and their existing CLI-flag logic
// stays above env. That keeps ONE precedence chain, read at the single definition point.
//
// The 5 knobs with a FIXED default (suite_scheduler / phase_overlap / max_concurrent_suites /
// max_oversubscription / main_tail_stall_pct) are listed in the shipped
// `.quay/config.yml` — suite_scheduler defaults ON via test.sh's `${QUAY_SUITE_SCHEDULER:-1}`
// fallback rather than a shipped literal (a `suite_scheduler: 1` line would be redundant).
// serial_concurrency and lowconc_concurrency both default to the SAME HOST-DERIVED value
// (os.availableParallelism() ÷ (S × P)) — gap-lowconc-concurrency-restore-host-derived reverted the
// lowconc=3 fixed-value split. Both are CONFIGURABLE here but intentionally ABSENT from the shipped
// config — a literal would be a machine-spec-dependent literal (CLAUDE.md 硬规则 4 推论二).

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
// flagVal now lives in gate-script-base.ts as `flagValue` (it was one of the byte-identical
// copies of the indexOf+next-arg idiom in plugin/scripts; .quay/routine-findings.jsonl finding
// `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { isDirectEntry, flagValue } from "./gate-script-base.ts";

/** The suite knobs: config key → env key (config-first per the same policy). `suite_scheduler`
 *  (gap-suite-dynamic-waterline-scheduler) turns the unified group-budget scheduler ON (default) /
 *  OFF (ONE-KEY ROLLBACK to the legacy phased path). `phase_overlap` / `main_tail_stall_pct` are
 *  RETIRED-BY-SCHEDULER: they stay in the CLOSED schema so an existing config that still sets them
 *  keeps validating — but they only take effect on the QUAY_SUITE_SCHEDULER=0 legacy fallback path.
 *
 *  `memory_max` (gap-suite-memorymax-literal-16g-cap-pinned-every-round-while-lanes-scale-with-nproc)
 *  is the suite cgroup's `MemoryMax` — the ONE knob here whose unit is a size STRING, not a count.
 *  It exists so the ceiling is DECLARED (per project, in config) instead of buried as a constant in
 *  the runner: a host-specific memory ceiling is exactly the value a project must be able to set
 *  without editing kernel code, and the 2026-09-24 human ruling (16G) is a DEFAULT, not the only
 *  possible value. ⛔ It is deliberately ABSENT from the shipped config: writing it there would put
 *  a machine-spec-dependent literal back into a tracked file (CLAUDE.md 硬规则 4 推论二). */
export const SUITE_KNOBS = {
  suite_scheduler: "QUAY_SUITE_SCHEDULER",
  phase_overlap: "QUAY_PHASE_OVERLAP",
  serial_concurrency: "QUAY_SERIAL_CONCURRENCY",
  lowconc_concurrency: "QUAY_LOWCONC_CONCURRENCY",
  max_concurrent_suites: "QUAY_MAX_CONCURRENT_SUITES",
  max_oversubscription: "QUAY_MAX_OVERSUBSCRIPTION",
  main_tail_stall_pct: "QUAY_MAIN_TAIL_STALL_PCT",
  memory_max: "QUAY_SUITE_MEMORY_MAX",
  heavy_threshold_mb: "QUAY_SUITE_HEAVY_THRESHOLD_MB",
  heavy_max_concurrent: "QUAY_SUITE_HEAVY_MAX_CONCURRENT",
} as const;

export type SuiteKnobKey = keyof typeof SUITE_KNOBS;

/** The typed config-file values. Every field is OPTIONAL — absent = "no config default for this
 *  knob" (the consumer falls through to its existing host-derived / literal default). */
export interface SuiteParams {
  suite_scheduler?: number;
  phase_overlap?: number;
  serial_concurrency?: number;
  lowconc_concurrency?: number;
  max_concurrent_suites?: number;
  max_oversubscription?: number;
  main_tail_stall_pct?: number;
  /** A systemd size string (`"16G"`, `"512M"`, `"17179869184"`) — the suite cgroup's MemoryMax. */
  memory_max?: string;
  /** gap-suite-heavy-files-and-phase-concurrency-under-16g-pressure-baseline-comparison — the
   *  memory-aware SCHEDULING declaration. A file whose MEASURED per-file high-water (max `memPeakKb`
   *  over `SUITE_PERFILE_MEMORY_ROUNDS` rounds) exceeds this many MiB is "heavy"; heavy files are
   *  scheduled in their own bucket, never co-running beyond `heavy_max_concurrent`. Both live here
   *  (project-declared, host-overridable via the env keys) rather than as literals in the runner:
   *  the right threshold is a property of the PROJECT's test suite and the right bound of the HOST's
   *  memory envelope, and neither is knowable from the code. ⛔ Declaring NEITHER knob leaves the
   *  mechanism OFF — it is deliberately not defaulted, because a default would be exactly the
   *  machine-spec-dependent literal hard rule 4 推论二 forbids. */
  heavy_threshold_mb?: number;
  heavy_max_concurrent?: number;
}

/** Per-knob schema: validator + a human-readable "must be …" clause for the FAIL-CLOSED message. */
const KNOB_SPEC: Record<SuiteKnobKey, { ok: (v: unknown) => boolean; must: string }> = {
  suite_scheduler: { ok: (v) => v === 0 || v === 1, must: "0 (legacy phased fallback) or 1 (unified scheduler)" },
  phase_overlap: { ok: (v) => v === 0 || v === 1, must: "0 (sequential) or 1 (overlap)" },
  serial_concurrency: { ok: (v) => typeof v === "number" && Number.isInteger(v) && v >= 1, must: "an integer >= 1" },
  lowconc_concurrency: { ok: (v) => typeof v === "number" && Number.isInteger(v) && v >= 1, must: "an integer >= 1" },
  max_concurrent_suites: { ok: (v) => typeof v === "number" && Number.isInteger(v) && v >= 1, must: "an integer >= 1" },
  max_oversubscription: { ok: (v) => typeof v === "number" && Number.isFinite(v) && v > 0, must: "a positive number" },
  main_tail_stall_pct: { ok: (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100, must: "a number in [0, 100] (PSI stall %)" },
  // A systemd size string: bare bytes or a K/M/G/T/P suffix with an optional B (systemd's own table).
  // Validated HERE rather than passed through: a malformed size would otherwise become an
  // unparseable `-p MemoryMax=` property and systemd-run would refuse the whole scope.
  memory_max: {
    ok: (v) => typeof v === "string" && /^\d+(\.\d+)?\s*[kKmMgGtTpP]?[bB]?$/.test(v.trim()),
    must: "a systemd size string (e.g. \"16G\", \"512M\", \"17179869184\")",
  },
  heavy_threshold_mb: {
    ok: (v) => typeof v === "number" && Number.isFinite(v) && v > 0,
    must: "a positive number of MiB (a file whose measured peak exceeds it is scheduled heavily)",
  },
  heavy_max_concurrent: {
    ok: (v) => typeof v === "number" && Number.isInteger(v) && v >= 1,
    must: "an integer >= 1 (how many heavy files may co-run at once)",
  },
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
    (out as Record<string, number | string>)[key] = v as number | string;
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
      var names are the fixed 8-knob whitelist and values are schema-validated (numbers, plus the
      size string for memory_max).

Exit codes: 0 ok; 1 FAIL-CLOSED (malformed suite: section — the suite must not silently degrade).`;

function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage + "\n");
    return 0;
  }
  const root = path.resolve(flagValue(args, "--root") ?? process.cwd());
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

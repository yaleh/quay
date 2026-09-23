#!/usr/bin/env node
// red-window-triage.ts — the mechanical red-window triage: partition suite failures into the
// KNOWN-LOAD-SENSITIVE family (in-family) vs everything else (not-in-family), auto-issue the
// isolated-rerun command for in-family failures, and record the rerun verdict back into the suite
// state. (tasks/gap-known-load-sensitive-rule-is-doc-only-no-mechanical-triage, AC3/AC4/AC6)
//
// Before this module, red-window triage was DOC-ONLY: fast-mode-loop-tick.md's 判读规则 said "if the
// fail lands in the family, rerun the family in isolation before concluding", but NO code enforced
// it — a human/agent had to REMEMBER to do the isolated rerun, and a non-family failure
// (test-file-snapshot baseline REMOVED vs runner-grouping AC7 zz- fixture) could be swept into the
// 'environmental' bucket because nothing partitioned in-family vs not-in-family.
//
// This module makes the triage mechanical and traceable:
//   1. PARTITION — read .quay/full-suite-state.json, and for each failure resolve whether its file
//      is a family member (machine-readable manifest from known-load-sensitive.ts — the single
//      source). Write `in_family` + `kind` onto each failure in the state file.
//   2. AUTO-TRIGGER — for in-family failures, emit the EXACT isolated-rerun command (only the
//      family files, low load) and record it as `isolate_rerun` on the failure. The outer runs it.
//   3. VERDICT — `--record-verdict <index> green|red` writes the rerun result back:
//        green ⇒ environmental (+ kind), red ⇒ NOT environmental, escalate.
//   4. BAND — `--band` exits non-zero when any in-family failure lacks an isolate_rerun verdict
//      (the Contract `family_failures_unverified = 0` band).
//
// A NOT-IN-FAMILY failure is NEVER auto-isolated (AC4 negative control): it is reported
// not-in-family and treated as a real candidate unless independent evidence says otherwise.
//
// Usage:
//   node --no-warnings --experimental-strip-types plugin/scripts/red-window-triage.ts \
//     --partition [--state <file>] [--root <dir>]      # partition + write in_family/kind + emit isolate commands
//   node --no-warnings --experimental-strip-types plugin/scripts/red-window-triage.ts \
//     --record-verdict <index> <green|red> [--state <file>] [--root <dir>]
//   node --no-warnings --experimental-strip-types plugin/scripts/red-window-triage.ts \
//     --band [--state <file>] [--root <dir>]
//
// Exit: 0 ok; 1 a --band violation (an in-family failure lacks an isolate_rerun verdict) or a
// --record-verdict out-of-range index; 2 usage/env error.

import fs from "node:fs";
import { repoRoot } from "./repo-root.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
// getArgValue now lives in gate-script-base.ts as `flagValue` (it was one of the byte-identical
// copies of the indexOf+next-arg idiom in plugin/scripts; .quay/routine-findings.jsonl finding
// `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { isDirectEntry, flagValue } from "./gate-script-base.ts";
import { scanFamily, kindForFile, isFamilyMember } from "./known-load-sensitive.ts";
import { writeJsonAtomic } from "./write-json-atomic.ts";

const REPO_ROOT = repoRoot();

export interface TriageFailure {
  line: string;
  file?: string;
  /** true when the failing file is a KNOWN-LOAD-SENSITIVE family member (AC3 partition). */
  in_family?: boolean;
  /** the family kind (wall-clock | nested-spawn | heavy | ...) — one root cause = one kind. */
  kind?: string;
  /** the exact isolated-rerun command issued for this family failure (auto-trigger). */
  isolate_rerun?: string;
  /** the verdict after the isolated rerun: "green" (environmental) | "red" (not environmental). */
  isolate_rerun_result?: string;
}

export interface TriageState {
  state: string;
  reason?: string;
  failures?: TriageFailure[];
  [k: string]: unknown;
}

// ── Partition ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Partition one failure against the family manifest. Returns the failure enriched with
 * `in_family` + `kind` (when the failing file is a family member). A failure with no resolvable
 * file stays `in_family: false` (never auto-isolated — AC4).
 */
export function partitionFailure(failure, family) {
  const out = { ...failure };
  if (!out.file) {
    out.in_family = false;
    return out;
  }
  const kind = kindForFile(family, out.file);
  out.in_family = kind !== undefined;
  if (kind !== undefined) out.kind = kind;
  return out;
}

/**
 * Partition all of a state's failures against the family manifest.
 * @returns {{failures: TriageFailure[], inFamily: string[], notInFamily: string[]}}
 */
export function partitionFailures(failures, family) {
  const out = [];
  const inFamily = [];
  const notInFamily = [];
  for (const f of failures ?? []) {
    const p = partitionFailure(f, family);
    out.push(p);
    if (p.in_family) inFamily.push(p.file);
    else notInFamily.push(p.file ?? "(no file context)");
  }
  return { failures: out, inFamily, notInFamily };
}

/**
 * Build the EXACT isolated-rerun command for a set of in-family failing files. Runs ONLY the family
 * files, at low load (no --test-concurrency splice — scripts/test.sh's derived default is 1 on a
 * 4-core box, i.e. serial). One command per line, absolute path resolved against `root`.
 */
export function buildIsolateRerunCommand(inFamilyRels, root) {
  const files = [...new Set(inFamilyRels)]
    .filter((f) => f && !String(f).startsWith("(no"))
    .map((f) => path.join(root, f));
  if (files.length === 0) return null;
  return `bash scripts/test.sh ${files.join(" ")}`;
}

/**
 * Enrich a state's failures with the family partition + issue isolate_rerun commands for in-family
 * failures. Pure (no I/O) — the caller writes the state back.
 */
export function applyTriage(state, family, root) {
  const { failures, inFamily, notInFamily } = partitionFailures(state.failures, family);
  let command = null;
  if (inFamily.length > 0) {
    command = buildIsolateRerunCommand(inFamily, root);
    for (const f of failures) {
      if (f.in_family && !f.isolate_rerun && command) f.isolate_rerun = command;
    }
  }
  return { state: { ...state, failures }, inFamily, notInFamily, command };
}

// ── Band / verdict ───────────────────────────────────────────────────────────────────────────────────

/** The Contract measure `family_failures_unverified` — in-family failures WITHOUT an isolate_rerun. */
export function unverifiedFamilyFailures(failures) {
  return (failures ?? []).filter((f) => f.in_family && !f.isolate_rerun);
}

/** Record an isolated-rerun verdict back onto one failure. Pure — caller writes the state. */
export function recordVerdict(failures, index, verdict) {
  if (!failures || index < 0 || index >= failures.length) return null;
  const f = { ...failures[index] };
  f.isolate_rerun_result = verdict;
  const out = [...failures];
  out[index] = f;
  return out;
}

// ── I/O helpers ──────────────────────────────────────────────────────────────────────────────────────

function defaultStateFile(root) {
  return path.join(root, ".quay", "full-suite-state.json");
}

function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeState(file, state) {
  writeJsonAtomic(file, state);
}

const usage = `red-window-triage.ts — mechanical red-window triage: partition + isolate-rerun trigger + verdict
(gap-known-load-sensitive-rule-is-doc-only-no-mechanical-triage AC3/AC4/AC6)

Usage:
  red-window-triage.ts --partition [--state <file>] [--root <dir>]
  red-window-triage.ts --record-verdict <index> <green|red> [--state <file>] [--root <dir>]
  red-window-triage.ts --band [--state <file>] [--root <dir>]

Exit: 0 ok; 1 band violation / out-of-range index; 2 usage/env error.`;

export function main(argv) {
  const args = argv.slice(2);
  const partitionMode = args.includes("--partition");
  const bandMode = args.includes("--band");
  const recordMode = args.includes("--record-verdict");
  const root = path.resolve(flagValue(args, "--root") ?? REPO_ROOT);
  const stateFile = path.resolve(flagValue(args, "--state") ?? defaultStateFile(root));
  const family = scanFamily(root);

  if (partitionMode) {
    const state = readState(stateFile);
    if (!state) {
      process.stderr.write(`red-window-triage: cannot read state file ${stateFile}\n`);
      return 2;
    }
    const { state: enriched, inFamily, notInFamily, command } = applyTriage(state, family, root);
    writeState(stateFile, enriched);
    process.stdout.write("red-window-triage --partition:\n");
    process.stdout.write(`  in-family (${inFamily.length}): ${inFamily.join(", ") || "(none)"}\n`);
    process.stdout.write(`  not-in-family (${notInFamily.length}): ${notInFamily.join(", ") || "(none)"}\n`);
    if (command) {
      process.stdout.write(`  isolate-rerun command:\n    ${command}\n`);
    } else {
      process.stdout.write("  isolate-rerun command: (none — no in-family failures)\n");
    }
    const unverified = unverifiedFamilyFailures(enriched.failures);
    if (unverified.length > 0) {
      process.stdout.write(`  WARNING: ${unverified.length} in-family failure(s) still lack an isolate_rerun verdict — run --band\n`);
    }
    return 0;
  }

  if (recordMode) {
    const flagIdx = args.indexOf("--record-verdict");
    const idx = Number(args[flagIdx + 1]);
    const verdict = args[flagIdx + 2];
    if (!Number.isInteger(idx) || idx < 0 || (verdict !== "green" && verdict !== "red")) {
      process.stderr.write(`${usage}\n`);
      return 2;
    }
    const state = readState(stateFile);
    if (!state) {
      process.stderr.write(`red-window-triage: cannot read state file ${stateFile}\n`);
      return 2;
    }
    const failures = recordVerdict(state.failures, idx, verdict);
    if (failures === null) {
      process.stderr.write(`red-window-triage: --record-verdict index ${idx} out of range (failures.length=${state.failures?.length ?? 0})\n`);
      return 1;
    }
    writeState(stateFile, { ...state, failures });
    process.stdout.write(
      `red-window-triage --record-verdict: failures[${idx}] isolate_rerun_result=${verdict}${state.failures[idx]?.kind ? ` (kind=${state.failures[idx].kind})` : ""}\n`
    );
    return 0;
  }

  if (bandMode) {
    const state = readState(stateFile);
    if (!state) {
      process.stderr.write(`red-window-triage --band: cannot read state file ${stateFile}\n`);
      return 2;
    }
    const unverified = unverifiedFamilyFailures(state.failures);
    if (unverified.length > 0) {
      for (const f of unverified) {
        process.stderr.write(`red-window-triage --band: in-family failure without isolate_rerun: ${f.file ?? f.line}\n`);
      }
      process.stderr.write(
        `red-window-triage --band: family_failures_unverified=${unverified.length} — must be 0 before labeling environmental\n`
      );
      return 1;
    }
    process.stdout.write(`red-window-triage --band: ok — family_failures_unverified=0 (${(state.failures ?? []).length} failures, all in-family failures carry isolate_rerun)\n`);
    return 0;
  }

  process.stderr.write(`${usage}\n`);
  return 2;
}

if (isDirectEntry(import.meta, undefined, "red-window-triage")) {
  process.exitCode = main(process.argv);
}

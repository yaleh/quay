#!/usr/bin/env node
// gitignore-runtime-coverage-check.ts — the anti-drift check binding quay's runtime-artifact LIST to
// the two places that must agree on it.
// (tasks/gap-quay-init-gitignore-misses-quay-runtime-artifacts-outside-dot-quay; Plan item 3)
//
// THE DEFECT THIS EXISTS FOR: quay-init's consumer `.gitignore` template listed only `.quay/*`, while
// quay itself also writes runtime state OUTSIDE `.quay/` — the native store's parse cache lands at
// `<tasksDir>/.quay-parse-cache.json`, telemetry at `milestones/fast-mode-telemetry/*.json`. Untracked
// and un-ignored, reading the task store dirties the tree and the mechanical fan-in's `ff` then fails
// for EVERY task ("working tree not clean"). Measured on a real third-party project (quay-fleet,
// 2026-09-13): a task with a 55/55-green suite could not land. The prior fix was two hand-added lines
// in that one project — which leaves the GENERATOR drifting for the next consumer (hard rule 5b).
//
// THE INVARIANT (single source of truth + executable binding): the pattern set exists in TWO
// representations and this checker asserts they are the SAME SET —
//   (a) quay's OWN `.gitignore`: every pattern whose IMMEDIATELY PRECEDING line carries the marker
//       token `@quay-runtime-artifact`;
//   (b) `plugin/scripts/quay-runtime-artifacts.txt` — THE manifest, and the ONLY thing quay-init reads
//       when writing a consumer project's `.gitignore` (and what the fan-in ff reads for its clean-tree
//       judgment).
// Either direction of divergence REDs:
//   • marked in (a), absent from (b)  ⇒ quay-init would NOT ignore it in a consumer project ⇒ RED
//     (this is the drift the task's AC3 pins with a negative control).
//   • present in (b), unmarked in (a) ⇒ an unreferenced rule nobody can trace in the repo ⇒ RED.
//
// WHY A MARKER RATHER THAN A KEYWORD SCAN (hard rule 2, position not keyword): the token is only read
// as a marker when it is a COMMENT line DIRECTLY above a pattern line. Prose that mentions runtime
// artifacts — including this file's own docblock, or the manifest's header — is never a match.
//
// WHY NOT just read the manifest and trust it: a manifest nobody is bound to is exactly the
// "manual copy that drifts" this repo keeps paying for (CLAUDE.md: single source of truth + executable
// invariants over prose). The binding is the product here, not the list.
//
// Exit codes: 0 = the two representations are the same non-empty set;
//             1 = drift (either direction) — the offending patterns are named;
//             2 = usage/environment error;
//             3 = NOT-EVALUATED (the manifest or `.gitignore` cannot be read — ⛔ never conflated with
//                 "no drift", hard rule 3b: a checker that cannot read its inputs must not return the
//                 same value as one that read them and found them consistent. An empty-but-present
//                 marked set is NOT NOT-EVALUATED — it is a real drift reading and REDs via (b)).
//
// Run:
//   node --experimental-strip-types plugin/scripts/gitignore-runtime-coverage-check.ts [--root <dir>] [--json]

import fs from "node:fs";
import path from "node:path";
import { helpExit, emitPass, emitFail, emitNotEvaluated, isDirectEntry } from "./gate-script-base.ts";

/** The marker token. A pattern line is "marked" iff the line DIRECTLY above it is a comment carrying
 *  this token. Kept as a single exported constant so the test, the docs and the `.gitignore` all
 *  reference one spelling. */
export const MARKER_TOKEN = "@quay-runtime-artifact";

/** The manifest's repo-relative location — the ONE list quay-init writes into a consumer project. */
export const MANIFEST_REL = "plugin/scripts/quay-runtime-artifacts.txt";

/** Parse the manifest text into its pattern list (order preserved). `#` comments and blank lines are
 *  not patterns; every other line is taken VERBATIM after trimming (gitignore has no trailing-comment
 *  syntax, so a pattern may contain `#`). */
export function parseManifest(text: string): string[] {
  const out: string[] = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    out.push(line);
  }
  return out;
}

/** Parse the patterns in a `.gitignore` that are MARKED as quay runtime artifacts: a non-comment,
 *  non-blank line whose IMMEDIATELY preceding line contains the marker token. */
export function parseMarkedPatterns(text: string): string[] {
  const lines = String(text).split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (line === "" || line.startsWith("#")) continue;
    const prev = (lines[i - 1] ?? "").trim();
    if (prev.startsWith("#") && prev.includes(MARKER_TOKEN)) out.push(line);
  }
  return out;
}

export interface CoverageResult {
  ok: boolean;
  marked: string[];
  manifest: string[];
  /** marked in `.gitignore` but absent from the manifest — quay-init would not ignore them. */
  missingFromManifest: string[];
  /** in the manifest but not marked in `.gitignore` — an unreferenced rule. */
  undeclaredInGitignore: string[];
}

/** The set comparison (pure, both directions). Duplicates are collapsed; order is reported. */
export function checkCoverage(marked: string[], manifest: string[]): CoverageResult {
  const markedSet = new Set(marked);
  const manifestSet = new Set(manifest);
  const missingFromManifest = [...markedSet].filter((p) => !manifestSet.has(p)).sort();
  const undeclaredInGitignore = [...manifestSet].filter((p) => !markedSet.has(p)).sort();
  return {
    ok: missingFromManifest.length === 0 && undeclaredInGitignore.length === 0,
    marked: [...markedSet].sort(),
    manifest: [...manifestSet].sort(),
    missingFromManifest,
    undeclaredInGitignore,
  };
}

const USAGE = `gitignore-runtime-coverage-check.ts — quay's marked runtime-artifact .gitignore entries must equal the manifest quay-init writes
usage: gitignore-runtime-coverage-check.ts [--root <dir>] [--json]
  exit 0 = same non-empty set | 1 = drift (named) | 2 = usage/env | 3 = NOT-EVALUATED (input unreadable)`;

function main(): number {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) helpExit(USAGE);

  const json = argv.includes("--json");
  let root = process.cwd();
  const rootIdx = argv.indexOf("--root");
  if (rootIdx !== -1) {
    const v = argv[rootIdx + 1];
    if (!v) return emitFail("--root requires a directory argument", undefined, { json });
    root = path.resolve(v);
  }

  const gitignorePath = path.join(root, ".gitignore");
  const manifestPath = path.join(root, MANIFEST_REL);
  if (!fs.existsSync(gitignorePath)) {
    return emitNotEvaluated(`NOT-EVALUATED — no .gitignore at ${gitignorePath} (nothing to compare)`, undefined, { json });
  }
  if (!fs.existsSync(manifestPath)) {
    return emitNotEvaluated(
      `NOT-EVALUATED — the runtime-artifact manifest is missing at ${manifestPath}; quay-init would write no runtime ignore rules and this checker cannot judge coverage (⛔ not "no drift")`,
      undefined,
      { json },
    );
  }

  const result = checkCoverage(
    parseMarkedPatterns(fs.readFileSync(gitignorePath, "utf8")),
    parseManifest(fs.readFileSync(manifestPath, "utf8")),
  );

  if (result.ok) {
    return emitPass(
      `quay's ${result.marked.length} marked runtime-artifact .gitignore pattern(s) match the manifest ${MANIFEST_REL} exactly (marked=${result.marked.length} manifest=${result.manifest.length}): ${result.marked.join(" ")}`,
      { marked: result.marked, manifest: result.manifest },
      { json },
    );
  }

  const parts: string[] = [];
  if (result.missingFromManifest.length > 0) {
    parts.push(
      `marked in .gitignore but ABSENT from ${MANIFEST_REL} (quay-init would not ignore them in a consumer project): ${result.missingFromManifest.join(" ")}`,
    );
  }
  if (result.undeclaredInGitignore.length > 0) {
    parts.push(
      `present in ${MANIFEST_REL} but NOT marked in .gitignore (an unreferenced rule — either mark it with a "${MARKER_TOKEN}" comment line directly above it, or drop it from the manifest): ${result.undeclaredInGitignore.join(" ")}`,
    );
  }
  return emitFail(`runtime-artifact drift — ${parts.join("; ")}`, { ...result }, { json });
}

if (isDirectEntry(import.meta, process.argv[1], "gitignore-runtime-coverage-check")) {
  process.exit(main());
}

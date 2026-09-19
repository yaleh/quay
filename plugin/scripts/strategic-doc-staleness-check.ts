#!/usr/bin/env node
// strategic-doc-staleness-check.ts — generic strategic-document staleness checker
// (tasks/gap-establish-daily-review-cadence-mechanism, AC2/AC3/AC8).
//
// WHAT IT DETECTS (by PATH EXISTENCE + RETIRED-MECHANISM REFERENCE — NOT a keyword grep):
//   A strategic document (docs/proposals/*.md, orchestration/*.md) or a ready-pool
//   promotion candidate (tasks/<id>.md) is STALE when it references a classic-pipeline script
//   file that ADR-022 (2026-08-03) deleted from the LIVE tree — `prepare-milestone.js`,
//   `execute-milestone.js`, `milestone-worktree.ts` — WITHOUT a retired/superseded annotation on
//   the same line. Live copies of those files now exist only in milestones/ and tmp/ archives.
//
//   This is the roadmap task's AC4 criterion ("无标注地指向已删除代码" — an UNANNOTATED reference
//   to DELETED code) generalized into a reusable script. The AC4 grep measure becomes this
//   checker's contract; the checker is not a one-off (its contract invariant
//   `reusable_not_one_off` is enforced by its mutation case + node:test suite).
//
//   Detection is deliberately NARROW: only references to the three DELETED script basenames count,
//   and only when unannotated. A line that merely names a phase (ProposalReview / PlanCheck) or an
//   EXISTING script (ready-pool-check.ts) is not stale — this avoids the keyword-checker
//   false-positive class this repo has recorded 6 times. An annotated reference (a line carrying
//   retired/superseded/historical/ADR-022 or a Chinese equivalent) is not counted.
//
// KNOWN-STALE BASELINE (shrink-only ratchet):
//   Strategic docs currently carrying unannotated references to deleted scripts. They are
//   reported on every run (audit trail) but NOT counted against the gate; the gate fails only on
//   a NEW stale doc (or a known-stale doc that GROWS). Each baseline entry is a live defect —
//   the review-cadence mechanism's checklist item (a) drives the shrink. The roadmap doc is
//   being fixed by the sibling task gap-roadmap-silently-stale-mark-superseded-or-rewrite-fast-mode.
//   The three orchestration/*.md entries were ADDED by gap-stale-check-orchestration-arm-is-a-dead-glob
//   (2026-08-05): the orchestration arm previously scanned ONLY *ROADMAP* (a dead glob that matched
//   zero files), so these pre-existing unannotated references were never seen. Widening the arm to
//   orchestration/*.md surfaced them; they are pre-existing, not new — baseline-not-counted.
//
// MODES:
//   default           — scan strategic docs (docs/proposals/*.md + orchestration/*.md);
//                       exit 0 iff no NEW stale doc beyond the KNOWN_STALE baseline.
//   --pool-candidate <task-id>  — judge ONE ready-pool promotion candidate task; exit 1 iff it
//                       references a deleted script without annotation (AC8 regression control:
//                       gap-prepare-milestone-no-size-aware-routing MUST be flagged).
//   --judge <path>    — judge one arbitrary .md file (relative to --root or absolute).
//   --json            — machine-readable output (the ## Contract measure reads stale_refs_found).
//
// Usage:
//   node --experimental-strip-types plugin/scripts/strategic-doc-staleness-check.ts [--root <dir>]
//       [--pool-candidate <task-id> | --judge <path>] [--json]
//
// Exit codes: 0 = PASS; 1 = FAIL (new stale doc / flagged candidate); 2 = usage/env error.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { helpExit, isDirectEntry } from "./gate-script-base.ts";
// REUSE (gap-judgepoolcandidate-keyword-vs-position): the same code-span stripper the ready-pool
// prose-prereq detector uses — single source, no parallel copy. gap-arch-import-cycles-zero: that
// single source is now the leaf module code-span-strip.ts (ready-pool-check.ts VALUE-imports
// judgePoolCandidate from this file, so importing stripCodeSpans FROM it was a value-level import cycle).
import { stripCodeSpans } from "./code-span-strip.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Classic-pipeline script files ADR-022 (2026-08-03) deleted from the LIVE tree. A reference to
 *  one of these basenames in a strategic doc or promotion candidate is a "reference to deleted
 *  code" unless annotated. This list is the PATH-EXISTENCE criterion: these paths no longer exist
 *  at a live location (only in milestones/ and tmp/ archives). */
export const DELETED_SCRIPTS = [
  "prepare-milestone.js",
  "execute-milestone.js",
  "milestone-worktree.ts",
] as const;

/** Match any of the deleted basenames (word-boundary anchored so `prepare-milestone.js` matches
 *  but `prepare-milestone` (bare mechanism name) does not — a bare phase/mechanism name is not a
 *  reference to deleted CODE, which is what the roadmap AC4 criterion targets). */
export const DELETED_SCRIPT_RE =
  /\b(prepare-milestone\.js|execute-milestone\.js|milestone-worktree\.ts)\b/g;

/** A line carrying one of these markers is an ANNOTATED reference (the roadmap task's "每个删除
 *  机制引用都带 retired/superseded 标注" rule) and is not stale. Chinese equivalents included for
 *  this repo's bilingual docs (已删除 = "already deleted" is an annotation in exactly the same way
 *  as 已废除). */
export const ANNOTATION_RE =
  /(retired|superseded|RETIRED|SUPERSEDED|historical|ADR-022|then-current|退役|废除|已退休|已废除|已删除)/;

/** STRONG annotation markers, applied across the ±1 line window. A marker like "historical" is
 *  too weak for the window — it often describes CONTENT near the reference ("historical STATUS
 *  prose") rather than the reference itself. Only a marker that unambiguously says the MECHANISM
 *  is retired/superseded suppresses a reference on a neighbouring line. */
export const STRONG_ANNOTATION_RE =
  /(retired|superseded|RETIRED|SUPERSEDED|ADR-022|退役|废除|已退休|已废除|已删除)/;

/** Annotation window: a reference is checked against its own line (all markers) and the immediate
 *  neighbours (strong markers only). Prose routinely wraps "已废除的经典 milestone 管线上——
 *  `prepare-milestone.js`/`execute-milestone.js`" across two lines, so the strong marker may sit
 *  on the line above the script names. */
export const ANNOTATION_WINDOW = 1;

/** Strategic docs currently known-stale (the shrink-only baseline, keyed by basename). Reported
 *  on every run but NOT counted against the gate; the gate fails only on a NEW stale doc. Entries
 *  must be REMOVED when the doc is fixed (annotated/rewritten) — review-cadence checklist item (a)
 *  drives that shrink. */
export const KNOWN_STALE_DOCS: ReadonlySet<string> = new Set([
  "exp5-deliverable-improvements.md",
  "exp6-queue-driven-concurrent-executor.md",
  "quay-adaptive-task-packing-and-overlap-concurrency.md",
  "quay-harness-crystallization-roadmap.md",
  "quay-milestone-workflow-git-crystallization.md",
  "quay-workflow-agent-distribution.md",
  // orchestration/*.md pre-existing stale refs surfaced by the dead-glob fix
  // (gap-stale-check-orchestration-arm-is-a-dead-glob, 2026-08-05):
  "FINDING-roadmap-predates-ADR-022-retirement-2026-08-05.md",
  "escalations.md",
  "tick-log.md",
]);

/** One stale reference: an unannotated mention of a deleted script on a single line. */
export interface StaleRef {
  line: number;
  hit: string;
  snippet: string;
}

/** Scan one document's text for unannotated references to deleted classic-pipeline scripts.
 *  Fenced code blocks (```) are skipped: a verbatim command/output block is EVIDENCE, not a live
 *  reference — a doc that pastes the checker's own output (which necessarily names the deleted
 *  scripts) must not flag itself. */
export function scanText(src: string): StaleRef[] {
  const refs: StaleRef[] = [];
  const lines = src.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    DELETED_SCRIPT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DELETED_SCRIPT_RE.exec(line))) {
      // Annotated → not stale. Own line: all markers. Neighbouring lines (wrapped prose:
      // "…已废除的经典 milestone 管线上——\n`prepare-milestone.js`…"): STRONG markers only.
      let annotated = ANNOTATION_RE.test(line);
      if (!annotated) {
        for (let j = Math.max(0, i - ANNOTATION_WINDOW); j <= Math.min(lines.length - 1, i + ANNOTATION_WINDOW); j++) {
          if (j === i) continue;
          if (STRONG_ANNOTATION_RE.test(lines[j])) { annotated = true; break; }
        }
      }
      if (annotated) continue;
      refs.push({ line: i + 1, hit: m[0], snippet: line.trim().slice(0, 90) });
    }
  }
  return refs;
}

/** One scanned strategic doc. */
export interface DocResult {
  rel: string;
  refs: StaleRef[];
  knownStale: boolean;
}

/** Collect the strategic-doc scan targets under `root` (docs/proposals/*.md + orchestration/*.md).
 *  The orchestration arm covers ALL .md files (not just the ROADMAP glob): the naming convention
 *  there is the SPEC/SYNTHESIS/FINDING prefix or an uppercase phrase (outer-phase-goal.md,
 *  manager-phase-goal.md, the loop tick docs, the SPEC/SYNTHESIS/FINDING files), so a ROADMAP glob
 *  matched ZERO files — a dead arm that never scanned the 43+ strategic orchestration docs. Fixed
 *  by gap-stale-check-orchestration-arm-is-a-dead-glob (2026-08-05). */
export function collectStrategicDocs(root: string): string[] {
  const files: string[] = [];
  const proposalDir = path.join(root, "docs", "proposals");
  if (fs.existsSync(proposalDir)) {
    for (const e of fs.readdirSync(proposalDir)) {
      if (e.endsWith(".md")) files.push(path.join("docs", "proposals", e));
    }
  }
  const orchDir = path.join(root, "orchestration");
  if (fs.existsSync(orchDir)) {
    for (const e of fs.readdirSync(orchDir)) {
      if (e.endsWith(".md")) files.push(path.join("orchestration", e));
    }
  }
  return files.sort();
}

/** Scan all strategic docs under `root`. */
export function scanStrategicDocs(root: string): DocResult[] {
  const out: DocResult[] = [];
  for (const rel of collectStrategicDocs(root)) {
    let src = "";
    try {
      src = fs.readFileSync(path.join(root, rel), "utf8");
    } catch {
      continue;
    }
    out.push({ rel, refs: scanText(src), knownStale: KNOWN_STALE_DOCS.has(path.basename(rel)) });
  }
  return out;
}

/** Judge ONE ready-pool promotion candidate task (tasks/<id>.md). Returns null when the task file
 *  does not exist (the pool should treat a missing file as an error, not a clean candidate). */
export function judgePoolCandidate(root: string, taskId: string): StaleRef[] | null {
  const abs = path.join(root, "tasks", `${taskId}.md`);
  if (!fs.existsSync(abs)) return null;
  // POSITION-NOT-KEYWORD (gap-judgepoolcandidate-keyword-vs-position — hard rule 2): a mention of a
  // deleted script inside an inline code span (backticks) is a QUOTE, not a live reference — a
  // provenance note ("Split … a real `prepare-milestone.js` ProposalReview run …"), an example, or a
  // historical record. DIR-103 line 25 ("Split 2026-08-01 … a real `prepare-milestone.js`
  // ProposalReview run …") was mis-flagged this way and permanently marked retired-mechanism even
  // though the task's subject is the LIVE acceptance-runner.ts. Strip inline code spans BEFORE
  // matching, reusing the stripCodeSpans technique ready-pool-check.ts uses for its prose-prereq
  // detector (single source, no parallel copy). Line-preserving and FENCE-AWARE: fence markers are
  // left intact (a bare ``` must not be turned into a stray backtick, or scanText's own ```-skip
  // below would silently stop skipping fenced content), and stripCodeSpans is applied only OUTSIDE
  // fences — so StaleRef.line stays the true file line and fenced verbatim output is still skipped.
  const lines = fs.readFileSync(abs, "utf8").split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) { inFence = !inFence; continue; }
    if (!inFence) lines[i] = stripCodeSpans(lines[i]);
  }
  return scanText(lines.join("\n"));
}

function usage(): never {
  console.error(
    "usage: node strategic-doc-staleness-check.ts [--root <dir>] [--pool-candidate <task-id> | --judge <path>] [--json]\n" +
      "Exit: 0 = PASS; 1 = FAIL (new stale strategic doc, or flagged pool candidate); 2 = usage/env error.",
  );
  process.exit(2);
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit("usage: node strategic-doc-staleness-check.ts [--root <dir>] [--pool-candidate <task-id> | --judge <path>] [--json]");
  const asJson = args.includes("--json");
  const rootArg = args.indexOf("--root");
  const root = path.resolve(rootArg !== -1 ? args[rootArg + 1] : process.cwd());
  const pcIdx = args.indexOf("--pool-candidate");
  const judgeIdx = args.indexOf("--judge");
  const poolCandidate = pcIdx !== -1 ? args[pcIdx + 1] : undefined;
  const judgePath = judgeIdx !== -1 ? args[judgeIdx + 1] : undefined;
  if (poolCandidate !== undefined && judgePath !== undefined) usage();
  if (!fs.existsSync(root)) {
    console.error(`ERROR: scan root not found: ${root}`);
    process.exit(2);
  }

  // ── pool-candidate mode (AC8) ───────────────────────────────────────────────────────────────────
  if (poolCandidate !== undefined) {
    const refs = judgePoolCandidate(root, poolCandidate);
    if (refs === null) {
      const msg = `ERROR: pool-candidate task not found: tasks/${poolCandidate}.md`;
      if (asJson) console.log(JSON.stringify({ mode: "pool-candidate", task: poolCandidate, error: msg }));
      else console.error(msg);
      return 2;
    }
    const flagged = refs.length > 0;
    if (asJson) {
      console.log(JSON.stringify({ mode: "pool-candidate", task: poolCandidate, flagged, refs }, null, 2));
    } else if (flagged) {
      console.log(`strategic-doc-staleness-check --pool-candidate ${poolCandidate}`);
      console.log(`FLAGGED: ${refs.length} stale reference(s) to deleted classic-pipeline scripts (unannotated)`);
      for (const r of refs) console.log(`  tasks/${poolCandidate}.md:${r.line}  [${r.hit}]  ${r.snippet}`);
      console.log("FAIL: candidate references a retired mechanism");
    } else {
      console.log(`strategic-doc-staleness-check --pool-candidate ${poolCandidate}: clean (no stale refs)`);
    }
    return flagged ? 1 : 0;
  }

  // ── --judge mode (tests / ad-hoc one-file check) ───────────────────────────────────────────────
  if (judgePath !== undefined) {
    const abs = path.isAbsolute(judgePath) ? judgePath : path.join(root, judgePath);
    if (!fs.existsSync(abs)) {
      console.error(`ERROR: --judge file not found: ${judgePath}`);
      return 2;
    }
    const refs = scanText(fs.readFileSync(abs, "utf8"));
    const flagged = refs.length > 0;
    if (asJson) {
      console.log(JSON.stringify({ mode: "judge", file: judgePath, flagged, refs }, null, 2));
    } else if (flagged) {
      console.log(`strategic-doc-staleness-check --judge ${judgePath}`);
      console.log(`FLAGGED: ${refs.length} stale reference(s) to deleted classic-pipeline scripts (unannotated)`);
      for (const r of refs) console.log(`  ${judgePath}:${r.line}  [${r.hit}]  ${r.snippet}`);
    } else {
      console.log(`strategic-doc-staleness-check --judge ${judgePath}: clean (no stale refs)`);
    }
    return flagged ? 1 : 0;
  }

  // ── default doc gate (AC2/AC3, wired into run_static_checks) ───────────────────────────────────
  const docs = scanStrategicDocs(root);
  const newDocs = docs.filter((d) => d.refs.length > 0 && !d.knownStale);
  const knownFlagging = docs.filter((d) => d.refs.length > 0 && d.knownStale);
  const newRefs = newDocs.reduce((n, d) => n + d.refs.length, 0);
  const knownRefs = knownFlagging.reduce((n, d) => n + d.refs.length, 0);
  const ok = newDocs.length === 0;

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          mode: "strategic-docs",
          scanned: docs.length,
          stale_refs_found: newRefs, // the ## Contract measure (band 0)
          new_stale_docs: newDocs.map((d) => ({ rel: d.rel, refs: d.refs.length })),
          known_stale_docs: knownFlagging.map((d) => ({ rel: d.rel, refs: d.refs.length })),
          known_stale_refs: knownRefs,
          ok,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`strategic-doc-staleness-check — ${docs.length} strategic doc(s) scanned (docs/proposals + orchestration/*.md)`);
    console.log(`stale_refs_found (new, beyond baseline): ${newRefs}`);
    if (knownFlagging.length) {
      console.log(`known-stale (baseline, reported not counted): ${knownFlagging.length} doc(s), ${knownRefs} ref(s)`);
      for (const d of knownFlagging) console.log(`  ${d.rel}: ${d.refs.length}`);
    }
    for (const d of newDocs) {
      console.log(`NEW-STALE ${d.rel}: ${d.refs.length} unannotated reference(s) to deleted scripts`);
      for (const r of d.refs.slice(0, 8)) console.log(`  ${d.rel}:${r.line}  [${r.hit}]  ${r.snippet}`);
    }
    if (ok) {
      console.log("PASS: no NEW stale strategic doc beyond the KNOWN_STALE baseline");
    } else {
      console.log(`FAIL: ${newDocs.length} NEW stale strategic doc(s) — a strategic doc references deleted code without annotation`);
    }
  }
  return ok ? 0 : 1;
}

if (isDirectEntry(import.meta, undefined, "strategic-doc-staleness-check")) {
  process.exit(main(process.argv));
}

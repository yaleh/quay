#!/usr/bin/env node
// phase-declare.ts — ADR-008 two-phase breathing (expansion | convergence), MINIMAL mechanization:
// RECORD the current phase in a machine-readable carrier, and let a HUMAN declare a switch.
//
// (tasks/gap-adr008-phase-state-mechanization-minimal; the ADR itself is
//  adr/ADR-008-two-phase-breathing-expansion-convergence.md, still status: proposed.)
//
// ── What this is, and what it deliberately is NOT ────────────────────────────────────────────────
// ADR-008's enforcement note promised the dashboard would record the current phase and the trigger
// of each switch. Two months later nothing recorded it: docs/analysis/crystallization-the-
// contraction-phase-has-no-mechanism.md (2026-08-04) diagnosed expansion as automatic and
// contraction as 100% human, with ZERO mechanism-originated contractions, and a repo-wide search
// for a `phase: expansion|convergence` field returned 0 hits.
//
// This script lands the RECORDING half only. AC3 is explicit and load-bearing: there is NO
// threshold-triggered auto-switch anywhere in this file. Read the code, not this comment — the
// only assignment to the carrier's `phase` is `opts.to`, i.e. the value a human typed after
// `--to`. The L_D reading below is RECORDED (evidence for the human), never CONSULTED: no `if`,
// no comparison, and no control-flow path anywhere reads `reading.flagged`/`reading.ratio` in
// order to choose or write a phase. That direction (a number deciding the phase) is the one
// docs/references/维度边界与结晶——从熔融实现中发现原则.md §3 argues is backwards: the machine
// measures, the human supplies the direction. The reading exists so the human's declaration is
// auditable, not so the machine can act alone.
//
// ── Why the carrier is .quay/two-phase-state.json and not dashboard.md (AC1's decision rule) ─────
// AC1 pins the choice to a measurement: dashboard.md if it has a real commit in the last 30 days,
// else a new .quay/ JSON file. Measured 2026-09-13:
//     git log -1 --format=%cI -- experiments/quay-perpetual-stream/dashboard.md
//     → 2026-08-02T18:30:26+00:00   (>30 days stale; its `milestone_counter` has read 206 since
//                                    2026-07-31 — ADR-022 retired the classic pipeline and the
//                                    2026-09-04 outer→manager merge removed its maintainer)
// ⇒ NOT an active state carrier. Writing a `phase` field into a file nobody updates would produce
// exactly the illusion CLAUDE.md 硬规则 3b names: a field that looks maintained while no reader
// exists. The carrier is therefore `.quay/two-phase-state.json` — parseable by `jq .phase` with no
// prose search (AC1).
//
// ── The reading: why it is computed here instead of calling the cited script ─────────────────────
// AC2 names `plugin/scripts/git-lens-l-d-code-doc-ratio.ts` (or `…-l-g-structural-drift.ts`) as the
// source of the L_D/L_S snapshot. Measured 2026-09-13, that path does not exist: the git-lens
// proxies were retired as zero-call scripts to
// `archive/2026-09-07-zero-call-scripts/plugin/scripts/git-lens-*.ts`, and the surviving
// `experiments/quay-perpetual-stream/scripts/git-lens-*.ts` entries are DANGLING SYMLINKS onto the
// removed plugin/scripts path (`git-lens-selfcheck.sh`, which runs them, is broken for the same
// reason). The archived copy is not runnable either — it imports `./gate-script-base.ts`, which was
// not archived beside it. So the AC's literal instruction cannot be followed; its INTENT — "a real
// reading, not a placeholder" — is what this file implements, by re-implementing the archived rule
// verbatim (doc = /\.(md|txt)$/i, code = everything else; docLines/codeLines are added+deleted over
// a real `git diff --numstat` range; FLAGGED when ratio > 3.0 and docLines > 20). Provenance is
// recorded in the carrier (`reading.rule`) so a reader can audit exactly what was measured.
//
// ── The carrier's shape ──────────────────────────────────────────────────────────────────────────
//   {
//     "phase": "expansion" | "convergence",   ← current value; AC1 reads exactly this
//     "declaredAt": "<ISO>", "reason": "<human sentence>",
//     "reading": { … },                        ← the L_D snapshot taken AT declaration time
//     "history": [ {phase, declaredAt, reason, reading}, … ]   ← every declaration, oldest first
//   }
// The top-level three fields mirror `history[history.length - 1]`; the array is what makes a
// declaration auditable AFTER the fact (AC4 compares a declaration's timestamp against the landing
// commit of this file). Nothing here is a counter and nothing is aggregated — an operator reading
// the file sees the same bytes a human wrote.
//
// ── Failure modes (fail-closed, nothing written) ─────────────────────────────────────────────────
//   1  REFUSED  — `--reason` missing or below MIN_REASON_CHARS non-whitespace chars (the AC2 negative
//                 control: a reason-less switch is structurally blocked at the write point, the same
//                 discipline as dispatch-record.ts), OR the existing carrier is unparseable (silently
//                 clobbering a corrupt file would destroy the history this file exists to keep).
//   2  USAGE    — `--to` missing or not `expansion`|`convergence`, or an unknown flag.
//   3  NO-READING — git could not produce a numstat range (not a repo / no commits). A declaration
//                 whose snapshot is absent would be exactly the placeholder AC2 excludes, so it is
//                 refused rather than written with a null reading.
//   0  written.
//
// Run:
//   node --experimental-strip-types plugin/scripts/phase-declare.ts \
//        --to <expansion|convergence> --reason "<one sentence: what triggered this switch>" \
//        [--root <repo>] [--window <n>] [--json]
//
//   --root    repo root holding the carrier (default: derived from this file's location — the
//             checkout you actually invoked, so a declaration made inside a task worktree lands in
//             that worktree and travels with its branch).
//   --window  how many trailing commits the L_D snapshot spans (default 50). Clamped to the
//             available history: a repo with fewer commits is read from its first commit (diffed
//             against the empty tree), never an error.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";

/** The carrier, repo-relative. AC1: a machine-readable JSON file, parseable without prose search. */
export const STATE_FILE_REL = ".quay/two-phase-state.json";

/** The two legal phases. Exported so the test and any reader share ONE spelling. */
export const PHASES = ["expansion", "convergence"] as const;
export type Phase = (typeof PHASES)[number];

/** Same threshold as dispatch-record.ts: a reason below this many non-whitespace chars is ABSENT.
 *  "换相了" / "x" / "" are placeholders, not the one-sentence trigger AC2 requires. */
export const MIN_REASON_CHARS = 8;

/** Default L_D window: how many trailing commits the snapshot spans. */
export const DEFAULT_WINDOW = 50;

/** The git empty tree — the diff base for a repo whose history is shorter than the window. Its sha
 *  is a fixed property of git's object model (sha1 of an empty tree), not a repo-specific value. */
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

// ── L_D, re-implemented from the archived git-lens rule (see the header for why) ─────────────────
// The two constants below are the ARCHIVED proxy's own defaults (FLAG_THRESHOLD=3.0,
// MIN_DOC_LINES=20), kept identical so a reading taken here means the same thing a reading taken
// there did. They parameterize the RECORDED verdict only.
export const FLAG_THRESHOLD = 3.0;
export const MIN_DOC_LINES = 20;

const DOC_RE = /\.(md|txt)$/i;

export interface NumstatRow {
  added: number;
  deleted: number;
  path: string;
}

export interface Reading {
  rule: string;
  range: string;
  head: string;
  commitCount: number;
  docLines: number;
  codeLines: number;
  ratio: number | null;
  verdict: string;
  flagged: boolean;
}

/** `git diff --numstat` text → rows. Binary files report `-\t-\tpath` and count as 0 lines. */
export function parseNumstat(text: string): NumstatRow[] {
  const rows: NumstatRow[] = [];
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!m) continue;
    const [, addedRaw, deletedRaw, p] = m;
    rows.push({
      added: addedRaw === "-" ? 0 : parseInt(addedRaw, 10),
      deleted: deletedRaw === "-" ? 0 : parseInt(deletedRaw, 10),
      path: p,
    });
  }
  return rows;
}

/** DOC iff the path ends .md/.txt (the archived rule: everything else — .ts/.mjs/.sh/.json/.yml —
 *  counts as code, matching "executable > prose"). */
export function classify(filePath: string): "doc" | "code" {
  return DOC_RE.test(filePath) ? "doc" : "code";
}

/** The pure arithmetic + verdict, given parsed rows. Same shape and same thresholds as the
 *  archived proxy's computeRatio. */
export function computeRatio(
  rows: NumstatRow[],
  opts: { flagThreshold?: number; minDocLines?: number } = {},
): { docLines: number; codeLines: number; ratio: number | null; verdict: string; flagged: boolean } {
  const flagThreshold = opts.flagThreshold ?? FLAG_THRESHOLD;
  const minDocLines = opts.minDocLines ?? MIN_DOC_LINES;
  let docLines = 0;
  let codeLines = 0;
  for (const r of rows) {
    const total = r.added + r.deleted;
    if (classify(r.path) === "doc") docLines += total;
    else codeLines += total;
  }
  if (docLines === 0 && codeLines === 0) {
    return { docLines, codeLines, ratio: null, verdict: "N/A", flagged: false };
  }
  const ratio = codeLines === 0 ? Infinity : docLines / codeLines;
  const flagged = docLines > minDocLines && ratio > flagThreshold;
  return { docLines, codeLines, ratio, verdict: flagged ? "FLAGGED (prose-heavy)" : "PASS", flagged };
}

function git(args: string[], root: string): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

/**
 * Take the L_D snapshot over the trailing `window` commits of `root`'s HEAD.
 * Throws when git cannot answer — the caller turns that into exit 3 (NO-READING), never a null field.
 */
export function takeLdReading(root: string, window: number = DEFAULT_WINDOW): Reading {
  const head = git(["rev-parse", "HEAD"], root).trim();
  const commitCount = parseInt(git(["rev-list", "--count", "HEAD"], root).trim(), 10);
  // Fewer commits than the window ⇒ measure the whole history by diffing against the empty tree.
  const base = commitCount > window ? `HEAD~${window}` : EMPTY_TREE;
  const range = `${base}..HEAD`;
  const rows = parseNumstat(git(["diff", "--numstat", range], root));
  const r = computeRatio(rows);
  return {
    rule: "L_D code:doc line-delta ratio (archived git-lens-l-d-code-doc-ratio rule: doc=/.(md|txt)$/i, ratio=docLines/codeLines, flagged = ratio > 3.0 AND docLines > 20)",
    range,
    head,
    commitCount,
    docLines: r.docLines,
    codeLines: r.codeLines,
    // JSON has no Infinity literal; a code-less range records null + the verdict says why.
    ratio: r.ratio === Infinity ? null : r.ratio,
    verdict: r.ratio === Infinity ? "FLAGGED (prose-heavy: codeLines=0)" : r.verdict,
    flagged: r.flagged || r.ratio === Infinity,
  };
}

// ── carrier I/O ──────────────────────────────────────────────────────────────────────────────────

export interface Declaration {
  phase: Phase;
  declaredAt: string;
  reason: string;
  reading: Reading;
}

export interface CarrierState {
  phase: Phase;
  declaredAt: string;
  reason: string;
  reading: Reading;
  history: Declaration[];
}

export function carrierPath(root: string): string {
  return path.join(root, STATE_FILE_REL);
}

/** Read the existing carrier. `exists:false` for a first declaration; throws for an unparseable or
 *  structurally-wrong file (silently replacing it would destroy the very history this file keeps). */
export function readCarrier(root: string): { exists: boolean; history: Declaration[] } {
  const p = carrierPath(root);
  if (!fs.existsSync(p)) return { exists: false, history: [] };
  const raw = fs.readFileSync(p, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${STATE_FILE_REL} exists but is not valid JSON (${(e as Error).message}) — refusing to overwrite; fix or remove it first`);
  }
  const history = (parsed as { history?: unknown }).history;
  if (!Array.isArray(history)) {
    throw new Error(`${STATE_FILE_REL} has no \`history\` array — refusing to overwrite an unrecognized shape`);
  }
  return { exists: true, history: history as Declaration[] };
}

/** Build the new carrier state: append the declaration to history, mirror the top level. */
export function buildState(prev: Declaration[], d: Declaration): CarrierState {
  const history = [...prev, d];
  return { phase: d.phase, declaredAt: d.declaredAt, reason: d.reason, reading: d.reading, history };
}

// ── arg parsing ──────────────────────────────────────────────────────────────────────────────────

interface ParsedArgs {
  to?: string;
  reason?: string;
  root?: string;
  window?: number;
  json: boolean;
  error?: string;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const need = (): string | undefined => argv[++i];
    if (a === "--to") out.to = need();
    else if (a === "--reason") out.reason = need();
    else if (a === "--root") out.root = need();
    else if (a === "--window") {
      const v = need();
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) return { ...out, error: `--window expects a positive integer, got ${JSON.stringify(v)}` };
      out.window = n;
    } else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.error = "help";
    else return { ...out, error: `unknown argument: ${a}` };
  }
  return out;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────

const USAGE = `phase-declare.ts — declare the ADR-008 two-phase breathing state (record only, no auto switch).

Usage:
  node --experimental-strip-types plugin/scripts/phase-declare.ts \\
       --to <expansion|convergence> --reason "<one sentence>" [--root <repo>] [--window <n>] [--json]

Exit: 0 written | 1 refused (no/thin --reason, or unreadable carrier) | 2 usage | 3 no reading`;

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error === "help") {
    console.log(USAGE);
    process.exit(0);
  }
  if (opts.error) {
    console.error(`phase-declare: ${opts.error}\n\n${USAGE}`);
    process.exit(2);
  }
  if (!opts.to || !PHASES.includes(opts.to as Phase)) {
    console.error(`phase-declare: --to must be one of ${PHASES.join("|")} (got ${JSON.stringify(opts.to ?? null)})\n\n${USAGE}`);
    process.exit(2);
  }
  const reason = (opts.reason ?? "").trim();
  const reasonChars = reason.replace(/\s+/g, "").length;
  if (reasonChars < MIN_REASON_CHARS) {
    console.error(
      `phase-declare: REFUSED — --reason is missing or below ${MIN_REASON_CHARS} non-whitespace chars ` +
        `(got ${reasonChars}). A phase switch without a recorded trigger is not auditable; nothing was written.`,
    );
    process.exit(1);
  }

  const root = opts.root ? path.resolve(opts.root) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

  let prev: Declaration[];
  try {
    prev = readCarrier(root).history;
  } catch (e) {
    console.error(`phase-declare: REFUSED — ${(e as Error).message}`);
    process.exit(1);
  }

  // The snapshot is taken BEFORE any write, and a failure here refuses the declaration outright:
  // a record without the reading AC2 requires is the placeholder that AC excludes.
  let reading: Reading;
  try {
    reading = takeLdReading(root, opts.window ?? DEFAULT_WINDOW);
  } catch (e) {
    console.error(`phase-declare: NO-READING — git could not produce the L_D snapshot: ${(e as Error).message}`);
    process.exit(3);
  }

  const declaration: Declaration = {
    phase: opts.to as Phase,
    declaredAt: new Date().toISOString(),
    reason,
    reading,
  };
  const state = buildState(prev, declaration);

  const p = carrierPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2) + "\n", "utf8");

  if (opts.json) {
    console.log(JSON.stringify(declaration, null, 2));
  } else {
    console.log(`phase-declare: phase=${declaration.phase} at ${declaration.declaredAt}`);
    console.log(`  reason : ${declaration.reason}`);
    console.log(
      `  L_D    : docLines=${reading.docLines} codeLines=${reading.codeLines} ` +
        `ratio=${reading.ratio === null ? "n/a" : reading.ratio.toFixed(3)} verdict=${reading.verdict} (${reading.range})`,
    );
    console.log(`  carrier: ${path.relative(root, p)} (${state.history.length} declaration(s) recorded)`);
  }
  process.exit(0);
}

if (isDirectEntry(import.meta, undefined, "phase-declare")) {
  main();
}

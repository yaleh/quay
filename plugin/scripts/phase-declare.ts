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
//   node --experimental-strip-types plugin/scripts/phase-declare.ts \
//        --staleness [--root <repo>] [--json]
//
//   --root    repo root holding the carrier (default: derived from this file's location — the
//             checkout you actually invoked, so a declaration made inside a task worktree lands in
//             that worktree and travels with its branch).
//   --window  how many trailing commits the L_D snapshot spans (default 50). Clamped to the
//             available history: a repo with fewer commits is read from its first commit (diffed
//             against the empty tree), never an error.
//   --staleness  READ-ONLY: report how far the CURRENT declaration is from HEAD — commits since,
//             newly added goals since, and days since — instead of declaring a phase. Writes no
//             file. See the section above `readPhaseStaleness` for what it is (and is not) for.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDirectEntry, parseArgs as baseParseArgs } from "./gate-script-base.ts";

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

// ── staleness reading (READ-ONLY) ────────────────────────────────────────────────────────────────
// tasks/gap-adr008-phase-declaration-staleness-reading (2026-10-22). The carrier in this file has a
// reader count of ZERO: `grep -n "two-phase-state|phase-declare" plugin/scripts/*.ts` outside this
// file returns nothing, so "the declaration may be stale" was only ever observable to a human who
// remembered to open the JSON. `readPhaseStaleness` turns that into a reading — commits since the
// declaration, goals newly added since it, and the number of days — and NOTHING else:
//   • it writes no file (AC5: no writeFileSync/appendFileSync/renameSync anywhere below);
//   • it sets no threshold and is not consulted by any control-flow decision, so it cannot switch
//     the phase (Plan §4: no auto-switch is added — the whole point of this task is a VISIBLE
//     number, not a decision);
//   • when it cannot read, it says so: `evaluated:false` with `commitsSince: null` — ⛔ never 0,
//     which would be indistinguishable from "the declaration was made at HEAD" (硬规则 3b).
//
// The goal predicate is by filename: `goals/` also holds `kind: criterion` files named AC-<n>, which
// are NOT goals (127 of them were added in the same window), and filtering them out is what
// reproduces the finding's count (30 GOAL-ids added since 2026-09-13). The authority on "is this a
// goal file" is each file's own frontmatter `kind:`; the name prefix is the cheap equivalent used
// here, and it is the SAME predicate the finding's command used (`git log --diff-filter=A -- goals/`
// piped through `GOAL-[0-9]+`), so the reading and the finding count the same objects.
const GOAL_ID_RE = /^(GOAL-\d+)/;

/** Milliseconds per day — a unit conversion, not a threshold. */
const DAY_MS = 86_400_000;

export interface PhaseStalenessReading {
  /** False whenever the carrier, its shape, or a git read could not be evaluated. */
  evaluated: boolean;
  /** Names the exact unreadable condition; `null` only when evaluated. */
  reason: string | null;
  phase: Phase | null;
  declaredAt: string | null;
  /** How many declarations the carrier's `history` holds (1 = it has never been re-declared). */
  declarations: number | null;
  /** `git rev-list --count --since=<declaredAt> HEAD`; null when not evaluated (⛔ not 0). */
  commitsSince: number | null;
  /** GOAL-<n> ids of files added under `goals/` since <declaredAt>, sorted; null when not evaluated. */
  newGoalsSince: string[] | null;
  /** Whole days (2 decimal places) between <declaredAt> and `now`; null when not evaluated, or
   *  when the caller's `now` seam is not a valid instant (unknown clock ≠ zero days). */
  daysSince: number | null;
}

/** The "could not evaluate" value — every quantity is null, never a plausible-looking zero. */
function stalenessNotEvaluated(reason: string): PhaseStalenessReading {
  return {
    evaluated: false,
    reason,
    phase: null,
    declaredAt: null,
    declarations: null,
    commitsSince: null,
    newGoalsSince: null,
    daysSince: null,
  };
}

/**
 * Read how far HEAD is from the carrier's CURRENT declaration. Pure with respect to the filesystem
 * (read-only) and never throws: every failure becomes `evaluated:false` + a distinguishable reason.
 *
 * `root` is the repo holding the carrier; `opts.now` is a deterministic-clock seam for tests.
 */
export function readPhaseStaleness(root: string, opts: { now?: Date } = {}): PhaseStalenessReading {
  const repo = path.resolve(root);
  const p = carrierPath(repo);

  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === "ENOENT"
      ? stalenessNotEvaluated(
          `carrier-missing: ${STATE_FILE_REL} does not exist under ${repo} — there is no declaration to measure the distance from`,
        )
      : stalenessNotEvaluated(`carrier-unreadable: ${STATE_FILE_REL} could not be read (${(e as Error).message})`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // Distinct from carrier-missing: the file IS there and its age is unknown, not zero.
    return stalenessNotEvaluated(
      `carrier-unparseable: ${STATE_FILE_REL} is not valid JSON (${(e as Error).message}) — the declaration exists but could not be read`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return stalenessNotEvaluated(`carrier-shape-unrecognized: ${STATE_FILE_REL} is not a JSON object`);
  }
  const state = parsed as Partial<CarrierState>;
  if (typeof state.phase !== "string" || !PHASES.includes(state.phase as Phase)) {
    return stalenessNotEvaluated(
      `carrier-shape-unrecognized: ${STATE_FILE_REL} has no legal phase value (${JSON.stringify(state.phase ?? null)})`,
    );
  }
  if (typeof state.declaredAt !== "string" || !Number.isFinite(Date.parse(state.declaredAt))) {
    return stalenessNotEvaluated(
      `carrier-shape-unrecognized: ${STATE_FILE_REL} has no parseable declaredAt (${JSON.stringify(state.declaredAt ?? null)})`,
    );
  }
  if (!Array.isArray(state.history)) {
    return stalenessNotEvaluated(`carrier-shape-unrecognized: ${STATE_FILE_REL} has no history array`);
  }
  const declaredAt = state.declaredAt;

  let commitsSince: number;
  try {
    const out = git(["rev-list", "--count", `--since=${declaredAt}`, "HEAD"], repo).trim();
    const n = Number(out);
    if (!Number.isInteger(n) || n < 0) throw new Error(`unexpected output ${JSON.stringify(out)}`);
    commitsSince = n;
  } catch (e) {
    return stalenessNotEvaluated(
      `git-unavailable: git rev-list --count --since=${declaredAt} HEAD failed in ${repo} (${(e as Error).message})`,
    );
  }

  let newGoalsSince: string[];
  try {
    const out = git(["log", `--since=${declaredAt}`, "--diff-filter=A", "--name-only", "--format=", "--", "goals/"], repo);
    const ids = new Set<string>();
    for (const line of out.split("\n")) {
      const rel = line.trim();
      if (!rel) continue;
      const m = path.posix.basename(rel).match(GOAL_ID_RE);
      if (m) ids.add(m[1]);
    }
    newGoalsSince = [...ids].sort();
  } catch (e) {
    return stalenessNotEvaluated(
      `git-unavailable: git log --diff-filter=A --name-only -- goals/ failed in ${repo} (${(e as Error).message})`,
    );
  }

  const nowMs = (opts.now ?? new Date()).getTime();
  const daysSince = Number.isFinite(nowMs)
    ? Math.round(((nowMs - Date.parse(declaredAt)) / DAY_MS) * 100) / 100
    : null;

  return {
    evaluated: true,
    reason: null,
    phase: state.phase as Phase,
    declaredAt,
    declarations: state.history.length,
    commitsSince,
    newGoalsSince,
    daysSince,
  };
}

// ── arg parsing ──────────────────────────────────────────────────────────────────────────────────

interface ParsedArgs {
  to?: string;
  reason?: string;
  root?: string;
  window?: number;
  /** READ-ONLY staleness reading instead of a declaration (never combined with --to/--reason). */
  staleness: boolean;
  json: boolean;
  error?: string;
}

// Thin adapter over the ONE canonical parser (gate-script-base.ts `parseArgs`) — this file carried one
// of the six hand-rolled token loops filed by a `semantic-dedup-scan` pass as
// `parse-args-adoption-split` (routine `semantic-dedup-scan`, runId `semantic-dedup-scan-1791908616513`,
// verdict `divergent-implementation`). It keeps this command's flag set and its ERROR-RETURN model
// (`error` is a field on the returned object, read by `main`) — errors are handed back by the shared
// parser (`errors: "return"`) rather than exiting, and `--help` becomes the sentinel `error: "help"`
// that `main` prints USAGE for. `argv` is the SLICED tail, so the two leading slots the shared parser
// skips are re-attached here.
export function parseArgs(argv: string[]): ParsedArgs {
  const parsed = baseParseArgs(["node", "phase-declare", ...argv], {
    minArgs: 0,
    usage:
      '--to <expansion|convergence> --reason "<one sentence>" [--root <repo>] [--window <n>] [--json]\n' +
      "       --staleness [--root <repo>] [--json]",
    help: "return",
    errors: "return",
    unknown: "reject",
    flags: {
      to: { type: "string" },
      reason: { type: "string" },
      root: { type: "string" },
      window: { type: "string" },
      staleness: { type: "boolean" },
      json: { type: "boolean" },
    },
  });
  const str = (v: string | boolean | undefined): string | undefined => (typeof v === "string" ? v : undefined);
  const out: ParsedArgs = {
    to: str(parsed.flags.to),
    reason: str(parsed.flags.reason),
    root: str(parsed.flags.root),
    staleness: parsed.flags.staleness === true,
    json: parsed.flags.json === true,
  };
  if (parsed.help) return { ...out, error: "help" };
  if (parsed.error) return { ...out, error: parsed.error };
  if (parsed.args.length > 0) return { ...out, error: `unknown argument: ${parsed.args[0]}` };
  if (parsed.flags.window !== undefined) {
    // "" is the shared parser's spelling for a flag that carried NO value; the retired `need()` read
    // `argv[++i]` past the end as undefined, and the message below interpolated that as `undefined`.
    const raw = parsed.flags.window;
    const v = raw === "" ? undefined : String(raw);
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) return { ...out, error: `--window expects a positive integer, got ${JSON.stringify(v)}` };
    out.window = n;
  }
  return out;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────

const USAGE = `phase-declare.ts — declare the ADR-008 two-phase breathing state (record only, no auto switch).

Usage:
  node --experimental-strip-types plugin/scripts/phase-declare.ts \\
       --to <expansion|convergence> --reason "<one sentence>" [--root <repo>] [--window <n>] [--json]
  node --experimental-strip-types plugin/scripts/phase-declare.ts \\
       --staleness [--root <repo>] [--json]      (READ-ONLY: no file is written)

Exit: 0 written | 1 refused (no/thin --reason, or unreadable carrier) | 2 usage | 3 no reading
      (with --staleness: 0 = read and evaluated, 3 = NOT-EVALUATED — a distinct value, see its reason)`;

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
  const repoRoot = opts.root ? path.resolve(opts.root) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

  // READ-ONLY face (tasks/gap-adr008-phase-declaration-staleness-reading): report the distance from
  // the current declaration. Deliberately disjoint from the declaration path below — mixing them
  // would let a read be mistaken for a write (and vice versa).
  if (opts.staleness) {
    if (opts.to !== undefined || opts.reason !== undefined) {
      console.error(`phase-declare: --staleness is a read-only reading and cannot be combined with --to/--reason\n\n${USAGE}`);
      process.exit(2);
    }
    const staleness = readPhaseStaleness(repoRoot);
    if (opts.json) {
      console.log(JSON.stringify(staleness, null, 2));
    } else if (!staleness.evaluated) {
      console.log(`phase-declare: NOT-EVALUATED — ${staleness.reason}`);
    } else {
      console.log(
        `phase-declare: phase=${staleness.phase} declaredAt=${staleness.declaredAt} ` +
          `(${staleness.daysSince} days ago, ${staleness.declarations} declaration(s) recorded)`,
      );
      console.log(
        `  since then: commits=${staleness.commitsSince} newGoals=${staleness.newGoalsSince?.length ?? 0}` +
          (staleness.newGoalsSince && staleness.newGoalsSince.length > 0 ? ` [${staleness.newGoalsSince.join(", ")}]` : ""),
      );
    }
    process.exit(staleness.evaluated ? 0 : 3);
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

  const root = repoRoot;

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

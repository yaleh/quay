#!/usr/bin/env node
// criterion-failure-attribution-check.ts — mechanical enumeration of goal criteria whose FAILURE exits
// write no cause (tasks/gap-goal-criteria-bare-failing-exit-unattributable, GOAL-009 AC-241).
//
// THE DEFECT THIS CLOSES: `goals/AC-*.md` criteria are shell strings executed by
// packages/quay/src/gate/acceptance-runner.ts. When a criterion exits non-zero and writes NOTHING to
// stderr/stdout, the runner's third branch (acceptance-runner.ts:143) composes
//   `acceptance failed (exit 1) — criterion wrote no output to stderr/stdout`
// — a verdict that says a criterion failed but not WHY. That is unattributable: "no anchorable site
// exists" and "the site exists but has no matching record" are different situations with different
// dispositions, and they were collapsed into one identical string. AC-237 fixed the RUNNER side (the
// failure reason now carries whatever the criterion wrote); it could not observe the CRITERION side,
// because its own fixture (`echo CAUSE-TOKEN >&2; exit 1`) necessarily writes a cause (hard rule 4
// 推论三: a fixture proves "can produce", not "did produce"). This checker is the criterion-side
// complement: it enumerates, BY POSITION, the criteria whose failure exits write nothing.
//
// WHAT IT ENUMERATES (hard rule 2 — position, not keyword):
//   goals/AC-*.md whose frontmatter `status` ∈ {active, achieved} (the I5 re-verification domain —
//   an achieved AC that turns red writes to the same ledger) AND whose `criterion` is a non-empty
//   string. For each such criterion, LINE BY LINE:
//     · a FAILURE-EXIT line   = matches /(?:sys\.)?exit\s*\(\s*1\s*\)/ or /\bexit\s+1\b/, OR is an
//       exit CALL whose argument ends with `else <nonzero>` (`sys.exit(0 if ok else 1)` — the trailing
//       computed form; see hasTrailingComputedFailureExit for why that half is a depth scan, not a regex)
//     · an ATTRIBUTED line    = also matches /stderr|>&2|console\.error/
//       (sys.stderr.write / print(..., file=sys.stderr) / shell `>&2` / console.error)
//   BARE = failure-exit ∧ ¬attributed. Comments and strings are not masked: a criterion is a SHELL
//   SCRIPT, so `#` is a comment but also a valid token inside a string — masking by position would be
//   a proxy for the real question. The real question is exactly "does this failure exit line carry a
//   write to a stream the runner captures", and that is what the two regexes answer.
//     · IMMEDIATE THIRD FORM — a criterion with NO exit statement at all, whose non-zero status is
//       inherited from a trailing command (`test`, `[`, `grep`, or a whole command sent to /dev/null).
//       Both rules above ask a question ABOUT an exit statement, so this form matched nothing on every
//       line and was never enumerated. See the IMPLICIT-EXIT CLASS block below for the rule and its
//       measured size (13 in-domain criteria on develop, 2026-09-12).
//
// THE TRAILING COMPUTED FORM (gap-criterion-attribution-ratchet-blind-to-trailing-computed-exit): the
// previous revision matched only a LITERAL `exit(1)` / `exit 1`, so `sys.exit(0 if ok else 1)` — which
// on its red branch writes nothing, exactly like `exit(1)` — read as CLEAN. The gap was even written
// into this file as a "documented limitation", which is the hard-rule-3b shape: for a ratchet, "I cannot
// read this form" and "this criterion is clean" produced the SAME output (count unchanged, status=pass,
// exit 0). Measured cost (2026-09-12): AC-245 entered the in-domain set in that form, wrote an
// unattributable `fail` into the production ledger, and turned GOAL-009's AC-241 red while the ratchet
// read 32 → 32, not moving one step. The opening/argument split is deliberate: the DIRECT forms are
// still regexes, and only the argument-tail question (which needs paren counting) is scanned.
//
// THREE-STATE OUTPUT (hard rule 3b — 读不懂输入 ≠ 合格):
//   0 = PASS (bare-AC count ≤ committed baseline; the ratchet is shrink-only, see below)
//   1 = FAIL (bare-AC count > baseline — a new or modified criterion introduced a bare failure exit)
//   3 = NOT-EVALUATED (the goals dir cannot be read, or it yields ZERO in-domain criteria — a
//       structurally-unreadable input must never render as "no bare exits"; printed to STDERR)
//   2 = usage/env error
//
// THE RATCHET IS SHRINK-ONLY: baseline is anchored at the mechanically-measured count at capture time
// and may only go DOWN. Fixing a criterion lowers the count and stays green; adding or modifying a
// criterion so it gains a bare failure exit raises the count and goes RED. ⛔ It is deliberately NOT a
// zero target: demanding 32 simultaneous rewrites would make this task unachievable (hard rule 12 —
// do not block an achievable goal on an unmeasured residual). ⛔ And it is deliberately NOT waivable by
// loosening the detector: the baseline is produced by --capture from the REAL enumeration.
//
// MODES:
//   default  [--root <dir>] [--json] — gate mode: enumerate, compare against the committed baseline.
//   --capture [--root <dir>] [--json] — enumerate and WRITE the committed baseline file.
// Test seams (used by plugin/test + the mutation case, ⛔ never by the registry):
//   --goals-dir <dir>   enumerate this dir instead of <root>/goals
//   --baseline <path>   read/write this baseline file instead of the committed one

import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { emitPass, emitFail, emitNotEvaluated, helpExit, isDirectEntry } from "./gate-script-base.ts";
import { repoRoot } from "./repo-root.ts";

// ── surfaces ────────────────────────────────────────────────────────────────────────────────────────

/** The committed, mechanically-generated baseline (docs/analysis/, alongside the other .baseline.json). */
export const BASELINE_FILE_REL = "docs/analysis/criterion-failure-attribution.baseline.json";

/** The in-domain statuses: the I5 re-verification domain (AC-216 — an achieved AC still gates). */
export const IN_DOMAIN_STATUSES: readonly string[] = ["active", "achieved"];

/** A failure exit, DIRECT forms: python `sys.exit(1)` / `exit(1)` (incl. the computed form
 *  `sys.exit(1 if bare else 0)` — it fails with no cause on its red branch), or shell `exit 1` in any
 *  position (incl. `|| exit 1`). `(?![\d])` keeps `exit(10)` / `exit(123)` out; `\b` keeps shell `exit 10`
 *  out.
 *
 *  ⚠️ This regex deliberately does NOT carry the *trailing* computed form (`sys.exit(0 if ok else 1)`,
 *  AC-245's shape) even though the task that closed that blind spot was phrased as "FAILURE_EXIT_RE
 *  增加该形态". The reason is mechanical, not stylistic: the argument of such an exit contains `)`
 *  characters of its own — AC-245's is `0 if log and str(log[-1].get("reason") or "").strip() else 1` —
 *  so telling "the `)` that closes `exit(`" from "a `)` inside its argument" requires COUNTING nesting,
 *  which a JS regex cannot do. A nesting-capped regex would re-open exactly the hole this closes for any
 *  deeper argument: a criterion one paren deeper would again read as "I can't parse this" ⇒ "clean", the
 *  hard-rule-3b shape. The trailing form is therefore matched by `hasTrailingComputedFailureExit` below,
 *  which scans the argument with a depth counter and applies a regex to the argument's TAIL. */
const FAILURE_EXIT_RE = /(?:sys\.)?exit\s*\(\s*1(?![\d])|\bexit\s+1\b/;

/** The opener of an exit CALL whose argument can be inspected — `sys.exit(` / `exit(`. */
const EXIT_CALL_SRC = "(?:sys\\.)?exit\\s*\\(";

/** The *trailing* computed non-zero: the exit call's ARGUMENT ends with `else <nonzero-int>`. `[1-9]\d*`
 *  keeps the always-zero control `sys.exit(0 if ok else 0)` out; the `$`-anchored tail keeps
 *  `sys.exit(0) if x else 1` (where `else 1` is NOT an argument of the exit) out, because in that line
 *  the `)` after `0` closes the call and the scanned argument is just `0`. */
const TRAILING_ELSE_NONZERO_RE = /\belse\s*[1-9]\d*\s*$/;

/** True iff `code` contains an exit CALL whose argument ends with `else <nonzero>` — the trailing
 *  computed failure exit. Depth-counting (not regex) for the reason given on `FAILURE_EXIT_RE`:
 *  AC-245's own argument nests `str(` around `log[-1].get(...)`.
 *
 *  ⛔ EVERY failure exit is examined, not just the last: a line legitimately carries more than one.
 *  ⛔ An exit call whose parentheses never balance (`exit(` with no matching `)`) yields NO verdict —
 *  it cannot be read, and the direct-form regex above still judges it on its own terms; this scanner
 *  never *clears* a line, only adds matches. */
export function hasTrailingComputedFailureExit(code: string): boolean {
  // A FRESH regex per call: a module-level `/g` regex carries `lastIndex` across calls, so this
  // function's own state would leak into the next line's judgment (a proxy量 whose failure mode is
  // silent — hard rule 4b). The scan is per-line and the regex is cheap.
  const opener = new RegExp(EXIT_CALL_SRC, "g");
  let m: RegExpExecArray | null;
  while ((m = opener.exec(code)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    let quote: string | null = null;
    for (; i < code.length; i++) {
      const c = code[i];
      if (quote !== null) {
        if (c === "\\" && quote !== "'") { i++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"') { quote = c; continue; }
      if (c === "(") depth++;
      else if (c === ")") { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) continue; // unreadable call — never conflated with "no trailing computed exit"
    if (TRAILING_ELSE_NONZERO_RE.test(code.slice(m.index + m[0].length, i))) return true;
  }
  return false;
}

/** A failure exit in EITHER form — the widened predicate. Direct forms via `FAILURE_EXIT_RE`, the
 *  trailing computed form via `hasTrailingComputedFailureExit`. */
export function hasFailureExit(code: string): boolean {
  return FAILURE_EXIT_RE.test(code) || hasTrailingComputedFailureExit(code);
}

// ── THE IMPLICIT-EXIT CLASS (2026-09-12, gap-criterion-attribution-blind-to-silent-terminal-command) ─
//
// THE THIRD BLIND SPOT, and the one the two revisions above could not see AT ALL. Both of them ask a
// question about an `exit` statement: `FAILURE_EXIT_RE` looks for the direct forms, and
// `hasTrailingComputedFailureExit` scans an exit CALL's argument. A criterion that contains **no exit
// statement whatsoever** therefore matched NOTHING on every line ⇒ it never entered the enumeration ⇒
// it was never baselined ⇒ the ratchet read 31 ≤ 32, status=pass, exit 0 while the very AC it guards
// (AC-241) was red in the production ledger. Same shape as the AC-245 revision: "I cannot read this
// form" and "this criterion is clean" shared one output (硬规则 3b).
//
// WHAT THE FORM IS. In a shell script with no `exit`, the exit status is the status of the last
// command EXECUTED. So the failure exit is not written down anywhere — it is INHERITED from a trailing
// command. Measured on develop 2026-09-12: 13 in-domain criteria have this shape, and every one of
// them exits 1 with **zero bytes** on both streams when false:
//   · `node …  get GOAL-001 >/dev/null 2>&1`            (AC-170 — the whole command's output discarded)
//   · `test "$(…)" -ge 27`                              (AC-171/178/195/197/208 — `test`/`[` are silent)
//   · `node … | grep -q 'GOAL-001'`                     (AC-174/176 — the pipeline's status IS grep's)
//   · `grep -qE A f && grep -qE B f`                    (AC-156; also AC-173/175/177)
//   · `test -f X && node … --json`                      (AC-225 — the SILENT branch is left of `&&`)
//
// THE RULE (position-based, 硬规则 2). A criterion with NO explicit failure exit ANYWHERE is examined
// at its **status-bearing statement** — the final logical statement, backslash continuations joined,
// because that is the only statement whose status can become the script's. Inside it, a top-level
// segment counts as the failure exit iff BOTH hold:
//   (a) it is a command that writes nothing on its FAILURE path — `test` / `[` / `grep` (see
//       SILENT_PREDICATE_RE), or the whole command has BOTH streams sent to /dev/null; and
//   (b) its failure PROPAGATES — it is the statement's last segment, or is followed by `&&`.
//       A segment followed by `||` is remediated (`grep -q X || { echo cause >&2; exit 1; }` must NOT
//       be flagged — that is AC2's negative control), and `;` / `|` are handled by (b)'s "last" case.
//
// ⛔ MEASURED OVER-REPORT, stated rather than hidden (the same discipline as ATTRIBUTION_RE's note).
// Two directions, both kept. A mechanical enumeration of develop's goals/ on 2026-09-12 gives:
// inDomain=95, explicit-class bareAcs=31 (the committed ratchet's set), implicit-class=13:
//   AC-156 AC-170 AC-171 AC-173 AC-174 AC-175 AC-176 AC-177 AC-178 AC-195 AC-197 AC-208 AC-225
//   · (a) `&&`-LEFT silent branches — the segment is flagged although a sibling segment sits to its
//     right. MEASURED: **5 of the 13** (AC-156, AC-173, AC-175, AC-177, AC-225), not the 2 named when
//     this task was filed (that count was taken over a different 14-member list). The direction is
//     kept because it is REAL: if the left branch is false the chain short-circuits and the script
//     exits 1 with zero output — AC-225's own shape, where `node … --json` on the right DOES write on
//     failure. That attribution is precisely what hid the defect: AC-228's ledger fail looked
//     attributable, and the attribution came from the right branch, saying nothing about the left one.
//   · (b) `grep -c`, whose no-match path prints `0` to stdout — which the runner DOES capture, so such
//     a line is arguably attributable, and flagging it is an over-report. Loosening the predicate to
//     "grep except -c" was rejected for the same reason ATTRIBUTION_RE is not widened to `echo`: the
//     safe direction is over-reporting. MEASURED SIZE OF THIS SUB-CLASS: **0** — a scan of all 95
//     in-domain criteria finds no flagged segment whose command word is `grep -c`. (`grep -c` does occur
//     in 2 status-bearing statements, AC-171 and AC-177, but always INSIDE `$( )`, where the
//     substitution absorbs the status and the flagged SEGMENT's command word is the enclosing `test` —
//     see splitTopLevelSegments, which does not split inside `$( )`.)
// ⛔ `ATTRIBUTION_RE` is deliberately NOT touched: widening it (to `print`/`echo`) would manufacture
// false negatives on lines like `if echo x | grep -q y; then exit 1; fi`.
//
// ⛔ NOT APPLIED when an explicit failure exit exists anywhere: in that case the failure exit IS that
// statement, and the inherited status is dead code or is remediated by the explicit branch. This is
// the task's scoping, and it keeps the class DISJOINT from the explicit-form enumeration above.

/** A command whose FAILURE path writes nothing to either captured stream. `[` and `test` are silent on
 *  both outcomes; `grep` prints matches (only on success) to stdout and nothing on the no-match path.
 *  Position-based: the command must be the SEGMENT'S command word, so `node x | grep -q y` matches on
 *  its `grep -q y` segment and `if echo x | grep -q y; …` does not match on `echo`. */
const SILENT_PREDICATE_RE = /^(?:command\s+|!\s*)*(?:\[|test|grep)(?:\s|$)/;

/** stdout → /dev/null (`>`, `1>`, `>>`, `1>>`). */
const DEVNULL_OUT_RE = /(?:^|\s)(?:1?>|1?>>)\s*\/dev\/null(?:\s|$)/;

/** BOTH streams → /dev/null in one token (`&>`, `>&`). */
const DEVNULL_BOTH_RE = /(?:^|\s)(?:&>|>&)\s*\/dev\/null(?:\s|$)/;

/** stderr → /dev/null explicitly (`2>`, `2>>`). */
const DEVNULL_ERR_RE = /(?:^|\s)(?:2>|2>>)\s*\/dev\/null(?:\s|$)/;

/** `2>&1` — stderr follows stdout, so it is discarded too iff stdout already is. This is the COMMON
 *  idiom `>/dev/null 2>&1`, and requiring `2>` to literally name /dev/null would have missed it (it
 *  did, on the first measurement: AC-170 stayed invisible while its command runs exactly that idiom). */
const STDERR_FOLLOWS_STDOUT_RE = /(?:^|\s)2>&1(?:\s|$)/;

/** One top-level command segment of a status-bearing statement: its text and the operator that
 *  FOLLOWS it (`&&`, `||`, `|`, `;`, or null at the end). `start`/`end` are offsets into the joined
 *  statement, so a caller can map the segment back to the source LINE for the report. */
export interface Segment {
  text: string;
  start: number;
  end: number;
  nextOp: string | null;
}

/** Split a statement at TOP-LEVEL `&&`/`||`/`|`/`;` only. Quote-aware, and opaque to `$( … )` /
 *  `` ` … ` `` / `( … )` nesting: a `|` inside a command substitution is not a pipe of the statement
 *  (`test "$(node … list | grep -c …)" -ge 27` is ONE segment whose command is `test`). That opacity is
 *  the difference between reporting the command that actually determines the status and reporting a
 *  sub-command whose status the substitution absorbs. */
export function splitTopLevelSegments(stmt: string): Segment[] {
  const segs: Segment[] = [];
  let start = 0;
  let quote: string | null = null;
  let depth = 0;
  const push = (end: number, nextOp: string | null) => {
    const text = stmt.slice(start, end);
    if (text.trim() !== "") segs.push({ text: text.trim(), start, end, nextOp });
  };
  for (let i = 0; i < stmt.length; i++) {
    const c = stmt[i];
    if (quote !== null) {
      if (c === "\\" && quote !== "'") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "\\") { i++; continue; }
    if (c === "'" || c === '"' || c === "`") { quote = c; continue; }
    if (c === "$" && stmt[i + 1] === "(") { depth++; i++; continue; }
    if (c === "(") { depth++; continue; }
    if (c === ")") { depth = Math.max(0, depth - 1); continue; }
    if (depth !== 0) continue;
    if (c === "&" && stmt[i + 1] === "&") { push(i, "&&"); i++; start = i + 1; continue; }
    if (c === "|" && stmt[i + 1] === "|") { push(i, "||"); i++; start = i + 1; continue; }
    if (c === "|") { push(i, "|"); start = i + 1; continue; }
    if (c === ";") { push(i, ";"); start = i + 1; continue; }
  }
  push(stmt.length, null);
  return segs;
}

/** True iff this segment's FAILURE writes nothing the acceptance-runner captures — either it is a
 *  silent predicate command, or the whole command has both streams discarded to /dev/null. */
export function isSilentOnFailureSegment(seg: string): boolean {
  const s = seg.trim();
  if (s === "") return false;
  if (DEVNULL_BOTH_RE.test(s)) return true;
  if (DEVNULL_OUT_RE.test(s) && (DEVNULL_ERR_RE.test(s) || STDERR_FOLLOWS_STDOUT_RE.test(s))) return true;
  return SILENT_PREDICATE_RE.test(s);
}

/** The criterion's STATUS-BEARING statement: the final logical statement, with backslash continuations
 *  joined. Returns the joined text plus a per-character map back to the 1-based source LINE, so the
 *  report points at the line a reader can open. Deliberately NOT the whole script: with no `exit`, only
 *  the last statement executed can become the script's status, so earlier statements are not failure
 *  exits however silent their commands are. */
export function statusBearingStatement(criterion: string): { text: string; lineOf: number[] } | null {
  const logical: Array<{ text: string; lineOf: number[] }> = [];
  let text = "";
  let lineOf: number[] = [];
  const flush = () => {
    if (text.trim() !== "") logical.push({ text, lineOf });
    text = "";
    lineOf = [];
  };
  const rawLines = criterion.split("\n");
  for (let i = 0; i < rawLines.length; i++) {
    const masked = maskValueStrings(maskHashComments(rawLines[i]));
    const trimmed = masked.trim();
    const cont = trimmed.endsWith("\\");
    const piece = cont ? trimmed.slice(0, -1).trimEnd() : trimmed;
    if (piece === "" && !cont) { flush(); continue; }
    if (text !== "") { text += " "; lineOf.push(i + 1); } // the joining space belongs to the new line
    const base = text.length;
    text += piece;
    for (let k = 0; k < piece.length; k++) lineOf[base + k] = i + 1;
    if (!cont) flush();
  }
  flush();
  return logical.length === 0 ? null : logical[logical.length - 1];
}

/** The IMPLICIT failure exits of `criterion` — the lines a reader must open to see why a criterion with
 *  no exit statement can exit non-zero with no cause. Empty when the criterion carries ANY explicit
 *  failure exit (see the ⛔ note above: the two classes are disjoint by construction), and empty when
 *  its status-bearing statement is a bare `exit 0` (an explicit exit determines the status; nothing is
 *  inherited, so there is no implicit failure exit to report). */
export function implicitFailureExitLines(criterion: string): BareLine[] {
  if (criterion.split("\n").some((l) => hasFailureExit(maskValueStrings(maskHashComments(l))))) return [];
  const stmt = statusBearingStatement(criterion);
  if (stmt === null) return [];
  if (/^exit\s+0\s*$/.test(stmt.text.trim())) return [];
  const out: BareLine[] = [];
  const segs = splitTopLevelSegments(stmt.text);
  segs.forEach((s, idx) => {
    const isLast = idx === segs.length - 1;
    // (b) failure must PROPAGATE: last segment, or followed by `&&`. `||` remediates (AC2's negative
    // control `grep -q X || { echo cause >&2; exit 1; }` must stay clean).
    if (!(isLast || s.nextOp === "&&")) return;
    if (!isSilentOnFailureSegment(s.text)) return;
    // Map the segment's start offset back to a source line. The offset may land on the joining space
    // between two continued lines (which has no line of its own), so walk BACK to the nearest mapped
    // character — that is the line the segment belongs to.
    let line = 0;
    for (let k = s.start; k >= 0; k--) {
      if (stmt.lineOf[k] !== undefined) { line = stmt.lineOf[k]; break; }
    }
    out.push({ line, text: s.text, implicit: true });
  });
  return out;
}

/** An attribution: something the acceptance-runner captures (stderr) or the shell redirects to it.
 *
 *  ⚠️ KNOWN, MEASURED OVER-APPROXIMATION (2026-09-11): acceptance-runner.ts:134-143 folds stderr FIRST
 *  and falls back to STDOUT, so `echo "cause"; exit 1` IS attributable — but `echo`/`console.log` are not
 *  matched here, so such lines read as BARE. Measured with the real enumeration: 7 of the 33 baselined ACs
 *  (AC-189/190/191/196/198/199/200) are bare ONLY via this class — i.e. the ratchet guards 33 where 26
 *  carry a genuinely silent failure exit.
 *  ⛔ Deliberately NOT widened to `echo`: `echo` is not a stream marker but a command name, so a line like
 *  `if echo x | grep -q y; then exit 1; fi` would lose a REAL bare exit — a false NEGATIVE, the harder
 *  error (hard rule 4). Over-reporting accuses an attributable criterion; under-reporting certifies a
 *  silent one. The conservative direction is kept, and its size is stated here rather than hidden. */
const ATTRIBUTION_RE = /stderr|>&2|console\.error/;

// ── types ───────────────────────────────────────────────────────────────────────────────────────────

export interface BareLine {
  /** 1-based line number inside the criterion text. */
  line: number;
  /** The trimmed line (or, for an implicit exit, the offending top-level segment). */
  text: string;
  /** true ⇔ this line is an IMPLICIT failure exit: the criterion writes no `exit`, and this segment's
   *  inherited status IS the criterion's non-zero exit. Absent for the explicit forms. Reported so a
   *  reader can tell "the exit is written here and writes no cause" from "the exit is not written at
   *  all and this command's status becomes it" — two different repairs. */
  implicit?: boolean;
}

export interface BareEntry {
  id: string;
  file: string;
  /** How many bare failure exits this criterion has (AC-157 has 3, AC-239 had 2, …). */
  bareLines: BareLine[];
}

export interface Enumeration {
  /** false ⇒ NOT-EVALUATED: the input could not be read/parsed. Never conflated with "zero bare". */
  evaluated: boolean;
  error?: string;
  /** goals/AC-*.md in-domain (status ∈ {active, achieved}) with a non-empty criterion. */
  inDomain: number;
  /** Total bare failure-exit LINES across all in-domain criteria. */
  bareLines: number;
  /** The ACs carrying ≥1 bare failure exit — THE ratcheted count is bareAcs.length. */
  bareAcs: BareEntry[];
}

export interface Baseline {
  /** The ratcheted number: how many in-domain ACs carry ≥1 bare failure exit. */
  count: number;
  inDomain: number;
  entries: Array<{ id: string; file: string; bareLines: number[] }>;
  generatedAt: string;
}

export interface RatchetVerdict {
  ok: boolean;
  /** current − baseline.count (negative = shrank = good). */
  delta: number;
  /** AC ids bare now that were not bare at capture time (the "新增或修改的判据" that must not happen). */
  added: string[];
  /** AC ids bare at capture time and no longer bare (the fixes — always welcome). */
  fixed: string[];
}

// ── position-based masking (hard rule 2) ────────────────────────────────────────────────────────────

/** Blank an unquoted `#`-to-end-of-line comment. `#` is the comment starter in BOTH shells and python,
 *  and a criterion is a shell string whose embedded heredocs are usually python — so one masker covers
 *  both. Quote-aware: `#` inside '…' / "…" / `…` is data, not a comment. ⛔ Strings are deliberately NOT
 *  masked HERE: unlike a C-style `//` slice, a shell criterion's quoted `bash -c "exit 1"` really does
 *  exit 1, so masking strings wholesale would manufacture false NEGATIVES — the harder error to notice
 *  (hard rule 4). `maskValueStrings` below masks ONLY the narrower value-position subset, for exactly
 *  that reason. */
export function maskHashComments(line: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote !== null) {
      if (c === "\\" && quote !== "'") {
        out += c;
        if (i + 1 < line.length) out += line[++i];
        continue;
      }
      if (c === quote) quote = null;
      out += c;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      out += c;
      continue;
    }
    if (c === "#") break;
    out += c;
  }
  return out;
}

/** Blank a quoted literal in VALUE position (`command:"exit 1"`, `cmd='exit 1'`) — the text is DATA
 *  handed to an API, not a command the criterion itself executes.
 *
 *  WHY THIS IS NOT A CONTRADICTION OF THE RULE ABOVE (2026-09-11, surfaced by AC-243 — see below): the
 *  exemption for quoted strings exists because `bash -c "exit 1"` really does exit 1. That case is
 *  *preserved* here: the quote is preceded by `c`, not by `:`/`=`, so it is still scanned and still BARE.
 *  What this masks is the strictly narrower shape where the quote is the VALUE of a `key:`/`key=` pair.
 *
 *  THE DEFECT IT FIXES (AC-243, real, found by the ratchet on develop's own new criterion): AC-243 proves
 *  the runner's zero-output template by *invoking* it — `m.runAcceptance({command:"exit 1", …})`. AC-243's
 *  own failure exits (:22/:28/:30) all write stderr, so it is fully attributable and can never leave an
 *  unattributable ledger fail — yet the bare scan matched the `exit 1` inside that ARGUMENT STRING and
 *  reported the achieved, faithful AC-243 as a REGRESSION, blocking an unrelated task from landing. A
 *  detector that accuses an attributable criterion is itself an attribution defect (hard rule 3b: the
 *  output must distinguish "查过且合格" from "读错了").
 *
 *  ⛔ TWO LIMITS, both deliberate, neither silent:
 *   · A value string containing command substitution (`x="$(exit 1)"`, `` x=`exit 1` ``) EXECUTES and is
 *     therefore NEVER masked — masking it would manufacture a false negative.
 *   · Indirection a masker cannot follow (`c='exit 1'; eval "$c"`) becomes a false negative. Contrived, and
 *     the safe direction is over-reporting, not under-reporting. */
export function maskValueStrings(line: string): string {
  return line.replace(
    /([:=])([ \t]*)((?:"(?:[^"\\]|\\.)*")|(?:'(?:[^'\\]|\\.)*'))/g,
    (m: string, sep: string, gap: string, lit: string) => {
      if (lit.includes("$(") || lit.includes("`")) return m;
      return sep + gap + " ".repeat(lit.length);
    },
  );
}

// ── enumeration ─────────────────────────────────────────────────────────────────────────────────────

/** Split a goal file into (frontmatter, body). null when there is no `---` frontmatter block. */
export function splitFrontmatter(src: string): { fm: string } | null {
  if (!src.startsWith("---")) return null;
  const end = src.indexOf("\n---", 3);
  if (end === -1) return null;
  return { fm: src.slice(3, end) };
}

/** True iff this criterion LINE is a failure exit that writes no cause. Pure — the testable core.
 *  Judged BY POSITION (hard rule 2): a `#`-comment that merely mentions `exit 1` is not a failure exit,
 *  and a quoted value (`command:"exit 1"`) is data, not one either (see maskValueStrings). */
export function isBareFailureExitLine(line: string): boolean {
  const code = maskValueStrings(maskHashComments(line));
  return hasFailureExit(code) && !ATTRIBUTION_RE.test(code);
}

/** Parse one goal file's frontmatter. Returns null when it is not parseable as a goal record. */
export function parseGoalFile(src: string): { id: string; status: string; criterion: string } | null {
  const split = splitFrontmatter(src);
  if (split === null) return null;
  let raw: any;
  try {
    raw = parseYaml(split.fm);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" ? raw.id : null;
  const status = typeof raw.status === "string" ? raw.status : null;
  if (id === null || status === null) return null;
  const criterion = typeof raw.criterion === "string" ? raw.criterion : "";
  return { id, status, criterion };
}

/**
 * Enumerate the bare-failure-exit ACs under `goalsDir`.
 * evaluated:false (NOT-EVALUATED) when the dir cannot be read, when NO file parses as a goal record,
 * or when the parse yields ZERO in-domain criteria — an input we could not read must not render as
 * "nothing to report" (hard rule 3b).
 */
export function enumerateBareFailureExits(goalsDir: string): Enumeration {
  const empty = { inDomain: 0, bareLines: 0, bareAcs: [] as BareEntry[] };
  let names: string[];
  try {
    names = fs.readdirSync(goalsDir).filter((f) => f.startsWith("AC-") && f.endsWith(".md"));
  } catch (e: any) {
    return { ...empty, evaluated: false, error: `the goals dir (${goalsDir}) could not be read: ${e?.message ?? e}` };
  }
  if (names.length === 0) {
    return { ...empty, evaluated: false, error: `the goals dir (${goalsDir}) holds no AC-*.md records` };
  }
  let parsed = 0;
  let inDomain = 0;
  const bareAcs: BareEntry[] = [];
  for (const name of names.sort()) {
    let src: string;
    try {
      src = fs.readFileSync(path.join(goalsDir, name), "utf8");
    } catch {
      continue;
    }
    const rec = parseGoalFile(src);
    if (rec === null) continue;
    parsed += 1;
    if (!IN_DOMAIN_STATUSES.includes(rec.status)) continue;
    if (rec.criterion.trim() === "") continue;
    inDomain += 1;
    const bareLines: BareLine[] = [];
    rec.criterion.split("\n").forEach((line, i) => {
      if (isBareFailureExitLine(line)) bareLines.push({ line: i + 1, text: line.trim() });
    });
    // The implicit-exit class (see the ⛔ note above): disjoint from the explicit forms by construction,
    // so this adds only the criteria that carry NO explicit failure exit at all — exactly the ones the
    // two earlier revisions could not see.
    if (bareLines.length === 0) bareLines.push(...implicitFailureExitLines(rec.criterion));
    if (bareLines.length > 0) bareAcs.push({ id: rec.id, file: name, bareLines });
  }
  if (parsed === 0) {
    return { ...empty, evaluated: false, error: `no file under ${goalsDir} parsed as a goal record` };
  }
  if (inDomain === 0) {
    return { ...empty, evaluated: false, error: `${goalsDir} yielded zero in-domain (${IN_DOMAIN_STATUSES.join("/")}) criteria with a non-empty criterion` };
  }
  const bareLines = bareAcs.reduce((n, e) => n + e.bareLines.length, 0);
  return { evaluated: true, inDomain, bareLines, bareAcs };
}

// ── judgment (shrink-only ratchet — pure, the testable core) ────────────────────────────────────────

/** The ratchet: ok iff the current bare-AC count does not EXCEED the baseline. Additions are the only
 *  red; removals (fixes) are always legal. */
export function checkRatchet(current: Enumeration, baseline: Baseline): RatchetVerdict {
  const cur = new Set(current.bareAcs.map((e) => e.id));
  const base = new Set(baseline.entries.map((e) => e.id));
  const added = [...cur].filter((id) => !base.has(id)).sort();
  const fixed = [...base].filter((id) => !cur.has(id)).sort();
  const delta = cur.size - baseline.count;
  return { ok: delta <= 0, delta, added, fixed };
}

// ── baseline file ───────────────────────────────────────────────────────────────────────────────────

export function baselinePath(root: string, override?: string): string {
  return override ?? path.join(root, ...BASELINE_FILE_REL.split("/"));
}

/** Strict-shape load: anything malformed returns null (⇒ NOT-EVALUATED), never a silent "≤ baseline". */
export function readBaseline(p: string): Baseline | null {
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    if (typeof raw?.count !== "number" || typeof raw?.inDomain !== "number" || !Array.isArray(raw?.entries)) {
      return null;
    }
    if (!raw.entries.every((e: any) => typeof e?.id === "string" && Array.isArray(e?.bareLines))) return null;
    return {
      count: raw.count,
      inDomain: raw.inDomain,
      entries: raw.entries.map((e: any) => ({ id: e.id, file: String(e.file ?? ""), bareLines: e.bareLines })),
      generatedAt: String(raw.generatedAt ?? ""),
    };
  } catch {
    return null;
  }
}

export function writeBaseline(p: string, e: Enumeration): void {
  const body: Baseline = {
    count: e.bareAcs.length,
    inDomain: e.inDomain,
    entries: e.bareAcs.map((x) => ({ id: x.id, file: x.file, bareLines: x.bareLines.map((b) => b.line) })),
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(body, null, 2) + "\n");
}

// ── modes ───────────────────────────────────────────────────────────────────────────────────────────

const usage = `criterion-failure-attribution-check.ts — enumerate goals/AC-*.md criteria whose failure exits write no cause (GOAL-009 AC-241)

Usage:
  node --experimental-strip-types criterion-failure-attribution-check.ts [--root <dir>] [--json]
      gate mode — exit 1 iff the bare-failure-exit AC count EXCEEDS the committed baseline (shrink-only
      ratchet); exit 3 iff the goals dir cannot be read or yields zero in-domain criteria.
  node --experimental-strip-types criterion-failure-attribution-check.ts --capture [--root <dir>] [--json]
      capture mode — enumerate and WRITE the committed baseline file.
  Test seams: --goals-dir <dir> · --baseline <path>
  Exit: 0 PASS · 1 FAIL (ratchet raised) · 2 usage/env · 3 NOT-EVALUATED`;

function getArgValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit(usage);
  const root = path.resolve(getArgValue(args, "--root") ?? repoRoot());
  const goalsDir = path.resolve(getArgValue(args, "--goals-dir") ?? path.join(root, "goals"));
  const asJson = args.includes("--json");
  const capture = args.includes("--capture");

  const summary = (e: Enumeration) => ({
    inDomain: e.inDomain,
    bareAcs: e.bareAcs.length,
    bareLines: e.bareLines,
    ids: e.bareAcs.map((x) => x.id),
  });

  const enum0 = enumerateBareFailureExits(goalsDir);
  if (!enum0.evaluated) {
    return emitNotEvaluated(
      `criterion-failure-attribution-check: NOT-EVALUATED — ${enum0.error ?? "the goals dir could not be enumerated"} (a checker that cannot read its input is never conflated with "no bare failure exits")`,
      { evaluated: false },
      { json: asJson, stream: "stderr" },
    );
  }

  if (capture) {
    const p = baselinePath(root, getArgValue(args, "--baseline"));
    writeBaseline(p, enum0);
    return emitPass(
      `criterion-failure-attribution-check: captured baseline → inDomain=${enum0.inDomain} bareAcs=${enum0.bareAcs.length} bareLines=${enum0.bareLines}`,
      { ...summary(enum0), baselineFile: p },
      { json: asJson },
    );
  }

  const p = baselinePath(root, getArgValue(args, "--baseline"));
  const baseline = readBaseline(p);
  if (baseline === null) {
    return emitNotEvaluated(
      `criterion-failure-attribution-check: NOT-EVALUATED — baseline file missing or malformed (${p}); run --capture to create it (a checker that cannot read its baseline is never conflated with "≤ baseline")`,
      { ...summary(enum0), evaluated: false, baselineMissing: true },
      { json: asJson, stream: "stderr" },
    );
  }

  const verdict = checkRatchet(enum0, baseline);
  if (verdict.ok) {
    return emitPass(
      `criterion failure attribution intact: inDomain=${enum0.inDomain} bareAcs=${enum0.bareAcs.length} ≤ baseline ${baseline.count} (bareLines=${enum0.bareLines}${verdict.fixed.length ? `; fixed since baseline: ${verdict.fixed.join(",")}` : ""})`,
      { ...summary(enum0), baseline: baseline.count, delta: verdict.delta, fixed: verdict.fixed },
      { json: asJson },
    );
  }
  return emitFail(
    `criterion failure attribution REGRESSED: bareAcs=${enum0.bareAcs.length} > baseline ${baseline.count} (delta +${verdict.delta}); new bare-failure-exit AC(s): ${verdict.added.join(", ") || "(none — a re-count mismatch)"} — a failing criterion must write its cause to stderr/stdout`,
    { ...summary(enum0), baseline: baseline.count, delta: verdict.delta, added: verdict.added },
    { json: asJson },
  );
}

if (isDirectEntry(import.meta, undefined, "criterion-failure-attribution-check")) {
  process.exitCode = main(process.argv);
}

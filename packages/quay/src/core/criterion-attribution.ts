// quay Core: criterion failure attribution — THE single predicate behind "this failure exit writes
// no cause" (extracted verbatim from `core/goal-store.ts` by
// tasks/gap-routine-architecture-analysis-god-module-goal-store; the predicate itself, its three
// blind spots and every measured count are documented on the classes below — unchanged by the move).
//
// WHY THIS IS ITS OWN MODULE. It is the one judgment TWO surfaces share: the shrink-only RATCHET over
// `goals/AC-*.md` (plugin/scripts/criterion-failure-attribution-check.ts) and the goal store's WRITE
// GATE (which refuses to let a new criterion CARRY an unattributable exit into active). It is a pure
// function over a string — no fs, no store, no gate — yet it lived in the 4,167-line goal store and
// was three of that module's five separable jobs (archguard `god-module` finding
// `god-module-goal-store`). Two implementations of one judgment drift; ONE module with no imports
// cannot drift, and the two callers import the SAME function objects (hard rule 5b — the plugin-side
// re-export and the store's re-export both forward this file, never a copy).
//
// ⛔ The DIRECTION of the dependency is unchanged: product → plugin, never the reverse. This module
// imports nothing; `core/goal-store.ts` and `plugin/scripts/criterion-failure-attribution-check.ts`
// both point here for the implementation, and the store re-exports it so its historical import
// surface (tests, quay-native) is preserved.
//
// THREE-STATE, ⛔ never a boolean (hard rule 3b): `evaluateCriterionAttribution` returns
// `evaluated:false` (with an `error`) when it cannot read its input at all — never conflated with
// `evaluated:true, bare: []`.

// ── criterion failure attribution: THE single predicate ────────────────────────────────────────
//
// WHY THIS LIVES IN CORE (gap-criterion-attribution-write-gate-at-birth; split out of
// `core/goal-store.ts` by tasks/gap-routine-architecture-analysis-god-module-goal-store). "This
// failure exit writes no cause" is asked at TWO surfaces: the shrink-only RATCHET over `goals/AC-*.md`
// (plugin/scripts/criterion-failure-attribution-check.ts) and the goal store's WRITE GATE (which
// refuses to let a new criterion CARRY such an exit into active in the first place). Two
// implementations of one judgment drift — that is not a style preference, it is measured: AC-243
// exists precisely to pin one constant (the runner's zero-output template) to its producer, and the
// ratchet's own history is three successive blind spots (the direct form, the trailing computed form,
// the implicit-exit class), each of which was fixed in ONE detector while the other surface kept the
// old reading.
//
// DIRECTION OF THE DEPENDENCY: product → plugin, never the reverse. `plugin/scripts/goal-driver.ts`
// and `plugin/scripts/meta-driver.ts` already import Core; nothing under `packages/quay/` imports
// `plugin/scripts/`. So the predicate lives HERE and the checker imports it — one impl.
//
// WHAT IT ENUMERATES (hard rule 2 — position, not keyword). For a criterion (a SHELL string whose
// heredocs are usually python), LINE BY LINE:
//   · a FAILURE-EXIT line = matches the direct forms (`sys.exit(1)` / `exit 1`, incl. the computed
//     `sys.exit(1 if bare else 0)`), OR is an exit CALL whose argument ends with a computed non-zero —
//     `else <nonzero>` (`sys.exit(0 if ok else 1)`) or `: <nonzero>` (a JS ternary,
//     `process.exit(cond ? 0 : 1)`); both halves are a depth scan, not a regex, for the reason given on
//     hasTrailingComputedFailureExit, OR — when the criterion carries no explicit exit at all — a
//     status-bearing segment that inherits a silent non-zero (see the IMPLICIT-EXIT note on
//     implicitFailureExitLines)
//   · an ATTRIBUTED line = also matches `stderr` / `>&2` / `console.error`
//   BARE = failure-exit ∧ ¬attributed.
//
// THREE-STATE OUTPUT (hard rule 3b — 读不懂输入 ≠ 合格). `evaluateCriterionAttribution` returns
// `evaluated:false` (with an `error`) when it cannot read its input at all — never conflated with
// `evaluated:true, bare: []`. The ratchet's own CLI keeps its 0/1/3 vocabulary on top of the same
// distinction.

/** A failure exit, DIRECT forms: python `sys.exit(1)` / `exit(1)` (incl. the computed form
 *  `sys.exit(1 if bare else 0)` — it fails with no cause on its red branch), or shell `exit 1` in any
 *  position (incl. `|| exit 1`). `(?![\d])` keeps `exit(10)` / `exit(123)` out; `\b` keeps shell
 *  `exit 10` out.
 *
 *  ⚠️ Deliberately does NOT carry the *trailing* computed form (`sys.exit(0 if ok else 1)`, AC-245's
 *  shape). The reason is mechanical, not stylistic: the argument of such an exit contains `)`
 *  characters of its own — AC-245's is `0 if log and str(log[-1].get("reason") or "").strip() else 1` —
 *  so telling "the `)` that closes `exit(`" from "a `)` inside its argument" requires COUNTING nesting,
 *  which a JS regex cannot do. A nesting-capped regex would re-open exactly that hole for any deeper
 *  argument: a criterion one paren deeper would again read as "I can't parse this" ⇒ "clean", the
 *  hard-rule-3b shape. That form is matched by `hasTrailingComputedFailureExit` below. */
export const FAILURE_EXIT_RE = /(?:sys\.)?exit\s*\(\s*1(?![\d])|\bexit\s+1\b/;

/** The opener of an exit CALL whose argument can be inspected — `sys.exit(` / `exit(`. */
const EXIT_CALL_SRC = "(?:sys\\.)?exit\\s*\\(";

/** The *trailing* computed non-zero, PYTHON spelling: the exit call's ARGUMENT ends with
 *  `else <nonzero-int>`. `[1-9]\d*` keeps the always-zero control `sys.exit(0 if ok else 0)` out; the
 *  `$`-anchored tail keeps `sys.exit(0) if x else 1` (where `else 1` is NOT an argument of the exit)
 *  out, because in that line the `)` after `0` closes the call and the scanned argument is just `0`. */
const TRAILING_ELSE_NONZERO_RE = /\belse\s*[1-9]\d*\s*$/;

/** The *trailing* computed non-zero, JS spelling: the exit call's ARGUMENT ends with `: <nonzero-int>`
 *  — the FALSE branch of a ternary (`process.exit(cond ? 0 : 1)`). Same intent as the python `else`
 *  tail above, different punctuation: a ternary's two branches are separated by `?` / `:`, so the word
 *  `else` never appears and the 2026-09-11 python-shaped tail matched NOTHING.
 *
 *  WHY IT IS A SEPARATE CONSTANT (gap-ac241-ternary-computed-exit-has-no-predicate). Measured
 *  2026-10-16: 20 in-domain criteria carry exactly this shape (AC-143/144/145/146/148/150/151/152/153/
 *  154/155/188/191/192/193/304/305/306/307/308) and the shared predicate returned `[]` for every one —
 *  the ratchet read `bareAcs=0`, status pass, exit 0 while the production ledger was writing AC-152's
 *  unattributable fail. Hard rule 3b again: "I cannot read this shape" and "this criterion is clean"
 *  shared one output. Repaired HERE, in the one implementation the write gate and the ratchet both
 *  import, so the born-side surface is fixed by the same change.
 *
 *  `[1-9]\d*` keeps the always-zero control `exit(c ? 0 : 0)` out — same conservative direction as the
 *  python tail. The `$` anchor is what keeps the MIRROR form (`exit(<nonzero> : 0)`, the non-zero in
 *  the TRUE branch) out: measured on develop 2026-10-16 the whole domain holds exactly ONE such exit
 *  (AC-330's `props.includes("reconcile")?4:0`) and it is ALREADY attributed — the next line rewrites
 *  rc=4 into a cause (`[ "$mrc" != 4 ] || { echo "CAUSE=…" >&2; exit 1; }`). Matching the head branch
 *  would accuse an attributable criterion (hard rule 4), so only the tail is matched. */
const TRAILING_TERNARY_NONZERO_RE = /:\s*[1-9]\d*\s*$/;

/** True iff `code` contains an exit CALL whose argument ends with a computed non-zero — `else <nonzero>`
 *  (python) or `: <nonzero>` (a JS ternary's false branch). Depth-counting (not regex) for the reason
 *  given on `FAILURE_EXIT_RE`.
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
    const arg = code.slice(m.index + m[0].length, i);
    if (TRAILING_ELSE_NONZERO_RE.test(arg) || TRAILING_TERNARY_NONZERO_RE.test(arg)) return true;
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
//   · `node … get GOAL-001 >/dev/null 2>&1`            (AC-170 — the whole command's output discarded)
//   · `test "$(…)" -ge 27`                             (AC-171/178/195/197/208 — `test`/`[` are silent)
//   · `node … | grep -q 'GOAL-001'`                    (AC-174/176 — the pipeline's status IS grep's)
//   · `grep -qE A f && grep -qE B f`                   (AC-156; also AC-173/175/177)
//   · `test -f X && node … --json`                     (AC-225 — the SILENT branch is left of `&&`)
//
// THE RULE (position-based, 硬规则 2). A criterion with NO explicit failure exit ANYWHERE is examined
// at its **status-bearing statement** — the final logical statement, backslash continuations joined,
// because that is the only statement whose status can become the script's. Inside it, a top-level
// segment counts as the failure exit iff BOTH hold:
//   (a) it is a command that writes nothing on its FAILURE path — `test` / `[` / `grep` (see
//       SILENT_PREDICATE_RE), or the whole command has BOTH streams sent to /dev/null; and
//   (b) its failure PROPAGATES — it is the statement's last segment, or is followed by `&&`.
//       A segment followed by `||` is remediated (`grep -q X || { echo cause >&2; exit 1; }` must NOT
//       be flagged — it is the write gate's / the test's negative control), and `;` / `|` are handled
//       by (b)'s "last" case.
//
// ⛔ MEASURED OVER-REPORT, stated rather than hidden (the same discipline as ATTRIBUTION_RE's note).
// Two directions, both kept. A mechanical enumeration of develop's goals/ on 2026-09-12 gives:
// inDomain=95, explicit-class bareAcs=31 (the committed ratchet's set), implicit-class=13:
//   AC-156 AC-170 AC-171 AC-173 AC-174 AC-175 AC-176 AC-177 AC-178 AC-195 AC-197 AC-208 AC-225
//   · (a) `&&`-LEFT silent branches — the segment is flagged although a sibling segment sits to its
//     right. MEASURED: **5 of the 13** (AC-156, AC-173, AC-175, AC-177, AC-225), not the 2 named when
//     the task was filed (that count was taken over a different 14-member list). The direction is
//     kept because it is REAL: if the left branch is false the chain short-circuits and the script
//     exits 1 with zero output — AC-225's own shape, where `node … --json` on the right DOES write on
//     failure. That attribution is precisely what hid the defect: AC-228's ledger fail looked
//     attributable, and the attribution came from the right branch, saying nothing about the left one.
//   · (b) `grep -c`, whose no-match path prints `0` to stdout — which the runner DOES capture, so such
//     a line is arguably attributable, and flagging it is an over-report. Loosening the predicate to
//     "grep except -c" was rejected for the same reason ATTRIBUTION_RE is not widened to `echo`: the
//     safe direction is over-reporting. MEASURED SIZE OF THIS SUB-CLASS: **0** — a scan of all 95
//     in-domain criteria finds no flagged segment whose command word is `grep -c`.
// ⛔ `ATTRIBUTION_RE` is deliberately NOT touched: widening it (to `print`/`echo`) would manufacture
// false negatives on lines like `if echo x | grep -q y; then exit 1; fi`.
//
// ⛔ NOT APPLIED when an explicit failure exit exists anywhere: in that case the failure exit IS that
// statement, and the inherited status is dead code or is remediated by the explicit branch. This is
// the scoping, and it keeps the class DISJOINT from the explicit-form enumeration above.

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

/** An attribution: something the acceptance-runner captures (stderr) or the shell redirects to it.
 *
 *  ⚠️ KNOWN, MEASURED OVER-APPROXIMATION (2026-09-11): acceptance-runner.ts folds stderr FIRST and
 *  falls back to STDOUT, so `echo "cause"; exit 1` IS attributable — but `echo`/`console.log` are not
 *  matched here, so such lines read as BARE. Measured with the real enumeration: 7 of the 33 baselined
 *  ACs (AC-189/190/191/196/198/199/200) are bare ONLY via this class — i.e. the ratchet guards 33 where
 *  26 carry a genuinely silent failure exit.
 *  ⛔ Deliberately NOT widened to `echo`: `echo` is not a stream marker but a command name, so a line
 *  like `if echo x | grep -q y; then exit 1; fi` would lose a REAL bare exit — a false NEGATIVE, the
 *  harder error (hard rule 4). Over-reporting accuses an attributable criterion; under-reporting
 *  certifies a silent one. The conservative direction is kept, and its size is stated here rather than
 *  hidden. */
const ATTRIBUTION_RE = /stderr|>&2|console\.error/;

/** One bare (unattributed) failure exit, with the 1-based source line so both surfaces can NAME it. */
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
  /** true ⇔ this line is an ERREXIT ABORT: under `set -e`, this assignment's command substitution fails
   *  and ends the shell on this line, so every guard below it (and the cause it writes) is dead code.
   *  A THIRD repair, distinct from both above: guard the assignment (`|| true`) or move it into a
   *  condition — ⛔ not "write a cause here", which the criterion already does and cannot reach. */
  errexitAbort?: boolean;
}

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
 *  WHY THIS IS NOT A CONTRADICTION OF THE RULE ABOVE (2026-09-11, surfaced by AC-243): the exemption
 *  for quoted strings exists because `bash -c "exit 1"` really does exit 1. That case is *preserved*
 *  here: the quote is preceded by `c`, not by `:`/`=`, so it is still scanned and still BARE. What this
 *  masks is the strictly narrower shape where the quote is the VALUE of a `key:`/`key=` pair.
 *
 *  THE DEFECT IT FIXES (AC-243, real, found by the ratchet on develop's own new criterion): AC-243
 *  proves the runner's zero-output template by *invoking* it — `m.runAcceptance({command:"exit 1", …})`.
 *  AC-243's own failure exits all write stderr, so it is fully attributable and can never leave an
 *  unattributable ledger fail — yet the bare scan matched the `exit 1` inside that ARGUMENT STRING and
 *  reported the achieved, faithful AC-243 as a REGRESSION, blocking an unrelated task from landing. A
 *  detector that accuses an attributable criterion is itself an attribution defect (hard rule 3b).
 *
 *  ⛔ TWO LIMITS, both deliberate, neither silent:
 *   · A value string containing command substitution (`x="$(exit 1)"`, `` x=`exit 1` ``) EXECUTES and is
 *     therefore NEVER masked — masking it would manufacture a false negative.
 *   · Indirection a masker cannot follow (`c='exit 1'; eval "$c"`) becomes a false negative. Contrived,
 *     and the safe direction is over-reporting, not under-reporting. */
export function maskValueStrings(line: string): string {
  return line.replace(
    /([:=])([ \t]*)((?:"(?:[^"\\]|\\.)*")|(?:'(?:[^'\\]|\\.)*'))/g,
    (m: string, sep: string, gap: string, lit: string) => {
      if (lit.includes("$(") || lit.includes("`")) return m;
      return sep + gap + " ".repeat(lit.length);
    },
  );
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
    // (b) failure must PROPAGATE: last segment, or followed by `&&`. `||` remediates (the negative
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

/** True iff this criterion LINE is a failure exit that writes no cause. Pure — the testable core.
 *  Judged BY POSITION (hard rule 2): a `#`-comment that merely mentions `exit 1` is not a failure exit,
 *  and a quoted value (`command:"exit 1"`) is data, not one either (see maskValueStrings). */
export function isBareFailureExitLine(line: string): boolean {
  const code = maskValueStrings(maskHashComments(line));
  return hasFailureExit(code) && !ATTRIBUTION_RE.test(code);
}

// ── THE ERREXIT-ABORT CLASS (2026-09-21, gap-ac241-errexit-abort-silent-failures-have-no-predicate) ─
//
// THE THIRD CLASS, and the first one that is NOT about an `exit` statement at all. Classes ① and ②
// both ask "where does the non-zero status come from?" — ① reads written exits, ② reads the inherited
// status of a criterion that writes none. This class asks a different question: **the criterion writes
// its cause correctly, and the shell never reaches the line that writes it.**
//
// WHAT THE FORM IS. Under `set -e`, an ASSIGNMENT whose value is a command substitution
// (`LINE="$(grep … | head -1)"`) takes the substitution's exit status, and a non-zero status ENDS THE
// SHELL on that line. Every guard below it — `if [ -z "$LINE" ]; then echo "CAUSE=…" >&2; exit 1; fi` —
// is dead code. The failure is silent not because the criterion forgot a cause but because errexit
// aborted before the branch that writes one could run. Measured 2026-09-20 in the production ledger:
// AC-286's criterion carries THREE attributed failure exits and still died with ZERO bytes on both
// streams, so the runner wrote its zero-output template and AC-241 went red for the 6th time. Minimal
// reproduction (this repo, 2026-09-21):
//   $ bash -c 'set -euo pipefail; x="$(grep NO-SUCH /dev/null | head -1)"; if [ -z "$x" ]; then echo "CAUSE=x" >&2; exit 1; fi'
//   EXIT=1   ← zero output: the guard and its CAUSE never ran
//
// WHY THE EARLIER CLASSES CANNOT SEE IT. ① judges LINES CONTAINING a failure exit — this line contains
// none, so it reads clean by construction. ② judges the status-bearing statement of a criterion with NO
// exit statement anywhere, and it sits behind `if (out.length === 0)` — the mutex documented as making
// the two classes "disjoint by construction". The abort lies in the SEAM: a criterion that is fully
// attributed AND still silent. That is why five successive repairs (bare exits → trailing computed →
// implicit terminal → birth gate → stock cleanup) each held and AC-241 still went red.
//
// THE RULE (position-based, 硬规则 2). Walk the lines in order, tracking whether errexit is currently ON
// and whether the line sits in an `if`/`elif`/`while`/`until` CONDITION — POSIX exempts conditions from
// errexit, which is exactly what makes `if ! LINE=$(…)` a correct repair and not a bug. A line is an
// errexit-abort silent exit iff ALL hold:
//   · errexit is ON at that line (`set -e…` / `set -o errexit` on, `set +e…` / `set +o errexit` off);
//   · the line is an ASSIGNMENT (`NAME=` / `export NAME=`) whose VALUE holds a command substitution —
//     the value is what the shell evaluates, so a substitution anywhere else on the line
//     (`echo "$(cmd)"`, whose status is `echo`'s) is NOT this class;
//   · the statement is UNGUARDED: no `||` on it. `LINE="$(grep … || true)"` and `LINE="$(…)" || true`
//     both prevent the abort (measured, both exit 0). `&&` is deliberately NOT remediation — same
//     choice class ② makes, same reason: a silent left branch of `&&` short-circuits and, as the
//     status-bearing statement, exits non-zero with zero output.
// ⛔ ATTRIBUTION ON THE SAME LINE DOES NOT CLEAR IT, and that is not an oversight: measured,
//   `X="$(false)"; echo "CAUSE=x" >&2; exit 1` still exits 1 with ZERO output — errexit aborts at the
//   assignment, so that `echo` is as dead as any guard below it. Clearing here on ATTRIBUTION_RE would
//   manufacture precisely the false negative this class exists to remove (硬规则 4).
//
// MEASURED OVER-REPORT, stated rather than hidden (the discipline ATTRIBUTION_RE and class ② follow).
// Two directions, both kept, both sized by a scan of develop's 155 in-domain criteria on 2026-09-21:
//   · a pipeline inside the substitution WITHOUT `pipefail` (`set -e; X="$(false | head -1)"`) does not
//     abort — measured, exit 0 — because a pipeline's status is its last command's. The predicate keys
//     on errexit alone and flags it. SIZE: 0 (every flagged AC sets `set -euo pipefail`).
//   · `X="$(false)" && echo ok` does not abort when a later statement succeeds (measured, exit 0), and
//     IS flagged. SIZE: 0 (no in-domain criterion carries that shape).

/** errexit turned ON by this line: `set -e`, `set -euo pipefail`, `set -ue -o pipefail`, `set -o errexit`. */
const ERREXIT_ON_RE = /^(?:command\s+)?set\s+(?:-\w*e\w*(?:\s|$)|-\w*o\s+errexit(?:\s|$))/;
/** errexit turned OFF by this line: `set +e`, `set +o errexit`. */
const ERREXIT_OFF_RE = /^(?:command\s+)?set\s+(?:\+\w*e\w*(?:\s|$)|\+\w*o\s+errexit(?:\s|$))/;

/** A line that OPENS a condition, whose commands POSIX exempts from errexit. `!` alone included: `! cmd`
 *  is a condition context. */
const CONDITION_OPENER_RE = /^(?:if|elif|while|until|!)(?:\s|$)/;
/** …and the token that CLOSES it. A condition may span lines (`if [ -f x ]` / `&& [ -f y ]; then`), so
 *  the region is tracked rather than judged per line. */
const CONDITION_END_RE = /(?:^|[;&|\s])(?:then|do)\s*$/;

/** A line whose statement is an ASSIGNMENT — `NAME=`, `export NAME=`, `readonly NAME=`. `(?!=)` keeps a
 *  comparison (`NAME==`) out. */
const ASSIGNMENT_PREFIX_RE = /^(?:export\s+|readonly\s+|declare\s+-\w+\s+)?[A-Za-z_][A-Za-z0-9_]*=(?!=)/;

/** A command substitution — `$( … )` or `` ` … ` `` — anywhere it can EXECUTE. */
const CMD_SUBST_RE = /\$\(|`/;

/** True iff `text` leaves a shell construct OPEN: an unterminated quote, an unbalanced `$( … )` or
 *  backtick, or a trailing `\` continuation. Used to join the physical lines of ONE logical statement,
 *  so a guard written on a LATER line of a multi-line assignment
 *  (`LINE="$(grep …` / `"$f" | head -1 || true)"`) is still seen — read per physical line, such a
 *  criterion reads BARE although it is guarded, i.e. the detector accuses a clean criterion (硬规则 3b,
 *  the harder error to notice). */
function statementLeavesOpen(text: string): boolean {
  let quote: string | null = null;
  let depth = 0;
  let ticks = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote !== null) {
      if (c === "\\" && quote !== "'") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "\\") { i++; continue; }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === "`") { ticks++; continue; }
    if (c === "$" && text[i + 1] === "(") { depth++; i++; continue; }
    if (c === ")") depth = Math.max(0, depth - 1);
  }
  return quote !== null || depth !== 0 || ticks % 2 !== 0 || /\\\s*$/.test(text);
}

/** The errexit-abort silent exits of `criterion` (see the class documentation above). Pure; `[]` for a
 *  criterion that never enables errexit, or one whose every such assignment is guarded. */
export function errexitAbortSilentExits(criterion: string): BareLine[] {
  const out: BareLine[] = [];
  const lines = criterion.split("\n");
  let errexit = false;
  let condPending = false;
  for (let i = 0; i < lines.length; i++) {
    const code = maskHashComments(lines[i]).trim();
    if (condPending) {
      if (CONDITION_END_RE.test(code)) condPending = false;
      continue;
    }
    if (code === "") continue;
    if (CONDITION_OPENER_RE.test(code)) {
      // A single-line `if …; then` opens and closes on the same line; a multi-line one holds the region
      // open until its `then`/`do`.
      if (!CONDITION_END_RE.test(code)) condPending = true;
      continue;
    }
    if (ERREXIT_OFF_RE.test(code)) { errexit = false; continue; }
    if (ERREXIT_ON_RE.test(code)) { errexit = true; continue; }
    if (!errexit) continue;
    if (!ASSIGNMENT_PREFIX_RE.test(code)) continue;
    const startLine = i + 1;
    // Join the rest of THIS logical statement before judging its guards — the guard may be written on a
    // later physical line of a multi-line value.
    let stmt = code;
    while (statementLeavesOpen(stmt) && i + 1 < lines.length) {
      i += 1;
      stmt += "\n" + maskHashComments(lines[i]);
    }
    const eq = code.indexOf("=");
    if (!CMD_SUBST_RE.test(code.slice(eq + 1))) continue;
    if (stmt.includes("||")) continue;
    out.push({ line: startLine, text: code, errexitAbort: true });
  }
  return out;
}

/** Every bare failure exit of a whole criterion — the explicit forms line by line, the implicit-exit
 *  class when no explicit failure exit exists, and the errexit-abort class. Pure; `[]` for a clean
 *  criterion.
 *
 *  ⛔ THE ERREXIT CLASS IS NOT BEHIND `out.length === 0`. That mutex is exactly what made the implicit
 *  class miss AC-286 — a criterion can carry attributed explicit exits AND still die with zero output,
 *  so the third class must be ADDITIVE. The mutex is kept for class ② alone, where it is correct (a
 *  written exit determines the status; nothing is inherited). */
export function bareFailureExitsOfCriterion(criterion: string): BareLine[] {
  const out: BareLine[] = [];
  criterion.split("\n").forEach((line, i) => {
    if (isBareFailureExitLine(line)) out.push({ line: i + 1, text: line.trim() });
  });
  if (out.length === 0) out.push(...implicitFailureExitLines(criterion));
  // A line can be BOTH an explicit bare exit and an errexit abort; it is one site, so count it once.
  const already = new Set(out.map((b) => b.line));
  for (const b of errexitAbortSilentExits(criterion)) {
    if (!already.has(b.line)) out.push(b);
  }
  return out;
}

/** The three-state verdict of the ONE predicate (硬规则 3b). `evaluated:false` is a DISTINCT value —
 *  never conflated with `evaluated:true, bare:[]` ("I read it, it is clean"). */
export interface CriterionAttributionVerdict {
  /** false ⇒ NOT-EVALUATED: the input could not be read at all. */
  evaluated: boolean;
  /** why it could not be read (only when `evaluated` is false). */
  error?: string;
  /** the bare failure exits, in source order (only meaningful when `evaluated` is true). */
  bare: BareLine[];
}

/** Judge an arbitrary criterion value — the surface both consumers share. `unknown` (not `string`)
 *  because the write gate is handed whatever the frontmatter parse produced: a non-string or an
 *  empty/whitespace-only criterion is NOT-EVALUATED, and that must never render as "clean". */
export function evaluateCriterionAttribution(criterion: unknown): CriterionAttributionVerdict {
  if (typeof criterion !== "string") {
    return {
      evaluated: false,
      error: `criterion is not a string (got ${criterion === null ? "null" : typeof criterion}) — a criterion is the runnable command that verifies the record`,
      bare: [],
    };
  }
  if (criterion.trim() === "") {
    return {
      evaluated: false,
      error: "criterion is empty (or whitespace-only) — there is nothing to judge, which is not the same as judging it clean",
      bare: [],
    };
  }
  return { evaluated: true, bare: bareFailureExitsOfCriterion(criterion) };
}

/** Render the bare failure exits for a human-facing rejection: the LINE NUMBERS and the offending
 *  line text (hard rule 3 — an enumeration, not a boolean). */
export function formatBareFailureExits(bare: BareLine[]): string {
  return bare
    .map((b) => {
      const kind = b.errexitAbort
        ? " (errexit abort — under `set -e` this assignment's command substitution ends the shell here, so the cause written below never runs; guard it with `|| true` or move it into a condition)"
        : b.implicit
          ? " (implicit — this command's status becomes the criterion's)"
          : "";
      return `line ${b.line}${kind}: ${b.text}`;
    })
    .join("; ");
}

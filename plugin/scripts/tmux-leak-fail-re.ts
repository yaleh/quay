// tmux-leak-fail-re.ts — SINGLE definition of the suite-tail tmux-leak-scan residual failure
// pattern (tasks/gap-fan-in-execute-tmux-leak-scan-unanchored, AC1/AC2).
//
// The suite-tail leak-scan (`tmux-leak-scan.sh`) emits `tmux-leak-scan: FAIL ...` at COLUMN-0 when
// it finds NEW residual tmux servers/dirs after a run. A PASSING test whose NAME quotes the shape
// (e.g. the runner's own AC5 e2e name, `✔ AC5 e2e — a 'tmux-leak-scan: FAIL' residual line flips
// red`) is `✔`-prefixed and must NOT match — hence the `^` anchor (same self-match family as the
// ^✖ fix c83ce4be and ^__PERFILE__ a1b78104; the FIRST unanchored copy of this literal was fixed
// in gap-tmux-leak-scan-pattern-unnchored-self-match-phantom-red, full-suite-runner.ts:483).
//
// SINGLE DEFINITION, THREE reference sites (hard rule 5b — 在一处修好 X ≠ X 只在那一处):
//   - plugin/scripts/full-suite-runner.ts   (FAILURE_PATTERNS + GATE_SCAN_FAILURE_LINES)
//   - plugin/workflows/fan-in-execute.js    (fix-scope gate leak-residual classification)
//   - .claude/workflows/fan-in-execute.js   (mirror of the above, workflows-dual-copy)
// The two workflow copies reference this constant by path; a stale unanchored literal in any copy
// becomes structurally impossible.
//
// gap-fan-in-leak-fail-regex-missing-m-flag: the fix-scope gate (both workflow copies) tests this
// RE against `logText` — the ENTIRE multi-line suite log, not a single stream line. Without the `m`
// (multiline) flag `^` anchors only to string start, so a `tmux-leak-scan: FAIL` on any line after
// the first never matches ⇒ the leak-residual branch was dead code and a real leak red was
// misclassified checker-misreport. With `m`, `^` also anchors after each `\n` (per-line column-0),
// which is exactly the leak-scan's emission contract; single-line consumers (isFailureLine /
// gateScanCause feed one stream line at a time) are unaffected — a `✔`-prefixed passing test NAME
// still can't match because `^` never lands mid-line.
export const TMUX_LEAK_FAIL_RE = /^tmux-leak-scan: FAIL/m;

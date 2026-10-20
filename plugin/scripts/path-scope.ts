// path-scope.ts — the ONE "which whitespace token is a repo path?" judgment for plugin/scripts
// checkers.
//
// Why this module exists: threshold-scope-check.ts and tick-core-static-check.ts each carried a
// byte-identical 28-line `pathCandidates` plus identical `TOP_LEVELS` / `PATH_EXT_RE` constants
// (`.quay/routine-findings.jsonl`, routine `architecture-analysis`, runId
// `architecture-analysis-1792481915389`, archguard dup hash 4cf914f3bbd40659, 316 tokens). Two
// copies of a scope-resolution predicate are two answers waiting to drift: a token one checker
// treats as a path and the other does not is exactly how a stale-path gate goes quiet while the
// other keeps reporting. The judgment now lives here once; the two checkers import (and re-export)
// it, so their scanning scopes cannot diverge by edit.
//
// ⛔ What this module deliberately does NOT do: unify the checkers' surrounding POLICY. Their
// STALE_ANNOT_RE / STALE_STRONG_ANNOT_RE / PLACEHOLDER_RE, paragraph grouping and reporting layers
// genuinely differ (see the callers' headers) and stay with the callers. Only the token judgment
// and the two constants it needs are shared.
//
// The `.quay/routine-findings.jsonl` family precedent is fs-walk.ts: when a byte-identical helper
// is extracted, the surviving module records the finding, and the callers keep their public surface
// by re-exporting (⛔ do not re-add a local copy here).

/**
 * Repo top-level dirs — a whitespace token is path-like if it starts with one of these OR carries a
 * known file extension.
 */
export const TOP_LEVELS = [
  "packages", "plugin", "scripts", "docs", "tasks", "orchestration", "experiments",
  "adr", "dist", ".github", ".quay", ".claude", "milestones", "src", "test",
];

/** Extensions that make a token path-like even when it is not under a known top-level. */
export const PATH_EXT_RE = /\.(ts|js|mjs|md|sh|json|yml|yaml|txt|env|tsx|jsx|css|html|png|py|lock|snapshot|jsonl)$/;

/** Extract path-like candidates from a backtick token.
 *  - A SLASH-BEARING token (or whitespace-token) is a candidate when it starts with a known
 *    repo top-level OR carries a file extension ("node … script.ts <cmd>" yields its path token;
 *    math expressions like "nproc / 1.0" and data shapes are not candidates).
 *  - A BARE basename (no `/`, e.g. `quay-native.js`, `lifecycle.ts`, `it0-dod-check.mjs`) is ALSO a
 *    candidate — the task's own stale examples include three bare names (`quay-native.js`,
 *    `it0-dod-check.mjs`, `lifecycle.js`) — but only when it looks like a REAL filename: chars before
 *    AND after the extension. A pure extension mention (`.mjs`), a shell word (`pgrep`, `--json`),
 *    or a numeric fragment (`0.5`) is not a path.
 *  Absolute / home paths (`/tmp/...`, `~/.claude/...`) are not repo-relative — skipped. */
export function pathCandidates(token: string): string[] {
  const out: string[] = [];
  for (const w of token.split(/\s+/)) {
    let w2 = w.replace(/^[`'"(]+/, "").replace(/[),;.]+$/, "");
    // A trailing `:NNN` is a LINE-NUMBER CITATION (`path.md:NNN`), not part of the path — the repo
    // cites `quay-init.sh:1011` / `inner-brief-2026-08-04-restart.md:103` / `select-preflight.ts:113`
    // everywhere. Strip it so the citation resolves to its base path (the file itself exists) instead
    // of being misread as a `stale-path-ext` (stem `x` ext `md` vs candExt `md:16` false positive,
    // round-312 CLAUDE.md:19). A genuinely-missing `path.md:NNN` still flags (base path missing).
    w2 = w2.replace(/:\d+$/, "");
    if (w2.length < 3) continue;
    if (w2.startsWith("/") || w2.startsWith("~")) continue;
    if (!w2.includes("/")) {
      const dot = w2.lastIndexOf(".");
      if (dot <= 0 || dot === w2.length - 1) continue; // ".mjs" or "foo." — not a filename
      const base = w2.slice(0, dot);
      const ext = w2.slice(dot + 1);
      if (!PATH_EXT_RE.test(`.${ext}`)) continue;
      if (!/^[A-Za-z0-9_@-]/.test(base)) continue; // shell/flag/quote leftovers
      out.push(w2);
      continue;
    }
    if (w2.length <= 2) continue; // lone "/" from math
    const startsTop = TOP_LEVELS.some((t) => w2 === t || w2.startsWith(t + "/"));
    if (startsTop || PATH_EXT_RE.test(w2)) out.push(w2);
  }
  return out;
}

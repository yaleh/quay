# M41-cryst-g1-observability — iteration-1 report

Worktree: `milestones/M41-cryst-g1-observability/worktrees/iteration-1`, branch `exp5-m41-iteration-1`,
base `ba1edb8` (master HEAD at charter time). Independent re-derivation of iteration-0's build (no
`baime:iteration-executor` subagent dispatch was available this pass — both iterations executed by
the OUTER orchestrator directly, in isolated worktrees, deliberately using different internal
approaches per proxy to preserve independent-verification value; see charter's dispatcher notes).

## 0. Preconditions

- Worktree confirmed on its own branch (`exp5-m41-iteration-1`), isolated from iteration-0
  (`exp5-m41-iteration-0`) — no shared working tree.
- `archguard_analyze` re-probed independently (fresh MCP call, not reusing iteration-0's probe):
  same result, `"Analysis failed: No query scopes were persisted."` for every lang/sources/noCache
  combination tried. Confirms the KNOWN GAP is a real, repeatable upstream condition, not a fluke.

## 1. Build — 3 proxies, independently derived

All three scripts implement the SAME external rule as iteration-0 (per the milestone AC, approach
convergence on the rule itself is expected) but differ in internal derivation, per the charter's
independent-iteration discipline:

- **L_D** (`scripts/git-lens-l-d-code-doc-ratio.mjs`): uses `git log --numstat --pretty=format:
  <base>..<head>` (full per-commit numstat, summed across the whole commit range — counts total
  CHURN including same-file-touched-twice cases) instead of iteration-0's single collapsed `git diff
  --numstat`. Broadened doc-file classifier to `/\.(md|txt|rst|adoc)$/i`.
- **L_G** (`scripts/git-lens-l-g-structural-drift.mjs`): builds a flat EDGE LIST `{from,to}` as the
  shared primary artifact (rather than an adjacency Map built up front), deriving both cycle
  detection (DFS over lazily-grouped edges) and god-module fan-in (a tally over the same edge list)
  from it. Genuinely different internal shape, same externally observable rule (cycle -> FLAG;
  file >= 400 lines AND fan-in >= 5 -> god-module FLAG).
- **L_S** (`scripts/git-lens-l-s-behavior-variance.mjs`): splits mutant DESCRIPTION (`describeMutants`
  — produces `{name, index, from, to}` specs) from mutant MATERIALIZATION (`materializeMutant` —
  applies one spec to source text) as two separate pure functions, rather than generating fully
  materialized mutant source strings in the same scanning pass. Also broadens the operator set beyond
  iteration-0's 6 operators with `flip-increment`/`flip-decrement` (`++`/`--`), for 8 operators total
  (still including the relational `<`/`>` flips, which a first draft omitted — see DIR-019 fix below).

### DIR-019 fix during build

First selfcheck run: `l-s/weak-module` FAILED (exit 0, expected 1) because a first draft of the
operator set dropped the relational `<`/`>` flip operators entirely (only `===`/`&&`/`++`/`--` were
present), so the weak-module fixture (whose only unpinned branches are relational comparisons)
produced just 2 mutants (1 killed, 1 survived → score 0.5, not below the 0.5 FLAG threshold, an exact
boundary miss). Per DIR-019 (fix the SCRIPT, not the fixture — the fixture's weakness is exactly what
it's designed to test): added back `flip-lt`/`flip-gt` operators with lookaround-guarded regexes
(so `<`/`>` don't double-mutate `<=`/`>=`/`<<`/`>>`). Re-ran: all fixtures PASS.

## 2. Selfcheck transcript (`scripts/git-lens-selfcheck.sh`, iteration-1)

```
== L_D code:doc ratio (iteration-1) ==
PASS: l-d/prose-heavy — exit 1 (expected 1)
PASS: l-d/code-heavy — exit 0 (expected 0)
PASS: l-d/empty — exit 0 (expected 0)

== L_G structural-drift (iteration-1, edge-list derivation) ==
PASS: l-g/cycle-repo — exit 1 (expected 1)
PASS: l-g/clean-repo — exit 0 (expected 0)

== L_S behavior-variance (iteration-1, descriptor/materialize split) ==
PASS: l-s/strong-module — exit 0 (expected 0)
PASS: l-s/weak-module — exit 1 (expected 1)

PASS: all git-lens (L_D/L_G/L_S) fixtures behaved as asserted (iteration-1).
```

## 3. Real (non-fixture) findings — cross-validated against iteration-0

| Proxy | iteration-0 | iteration-1 | Agreement |
|---|---|---|---|
| L_D (`5c7ac2f..ba1edb8`) | docLines=11679 codeLines=4234 ratio=2.758 PASS | docLines=14067 codeLines=4968 ratio=2.832 PASS | Same verdict (PASS); ratio differs slightly by design (per-commit churn sums higher than a collapsed diff) — both well under the FLAG_RATIO=3 threshold given MIN_DOC_LINES gating, confirming the milestone's own code:doc churn is NOT prose-heavy by either method. |
| L_G (`packages/`) | 0 cycles; 3 god-modules: github-client.js(851L/fanin8), store.js(729L/fanin14), serve.js(1079L/fanin8); FLAGGED | Identical: 0 cycles; same 3 god-modules, same line/fanin counts; FLAGGED | Exact agreement — independently-derived edge-list vs adjacency-map approaches converge on the identical real finding. |
| L_S (`registry.js` + `gate.test.mjs`) | totalMutants=31 killed=3 survived=28 mutationScore=0.097 FLAGGED | totalMutants=32 killed=3 survived=29 mutationScore=0.094 FLAGGED | Same verdict and same 3 kills; iteration-1's broader operator set (+ relational flips already counted in both, + increment/decrement) adds 1 extra survived mutant, mutationScore differs in the 3rd decimal only. Both confirm registry.js is severely under-tested by gate.test.mjs (~9-10% mutation kill rate). |

`registry.js` verified restored to clean git state both before and after the L_S probe
(`git status --porcelain` empty pre/post; `.l-s-backup` file removed on completion).

## 4. Done-when self-assessment (charter, iteration-1 contribution)

1. "All 3 proxies exist as runnable scripts, each independently re-derived, each producing a REAL
   (non-fixture) finding against the live repo" — YES, see §3.
2. "Selfcheck harness (RED+GREEN fixtures) exists per proxy and passes" — YES, see §2.
3. "archguard gap is explicitly documented (not silently worked around)" — YES, re-confirmed
   independently in this iteration's own probe (§0) and in the script header KNOWN GAP section.

No self-ticking of the charter's own AC/DoD boxes performed (DIR-020) — that is reserved for the
ABSORB adversarial-audit step.

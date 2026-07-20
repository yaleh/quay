# M41-cryst-g1-observability — ABSORB adversarial audit

Performed by the OUTER orchestrator (no separate audit subagent dispatch available this pass — see
charter dispatcher notes); stance is refute-first, all checks independently re-run rather than
trusting the iteration reports' self-reported transcripts.

## Independent re-verification performed

1. **Fixture selfcheck re-run on post-merge master** (not just inside a worktree):
   `bash experiments/quay-perpetual-stream/scripts/git-lens-selfcheck.sh` → all 7 fixture cases
   (3 L_D + 2 L_G + 2 L_S) PASS, exit 0. Confirms the merged files are genuinely wired and correct,
   not just correct inside the now-discarded worktree.

2. **Real (non-fixture) findings independently re-run on master HEAD, not copy-pasted from either
   iteration report:**
   - L_D (`5c7ac2f..ba1edb8`): `docLines=11679 codeLines=4234 ratio=2.758 verdict=PASS` — exact match
     to iteration-0's report.
   - L_G (`packages/`): `cycles=0`, 3 god-modules (`github-client.js` 851L/fanin8, `store.js`
     729L/fanin14, `serve.js` 1079L/fanin8), `verdict=FLAGGED` — exact match to BOTH iteration
     reports (iteration-1's independently-derived edge-list approach found the identical set).
   - L_S (`registry.js` + `gate.test.mjs`): `totalMutants=31 killed=3 survived=28
     mutationScore=0.097 verdict=FLAGGED` — exact match to iteration-0's report. Confirmed via
     `git status --porcelain` before AND after the probe that `registry.js` was clean pre-run and
     restored clean post-run (no residual `.l-s-backup` file, no diff) — the mutation probe does not
     leave the repo in a dirty state.

3. **archguard gap independently re-confirmed**, fresh MCP call this audit (not reusing either
   iteration's probe): `archguard_analyze(lang: typescript, projectRoot: /home/yale/work/quay,
   format: json)` → `"Analysis failed: No query scopes were persisted. Previous query state is
   unchanged."` Confirms the KNOWN GAP documented in both scripts' headers is a real, reproducible
   upstream condition (third independent confirmation across this milestone: iteration-0's probe,
   iteration-1's probe, this audit's probe), not a one-off flake or a fabricated excuse to avoid
   integration work.

4. **Test-floor scope check**: `git diff ba1edb8..HEAD --stat -- 'packages/quay*'` → empty output.
   Confirms zero product-code (`packages/quay*`) files were touched by this milestone — Test-floor
   clause is genuinely N/A, not silently assumed.

## adversarial-audit verdict: NO REFUTATION FOUND at AC-content level

All 3 ACs (L_D real+dashboard-recordable finding; L_G real archguard-or-fallback finding; L_S
behavior-variance with pinning fixtures) are independently confirmed against the live repo, not
merely asserted in prose. Both DoD Done-when items (runnable proxies that ran at a real ABSORB;
flags a real regression) are satisfied — L_G and L_S both genuinely FLAG on the live repo (a real
non-synthetic regression signal), L_D correctly PASSes (confirming this milestone's OWN code:doc
churn is not prose-heavy, which is itself informative).

## Non-blocking CONCERN (carried forward, not a re-open)

The L_G/L_S fallback proxies are a plain-JS approximation of the archguard-backed design the task's
own `## Proposal` originally envisioned ("archguard-backed L_D/L_G probe"). This is disclosed
explicitly (not silently substituted) in both scripts' KNOWN GAP headers, both iteration reports, and
this audit — but the fallback's god-module/cycle heuristics are simpler than what a true
dependency-graph tool (duplicated-abstraction detection in particular) would surface. Follow-up:
once the archguard "No query scopes were persisted" gap is fixed upstream for plain-JS/ESM projects,
a follow-up milestone should re-point L_G at the real archguard API and diff its findings against
this fallback's.

## V_meta consolidation-lag: clear — no rows past threshold

`v-meta-ledger.md` re-checked via `vmeta-lag-check.sh --counter 40 v-meta-ledger.md`: PASS, no
confirmed-unconsolidated row past K=2 without a dated carry-forward (both existing rows are
`consolidated`/`proposed`, neither triggers the lag gate).

## Escrow-Δv / Impl-row clauses

N/A — not design-only; real proxy code + fixtures + selfcheck + reports were delivered directly (this
milestone's own output IS the mechanism, mirrors M25/M38/M39/M40 method-infra precedent).

## Test-floor clause

N/A — `surface:method-infra`, zero `packages/quay*` product files touched (confirmed above).

## Task canonical-lifecycle-record (Clause 8)

`exp5-M-CRYST-G1` carries its own `## Proposal` (real, specific — quoted above) and `## Plan`
("N/A — one metric module... no staged docs/plans doc warranted", a genuine N/A with reasoning, not
an empty placeholder).

## AC/DoD checkbox disposition (DIR-020: only this audit ticks boxes)

- AC1 (`code:doc` L_D computes from real git deltas, flags synthetic prose-heavy, recorded at real
  ABSORB) → `[x]` MET: real finding above + this ABSORB entry recording it on the dashboard.
- AC2 (L_G surfaces a real cycle/god-package/dup-abstraction on the live repo, not just a fixture)
  → `[x]` MET: real finding above (3 god-modules on live `packages/`), archguard-primary gap
  explicitly disclosed with a working fallback.
- AC3 (L_S reports behavior variance for a touched module; fixtures pin each metric)
  → `[x]` MET: real finding above (`registry.js`, mutationScore=0.097 FLAGGED) + 7/7 fixtures PASS.
- DoD item 1 (dark axes each have a runnable proxy that RAN at a real ABSORB, recorded on dashboard)
  → `[x]` MET, recorded in this ABSORB entry + dashboard update.
- DoD item 2 (flags a real regression; single-source, quay-wrappable) → `[x]` MET: L_G and L_S both
  genuinely FLAG on the live repo; all 3 scripts are pure-function-plus-thin-CLI, explicitly
  documented as wrappable unchanged by a future `quay gate --gate l-d/l-g/l-s` (M39 registry
  precedent).

## Backlog row
| exp5-M-CRYST-G1 | G1: L_D/L_G/L_S convergence-observability proxies (ADR-007) — code:doc ratio, structural-drift (cycles/god-modules), behavior-variance (mutation probe) | discovery (primary) + instrument-correction (secondary) | no VT chart cell | milestone-candidate, surface:method-infra, milestone:M41-cryst-g1-observability |

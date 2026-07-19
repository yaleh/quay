---
id: exp5-M-CRYST-ANALYSIS
title: ANALYSIS [discovery] Cross-experiment pattern analysis — exp1-5
  development history → recurring patterns + typical failure modes
status: done
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-CRYST
children: []
extra:
  dirStatus: applied
---
## Proposal
Cross-experiment (exp1-5) pattern + failure-mode catalog with the "deterministic-vs-judgment" step inventory, from 5 parallel analyses. Purpose: crystallize the REAL recurring problems (not just this session's finds) and re-prioritize the plan.

## Findings — recurring FAILURE MODES (confirmed across experiments)

The failure families are NOT independent — they are facets of ONE root: **the method is expressed as PROSE the LLM re-interprets each cycle; prose can drift from a 2nd copy, be paraphrased-away when regenerated, describe a mechanism without building it, or defer without a mechanical tracker.** Every family = "prose where there should be an executable invariant." This validates Axis 2′ (code-over-prompt) as THE central lever, confirmed in 5 experiments.

1. **Molten (prose > executable)** — ALL 5 exps. σ/V computation, precondition checks, re-trigger checks, sizing — encoded as English prose, re-read/re-done manually each cycle. Universal.
2. **Designed-not-wired / enforcement-half-never-built** — ALL 5. exp1 executeEpic/GitHub-compound; exp2 timeout-envelope in prose not SKILL; **exp4 worktree-isolation rule diluted — the SAME PR-002 recurred 13 CONSECUTIVE times** (DIR-009) until pasted-output proof forced it; exp5 DIR-014 skill built m22, wired m42 = 25 milestones shelfware. THE deepest recurring structural fault. Fix (exp5 DIR-026 item 5): build enforcement WITH the design, never after.
3. **Form-vs-substance dilution (Layer-A pinned doc → Layer-B generated prompt paraphrases it away)** — NEW family, strongest in exp4 (DIR-009). A rule that lives only in prose gets paraphrased out when a fresh prompt is generated. Motivates code-over-prompt (a coded step can't be paraphrased) + self-verifying doc contracts.
4. **Phased-deferral (later phase never comes)** — exp3/4/5. DIR-004 (SEA packaging) deferred across exp3 AND exp4 AND into exp5; exp4 HALTED partly on deferral stack-up.
5. **Dual-source / drift** — exp1 (provenance.md replication), **exp4 merge-drift: 12 "closed" gaps NEVER merged to master (doc commits merged, code commits not) — caught only by git forensics**; exp5 file+task projection (fixed DIR-028). The ledger-of-done must be DERIVED from merged code state, not a separately-edited doc.
6. **Uncritical metric/baseline carry-forward** — exp1/2/3/4/5. Multiplicative V_meta frozen effectiveness=0.26 → 0.80 unreachable; σ inherited-floor dominates unless reset; VT₀ carried from exp4's overstated "closed" claims (exp5 M4 Δv=−6.60). NEW ADR candidate.
7. **Schema-inconsistency** — exp1 + exp5 (task shape in ≥3 places).
8. **False/stale precondition claims** — exp4 (iter-11 "directives empty" false; read stale worktree snapshot).

## Findings — recurring PATTERNS (worked, cross-exp)
Two-phase author→ready→done gated cycle; provenance/single-source computed-not-asserted; independent out-of-band audit (G3/adversarial) every cycle; walk-the-design fresh re-read; directive lifecycle; gate transclusion+hash-check (anti-paraphrase); exhaustive-enumeration to find next gap; DoD meta-enforcer clauses + quay-gate engine; split-or-commit.

## Code-over-prompt inventory (Axis 2′)
- **~15-19 deterministic steps still prose** across exps: VT/σ/Δv computation, precondition checks, batch task-writes (SELECT/directive dispositions/AC-DoD authoring), re-trigger checks, dashboard updates, next-id, worktree creation, sizing gauge, value-type classify, consolidation-lag count.
- **~8 already scripts** (it0-*.sh): ceiling, gate-hash, dogfood, line-budget, dod-check, impl-row, backlog-regen.
- **Irreducible JUDGMENT residue (~7-9, stays prompt but formalized):** SELECT candidate; split-seam decision; value-type classify (borderline); author charter/proposal; adjudicate divergence; AC-refutation; needs-human external-vs-internal; checkpoint HALT.

## Acceptance Criteria
- [x] Pattern/failure-mode catalog with evidence citations (above).
- [x] Deterministic-vs-judgment inventory (above).
- [x] Re-prioritizes ≥1 plan item on cross-experiment evidence (see Consequences).

## Definition of Done
References inherited-core DoD. Real: the catalog re-prioritizes the crystallization plan (done — see Consequences), based on 5-experiment evidence not one session.

## Consequences (re-prioritization of the crystallization plan)
1. **RAISE D3 + Axis 2′ (code-over-prompt) to the top tier** — the ROOT lever, confirmed in all 5 exps. Failure modes 1/2/3 all dissolve when a deterministic step becomes code (can't drift, can't be paraphrased, can't be "designed-not-wired").
2. **Elevate "enforcement-WITH-design" to a first-class INVARIANT + ADR + gate** — #1 recurring fault across 5 exps (DIR-026 item 5 generalized): no new rule/clause/DoD is accepted without its executable enforcement in the SAME milestone. Add as a gate (C1-adjacent) + an ADR (E2).
3. **Add two failure families to the plan's targets:** form-vs-substance dilution (→ fixed by code-over-prompt + self-verifying contracts D1/D2/D3) and uncritical-carry-forward (→ ADR + a reset-vs-carry check).
4. **merge-drift → connect G1 + Axis 3:** the "done" ledger must be derived from actual merged code, not a separately-edited doc (exp4's 12-gap catastrophe). Elevate G1/F1.
5. First implementation wave unchanged (B1→B2→B3 + A2) but D3/Axis-2′ moves up right behind it; E2 adds ADRs for "enforcement-with-design" and "carry-forward discipline".
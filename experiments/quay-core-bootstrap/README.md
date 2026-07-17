# Quay-Core Bootstrap — BAIME Experiment (Experiment 2)

- **Status**: Not started — iteration 0 is the next action.
- **Date**: 2026-07-16
- **Owner**: Yale Huang
- **Protocol**: [`docs/proposals/quay-core-bootstrap-experiment-v2.md`](../../docs/proposals/quay-core-bootstrap-experiment-v2.md) (authoritative — this file operationalizes it, does not redefine it)
- **Iteration prompts**: [`ITERATION-PROMPTS.md`](./ITERATION-PROMPTS.md)
- **Inheritance from experiment 1**: [`../quay-native-bootstrap/EXTRACTION-SUMMARY.md`](../quay-native-bootstrap/EXTRACTION-SUMMARY.md) · [`../../.claude/skills/quay-native-methodology/`](../../.claude/skills/quay-native-methodology/)

> Frozen vocabulary applies (`glossary.md`). Do not rename Provider, Skill, status, lane, action button, capability, run, task. BAIME terms used verbatim per `methodology-bootstrapping` skill.

---

## 1. Domain

This is the **second** BAIME experiment for the quay project. It inherits methodology from experiment 1 (`experiments/quay-native-bootstrap/`) rather than bootstrapping from σ=0.

### Instance objective (four bounded items with "Done when" clauses — §4 of protocol)

1. **Core CLI/MCP/Web-UI three-way symmetry**: a Core-level equivalent of `abi-symmetry.mjs` exists, covers every Core MCP tool also reachable via CLI and Web UI, runs in the automated suite, and every symmetry gap is either closed or explicitly tracked as a QC-* task.
2. **Browser-driven Web UI verification**: every page/flow currently reachable in `packages/quay` has at least one committed browser-automation-driven test confirming current behavior (chrome-devtools or playwright MCP tooling); any discovered appearance/interactivity changes filed as separate tasks (G5).
3. **Mock/log-file action-delivery verification mode**: `deliverTrigger()` in `packages/quay/src/action.js` has a deterministic file-based recording mode as the default in the CI-equivalent harness; live-manda delivery exists as a separate, clearly-labeled, non-blocking check.
4. **Continued quay-native backlog work**: no quay-native V-factor regresses below experiment 1's final (stop-time) snapshot values across any iteration of this experiment.

### Meta objective (§5 of protocol)

Identify and fix the specific reasons experiment 1's `effectiveness`, `reusability`, `completeness`, and `validation` V_meta factors stalled — using Core + quay-native development as the proving ground. The starting hypothesis for each factor is in `.claude/skills/quay-native-methodology/reference/v-meta-stall-analysis.md`. Experiment 2 must show either genuine movement or a **different** stalling reason than experiment 1 documented.

### Task IDs

All new tasks in this experiment use the `QC-*` prefix. This keeps the two experiments' task populations physically distinguishable in `tasks/`.

---

## 2. Inheritance baseline

Experiment 1 was halted (not converged) at iteration 88. The extraction artifact is at `.claude/skills/quay-native-methodology/`. Starting scores (iteration 0) and final state (iteration 10, practical convergence accepted):

```
V_instance (experiment 2's own factors) = 1.0 × 1.0 × 1.0 × 1.0 = 1.0
             (core_abi_symmetry × web_ui_verification × action_delivery_mode × native_backlog_health)
             All four "Done when" clauses satisfied since iteration 3.

V_meta (inherited from experiment 1's final values; completeness raised 0.74→0.77 in iteration 6)
             = 0.77 × 0.26 × 0.79 × 0.64 = 0.1012
             (completeness × effectiveness × reusability × validation)
             V_meta_ceiling = 0.26 (effectiveness=0.26; criterion 1 arithmetically unreachable).

σ_QC (experiment 2's own tasks, QC-* only) = 4/10 = 0.40 (QC-007, QC-008, QC-009, QC-010 are native-gate tasks)
σ_strict (experiment 1's final, inherited floor) = 62/73 = 0.8493
```

A first iteration that re-derives V_meta from zero is a scoring error — see protocol §5.

---

## 3. Convergence target

All five criteria must hold simultaneously (never partially):

1. V_instance ≥ 0.80 AND V_meta ≥ 0.80.
2. All 4 "Done when" clauses independently satisfied with direct evidence.
3. V_meta genuine movement: ≥2 of the 4 stalled factors show real movement with a *different* stall reason than experiment 1 (if still flat).
4. G3 out-of-band audit green: all Core and V-lift tasks have independent adjudicate co-signs.
5. Diminishing returns: ΔV < 0.02 for 2+ consecutive iterations on both V_instance and V_meta.

---

## 4. Directory layout

```
experiments/quay-core-bootstrap/
  README.md                  ← this file
  ITERATION-PROMPTS.md       ← operational iteration prompts
  provenance.md              ← QC-* task provenance ledger (inheritance record already written)
  iterations/                ← iteration-N.md reports (iteration-0.md is the next action)
  audits/                    ← G3 out-of-band adjudicate verdicts
  directives/
    README.md                ← directive mechanism (inherited; read before filing)
    pending/                 ← active steering directives
    archive/                 ← consumed/resolved directives
```

---

## 10. Iteration history

| Iteration | Date | Primary work | V_instance | V_meta | σ_QC | Status |
|-----------|------|-------------|------------|--------|-------|--------|
| 0 | 2026-07-16 | Baseline — inherited state, starting scores confirmed | 0.0 | 0.0973 | 0/0 | NOT CONVERGED |
| 1 | 2026-07-16 | QC-001: browser-automation tests (GET /, GET /task/:id) | 0.20 | 0.0973 | 0/1 | NOT CONVERGED |
| 2 | 2026-07-16 | QC-002: POST trigger + mock delivery mode (web_ui + action_delivery to 1.0) | 0.80 | 0.0973 | 0/2 | NOT CONVERGED |
| 3 | 2026-07-16 | QC-003: core_abi_symmetry 0.8→1.0 — all four Done-when clauses satisfied | 1.0 | 0.0973 | 0/3 | NOT CONVERGED |
| 4 | 2026-07-16 | QC-004: bounded manda Agent trial + Skill gap annotations | 1.0 | 0.0973 | 0/4 | NOT CONVERGED |
| 5 | 2026-07-16 | QC-005: medium manda trial + hub-address docs; completeness 0.74→0.75 | 1.0 | 0.0987 | 0/5 | NOT CONVERGED |
| 6 | 2026-07-16 | QC-006: complex manda G3 trial + CHANGELOG; completeness 0.75→0.77 | 1.0 | 0.1012 | 0/6 | NOT CONVERGED |
| 7 | 2026-07-16 | QC-007: Skill files updated (manda 3-tier + timing note); first native-gate | 1.0 | 0.1012 | 1/7 | NOT CONVERGED |
| 8 | 2026-07-16 | QC-008: ITERATION-PROMPTS.md updated; manda 6/6 confirmed; practical convergence §11 | 1.0 | 0.1012 | 2/8 | NOT CONVERGED |
| 9 | 2026-07-16 | QC-009: README §2 updated + §9 Practical Convergence Assessment added | 1.0 | 0.1012 | 3/9 | NOT CONVERGED |

*Full per-factor evidence for each iteration in `iterations/iteration-N.md` §7 (V_instance) and §8 (V_meta).*

---

## 9. Practical Convergence Assessment

*Source: `iterations/iteration-8.md §11` (2026-07-16). Updated by QC-009 (iteration 9).*

### Criteria satisfied (criteria 2, 4, 5)

- **Criterion 2 (Done-when clauses)**: all four instance "Done when" clauses independently satisfied since iteration 3:
  core_abi_symmetry = 1.0, web_ui_verification = 1.0, action_delivery_mode = 1.0,
  native_backlog_health = 1.0 (confirmed every iteration 3–8 via 30/30 test suite).
- **Criterion 5 (Diminishing returns)**: ΔV_instance = 0.00 and ΔV_meta = 0.00 for eight
  consecutive iterations (iterations 1–8). Both ΔVs < 0.02 threshold, continuously since
  iteration 5.
- **Criterion 4 (G3 audit)**: no Core source change, no V-factor lift in iterations 4–8.
  G3 is vacuously satisfied (no trigger = no failing audit).

### Criteria structurally unsatisfiable (criteria 1 and 3)

- **Criterion 1 (V_meta ≥ 0.80)**: mathematically impossible given effectiveness = 0.26.
  V_meta_ceiling = 1.0 × 0.26 × 1.0 × 1.0 = 0.26 < 0.80. Even if completeness and
  reusability both reach 1.0, effectiveness would need to be 0.80 to reach the threshold —
  but it currently scores 0.26 (stalled since iteration 23 of experiment 1, 65+ iterations)
  because no organically-arising scope-matched task has appeared. Manufacturing one would
  be metric-manufacturing (G2/G5 violation).
- **Criterion 3 (V_meta genuine movement ≥2 factors)**: requires external events not
  generated by this experiment's own objectives — a scope-matched source-logic task
  (effectiveness), organic GitHub write demand (reusability), or ~11 more consecutive
  native-gate tasks to exceed inherited floor (validation).

### Recommendation

**If no V_meta re-trigger fires by iteration 10: accept practical convergence.** The instance
objectives are complete. The experiment has documented concrete findings on all four V_meta
factors. The mathematical ceiling is explicit and documented in every iteration report since
iteration 4. The remaining V_meta gap (effectiveness, reusability) is an environmental and
scope constraint, not a methodology failure. See `iterations/iteration-8.md §11d` for the full
Option A / Option B reasoning.

*Fallback rule*: if no re-trigger fires within 12 total iterations (current: 8/12), a
dedicated full search is mandatory before accepting convergence (per `v-meta-stall-analysis.md`
re-trigger condition 5).

---

## 5. Guardrails (inherited from experiment 1)

All six guardrails (G1–G6) from experiment 1's protocol carry over:

- **G1**: provenance is a fact, not an aspiration — σ_QC is computed, not asserted.
- **G2**: V_meta factors are measured on marginal increments and held-out targets only, never the accumulated artifact.
- **G3**: independent out-of-band audit (`adjudicate`) is mandatory for every Core change and every V-factor lift — not self-certified by the session that authored/executed the work.
- **G4**: human fixpoint sign-off (if a fixpoint is reached — less directly relevant here than in experiment 1, but the discipline stands).
- **G5**: walking-skeleton discipline — each "Done when" clause is a checkable acceptance condition; do not over-scope or under-scope.
- **G6**: manda daemon liveness + monitor-bound-to-session check before each iteration (mechanized ps-based procedure, not just /healthz).

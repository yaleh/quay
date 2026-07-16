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

Experiment 1 was halted (not converged) at iteration 88. The extraction artifact is at `.claude/skills/quay-native-methodology/`. Starting scores:

```
V_instance (experiment 2's own factors) = 0.0 × 0.0 × 0.0 × 1.0 = 0
             (core_abi_symmetry × web_ui_verification × action_delivery_mode × native_backlog_health)

V_meta (inherited from experiment 1's final values) = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973
             (completeness × effectiveness × reusability × validation)

σ_QC (experiment 2's own tasks, QC-* only) = 0/0 (no tasks yet)
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

## 5. Guardrails (inherited from experiment 1)

All six guardrails (G1–G6) from experiment 1's protocol carry over:

- **G1**: provenance is a fact, not an aspiration — σ_QC is computed, not asserted.
- **G2**: V_meta factors are measured on marginal increments and held-out targets only, never the accumulated artifact.
- **G3**: independent out-of-band audit (`adjudicate`) is mandatory for every Core change and every V-factor lift — not self-certified by the session that authored/executed the work.
- **G4**: human fixpoint sign-off (if a fixpoint is reached — less directly relevant here than in experiment 1, but the discipline stands).
- **G5**: walking-skeleton discipline — each "Done when" clause is a checkable acceptance condition; do not over-scope or under-scope.
- **G6**: manda daemon liveness + monitor-bound-to-session check before each iteration (mechanized ps-based procedure, not just /healthz).

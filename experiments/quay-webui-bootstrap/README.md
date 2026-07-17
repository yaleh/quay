# Quay Web UI Bootstrap — BAIME Experiment (Experiment 3)

- **Status**: Not started — iteration 0 is the next action. §7 precondition 5 (explicit human authorization to begin iteration 0) has NOT yet been given.
- **Date**: 2026-07-17
- **Owner**: Yale Huang
- **Protocol**: [`docs/proposals/quay-webui-bootstrap-experiment-v3.md`](../../docs/proposals/quay-webui-bootstrap-experiment-v3.md) (authoritative — this file operationalizes it, does not redefine it)
- **Iteration prompts**: [`ITERATION-PROMPTS.md`](./ITERATION-PROMPTS.md)
- **Inheritance from experiment 1**: [`../quay-native-bootstrap/EXTRACTION-SUMMARY.md`](../quay-native-bootstrap/EXTRACTION-SUMMARY.md) · [`../../.claude/skills/quay-native-methodology/`](../../.claude/skills/quay-native-methodology/)
- **Inheritance from experiment 2**: [`../quay-core-bootstrap/provenance.md`](../quay-core-bootstrap/provenance.md) · [`../quay-core-bootstrap/iterations/iteration-10.md`](../quay-core-bootstrap/iterations/iteration-10.md) (authoritative closing report) · [`../../.claude/skills/quay-core-bootstrap-methodology/`](../../.claude/skills/quay-core-bootstrap-methodology/)

> Frozen vocabulary applies (`glossary.md`). Do not rename Provider, Skill, status, lane, action button, capability, run, task. BAIME terms used verbatim per `methodology-bootstrapping` skill.

---

## 1. Domain

This is the **third** BAIME experiment for the quay project. It inherits methodology from both prior experiments — experiment 1's Layer-1/Layer-2 Skill structure and gate/directive/G3 mechanics, and experiment 2's manda-reliability, G3-dispatch, V_meta-ceiling, and σ-inherited-floor findings — rather than bootstrapping from σ=0 or V_meta=0.

### Instance objective (four bounded, multiplied factors — §4 of protocol)

1. **`ui_read_capability`** (§4.1): the fixed, bounded read-side capability list (task list filter by status/label, sort by id/status, pagination past a measured threshold, task detail page rendering all frontmatter + rendered markdown body + back-navigation, action-button trigger behavior preserved exactly, no new write surface) is fully implemented and confirmed via browser-automation test.
2. **`visual_design_quality`** (§4.2): every reachable page/flow passes BOTH a mechanical Lighthouse threshold (accessibility ≥ 90, best-practices ≥ 90) AND an independent holistic visual review (fresh-context agent, real browser screenshot, PASS verdict) — neither substitutes for the other.
3. **`verified_by_construction`** (§4.3): every currently-existing capability (inherited from experiment 2's `web_ui_verification` work, plus any new capability from this experiment) is covered by a committed browser-automation-driven test in the same iteration it lands.
4. **`backlog_health`** (§4.4): binary — no quay-native V-factor regresses below experiment 1's final snapshot, and no quay-core-bootstrap V-factor regresses below experiment 2's iteration-10 stopping values, across any iteration of this experiment.

Plus a standing, non-multiplied check: **parallel-advancement stall guard** (§4.5) — no unexplained 3-or-more-consecutive-iteration one-sided run between `ui_read_capability` and `visual_design_quality`.

### Meta objective (§5 of protocol)

Continue the search for genuine movement on the four V_meta factors (`completeness`, `effectiveness`, `reusability`, `validation`) using Web UI visual/UX work as the proving ground — a domain genuinely different from experiments 1/2's backend/Core focus, and explicitly hypothesized (protocol §5) as a plausible re-trigger candidate for `effectiveness`, which has been frozen at 0.26 since experiment 1 iteration 23. V_meta is **not** reset to zero; it continues from experiment 2's exact stopping values.

### Task IDs

All new tasks in this experiment use the `QW-*` prefix (quay-Web), distinct from experiment 1's `QN-*` and experiment 2's `QC-*`, keeping all three task populations physically distinguishable in `tasks/`.

---

## 2. Inheritance baseline

Experiment 2 was halted (practical convergence accepted, not formally CONVERGED) at iteration 10. The extraction artifact is at `.claude/skills/quay-core-bootstrap-methodology/`. Experiment 1's extraction artifact (`.claude/skills/quay-native-methodology/`) remains in force unchanged. Starting scores for experiment 3 (iteration 0, not yet run):

```
V_instance (experiment 3's own factors — NOT yet measured; baseline is iteration 0's job)
             = ui_read_capability × visual_design_quality × verified_by_construction × backlog_health
             Expected iteration-0 shape: low-but-nonzero / ~0 pending review / inherited-high / ~1.

V_meta (inherited from experiment 2's final values — NOT experiment 1's 0.0973, NOT re-derived from zero)
             = 0.77 × 0.26 × 0.79 × 0.64 = 0.1012
             (completeness × effectiveness × reusability × validation)
             V_meta_ceiling = 0.26 if effectiveness stays frozen (live, testable hypothesis — see
             ITERATION-PROMPTS.md "V_meta ceiling" section; frontend/visual/UX work is exactly the kind
             of organically-different scenario experiment 1's own hypothesis predicted might re-trigger it).

σ_QW (experiment 3's own tasks, QW-* only) = 0/0 (no tasks yet — iteration 0 has not run)
Inherited floor candidates (σ_QW-vs-inherited-floor decision required at iteration 0, NOT to be
             defaulted silently — see ITERATION-PROMPTS.md):
             - experiment 2's own final σ_QC = 4/10 = 0.40 (immediately-preceding experiment's own floor)
             - experiment 1's final σ_strict = 62/73 = 0.8493 (context only, per experiment 2's own
               provenance.md framing — experiment 3 must state explicitly which one it tracks, or
               reset to 0, and record the arithmetic)
```

A first iteration that re-derives V_meta from zero, or from experiment 1's values instead of experiment 2's, is a scoring error — see protocol §5.

---

## 3. Convergence target

All seven criteria must hold simultaneously (never partially) — see `ITERATION-PROMPTS.md` §"Convergence criteria for this experiment" for full text:

1. Dual threshold: V_instance ≥ 0.80 AND V_meta ≥ 0.80.
2. All 4 "Done when" clauses (§4.1–§4.4) independently satisfied with direct evidence.
3. V_meta genuine movement: ≥2 of the 4 factors show real movement from the inherited 0.1012 baseline (or a *different* stall reason than experiments 1/2, if still flat).
4. G3 out-of-band audit green: all Core-touching and V-factor-lift tasks have independent adjudicate co-signs, dispatched by the orchestrator via the native Agent/Task tool (never manda).
5. Independent holistic visual review green: every claimed `visual_design_quality` improvement has an on-file PASS verdict, no open CONCERNS/FAIL.
6. Parallel-advancement stall guard: no unexplained 3+-consecutive-iteration one-sided run between `ui_read_capability` and `visual_design_quality`.
7. Diminishing returns: ΔV < 0.02 for 2+ consecutive iterations on both V_instance and V_meta.

Note: this experiment's convergence shape differs from both predecessors — not a self-hosting σ→1 fixpoint (experiment 1) and not a dual-threshold-only shape (experiment 2), but the four "Done when" clauses plus the two visual-quality verification mechanisms plus the stall guard plus V_meta movement, together.

---

## 4. Directory layout

```
experiments/quay-webui-bootstrap/
  README.md                  ← this file
  ITERATION-PROMPTS.md       ← operational iteration prompts (7-criterion convergence, §0c visual review)
  provenance.md              ← QW-* task provenance ledger (inheritance record already written)
  iterations/                ← iteration-N.md reports (iteration-0.md is the next action)
  audits/                    ← G3 out-of-band adjudicate verdicts
  directives/
    pending/                 ← active steering directives (none yet)
    archive/                 ← consumed/resolved directives (none yet)
```

---

## 5. Guardrails (inherited from experiments 1 and 2)

All six guardrails (G1–G6) carry over unchanged:

- **G1**: provenance is a fact, not an aspiration — σ_QW is computed, not asserted.
- **G2**: V_meta factors are measured on marginal increments and held-out targets only, never the accumulated artifact.
- **G3**: independent out-of-band audit (`adjudicate`) is mandatory for every Core-touching change and every V-factor lift — dispatched by the orchestrator via the native Agent/Task tool, never manda, never self-dispatched by the iteration-executor (experiment 2's DIR-003 correction applies from iteration 0 onward, not as a later fix).
- **G4**: human fixpoint sign-off, where applicable.
- **G5**: walking-skeleton discipline for the read/verification dimensions; for the visual-quality dimension, improving is the point (within the bounded list), but silently folding an out-of-scope discovery into the current task is still forbidden.
- **G6**: manda daemon liveness + monitor-bound-to-session check before each iteration — read `.manda/hub.addr` for the live address at runtime, never a hardcoded port (experiment 2's iterations 0–3 lost three iterations to this bug).

Plus one new, experiment-3-specific guardrail:

- **Write-surface boundary**: no task creation from the browser, no field editing from the browser, no new write path beyond the existing action-button trigger. "Core stays dumb" — no backend-specific conditional rendering. Any change crossing this boundary is scope creep, to be filed as a separate task/directive, not implemented under this experiment's authority.

---

## 10. Iteration history

| Iteration | Date | Primary work | V_instance | V_meta | σ_QW | Status |
|-----------|------|-------------|------------|--------|------|--------|
| — | — | Not yet started | — | — | — | — |

*Iteration 0 has not run. §7 precondition 5 (explicit human authorization) is still outstanding.*

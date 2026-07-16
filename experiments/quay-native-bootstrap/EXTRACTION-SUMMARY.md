# Extraction summary — quay-native bootstrap experiment

- **Date:** 2026-07-16
- **Status of the source experiment: HALTED BY ITS HUMAN OWNER, NOT CONVERGED.**
  This extraction does **not** imply, and must never be cited as implying,
  that the experiment converged. It did not.
- **This is a deliberate, documented deviation** from the normal
  post-convergence use of the knowledge-extraction process, per
  `docs/proposals/quay-core-bootstrap-experiment-v2.md` §2.1 ("Extraction
  before stop"). The goal is an honest artifact of what this experiment's
  methodology actually contained as of iteration 88 — not a polished
  retrospective — so that a planned follow-on experiment
  (quay-core-bootstrap, described in the same v2 proposal) can verifiably
  inherit from it rather than informally asserting inheritance.

## Final metrics (iteration 88, the last iteration before this extraction)

```
V_instance = skeleton × abi_symmetry × gate_correctness × skill_convergence
           = 0.85 × 0.97 × 0.76 × 0.96 = 0.6016

V_meta     = completeness × effectiveness × reusability × validation
           = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973
             (unchanged since iteration 66 — 22+ consecutive iterations
              of exact zero movement)

σ_strict   = 62 / 73 = 0.8493
             (down from 0.8611 the prior iteration — an honest, mechanical
              decrease: a seed-provenance test-coverage task was added
              without a matching native-provenance numerator increment)
```

None of protocol §7's 5 convergence criteria are met:

1. Dual threshold (V_instance ≥ 0.80 AND V_meta ≥ 0.80) — **NO**, V_meta
   is an order of magnitude below 0.80.
2. Self-hosting fixpoint (σ → 1) — **NO**, σ_strict = 0.8493 and trending
   mechanically downward at the end, not up toward 1.
3. Contract proven (native + GitHub Provider both run) — partially true,
   not sufficient alone.
4. Out-of-band audit passed — iteration 88's own audit was still pending
   separate dispatch by the top-level orchestrator at halt time.
5. Diminishing returns (ΔV < 0.02 for 2+ iterations) — **NO**, V_instance
   moved for 3 consecutive iterations (86, 87, 88) right up to the halt.

## What was extracted

A Claude Code Skill at
`.claude/skills/quay-native-methodology/`, containing:

- **`SKILL.md`** — usage contract, status/non-convergence statement,
  constraints (honest inheritance, no convergence claim, σ-boundary reset
  requirement, gate-before-status-advance, G3-before-credit), and
  step-by-step implementation guidance for a consuming scope.
- **`reference/patterns.md`** — σ/V-function mechanics, final-state
  numbers, per-factor discovery-vein history, and the actual (not
  originally-planned) Layer-1/Layer-2 Skill structure.
- **`reference/v-meta-stall-analysis.md`** — the four V_meta factors
  (`completeness`, `effectiveness`, `reusability`, `validation`), how long
  each has been held flat, the specific structural blocker documented for
  each, the evidentiary basis for calling it a practical (not permanent)
  ceiling, and the concrete, checkable re-trigger conditions for each.
- **`reference/gate-mechanics.md`** — the `task check`/`checkGate()` gate
  logic (artifact-completeness, checked-state, recursive compound/epic
  children-done checks), its history of found-and-fixed bugs, and its
  explicitly-acknowledged remaining gameability boundary.
- **`reference/directive-lifecycle.md`** — the `pending/`→`archive/`
  one-time-consumed directive mechanism, and the extracted state of
  `experiments/quay-native-bootstrap/directives/` at halt time (24 archived, 2 genuinely pending:
  DIR-021, DIR-025).
- **`reference/g3-audit-discipline.md`** — the out-of-band audit
  requirement (guardrails G3/G4), with the concrete evidence it actually
  functions: three separate overclaim attempts (iterations 29, 59, 61)
  each independently caught and reverted.
- **`reference/case-studies/iteration-88-abi-symmetry-walkthrough.md`** —
  a worked example of the methodology in use (QN-074), chosen because it
  demonstrates several inherited disciplines (re-derive-spec-before-
  searching, side-by-side enumeration, adversarial break/restore
  verification, honest negative-result reporting) in one compact example.
- **`examples/quay-author-SKILL.md`**, **`examples/quay-execute-SKILL.md`**
  — the two Layer-2 orchestration Skills, copied verbatim from
  `packages/quay-native/skills/{author,execute}/SKILL.md`. Layer-1
  operation steps (write-proposal, review-proposal, write-plan,
  review-plan, implement, adjudicate) were never materialized as
  standalone Skill files in the source — they exist only as named Method
  steps inline in these two files; this extraction preserves that
  structure rather than inventing files that never existed.
- **`templates/directive-template.md`** — the directive file format.
- **`scripts/`** — four automation scripts (`count-artifacts.sh`,
  `extract-patterns.py`, `generate-frontmatter.py`, `validate-skill.sh`),
  all executed and verified working; `extract-patterns.py` independently
  re-parses `experiments/quay-native-bootstrap/provenance.md` and confirms the final
  V_instance/V_meta/σ_strict values stated above.
- **`inventory/`** — `inventory.json`, `patterns-summary.json`,
  `skill-frontmatter.json`, `validation_report.json` (generated by the
  scripts above; the validation report's `overall_compliant: true`
  explicitly means "honestly represents the halted-not-converged state
  and packages the actually-inheritable mechanics," not "the source
  experiment succeeded").
- **`experiment-config.json`** — a synthesized (no source `config.json`
  existed) machine-readable statement of the meta-objective breakdown, for
  downstream tooling.

## The four stalled V_meta factors (headline finding for the follow-on experiment)

Per iteration 84's "Standing fact" note in `experiments/quay-native-bootstrap/provenance.md`
(re-confirmed unchanged through iteration 88), all four V_meta factors
were reported stalled, with these specific, documented reasons:

| Factor | Held flat since | Documented stall reason |
|---|---|---|
| `effectiveness` | iteration 23 (65+ iterations) | No organically-arising, scope-matched marginal-increment timing comparison has appeared in the backlog since iteration 22; manufacturing one solely for a timing data point would corrupt the metric (guardrail G5). |
| `reusability` | iteration 25 (63+ iterations) | Genuine new GitHub-Provider `data.write` capability is blocked by a deliberate v1 scope decision (status-only writes, `packages/quay-github/DESIGN.md` QN-024) — independently confirmed at the code level in iteration 83 that no `body`/`title` write path exists. |
| `completeness` | ~iteration 22 (66+ iterations) | Every documented Method-step gap in both Skill files carries an explicit resolution annotation, except one standing environmental gap: no native subagent-dispatch primitive existed for most of the experiment's life (re-confirmed absent via `ToolSearch` almost every iteration; a conditional async workaround was found later, iterations 78-87, but scoped as `completeness`-adjacent staleness, not credited as closing the gap). |
| `validation` | tracks σ_strict | σ_strict itself plateaued (0.85-0.89 range for ~20 iterations) and mechanically decreased at the very end (0.8611 → 0.8493) as seed-provenance test-coverage tasks were added without matching native-provenance growth. |

This stall claim rests on 6+ independently-motivated search passes
(iterations 19-24, 41, 45, 82, 83) converging on the same negative result,
and on three separate overclaim attempts (iterations 29, 59, 61) each
independently caught and reverted by the out-of-band audit — evidence the
anti-inflation guardrails were functioning, not that the factors were
under-searched. Full detail, including concrete re-trigger conditions for
each factor, is in
`.claude/skills/quay-native-methodology/reference/v-meta-stall-analysis.md`.

**These are documented as starting hypotheses for the follow-on
experiment's meta objective (refine the methodology, per v2 proposal §5),
not settled/permanent conclusions.** A consuming experiment must show
either genuine movement or a *different* stalling reason than recorded
here — repeating the same reason after a claimed refinement is itself a
finding requiring escalation.

## Where the artifacts live

- Skill directory: `.claude/skills/quay-native-methodology/`
- This summary: `experiments/quay-native-bootstrap/EXTRACTION-SUMMARY.md`
- Underlying source (unchanged by this extraction): `experiments/quay-native-bootstrap/provenance.md`,
  `experiments/quay-native-bootstrap/iterations/iteration-{84..88}.md`,
  `experiments/quay-native-bootstrap/directives/{pending,archive}/`,
  `packages/quay-native/skills/{author,execute}/SKILL.md`

## What this artifact is for

Per `docs/proposals/quay-core-bootstrap-experiment-v2.md` §2.1/§2.2/§6,
this is the "extracted-methodology artifact" those sections reference: it
gives the planned quay-core-bootstrap experiment a concrete, checkable
inheritance boundary ("everything extracted here is inherited, stage 0")
instead of an informal, unverifiable claim that the new experiment
"applies lessons from" this one.

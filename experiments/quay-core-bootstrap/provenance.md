# Provenance ledger — quay-core-bootstrap (experiment 2)

## Inheritance record

This experiment inherits methodology, not σ, from experiment 1
(quay-native bootstrap). Per
`docs/proposals/quay-core-bootstrap-experiment-v2.md` §6, σ **resets to
a fresh count** scoped to this experiment's own task set — it is not
averaged or concatenated with experiment 1's final value.

- **Experiment 1's final provenance state:**
  `experiments/quay-native-bootstrap/provenance.md` (last entry:
  iteration 88, σ_strict = 62/73 = 0.8493, V_instance = 0.6016,
  V_meta = 0.0973).
- **Experiment 1's closing report:**
  `experiments/quay-native-bootstrap/CLOSING-REPORT.md`.
- **Extracted-methodology artifact:**
  `experiments/quay-native-bootstrap/EXTRACTION-SUMMARY.md` and
  `/home/yale/work/quay/.claude/skills/quay-native-methodology/`
  (Layer-1/Layer-2 Skills, gate mechanics, directive lifecycle, G3 audit
  discipline, and the four-stalled-V_meta-factor analysis, as of
  iteration 88).
- **Task-ID separation:** this experiment's own tasks use a `QC-*`
  prefix (quay-Core), distinct from experiment 1's `QN-*` prefix, so the
  two task populations stay physically distinguishable in `tasks/` (see
  the v2 proposal §6).
- **Directives inherited as standing practice (not re-litigated here):**
  the `task check` gate mechanics, and the out-of-band audit (G3)
  discipline. **Not** inherited as active practice: DIR-025's
  manda-nested-subagent-for-concurrent-work adoption — explicitly
  deferred for this experiment (see
  `experiments/quay-native-bootstrap/directives/pending/DIR-025-*.md`'s
  2026-07-16 progress note).

## Iteration 0 context note (2026-07-16)

Iteration 0 was run on 2026-07-16 as a purely observational pass. No
QC-* tasks were created or driven. The inheritance record above was
confirmed by reading all required artifacts (provenance.md, EXTRACTION-
SUMMARY.md, SKILL.md, patterns.md, v-meta-stall-analysis.md, gate-
mechanics.md, g3-audit-discipline.md, quay-core-bootstrap-experiment-v2.md,
CLOSING-REPORT.md, iteration-88.md) and surveying the actual code in
packages/quay/ and packages/quay-native/.

Initial V scores for this experiment, measured at iteration 0:

```
V_instance = core_abi_symmetry × web_ui_verification × action_delivery_mode × native_backlog_health
           = 0.8 × 0.0 × 0.5 × 1.0 = 0.0
             (web_ui_verification = 0.0 collapses the product)

V_meta     = completeness × effectiveness × reusability × validation
           = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973
             (inherited unchanged from experiment 1's final values;
              not re-derived from zero — a scoring error per protocol §5)

σ_QC       = 0/0 (no QC-* tasks exist yet)
σ_strict   = 0.8493 (experiment 1's final inherited floor — noted separately,
             not substituted for σ_QC)
```

See `experiments/quay-core-bootstrap/iterations/iteration-0.md` for the
full per-factor evidence, re-trigger checks, and convergence assessment.

## Entry format norm (DIR-002, iteration 2)

Per DIR-002 (2026-07-16): entries must be terse. Each task entry contains:
task id, provenance triple, σ_QC delta, and a one-line pointer to the
relevant `iterations/iteration-N.md` or `audits/iteration-N-adjudicate.md`.
Full derivation stays in the iteration report. Size limit: 1,500 lines; run
`wc -l experiments/quay-core-bootstrap/provenance.md` each iteration as §0
precondition — compact if over limit (see DIR-002 for procedure).

## Task entries

| Task | Iteration | author_by | execute_by | gate_by | σ contribution | V_instance lift |
|------|-----------|-----------|------------|---------|----------------|-----------------|
| QC-001 | 1 (2026-07-16) | seed | seed | seed | 0/1 | web_ui_verification 0.0 → 0.5 |
| QC-002 | 2 (2026-07-16) | seed | seed | seed | 0/2 | web_ui_verification 0.5 → 1.0; action_delivery_mode 0.5 → 1.0 |
| QC-003 | 3 (2026-07-16) | seed | seed | seed | 0/3 | core_abi_symmetry 0.8 → 1.0 |
| QC-004 | 4 (2026-07-16) | seed | seed | seed | 0/4 | completeness annotation — no V_instance lift |
| QC-005 | 5 (2026-07-16) | native¹ | native¹ | seed | 0/5 | no V_instance lift; completeness 0.74→0.75 from manda trial (not QC-005). Reclassified iteration 6: Method-step-driven under QN-070 precedent; gate_by=seed (same session). |
| QC-006 | 6 (2026-07-16) | native¹ | native¹ | seed | 0/6 | no V_instance lift; completeness 0.75→0.77 from complex manda G3 trial. CHANGELOG.md created. gate_by=seed (same session). |
| QC-007 | 7 (2026-07-16) | native¹ | native¹ | native² | 1/7 | no V_instance lift; no V_meta score move (validation floor still dominates; completeness update = evidence consolidation only). Skill files updated: three-tier manda envelope + timing-recording note. DIR-003 applied and archived. |
| QC-008 | 8 (2026-07-16) | native¹ | native¹ | native² | 2/8 | no V_instance lift; no V_meta score move. ITERATION-PROMPTS.md updated: timing baseline citation, standing timing-recording instruction, manda reliability 6/6. Timing recorded: author 39s, execute 128s — not scope-matched (documentation, not source logic). Three new manda trials all SUCCESS. |
| QC-009 | 9 (2026-07-16) | native¹ | native¹ | native² | 3/9 | no V_instance lift; no V_meta score move. README.md §2 updated (current V scores, σ_QC=2/8), §9 Practical Convergence Assessment added. Timing: author ~225s, execute ~465s — not scope-matched (documentation). |
| QC-010 | 10 (2026-07-16) | native¹ | native¹ | native² | 4/10 | no V_instance lift; no V_meta score move. README.md §10 Iteration history table added (10 rows, iterations 0–9). Timing: author ~210s, execute ~360s — not scope-matched (documentation). Final iteration; practical convergence accepted. |

¹ native (degraded fallback): quay:author/quay:execute SKILL.md Method steps were the
operative driver (write-proposal → review-proposal → write-plan → review-plan → gate →
implement → self-audit-ac → gate-check), followed explicitly in sequence with the Skill
file as the guide. Consistent with QN-070 precedent from experiment 1 (iteration 69).
The review steps are same-session (not fresh-context independent), per the Skill's own
degraded-fallback definition.

² native (gate): the gate-check (`mcp__quay__task_check`) was run as the FINAL step of
the quay:execute Method (Method step 3 — gate-check), not ad-hoc outside the Skill's
own sequence. The Skill's Method structure was the operative driver of the gate assertion.
For QC-007: all three fields native → σ_QC numerator credit.

gate_by=seed (QC-001 through QC-006): the gate check was mechanically run by the same
session that executed — not driven by the Skill's gate-check Method step as the final
operative step of the Method sequence.

For σ_QC numerator credit, ALL THREE fields must be native.

**σ_QC**: 4/10 (after iteration 10). QC-007, QC-008, QC-009, and QC-010 are all all-three-fields native. Validation
score remains at inherited floor (0.64) because σ_QC = 4/10 = 0.40 is below the inherited floor
σ_strict = 0.8493 level.
**Inherited floor**: σ_strict = 0.8493 (experiment 1's final value — context only).

See each iteration's report for full per-factor evidence:
- QC-001: `experiments/quay-core-bootstrap/iterations/iteration-1.md` §5/§7
- QC-002: `experiments/quay-core-bootstrap/iterations/iteration-2.md` §5/§7
- QC-003: `experiments/quay-core-bootstrap/iterations/iteration-3.md` §5/§7
- QC-004: `experiments/quay-core-bootstrap/iterations/iteration-4.md` §5/§7
- QC-005: `experiments/quay-core-bootstrap/iterations/iteration-5.md` §5/§7 (reclassified iteration 6)
- QC-006: `experiments/quay-core-bootstrap/iterations/iteration-6.md` §5/§7
- QC-007: `experiments/quay-core-bootstrap/iterations/iteration-7.md` §5/§6
- QC-008: `experiments/quay-core-bootstrap/iterations/iteration-8.md` §5/§6
- QC-009: `experiments/quay-core-bootstrap/iterations/iteration-9.md` §5/§6
- QC-010: `experiments/quay-core-bootstrap/iterations/iteration-10.md` §5/§6

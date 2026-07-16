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

## Task entries

| Task | Title | author_by | execute_by | gate_by | σ contribution |
|------|-------|-----------|------------|---------|----------------|
| QC-001 | Write browser-automation tests for Web UI pages | seed | seed | seed | 0/1 (seed, excluded from σ_QC numerator) |

**σ_QC after iteration 1**: 0/1 (QC-001 has seed provenance throughout —
authored, executed, and gated by the iteration-1 seed session, not through
`quay:author` / `quay:execute` native Skills). Per protocol §6: seed-provenance
tasks increment the denominator but not the numerator. The task's real value is
the V_instance lift (web_ui_verification 0.0 → 0.5), not σ credit.

**Inherited floor**: σ_strict = 0.8493 (experiment 1's final value — noted
separately, not substituted for σ_QC).

### QC-001 detail

- **Iteration**: 1 (2026-07-16)
- **Work**: Created `packages/quay/test/web-ui-browser.test.mjs` — 26
  structural assertions covering GET / (task list), GET /task/:id (detail,
  todo + done negative control), GET /task/:nonexistent (404). Live
  browser-automation verification via playwright MCP tools confirmed rendering
  of all three page types; observations recorded verbatim in the test file's
  own header.
- **Test count**: 29 pass, 0 fail after commit (was 28).
- **V_instance lift**: web_ui_verification 0.0 → 0.5 (GET / and GET /task/:id
  both covered, per the 0.5 rubric in ITERATION-PROMPTS.md). POST action
  trigger not covered by browser-automation yet → not at 1.0.
- **G3 audit**: dispatched as out-of-band adjudicate pass; verdict in
  `experiments/quay-core-bootstrap/audits/iteration-1-adjudicate.md`.

# V_meta stall analysis (extracted verbatim reasoning, iteration 84's "Standing fact")

This is the material the v2 proposal's meta objective (refine, don't
re-bootstrap — §5) needs as its starting hypothesis. **These are documented
stall reasons as of iteration 84-88, not settled/permanent conclusions.**
A consuming experiment must show either genuine movement on a factor or a
**different** stalling reason than the one recorded here — repeating the
same reason after a claimed methodology refinement is itself a finding
(the refinement didn't work), not just "held flat again."

`V_meta = completeness × effectiveness × reusability × validation`
`      = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973` (flat since iteration 66,
22+ consecutive iterations, as of iteration 88).

## The four factors, held-flat duration, and structural blocker

| Factor | Value | Held flat since | Structural blocker (as documented) |
|---|---|---|---|
| `effectiveness` | 0.26 | iteration 23 (65+ iterations) | Requires an organically-arising, scope-matched marginal-increment timing comparison (protocol §5.2: "measured on the marginal increment only"). No task comparably scoped to stage-0 QN-006 (single-file, no network I/O) has arisen since iteration 22; manufacturing one solely for a timing data point would corrupt the metric (G5). |
| `reusability` | 0.79 | iteration 25 (63+ iterations) | Requires genuine new GitHub-Provider write capability against a real compound-issue structure (protocol §5.2: "measured on the transfer target, never the accumulated artifact"). The one remaining candidate (gh-3/gh-4's blocked AC checkboxes) is blocked by a deliberate v1 scope decision (`data.write` status-only, `packages/quay-github/DESIGN.md` QN-024) — independently confirmed at the code level (not just doc level) in iteration 83 that no `body`/`title` write path exists in `github-client.js`. Widening it with no organic demand would be metric-manufacturing. |
| `completeness` | 0.74 | ~iteration 22 (66+ iterations) | Every documented Method-step gap in both `skills/author/SKILL.md` and `skills/execute/SKILL.md` carries an explicit "Resolved"/"Fixed in iteration N" annotation, re-verified as recently as iteration 83 — except one standing environmental gap: no native subagent-dispatch (fresh-context spawn) primitive existed for most of the experiment's life, re-confirmed absent via `ToolSearch` in essentially every iteration. This is an out-of-quay-native's-control environmental limitation, not a Skill-content gap (though iterations 78-87 later found a *conditional* async workaround — see patterns.md's Layer-1/Layer-2 section — that was scoped `completeness`-adjacent, not credited as closing this gap). |
| `validation` | 0.64 | tracks σ_strict | Tracks σ_strict directly; σ_strict itself plateaued (0.85-0.89 range across the last ~20 iterations) and even mechanically decreased at the end (0.8611 → 0.8493, iteration 88) as seed-provenance test-coverage tasks were added without matching native-provenance numerator growth. The out-of-band audit mechanism itself continued functioning correctly throughout (PASS on every dispatched audit through iteration 88). |

## Evidentiary basis for the "practical ceiling" claim (not the same as "permanently closed")

6+ independently-motivated search passes converged on the same negative
result for `effectiveness`/`reusability`/`completeness`: iterations 19-24
(original exhaustive search), 41 and 45 (later independent re-derivations),
82 (a differently-motivated organic sweep — "is there unclaimed work
sitting in the task list," not a rubric re-derivation), and 83 (a
rubric-driven, primary-source-level re-verification reading
`github-client.js`'s actual code, not just `DESIGN.md` prose).

**Three separate overclaim attempts on these factors (iterations 29, 59,
61) were each independently caught and correctly reverted** by the G3
out-of-band audit mechanism — direct, concrete evidence the anti-inflation
guardrails (G1/G2/G3/G5) were functioning as designed, not evidence the
factors were under-searched.

## Re-trigger conditions (concrete, checkable — not vibes-based)

A consuming experiment inheriting this methodology should check these
directly against its own current state, not assume they still hold
unchanged:

1. A new task appears that is organically scope-matched to stage-0
   QN-006's shape (single-file, no/minimal source change, no network I/O)
   — re-open `effectiveness`.
2. Genuine external/organic demand appears for wider GitHub Provider
   `data.write` capability (AC/DoD-checkbox or body/title writes against a
   real issue, not a legacy pre-QN-024-scope fixture) — re-open
   `reusability`.
3. A new, previously-undocumented Skill Method-step gap is found during
   *unrelated* work on the Skill files (discovered organically, not from a
   dedicated re-search) — re-open `completeness`.
4. A native fresh-context subagent-dispatch primitive becomes reliably,
   unconditionally available (not the conditional async/background-caller
   workaround already found) — re-open `completeness` and
   `reusability`/`effectiveness` jointly against full design-§5 fidelity.
5. If none of 1-4 trigger organically within roughly 12 iterations, run
   one more dedicated full search rather than letting the standing-fact
   note calcify into unexamined dogma.

## `skill_convergence`'s distinct (V_instance-side) stall

Not part of V_meta's formula, but the same "flat for structural, not
architectural, reasons" shape applies: `skill_convergence` never moved in
87 iterations because the live backlog's only non-`done` tasks were
permanent adversarial fixtures, not because the Skills were shown incapable
of driving fresh work. See `patterns.md`'s V_instance factor section.

## What actually moved late in the experiment, and what that implies

Iterations 86-88 moved `V_instance` (0.5813 → 0.6016) entirely through
`{seed, seed, seed}`-provenance test-coverage closure work (QN-071 through
QN-074), not through `quay:author`/`quay:execute` being exercised on fresh
material. This is a concrete, checkable fact: it means the *methodology*
(the two Skills, the gate) was not what produced the late gains — direct,
ad hoc engineering was. A consuming experiment whose meta objective is
"refine the methodology" should treat this as the central open question,
not a footnote: the current Skills have not been shown to still be the
active driver of the project's late-stage progress.

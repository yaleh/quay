# Case study: iteration 88 — closing a genuine ABI-symmetry gap (QN-074)

Source: `experiments/quay-native-bootstrap/iterations/iteration-88.md` (full), `experiments/quay-native-bootstrap/provenance.md`
(QN-074 entry). This is the last iteration before extraction; chosen because
it exemplifies several inherited disciplines in one, compact, real example.

## Overview

Iteration 87's independent G3 audit recommended applying its own
exhaustive-enumeration rigor to the two V_instance factors that had not
had a comparably rigorous fresh search: `abi_symmetry` (last genuine
movement: iteration 35) and `skill_convergence` (never moved in 87
iterations). Iteration 88 did exactly that, for both, and got two
different outcomes.

## Method demonstrated

1. **Re-derive the spec before searching** — re-read `quay-native-
   design.md` §6's exact "four surfaces" language rather than trusting a
   prior iteration's summary of it.
2. **Side-by-side enumeration** — read the CLI (`quay-native.js`) and MCP
   server (`mcp-server.js`) line by line looking for any flag/param
   without a symmetric test. Found: `task_write`'s CAS option
   (`--expect-status`/`expectedStatus`, live since QN-015 at iteration 6)
   had **zero** test coverage for CLI-vs-MCP error-shape symmetry —
   confirmed by exhaustive grep across every `*.test.mjs` file, not
   assumed.
3. **Fix + adversarial verification** — added a 5th check to
   `abi-symmetry.mjs`, then deliberately broke the CLI's CAS wiring
   (`if (false && flags["expect-status"]...)`) to confirm the new check
   fails loudly, restored the file byte-identical (`diff` confirmed),
   reran the full regression suite (28/28 unchanged).
4. **Honest negative result on the second search** — the
   `skill_convergence` search found no fresh, non-adversarial `todo` task
   in the backlog (`ls tasks/QN-*.md`: 68 done, 3 needs-human, 1 todo, all
   4 non-done being the same permanent adversarial fixtures already fully
   exercised). A tempting-but-rejected secondary finding (Skill files'
   "Gaps" sections narrating a stale "no subagent-dispatch primitive"
   claim, now contradicted by iterations 78-87's demonstrated manda path)
   was explicitly checked against precedent and correctly scoped out as
   `completeness`-adjacent, not a `skill_convergence` event.

## Metrics

```
V_instance: 0.5954 → 0.6016  (abi_symmetry 0.96 → 0.97, three others flat)
V_meta:     0.0973 (unchanged, 6th consecutive iteration)
σ_strict:   62/72=0.8611 → 62/73=0.8493  (mechanical decrease, honest)
```

## Learnings (quoted from the iteration's own Reflection)

"Applying 'the same rigor' to a different factor does not guarantee the
same outcome... a factor being old and flat is not itself evidence of
exhaustion if no rigorous fresh search has actually been performed on
it." This is the single most transferable lesson for a consuming scope:
do not treat V_meta's three long-stalled factors (`v-meta-stall-
analysis.md`) as proven-exhausted just because they are old and flat —
each was checked by 6+ independently-motivated passes, which is a much
stronger evidentiary bar than `abi_symmetry` had before iteration 88.

## Validation

Independent out-of-band audit for iteration 88 itself: pending dispatch by
the top-level orchestrator at extraction time (per standing G3 discipline,
never self-performed by the iteration session). Iterations 84-87's own
audits are all recorded PASS in `experiments/quay-native-bootstrap/audits/`.

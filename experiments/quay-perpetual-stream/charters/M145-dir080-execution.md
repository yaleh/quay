# M145 — DIR-080 execution: collapse prose, extract history

**Task:** DIR-080
**Milestone counter:** 145
**Chart:** 2
**Class:** methodology (governance-integrity — driver documentation)
**Value type:** governance-integrity
**Cadence:** exploit
**Deliverable:** no (driver documentation)
**Charter tokens:** ~0.8 K
**type:** learning

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ = 0. Real value: ~1200 lines of prose moved from executed documents to provenance,
reducing context consumption per /loop iteration and eliminating prose drift from
executable checks (ADR-004).

## Scope

Per DIR-080 execution order:

1. `inherited-core.md`: collapse 1602→≤500 lines. Every section: λ-signature + constraint predicate.
   Historical narratives (validation examples, worked cases, discovery stories) → provenance.md.
2. `plugin/skills/execute/SKILL.md` + `author/SKILL.md`: Gaps→current-state lists. Resolved-gap
   histories → provenance.md.
3. `.claude/skills/` methodology: honesty notes→frontmatter fields. Gaps→current-state.
4. `OUTER-LOOP.md`: DRAIN standing methodology + chart transitions prose→pointers.
5. `provenance.md`: append all extracted histories.

## Touches
- experiments/quay-perpetual-stream/inherited-core.md
- experiments/quay-perpetual-stream/provenance.md
- experiments/quay-perpetual-stream/OUTER-LOOP.md
- .claude/skills/quay-core-bootstrap-methodology/SKILL.md
- .claude/skills/quay-native-methodology/SKILL.md
- .claude/skills/quay-webui-bootstrap-methodology/SKILL.md
- plugin/skills/execute/SKILL.md
- plugin/skills/author/SKILL.md

## Done-when (binary)

1. inherited-core.md ≤500 lines, every section with formal declaration.
2. provenance.md contains all extracted narratives, traceable to source sections.
3. Skills: Gaps→current-state, honesty→frontmatter, history→provenance.
4. OUTER-LOOP.md DRAIN section→pointer, Chart transitions→pointer.
5. No semantic information lost — every constraint preserved.

## Inner termination

Done-when-complete OR external HALT.

## it0 systematic-explore checks

See HARD GATES block by-reference (inherited-core.md).

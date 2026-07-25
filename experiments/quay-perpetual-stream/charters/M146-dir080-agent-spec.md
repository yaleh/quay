# M146 — DIR-080: Agent-spec refactoring (formal density ≥80%)

**Task:** DIR-080
**Milestone counter:** 146
**Chart:** 2
**Class:** methodology (governance-integrity)
**Value type:** governance-integrity
**Cadence:** exploit
**Deliverable:** no
**Charter tokens:** ~0.5 K
**type:** learning

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ = 0. Real value: executed prose → formal notation with ≥80% density, matching
/home/yale/.claude/agents/ reference standard (16 :: signatures / 107 lines).

## Scope

Per updated DIR-080 ACs:

1. OUTER-LOOP.md: ≤200 lines, ≥15 :: sigs. Spec block becomes primary; cycle steps as named functions.
2. inherited-core.md: 400-500 lines, ≥30 :: sigs. Section bodies formal, not prose paragraphs.
3. .claude/skills/ methodology: ≥5 :: sigs per skill.
4. plugin/skills/execute+author: formal density ≥50% (already near target).

## Touches
- experiments/quay-perpetual-stream/OUTER-LOOP.md
- experiments/quay-perpetual-stream/inherited-core.md
- .claude/skills/quay-core-bootstrap-methodology/SKILL.md
- .claude/skills/quay-native-methodology/SKILL.md
- .claude/skills/quay-webui-bootstrap-methodology/SKILL.md
- plugin/skills/execute/SKILL.md
- plugin/skills/author/SKILL.md

## Done-when (binary)

1. OUTER-LOOP.md ≤200 lines, ≥15 :: signatures, cycle steps as named functions.
2. inherited-core.md 400-500 lines, ≥30 :: sigs, ≤10% prose.
3. Methodology skills: ≥5 :: sigs each.
4. Execute+author: formal density ≥50%.

## Inner termination

Done-when-complete OR external HALT.

## it0 systematic-explore checks

See HARD GATES block by-reference (inherited-core.md).

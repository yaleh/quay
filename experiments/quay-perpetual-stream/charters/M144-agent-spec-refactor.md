# M144 — Refactor executed documents to agent-spec style

**Task:** DIR-080
**Milestone counter:** 144
**Chart:** 2
**Class:** methodology (governance-integrity — driver infrastructure)
**Value type:** governance-integrity
**Cadence:** exploit
**Deliverable:** no (driver documentation)
**Charter tokens:** ~0.8 K
**type:** learning

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ = 0 (documentation refactoring). Real value: ~3,400 lines of executed prose collapsed toward
agent-spec formal notation, reducing context consumption per `/loop` iteration and eliminating
prose drift from executable checks (ADR-004).

## Scope

Five document groups, per DIR-080 execution order:

1. `inherited-core.md` — collapse 1597→≤500 lines, λ-signatures per section, DoD 495→≤100 lines
2. `plugin/skills/execute/SKILL.md` + `author/SKILL.md` — Gaps→current-state, honesty→frontmatter
3. `.claude/skills/` methodology skills — same treatment
4. `OUTER-LOOP.md` — SELECT prose -40%, Lesson recorded→1-line constraint
5. Create `experiments/quay-perpetual-stream/provenance.md`

## Touches
- experiments/quay-perpetual-stream/inherited-core.md
- experiments/quay-perpetual-stream/OUTER-LOOP.md
- experiments/quay-perpetual-stream/provenance.md
- .claude/skills/quay-core-bootstrap-methodology/SKILL.md
- .claude/skills/quay-native-methodology/SKILL.md
- .claude/skills/quay-webui-bootstrap-methodology/SKILL.md
- plugin/skills/execute/SKILL.md
- plugin/skills/author/SKILL.md
- plugin/skills/loop-driver/SKILL.md

## Done-when (binary)

1. `inherited-core.md` ≤500 lines, every section with formal declaration.
2. `provenance.md` created with extracted iteration histories.
3. `OUTER-LOOP.md` SELECT prose reduced ≥40%; Lesson recorded→1-line constraint.
4. `.claude/skills/` methodology skills: Gaps→current-state, honesty→frontmatter.
5. `plugin/skills/` execute + author: Gaps≤30 lines, history→provenance.

## Inner termination

Done-when-complete (5 clauses) OR external HALT.

## it0 systematic-explore checks

See HARD GATES block by-reference (inherited-core.md).

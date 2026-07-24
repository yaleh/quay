# M138 — /loop self-paced mode + loop.md

**Task:** DIR-077
**Milestone counter:** 138
**Chart:** 2
**Class:** methodology (governance-integrity — driver infrastructure)
**Value type:** governance-integrity
**Cadence:** exploit
**Deliverable:** no (loop's own driver machinery)
**Charter tokens:** ~0.5 K
**type:** learning

## Value hypothesis

Δv̂ = 0 (no surface cell moves — this is driver infrastructure). Real value is eliminating
the mid-session 63-minute disengagement gap observed at M136→M137.

## Scope

Two file changes, ~5 lines total:

1. Create `.claude/loop.md` — one line: `@experiments/quay-perpetual-stream/OUTER-LOOP.md`
2. Add end-of-cycle signal paragraph to OUTER-LOOP.md `## Outer cycle` section (~4 lines)

## Touches
- .claude/loop.md
- experiments/quay-perpetual-stream/OUTER-LOOP.md

## Done-when (binary)

1. `.claude/loop.md` exists with the OUTER-LOOP.md reference.
2. OUTER-LOOP.md ends each outer cycle with explicit stop/continue signal.
3. `.halt` → ScheduleWakeup(stop=true) documented in OUTER-LOOP.md.
4. Existing OUTER-LOOP.md structure unchanged (no new sections, no moved content).

## Inner termination

Done-when-complete (4 clauses) OR external HALT (.halt sentinel).

GATE-HASH-REF: 7200e010ba61b4d59416d1926a15bcf140a5eefd9735c7cd0eb08dca6ce76636

## Gap references

None — DIR-077 is a new directive created 2026-07-24, not carried from any prior experiment's gap list.

## it0 systematic-explore checks

See HARD GATES block by-reference (inherited-core.md).

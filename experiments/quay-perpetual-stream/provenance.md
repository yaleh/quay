# Provenance — quay-perpetual-stream (Experiment 5)

Extracted iteration histories, gap-discovery narratives, and consolidation log from
executed documents (inherited-core.md, skills, OUTER-LOOP.md). Per DIR-080: formal
constraints live in the source documents; the narrative of HOW each constraint was
discovered, refined, and verified lives here.

## DoD clause discovery log

### Clause 0 (AC+DoD present)
- **Origin:** M25-dod-meta-enforcer / DIR-017 Step 1
- **Enforcement:** it0-dod-check.ts clause0
- **History:** checklist-form requirement added after M32-dod-escrow-testfloor

### Clause 1 (Adversarial audit)
- **Origin:** M10-audit-consolidation / DIR-007
- **Enforcement:** it0-dod-check.ts clause1
- **Key finding:** UNCONDITIONAL per milestone; no opt-out for "trivial" milestones

### Clause 2 (V_meta consolidation lag)
- **Origin:** M07-vmeta-gate
- **Enforcement:** vmeta-lag-check.ts, K=2 ALARM

### Clause 3 (Line budget)
- **Origin:** M06-sizing / DIR-012 item 2
- **Enforcement:** it0-ceiling-line-budget-check.sh

### Clause 4 (Design-only → -IMPL row)
- **Origin:** M21-impl-row-enforcement / DIR-016
- **Enforcement:** it0-impl-row-check.sh

### Clause 5 (No self-exemption)
- **Origin:** DIR-017 Step 1
- **Enforcement:** it0-dod-check.ts clause5 (discipline, not mechanically verifiable)

### Clause 6 (Escrow Δv)
- **Origin:** M32-dod-escrow-testfloor
- **Enforcement:** it0-dod-check.ts clause6

### Clause 7 (Product-work test floor)
- **Origin:** M32-dod-escrow-testfloor
- **Enforcement:** it0-dod-check.ts clause7

### Clause 8 (Task canonical-lifecycle-record)
- **Origin:** M24-task-backlog-projection-impl
- **Enforcement:** it0-dod-check.ts clause8

### Clause 9 (SPLIT-OR-COMMIT)
- **Origin:** DIR-026
- **Enforcement:** it0-split-or-commit-check.ts + quay gate --gate split-or-commit

### Clause 10 (Tree hygiene)
- **Origin:** M08-merge-recover
- **Enforcement:** tree-hygiene-check.sh

### Clause 11 (Worktree branch hygiene)
- **Origin:** DIR-044
- **Enforcement:** worktree-branch-hygiene-check.sh

### Clause 12 (Audit independence)
- **Origin:** M10-audit-consolidation / DIR-007
- **Enforcement:** audit-independence-check.sh

## Lesson recorded (DIR-013 / M19)
Concurrent human/loop edits to the same file — auto-resolved merge (989e0cd) took one
side's body wholesale, leaving dangling cross-references. Constraint: no blanket
--ours/--theirs merge; post-merge cross-reference sweep required.

## Skill extraction log
See individual skill directories under .claude/skills/ and plugin/skills/ for
current state. Historical iteration narratives (Gaps sections) moved here per DIR-080.

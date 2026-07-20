---
id: DIR-042-B
title: "DIR-042 child B: shippable slim loop-driver skill
  (SELECT-execute-gate-done-repeat), research-layer-free, demonstrated driving a
  real task on a non-exp5 board"
status: todo
labels:
  - directive
  - milestone-candidate
parent: DIR-042
children: []
extra:
  schema: v1
  dirStatus: pending
---
## Proposal
Child B (of [[DIR-042]]) — Level B: deliver a **shippable, slim loop-driver skill** (SELECT → execute → gate → done/needs-human → repeat), runner-agnostic and research-layer-free (no VT/value-ledger/checkpoints/`experiments/**` references), demonstrated driving ≥1 REAL task through the full cycle on a NON-exp5 board with a non-node:test acceptance command configured purely as workspace data. Depends conceptually on [[DIR-042-A]]'s gate set existing (the driver's "gate" step calls `quay gate`, which after DIR-042-A includes the generic factories) but can be built/validated against the EXISTING `quay gate <task>`/`extra.acceptance` mechanism if DIR-042-A has not yet landed — the driver skill itself does not require the NEW gate factories, only the pre-existing data-driven `quay gate` command.

## Plan
N/A — resolved via an in-repo product milestone (a Claude Code skill, mirroring the shape of the existing author/execute skills and the now-portable `quay-directive` skill from [[DIR-040]]); no separate staged plan file needed at this scope.

## Finding
Carried from [[DIR-042]]'s Finding: `OUTER-LOOP.md` is exp5's own driver, entangled with the research layer (VT/value-ledger/checkpoints/`inherited-core`). There is no slim, product-level "SELECT→execute→gate→done→repeat" skill a foreign project can install and run — DIR-040 packaged the AUTHORING half (MCP + author/execute + portable directive skill) but not this gated-LOOP half.

## Requested action
1. Author a new Claude Code skill (e.g. `packages/quay-native/skills/loop-driver/SKILL.md` or bundled into the DIR-040 plugin's `plugin/skills/`) implementing: pick a ready task (`task_list --status ready` or workspace-equivalent) → invoke the existing `execute` skill on it → run `quay gate <task>` → on PASS mark done, on FAIL mark `needs-human` (or leave for retry, per the skill's own documented policy) → repeat.
2. Ensure zero reference to VT / value-ledger / checkpoints / `experiments/**` / exp5-specific concepts anywhere in the new skill's file.
3. Demonstrate it driving ≥1 REAL task through the full cycle on a NON-exp5 board (e.g. a scratch native-provider workspace, or archguard's own board if safely non-destructive) with a real, non-node:test acceptance command (e.g. a shell one-liner, or vitest if available) configured as pure `extra.acceptance` workspace data — captured output.

## Acceptance Criteria
- [ ] A shippable slim loop-driver skill file exists with NO reference to VT/value-ledger/checkpoints/`experiments/**`/exp5-specific concepts (`grep` confirms).
- [ ] The skill is demonstrated driving a REAL task through SELECT→execute→gate→done (or →needs-human on a deliberate FAIL) on a NON-exp5 board, with the acceptance command supplied as pure workspace config, not a hardcoded runner — captured transcript/output in the milestone record.
- [ ] The skill correctly distinguishes PASS (→done) from FAIL (→needs-human or retry, per its documented policy) — both paths demonstrated on a real or deliberately-broken task.
- [ ] `bash packages/quay/test/delivery-standalone-smoke.sh` stays 0 RED.

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts. Done ONLY when:
- [ ] The driver skill actually drove a REAL task on a non-exp5 board through the full cycle (DIR-026 real object) — evidenced by captured output, not a fixture/demo.
- [ ] No research-layer references leaked into the shipped skill (grep-verified).
- [ ] Both the PASS and FAIL paths are demonstrated for real; the it0 DoD meta-enforcer passes.
- [ ] Per DIR-026: lands done or `needs-human`; no prose-only deferral.

## Human verification when exp5 marks this done
1. Does the shipped skill file contain zero VT/value-ledger/checkpoints/`experiments/**` references?
2. Was a REAL task driven through the full SELECT→execute→gate→done cycle on a non-exp5 board, with the acceptance command as pure config — captured?
3. Was a FAIL path (→needs-human) also demonstrated, not just the happy path?
4. Does delivery-standalone-smoke stay 0 RED?
5. If only a design doc exists with no real driven task, it is NOT landed — send back.

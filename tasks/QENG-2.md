---
id: QENG-2
title: "AC-as-runnable-meter: task.acceptance executed by quay gate (epicd ADR-019)"
status: todo
labels:
  - initiative:epicd-engine-port
parent: QENG-0
children: []
extra: {}
---
## Proposal
Add an **acceptance** field to the task model: a runnable command (or list). `quay gate <task>` (default `acceptance` gate) executes it in a sandboxed cwd with a timeout and transparently propagates the exit code. This is epicd ADR-019's "runnable meter" — it directly fixes exp5's poor verifiability (audits run a command instead of judging prose).

## Acceptance Criteria
- [ ] `quay task edit X --acceptance 'exit 0'` then `quay gate X` exits 0.
- [ ] `quay task edit X --acceptance 'exit 1'` then `quay gate X` exits 1.
- [ ] Acceptance runs at repo root with an enforced timeout; a hanging command is killed and reported as fail (exit 1).
- [ ] tests >=80% on the acceptance-runner, actually run (paste output).

## Definition of Done
References the standard + tests >=80%. Every AC is a command.
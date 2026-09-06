---
id: gap-scratch-ac-abi-e2e
title: scratch — verify worker ticks AC via task_write (not hand edit)
status: done
labels: []
parent: null
children: []
extra: {}
---
## Proposal

Verify that a dispatched worker, given the new acCheckNote instruction, records its Acceptance Criteria state through the Provider ABI (task_check + task_write) instead of hand-editing the checkbox characters in the task file. Throwaway end-to-end probe for gap-worker-prompt-ac-check-via-abi-not-hand-edit.

## Plan

1. Create the marker doc file docs/scratch-ac-abi-e2e.md with the exact literal content abi-ok.
2. Confirm the file exists with that content.
3. Record the AC state via task_check then task_write.

## Acceptance Criteria

- [x] docs/scratch-ac-abi-e2e.md exists with the exact literal content abi-ok.

## Definition of Done

The marker doc exists with content abi-ok, and the worker ticked the AC above via task_write rather than a hand markdown edit.

## Touches

- docs/scratch-ac-abi-e2e.md
- tasks/gap-scratch-ac-abi-e2e.md
---
id: DIR-124-A1a
title: "Stage-event schema v1 module (workflow-event-schema.mjs)"
status: todo
labels: [directive, milestone-candidate]
parent: DIR-124-A1
children: []
extra: {schema: v1}
---

**type:** execution

## Proposal

Split from DIR-124-A1 (3 independently landable mechanisms). This child owns the canonical schema module.

### Chosen mechanism

A single `workflow-event-schema.mjs` module (Node ESM, zero npm dependencies) defining:
1. The v1 stage-event schema (20 fields: schemaVersion, runId, candidateId, taskId, stage, attempt, timing, agentLabel, commandIdentity, executionCwd, worktreePath, baseCommit, candidateCommit, outcome, waitReason, resourceClaim, observedWrites, isolationMode, dispatchMode, recordedAtMs)
2. `validateEvent(obj)` — structural validation (required fields, types, value constraints)
3. `parseEventStream(jsonl)` — stream reader with per-line validation + parseWarnings
4. `emitEvent(event)` — deterministic JSON serialization (sorted keys, no trailing newline)
5. CLI surface: `--validate <file>`, `--selftest`, `--json`

Byte-identical mirror at `plugin/scripts/workflow-event-schema.mjs`.

## Acceptance Criteria

- [ ] Schema module validates required fields and rejects malformed events
- [ ] parseEventStream handles malformed lines with parseWarnings (never crashes)
- [ ] emitEvent produces deterministic output (sorted keys)
- [ ] Byte-identical mirror at plugin/scripts/
- [ ] Tests RED/GREEN in both mirrors
- [ ] No post-Land Wiring Audit, lifecycle-promotion policy, worktree redesign, stage scheduler, or resource lease

## Definition of Done

Standard inherited-core DoD clauses apply.

## Touches

- `experiments/quay-perpetual-stream/scripts/workflow-event-schema.mjs (new)`
- `plugin/scripts/workflow-event-schema.mjs (new)`
- `experiments/quay-perpetual-stream/test/workflow-event-schema.test.mjs`
- `plugin/test/workflow-event-schema.test.mjs`

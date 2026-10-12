---
id: gap-discovery-method-record-tool-vs-subject-leak
title: "Discovery Method: method records memorize the seed (tool = subject file,
  seed names in method text)"
status: todo
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
depends_on:
  - gap-discovery-method-generalization-lineage-and-temporal-binding
---
## Proposal
The read-only audit found that method DATA memorizes the seed answer although the reflection CODE does not. The Phase 2 candidate `shared-contract-divergence` v2 recorded `operation.tools = ["fan-in-ff-protocol-check.ts","fan-in-queueing-model.ts","dual-source-check.ts","mirror-pair-drift-check.ts"]`: the first two are the seed case's own subject files, not analysis tools.
- Phase 0's validator (`docs/analysis/discovery-method-registry.mjs`) only checks that each tool name is a capability-catalog entry, so it cannot tell "a tool used to inspect" from "the file being inspected".
- Phase 2's no-hand-coding static control scans only `discovery-reflection.mjs` source, not method records.

## Plan
1. In the registry validator, refuse (`TOOL_IS_SUBJECT`) any `operation.tools` entry that equals (by basename) a component of any Experience referenced by the method's `provenance_evidence`.
2. Refuse (`METHOD_TEXT_NAMES_SEED`) a method whose `operation.steps`, `expected_invariant`, `falsification` or `applicability` text names a seed component basename or symbol.
   - The seed set comes from `experienceDenyList` over the provenance Experiences (reuse it; do not re-derive).
3. In `discovery-reflection.mjs`, the reflection prompt states that tools must be analysis instruments. `assembleCandidate` strips subject files from `tools` before validation and records what it stripped, so a refusal is visible, not silent.
4. Records written before this change are unaffected on disk; `readMethodRegistry` flags them `legacy_unvalidated: true` when they would now fail.

## Acceptance Criteria
- [ ] `node --test plugin/test/discovery-method-registry.test.mjs plugin/test/discovery-reflection.test.mjs` exits 0, with new cases:
  - (a) a tool equal to a provenance component ⇒ `TOOL_IS_SUBJECT`;
  - (b) a genuine analysis tool not among provenance components ⇒ accepted;
  - (c) `expected_invariant` naming a seed basename ⇒ `METHOD_TEXT_NAMES_SEED`;
  - (d) the same invariant written generically ⇒ accepted;
  - (e) `assembleCandidate` strips a subject file from tools and records it.
- [ ] Real control: validate the v2 record exactly as pasted in the Phase 2 task evidence. Paste the refusal naming both `fan-in-ff-protocol-check.ts` and `fan-in-queueing-model.ts`.
- [ ] Static check: `grep -n -E 'fan-in-ff-protocol-check|per-task-suite-record|checker-io|touches-parser' docs/analysis/discovery-method-registry.mjs` prints nothing. Paste the output.
- [ ] Mutation control: disable the `TOOL_IS_SUBJECT` rule and show case (a) goes red. Paste, then revert.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-discovery-method-record-tool-vs-subject-leak` green.

## Touches
- tasks/gap-discovery-method-record-tool-vs-subject-leak.md
- docs/analysis/discovery-method-registry.mjs
- docs/analysis/discovery-reflection.mjs
- plugin/test/discovery-method-registry.test.mjs
- plugin/test/discovery-reflection.test.mjs

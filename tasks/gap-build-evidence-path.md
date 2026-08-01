---
id: gap-build-evidence-path
title: "build-evidence manifest output path — write under MILESTONE_ROOT, not /tmp"
status: todo
labels:
  - gap
  - milestone-candidate
  - human-steered
parent: gap-build-evidence-manifest-missing
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

Split from gap-build-evidence-manifest-missing (M238) — mechanism 1, the **manifest output path fix**.
The critical-path fix is already committed in `2b1d67c2` ("fix: build-evidence manifest output path —
write under MILESTONE_ROOT not /tmp"); this task formalizes it as a milestone-candidate leaf so the
split is complete and the fix is tracked.

### Chosen mechanism

The Build-Evidence phase in `execute-milestone.js` (both mirrors) was writing the evidence manifest
to a `/tmp` path. The committed fix (2b1d67c2, touching `.claude/workflows/execute-milestone.js` +
`plugin/workflows/execute-milestone.js`, 1 line each) resolves the manifest output path via
`gate_resolve_milestone_root` so it lands at `<MILESTONE_ROOT>/build-evidence-manifest.json` — the
canonical milestone root (rule ≥130 → top-level `milestones/M<NN>`), the same single-sourced resolver
Build/Audit/Land use. The manifest is therefore a committed milestone artifact at the canonical path
that the Audit prompt (line 744) and the DIR-124-B receipt (`manifestRefForReceipt`) reference.

**WIRING-CLAIM (BE-PATH-CANONICAL):** the collector writes `build-evidence-manifest.json` under
`<MILESTONE_ROOT>` resolved via `gate_resolve_milestone_root`, not `/tmp`; the manifest path is the
one Audit references and the DIR-124-B receipt binds. → AC6/AC10 (path resolution, canonical root).

## Acceptance Criteria

- [ ] The Build-Evidence phase writes `build-evidence-manifest.json` to `<MILESTONE_ROOT>` (resolved
  via `gate_resolve_milestone_root`), never `/tmp` (grep-confirmable: no `/tmp` manifest path remains
  in either workflow mirror).
- [ ] Both `execute-milestone.js` mirrors carry the corrected output path (byte-identical, `diff` exit
  0).
- [ ] The manifest path is the one referenced in the Audit prompt and produced by
  `build-evidence-manifest.ts`'s `manifestRefForReceipt` (no path-prefix divergence).
- [ ] Existing `build-evidence` gate/collector tests stay GREEN (no regression).

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline (the core fix already committed in 2b1d67c2).
- [ ] One real non-fixture milestone emits `build-evidence-manifest.json` at `<MILESTONE_ROOT>` (real
  dispatch evidence).
- [ ] A fresh independent audit finds no refutation.

## Touches

- `.claude/workflows/execute-milestone.js`
- `plugin/workflows/execute-milestone.js`
- `experiments/quay-perpetual-stream/scripts/*build-evidence*`
- `plugin/scripts/*build-evidence*`
- `docs/plans/M263-gap-build-evidence-path.md`
- `milestones/M263/preparation.json`
- `milestones/M263/proposal-ledger.json`
- `milestones/M263/stage-journal.jsonl`
- `milestones/M263/receipts/*.json`
- `tasks/gap-build-evidence-path.md`
- `.quay/config.yml`

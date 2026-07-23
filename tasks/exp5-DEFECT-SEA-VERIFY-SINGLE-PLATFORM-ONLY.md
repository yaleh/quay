---
id: exp5-DEFECT-SEA-VERIFY-SINGLE-PLATFORM-ONLY
title: "defect: sea-verify-node-free only covers linux-x64 —
  macos-arm64/windows-x64 SEA builds have no runtime-smoke evidence"
status: todo
labels:
  - milestone-candidate
  - defect
  - milestone:M-122
parent: null
children: []
extra:
  schema: v1
---
## Proposal

Found at M121 while flipping chart-2 S1's `sea-linux-x64` row after fixing
`exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH`: `release.yml`'s `sea-verify-node-free` job
(`runs-on: ubuntu-latest`, downloads and smoke-tests only the linux-x64 SEA archive) is the ONLY
runtime-smoke verification in the release pipeline. `sea-release`'s macos-latest/windows-latest matrix
legs only prove the SEA *build* succeeds on those platforms — they do NOT prove the binary *runs*
without crashing (the exact class of bug `exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH` was: a RUNTIME crash,
not a build failure — `sea-release` was green on all 3 platforms even on the crashing v0.3.8 build).

This left chart-2 S1's `sea-macos-arm64`/`sea-windows-x64` rows honestly un-flippable at M121: the fix
is almost certainly cross-platform (the root cause is pure JS/Node CJS-module-wrapper semantics, not
OS-specific native code), but there is currently no real evidence source for either platform — only an
inference from the linux result. See `chart2-s1-artifacts.json`'s current evidence notes on both rows.

## Plan
N/A — small, mechanical CI extension: turn `sea-verify-node-free` into a 3-way matrix (mirroring
`sea-release`'s own `matrix.include` shape), using platform-appropriate Node-free verification per OS
(the current job's technique — a `container: debian:stable-slim` with no Node installed — is
Linux-specific; macOS/Windows runners need an equivalent "confirm no Node on PATH, then run the
binary" approach, e.g. a clean runner + explicit `PATH` stripping rather than a container).

## Acceptance Criteria
- [ ] `sea-verify-node-free` (or a renamed/split equivalent) runs a real Node-free smoke test
  (`--help` + `serve`, matching the current linux job's coverage) against the macos-arm64 SEA archive.
- [ ] Same for windows-x64.
- [ ] A real release run (tag push) shows all 3 platform verify jobs green — run URL + per-job status
  pasted, not asserted.
- [ ] `chart2-s1-artifacts.json`'s `sea-macos-arm64`/`sea-windows-x64` rows are flipped to
  `floorSmokePass:true` citing that real run (S1 cov moves 0.4 → 0.8), OR left `false` with a
  documented real failure if the verification actually catches a platform-specific gap.

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget,
impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene,
worktree-branch-hygiene, audit-independence).
- [ ] All 4 AC items above verified true with pasted command output / run URLs.
- [ ] it0 DoD meta-enforcer passes all clauses.

---
id: exp5-DEFECT-SEA-VERIFY-SINGLE-PLATFORM-ONLY
title: "defect: sea-verify-node-free only covers linux-x64 —
  macos-arm64/windows-x64 SEA builds have no runtime-smoke evidence"
status: done
labels:
  - milestone-candidate
  - defect
  - milestone:M-122
parent: null
children: []
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-DEFECT-SEA-VERIFY-SINGLE-PLATFORM-ONLY
    experiments/quay-perpetual-stream/charters/M122-sea-verify-3platform.md
    /tmp/m122-absorb-entry.md
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
- [x] `sea-verify-node-free` (or a renamed/split equivalent) runs a real Node-free smoke test
  (`--help` + `serve`, matching the current linux job's coverage) against the macos-arm64 SEA archive.
- [x] Same for windows-x64.
- [x] A real release run (tag push) shows all 3 platform verify jobs green — run URL + per-job status
  pasted, not asserted.
- [x] `chart2-s1-artifacts.json`'s `sea-macos-arm64`/`sea-windows-x64` rows are flipped to
  `floorSmokePass:true` citing that real run (S1 cov moves 0.4 → 0.8), OR left `false` with a
  documented real failure if the verification actually catches a platform-specific gap.

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget,
impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene,
worktree-branch-hygiene, audit-independence).
- [x] All 4 AC items above verified true with pasted command output / run URLs.
- [x] it0 DoD meta-enforcer passes all clauses. — independently re-run (not trusted from the
  orchestrator's paste) after syncing this audit's isolated worktree to the orchestrator's real
  ABSORB-entry state (task file + this audit artifact's session-id line, via local Read+Edit only, no
  git op against the shared checkout — same precedent as M121's audit). First run against unsynced
  worktree state genuinely FAILed (clause0-ac-dod-present: stale unticked AC boxes; clause12-audit-
  independence: stale PLACEHOLDER session-id) — confirms this is a real, non-trivial gate, not a
  rubber stamp. After sync: `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
  exp5-DEFECT-SEA-VERIFY-SINGLE-PLATFORM-ONLY experiments/quay-perpetual-stream/charters/
  M122-sea-verify-3platform.md /tmp/m122-absorb-entry.md` → all 12 clauses PASS, exit 0. Separately
  ran `node packages/quay/bin/quay.ts gate exp5-DEFECT-SEA-VERIFY-SINGLE-PLATFORM-ONLY` myself → PASS,
  exit 0, a NEW independently-generated GateEvent recorded in this worktree's own
  `.quay/gate-events.jsonl` (verdict "pass", timestamp 2026-07-23T10:32:41.103Z), distinct from but
  corroborating the orchestrator's own cited GateEvent (10:31:10.251Z).

## Execution record (M122 ABSORB, 2026-07-23)

**Milestone:** M122 · **Iterations:** 1 (single-pass development-class CI extension) · **Realized
chart-2 Δv:** +12.0 (S1 cov 0.40→0.80, weight 30) — completes DIR-064-B's full 0.20→0.80 prediction
in combination with M121's own +6.0. **Merge commits:** `7f8dd1b` (cross-platform verify job),
`97cb06a` (Windows dotglob fix), `4fc10fa` (chart-2 Δv registration). **Adversarial-audit verdict:**
NO REFUTATION FOUND (see `milestones/M122/audits/iteration-0-adversarial-audit.md`) — independently
re-pulled both cited GitHub Actions runs, independently reproduced the dotglob root-cause mechanism,
independently re-ran the test suite, judged the mid-flight scope expansion (finding+fixing the real
pre-existing Windows `.quay/config.yml` bug) legitimate. **DoD meta-enforcer:** PASS (`quay gate`,
GateEvent `2026-07-23T10:31:10.251Z` orchestrator + `2026-07-23T10:32:41.103Z` independent audit
re-run, both PASS). **Real release evidence:** v0.3.11,
https://github.com/yaleh/quay/actions/runs/29998600334 — all 5 verification jobs green across all 3
platforms (linux/macos/windows). One-line outcome: SEA release runtime-smoke coverage extended to all
3 platforms, catching and fixing a real multi-milestone-old Windows packaging bug along the way;
chart-2 S1 fully realized at cov=0.80.
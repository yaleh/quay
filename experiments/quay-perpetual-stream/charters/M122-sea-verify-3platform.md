# Charter M122-sea-verify-3platform — extend sea-verify-node-free to macOS/Windows

**Milestone id:** M122
**Task:** `tasks/exp5-DEFECT-SEA-VERIFY-SINGLE-PLATFORM-ONLY.md`
**Surface:** development-class / capability-growth (chart-2 S1 Distribution-reliability)
**Charter authored:** 2026-07-23
**Base commit:** master HEAD at dispatch (`cf1f2b4`, M121's ABSORB commit)
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

M121 fixed quay Core's SEA binary crash and flipped `chart2-s1-artifacts.json`'s `sea-linux-x64` row
to `floorSmokePass:true`, citing real evidence from `release.yml`'s `sea-verify-node-free` job — the
ONLY runtime-smoke verification in the release pipeline, and Linux-only (`runs-on: ubuntu-latest`,
`container: debian:stable-slim`). `sea-macos-arm64`/`sea-windows-x64` remained unflipped: their
`sea-release` matrix legs proved the BUILD succeeds on those platforms, but build success was never
proof of the runtime fix (the original bug was a runtime crash, not a build failure — `sea-release` was
green on all 3 platforms even on the crashing v0.3.8 build). This milestone closes that gap.

## Scope

1. Add a NEW job to `.github/workflows/release.yml` that runtime-smokes the macOS and Windows SEA
   archives — `runs-on` matrix `[macos-latest, windows-latest]` (GitHub Actions `container:` only
   supports Linux runners, so the existing Linux job's container-based technique cannot be reused
   verbatim; use PATH-stripping instead — compute a PATH value with every directory containing a
   `node`/`node.exe` binary removed, confirm `command -v node` fails under that PATH, then run
   `--help`/`serve` under it). Downloads the SAME per-platform archive `sea-release` (this same run)
   just published, via the private-repo assets API (mirrors `sea-verify-node-free`'s existing
   curl-based fetch, parameterized per platform/archive extension).
2. `chart2-s1-artifacts.json`'s `sea-macos-arm64`/`sea-windows-x64` rows flip to
   `floorSmokePass:true` ONLY if a real tagged release run shows the new job green on both platforms
   — cited to that run's URL, not asserted. If either platform's job fails for real, the row stays
   `false` with the real failure documented (a genuine finding, not silently hidden).
3. Version bump + tag to trigger a real `release.yml` run and gather this evidence.

**Not in scope:** any change to the existing Linux `sea-verify-node-free` job (container-based,
strongest evidence, unchanged); the `dist-verify-node-floor` job (npm-pack tarball, already
Linux-verified, unrelated surface); embedding `docs-managed/`; any other chart-2 surface (S2/S3).

## Class routing

**Development-class** (a CI-workflow extension + a real triggered run, mechanical once scoped, no
open design question — mirrors the existing Linux job's shape). No `quay-task-to-plan` pipeline
required, per the same small-well-bounded-fix precedent as M99/M116/M119/M121.

## Acceptance Criteria (from task)

- [ ] `sea-verify-node-free` (or a renamed/split equivalent) runs a real Node-free smoke test
  (`--help` + `serve`, matching the current linux job's coverage) against the macos-arm64 SEA archive.
- [ ] Same for windows-x64.
- [ ] A real release run (tag push) shows all 3 platform verify jobs green — run URL + per-job status
  pasted, not asserted.
- [ ] `chart2-s1-artifacts.json`'s `sea-macos-arm64`/`sea-windows-x64` rows are flipped to
  `floorSmokePass:true` citing that real run (S1 cov moves 0.4 → 0.8), OR left `false` with a
  documented real failure if the verification actually catches a platform-specific gap.

## Definition of Done

- [ ] All 4 AC items above verified true with pasted command output / run URLs.
- [ ] it0 DoD meta-enforcer passes all clauses.

## GATE-HASH-REF

GATE-HASH-REF: 22c64fc383d6fc03ba375f8b9ce463abce3459d318c8787e33d8bcb321d876e1

(Same pre-existing, tracked-not-blocking drift as M116-M121 —
`exp5-DEFECT-GATE-HASH-CHECK-STALE-PINNED-SOURCE`.)

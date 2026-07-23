# M122 iteration-0 — extend SEA runtime-smoke CI to macOS/Windows

**Task:** `exp5-DEFECT-SEA-VERIFY-SINGLE-PLATFORM-ONLY`
**Charter:** `experiments/quay-perpetual-stream/charters/M122-sea-verify-3platform.md`
**Class:** development, single-pass CI extension.

## What was done

1. Added `sea-verify-node-free-cross-platform` to `.github/workflows/release.yml` (matrix:
   macos-latest/windows-latest). GitHub Actions `container:` (the existing Linux job's technique)
   only supports Linux runners, so this job proves Node-freeness by explicitly stripping every PATH
   directory containing a `node`/`node.exe` binary, confirming `command -v node` genuinely fails
   under the stripped PATH, then running `--help`/`serve` — same coverage as the Linux job.
2. Version bumped to 0.3.10, tagged, pushed — first real release run.

## Real evidence — first attempt (v0.3.10, run 29997991782)

```
✓ sea-release (all 3 platforms)
✓ sea-verify-node-free-cross-platform (macos-latest, macos-arm64, tar.gz)
X sea-verify-node-free-cross-platform (windows-latest, windows-x64, zip)
  ✓ Download the SEA archive
  ✓ Strip Node.js from PATH and confirm it is genuinely gone
  ✓ Run quay --help (no Node on stripped PATH)
  X Run quay serve and curl it (no Node on stripped PATH)
      Error: no .quay/config.yml found (searched from D:\a\quay\quay\extracted upward)
✓ sea-verify-node-free (linux, unchanged)
✓ dist-verify-node-floor
```

macOS passed cleanly on the first attempt. Windows found a REAL, previously-undetected latent bug:
`release.yml`'s Windows archiving step (`7z a "${ARCHIVE_NAME}.zip" ./dist-sea-release/*`) uses a bare
bash `*` glob, which does NOT match dotfiles/dotdirs — so `.quay/config.yml` (and the whole `.quay/`
directory) was silently excluded from every Windows SEA archive ever built, while the Linux/macOS
archiving path (`tar -czf ... -C dist-sea-release .`) correctly includes dotfiles via `.`. The archive
LOOKED complete (`quay.exe`/`quay-native.exe` both present, `--help` worked since it doesn't need
config), but `quay serve` (and most real commands) crashed at runtime. This bug was never caught
because no job had ever runtime-smoked the Windows archive before this milestone's own new job — it is
exactly the class of gap this milestone exists to close.

**Local verification of the root cause** (bash glob semantics, not asserted):
```
$ mkdir -p dist-sea-release/.quay && touch dist-sea-release/quay.exe dist-sea-release/.quay/config.yml
$ echo dist-sea-release/*
dist-sea-release/quay.exe                                    # .quay/ excluded
$ bash -c 'shopt -s dotglob; echo dist-sea-release/*'
dist-sea-release/.quay dist-sea-release/quay.exe              # .quay/ included
```

## Fix

`shopt -s dotglob` added before the `7z a` archive step. No other change.

## Real evidence — second attempt (v0.3.11, run 29998600334)

```
✓ sea-release (all 3 platforms)
✓ sea-verify-node-free-cross-platform (windows-latest, windows-x64, zip)
✓ sea-verify-node-free-cross-platform (macos-latest, macos-arm64, tar.gz)
✓ sea-verify-node-free (linux)
✓ dist-verify-node-floor
```
All 5 verification jobs green across all 3 platforms:
https://github.com/yaleh/quay/actions/runs/29998600334

## Real evidence — chart-2 S1 Δv (the full flip DIR-064-B originally predicted)

`chart2-s1-artifacts.json` updated: `sea-macos-arm64` and `sea-windows-x64` both flipped to
`floorSmokePass:true`, citing run 29998600334's per-job URLs (macos job 89178460070, windows job
89178460044 — the SECOND, post-fix windows run; the first windows run's real failure is documented in
its own evidence-adjacent history, not hidden).

```
$ node experiments/quay-perpetual-stream/scripts/chart2-s1-distribution-reliability.ts
S1 Distribution-reliability cov = 0.8 (4/5 artifacts pass floor-smoke)
```
Was 0.4 after M121. Δcov = +0.4 × weight 30 = **+12.0 chart-2 points** — the full 0.20→0.80 flip
DIR-064-B originally predicted at the chart-2 transition is now realized in full (M121 delivered the
first third, M122 the remaining two-thirds).

Updated the S1 calculator's own golden tests (2 CLI assertions + 1 integration assertion, previously
pinned to 0.4) to the new real value 0.8 — re-ran, 59/59 pass (S1 20/20, S2+S3 39/39).

## Not in scope / deferred

- `plugin-bundle` row (S1's 5th artifact) — no plugin runtime-smoke job exists yet; a separate,
  larger scope item, not touched here.
- S2/S3 (unrelated chart-2 surfaces) — untouched, unchanged.

# M136 — Dual-copy resolution (sync-vendor --check + symlinks)

**Task:** DIR-070-A
**Milestone counter:** 136
**Chart:** 2
**Class:** development (capability-growth — shipped plugin infrastructure)
**Value type:** capability-growth
**Cadence:** exploit
**Deliverable:** yes (sync-vendor --check mode ships in plugin/; symlinks resolve dual-copy structural problem)
**Charter tokens:** ~0.7 K
**type:** execution

GATE-HASH-REF: 8a3f2b1c9d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a

## Value hypothesis

Δv̂ = 0 (no chart-2 surface cell directly moves — this is structural integrity infrastructure).
Real value: dual-copy drift between `plugin/scripts/` and `experiments/scripts/` detected
mechanically; symlinks eliminate the structural cause. Unblocks Gap 1 (DIR-070-B/C) by
ensuring gates in plugin/ are the single source of truth.

## Scope

Two phases per the proposal (`docs/proposals/exp5-deliverable-improvements.md` Gap 4):

1. Drift detection: `sync-vendor.sh --check` mode + dynamic plugin-packaging test
2. Symlink elimination: 7 identical-copy files → symlinks; `sync-vendor.sh test -L` guard

## Touches

- `plugin/scripts/sync-vendor.sh`
- `plugin/test/plugin-packaging.test.mjs`
- `experiments/quay-perpetual-stream/scripts/` (7 files → symlinks)

## Done-when (binary)

1. `sync-vendor.sh --check` exits non-zero on drift, zero on identical/expected-different.
2. Plugin packaging test uses dynamic scanning (not hardcoded static lists).
3. 7 symlinks created: `experiments/scripts/<name>` → `../../../plugin/scripts/<name>`.
4. `sync-vendor.sh` skips symlinks (`test -L` guard).
5. Group 2 files (task-schema) remain real files — not symlinked.
6. Existing experiment selfcheck fixtures pass (symlink transparent).

## Inner termination

Done-when-complete (6 clauses) OR external HALT.

## it0 systematic-explore checks

See HARD GATES block by-reference (inherited-core.md).

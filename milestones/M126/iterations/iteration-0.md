# M126 iteration-0 report — version-consistency-check implementation

**Milestone:** M126 · **Task:** exp5-M-PRODUCTIZED-DELIVERY-A
**Iteration:** 0 · **Charter:** charters/M126-productized-delivery-a-version-consistency.md

## Summary

Implemented `scripts/version-consistency-check.ts` — a fail-closed gate that exits 0 iff every version-bearing artifact carries the identical version string. The real tree was version-drifted across 8 files with 6 different versions; unified all to 0.3.11 and demonstrated GREEN.

## RED demonstration (pre-fix)

```
VERSION-CONSISTENCY: DRIFT DETECTED
  packages/quay                                           0.3.11
  packages/quay-native                                    0.3.4
  packages/quay-github                                    0.1.0
  packages/quay-backlog                                   0.1.0
  plugin/.claude-plugin/plugin.json                       0.3.22
  plugin/.claude-plugin/marketplace.json (quay entry)     0.3.16
  .claude-plugin/marketplace.json (quay entry)            0.3.5
  plugin/vendor/quay/package.json                         0.3.5
6 different versions across 8 files
EXIT: 1
```

## GREEN demonstration (post-unification)

```
VERSION-CONSISTENCY: OK
  packages/quay                                           0.3.11
  packages/quay-native                                    0.3.11
  packages/quay-github                                    0.3.11
  packages/quay-backlog                                   0.3.11
  plugin/.claude-plugin/plugin.json                       0.3.11
  plugin/.claude-plugin/marketplace.json (quay entry)     0.3.11
  .claude-plugin/marketplace.json (quay entry)            0.3.11
  plugin/vendor/quay/package.json                         0.3.11
All 8 files carry version 0.3.11
EXIT: 0
```

## Scope delivered

1. `scripts/version-consistency-check.ts` — 8 version-bearing locations enumerated, fail-closed
2. `scripts/version-consistency-check.test.ts` — 9 tests, 88.16% line / 83.33% branch / 94.12% funcs coverage
3. All 8 version-bearing files unified to `0.3.11`
4. No driver files touched (git diff --stat: only packages/ + plugin/ + scripts/ + tasks/)

## Test evidence

```
$ node --experimental-strip-types --test --test-reporter spec scripts/version-consistency-check.test.ts
✔ readVersions returns 8 entries for the real tree
✔ readVersions returns errors for missing files
✔ check returns all-equal on the real tree post-unification (GREEN)
✔ check returns all-equal for a unified fixture (GREEN)
✔ check detects single-entry drift (RED after one drift)
✔ check handles marketplace.json with { plugins: [...] } wrapper
✔ CLI --json exits 0 with JSON output even on drift
✔ CLI exits 0 on the real tree (post-unification GREEN)
✔ CLI exits 0 on a unified fixture
ℹ tests 9
ℹ pass 9
ℹ fail 0
```

Coverage: 88.16% line / 83.33% branch / 94.12% funcs (≥80% threshold met).

## Files changed

- `scripts/version-consistency-check.ts` (new) — main check script
- `scripts/version-consistency-check.test.ts` (new) — 9 fixture tests
- `packages/quay-native/package.json` — 0.3.4 → 0.3.11
- `packages/quay-github/package.json` — 0.1.0 → 0.3.11
- `packages/quay-backlog/package.json` — 0.1.0 → 0.3.11
- `plugin/.claude-plugin/plugin.json` — 0.3.22 → 0.3.11
- `plugin/.claude-plugin/marketplace.json` — quay 0.3.16 → 0.3.11
- `.claude-plugin/marketplace.json` — quay 0.3.5 → 0.3.11
- `plugin/vendor/quay/package.json` — 0.3.5 → 0.3.11
- `tasks/DIR-066.md` — dirStatus applied, Resolution added
- `tasks/DIR-065.md` — dirStatus superseded, Resolution added

## DoD self-check

- [x] RED+GREEN demonstrated on the real tree (not fixture-only) — see above
- [x] Load-bearing script with passing sibling test (≥80%) — 88.16% line coverage
- [x] No driver file touched — all changes in packages/ + plugin/ + scripts/ + tasks/
- [ ] it0 DoD meta-enforcer — to be verified at ABSORB

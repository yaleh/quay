---
id: exp5-M-TS-MIGRATION-P5-A
title: "TS migration P5-A (bin entrypoints, DIR-058): migrate 4 CLI bin/*.js
  launchers to .ts"
status: todo
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-TS-MIGRATION-P5
children: []
extra:
  schema: v1
---
## Proposal

P5-A of [[exp5-M-TS-MIGRATION-P5]] (DIR-058): migrate the 4 CLI `bin/*.js` entrypoints to `.ts`,
behavior-preserving (same CLI output, same exit codes, same argv handling), under the ADR-012
golden-diff discipline (`tsc --noEmit` + full-suite-green before/after, Node native type-stripping,
no build step):

- `packages/quay-native/bin/quay-native.js`
- `packages/quay-github/bin/quay-github.js`
- `packages/quay/bin/quay.js`
- `packages/quay-backlog/bin/quay-backlog.js`

**Out of scope (permanent exemption, DIR-058):** `packages/quay-native/scripts/manifest.sea-shim.js`,
`packages/quay/scripts/version-sea-shim.js` — esbuild `--alias` substitution targets for the SEA
single-executable build only; must never join the normal ESM/TS module graph.

## Plan
N/A — mechanical per-file port, same pattern as P1 (`provider-client.js`→`.ts`, M77). Each entrypoint
ported individually with a `tsc --noEmit` + full-suite-green check before moving to the next.

## Acceptance Criteria
- [ ] All 4 `bin/*.js` files renamed/ported to `.ts`, runnable directly via `node <path>.ts --help` (or equivalent) with exit code 0 and unchanged output.
- [ ] `npx tsc --noEmit` (root tsconfig, once these files are included) exits 0 or with only the pre-existing documented TS2589 errors (no NEW errors from these 4 files).
- [ ] Full non-flaky suite green before/after (golden-diff): `cd packages/quay && node --test $(ls test/*.mjs | grep -vE 'serve-github|provider-abi-conformance')`.
- [ ] The 2 SEA shims are explicitly named as out-of-scope in this task's Resolution (not silently ignored).

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [ ] All 4 files are `.ts` on `master`, `git log --follow` shows the rename commit for each.
- [ ] `tsc --noEmit` + full suite pasted as evidence in the Resolution.
- [ ] No behavior change (golden-diff: identical CLI output/exit codes before and after, pasted evidence).

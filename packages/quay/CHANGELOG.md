# Changelog (packages/quay)

This package's changelog is maintained at the repo root:
[`../../CHANGELOG.md`](../../CHANGELOG.md) — the monorepo has a single
version-tag/release cadence shared across `packages/quay`,
`packages/quay-native`, and `packages/quay-github`, so per-package entries
would duplicate the same dated release notes three times. This file exists
(rather than being absent) so `packages/quay`'s own npm-published artifact
(`quay-<version>.tgz`, whose `files` field includes `CHANGELOG.md`) carries
a changelog at all — see the root file for the actual entries, starting
with v0.3.x (M08-merge-recover: SEA/CI distribution, `--version`/`-V`,
`--format json`, `--page-size`, packaging metadata) and v0.2.0.

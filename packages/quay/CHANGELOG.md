# Changelog (packages/quay)

This package's changelog is maintained at the repo root:
[`../../CHANGELOG.md`](../../CHANGELOG.md) — the monorepo has a single
version-tag/release cadence shared across `packages/quay`,
`packages/quay-native`, and `packages/quay-github`, so per-package entries
would duplicate the same dated release notes three times. This file exists
(rather than being absent) so `packages/quay`'s own npm-published artifact
(`quay-<version>.tgz`, whose `files` field includes `CHANGELOG.md`) carries
a changelog at all — see the root file for the actual entries, newest
first: v0.6.0 (2026-08-20, productization pipeline close-out), v0.5.0
(2026-08-16, AC85-93 productization chain), v0.4.0 (2026-08-06, plugin
bundle in the release + two-line branch model), then the v0.3.x series
(M08-merge-recover: SEA/CI distribution, `--version`/`-V`,
`--format json`, `--page-size`, packaging metadata) and v0.2.0.

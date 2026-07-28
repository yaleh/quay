# M194 — DIR-120-B: fix drivable-workspace-check.ts's layering inversion

**Task:** DIR-120-B · **Class:** development · **Value type:** capabilityGrowth
**Deliverable:** yes · **Charter tokens:** ~0.4 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ > 0 (capability-growth, deliverable, method-infra surface). `drivable-workspace-check.ts`'s
`DEFAULT_REGISTRY_PATH` is a directory-relative guess that only resolves correctly from one of its
two real invocation locations (an accident of the experiments-tree copy's location, not by design)
— latent today only because no real task sets `extra.drivableWorkspaceArgs`, but a real correctness
gap in a product-level gate script. This milestone removes the guessed constant, makes `--registry`
required, converts the experiments-tree copy to a real symlink (matching `config-wiring-check.ts`'s
already-proven shape), and fixes both downstream consumers (`select-preflight.ts`'s dead import,
`human-steered-classify.ts`'s runtime default) plus the one out-of-`scripts/test.sh`-glob test file
that currently only passes by the same location accident this milestone removes.

## Why skip `prepare-milestone` for this milestone

`tasks/DIR-120-B.md` already carries a full, real, line-cited Proposal/Finding/Requested-action/AC/
DoD — split out of DIR-120 (DIR-026 SPLIT-OR-COMMIT, 2026-07-28) after 5+ independent real findings
across `prepare-milestone.js`'s own ProposalReview rounds against the parent task all traced to this
same self-contained sub-area. Its own `## Plan` is explicitly `N/A` (a directive resolved via a
human-steered milestone, no separate design doc needed) — the same shape as DIR-125/M193, which
skipped `prepare-milestone` for the identical reason (task already well-grounded, narrow, and
directly derived from real session evidence, not a thin draft needing independent re-derivation).

## Scope

Per `tasks/DIR-120-B.md`'s own Acceptance Criteria and Definition of Done — not summarized here to
avoid a second, driftable copy. In short: remove `DEFAULT_REGISTRY_PATH` from
`plugin/scripts/drivable-workspace-check.ts` (require `--registry`, clean usage error when
omitted); convert the experiments-tree `.ts`/`.sh` copies to real symlinks; re-derive `selftest()`'s
three `real-registry-*` checks to each individually prove execution; fix `select-preflight.ts`'s
dead import and `human-steered-classify.ts`'s runtime default independently of each other; rewrite
`experiments/quay-perpetual-stream/test/drivable-workspace-check.test.mjs` to pass an explicit
registry in every assertion and run it directly; sign off explicitly that the `.quay/config.yml`
`gates.it0` `drivable-workspace` entry stays end-to-end-unexercised (no real task sets
`drivableWorkspaceArgs`).

## Touches

Per `tasks/DIR-120-B.md`'s own `## Touches` list — not duplicated here.

## Done-when

Per `tasks/DIR-120-B.md`'s own AC/DoD — real command output for every item (usage-error exit code,
`ls -la` symlink proof, per-check selftest visibility, both consumer fixes independently re-run
green, the out-of-glob test run directly with pasted GREEN output, the drivable-workspace gate's
non-exercise sign-off). A fresh independent audit (wiring-focused) after Land, per standing session
practice.

## Inner termination

Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7

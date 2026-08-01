# M215 — DIR-099: Add quay config validate command

**Task:** DIR-099 · **Class:** development · **Value type:** capabilityGrowth
**Deliverable:** yes · **Charter tokens:** ~0.3 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ > 0 (capability-growth, deliverable, product surface). `.quay/config.yml` has no
pre-runtime validation — malformed YAML, missing required fields, gate references to
non-existent gates, and incorrect gate entry shapes are only discovered when a command
fails at runtime. This milestone adds `quay config validate` (alias `check`): a
fail-closed, comprehensive validator of `.quay/config.yml` with line-level diagnostics,
exit 0 on clean / exit 1 on issues, plus `--check-files` and `--json` modes.

Also serves as the file-disjoint concurrency partner for the DIR-123 real-concurrent-dispatch
proof: D5 (M213) touches `execute-milestone.js`/`composite-land.ts`; this milestone touches
`packages/quay/` only — genuinely file-disjoint, so D5 + M215 dispatched concurrently with
`isolationMode:'worktree'` prove DIR-123's AC #1 (overlapping Build-phase timestamps, both
Land correctly).

## Prepared-gate note

Dispatched under the M195/DIR-117-B enforced-by-default Prepared gate: carries a real
`prepare-milestone.js` receipt consumed by its `execute-milestone.js` dispatch.

## Scope

Per `tasks/DIR-099.md`'s own Acceptance Criteria / Definition of Done — not duplicated here.
In short: `config validate`/`check` subcommand in `packages/quay/bin/quay.ts`; reusable
validation module `packages/quay/src/config-validate.ts`; test file with ≥80% coverage
covering all 10 validation checks; README mention; meta-cc config-with-vitest-gate-error
as test fixture.

## Touches

Per `tasks/DIR-099.md`'s own `## Touches` list — not duplicated here.

## Done-when

Per `tasks/DIR-099.md`'s own AC/DoD. A fresh independent audit after Land.

## Inner termination

Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ 26b651746d5f85f9fa317b65e204932089b75a16

# M173 — Canonical test runner (scripts/test.sh) + in-file skip for live/conformance tests

**Task:** DIR-109 · **Counter:** 173 · **Chart:** 2
**Class:** development · **Value type:** instrumentCorrection
**Deliverable:** no · **Charter tokens:** ~0.9 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis
Δv̂ > 0 (instrument-correction, VT-neutral). ADR-019 records that this repo's test taxonomy
(which files are live/network-dependent vs safe-by-default) lives only in duplicated, hand-written
prose independently maintained in BOTH `CLAUDE.md` and `.github/workflows/ci.yml` — nothing keeps
the two copies in sync (the exact DIR-013 drift pattern). Moving the taxonomy into the test files
themselves (in-file skip) and consolidating the invocation into one canonical script closes a real,
demonstrated drift class and sets up DIR-110's mechanical self-check.

## Scope
Per DIR-109's Requested action:
1. Give each of the 3 live/conformance test files (`serve-github.test.mjs`,
   `provider-abi-conformance.test.mjs`, `cli-edit-parity-conformance.test.mjs`) an in-file skip
   declaration (`test(name, {skip: <condition>}, fn)` or file-level early guard), gated on a
   concrete, checkable condition (env var and/or cheap reachability probe).
2. Create `scripts/test.sh`: canonical invocation script, owns the test-file glob
   (`packages/*/test/*.test.mjs plugin/test/*.test.mjs`), defaults to `--test-concurrency=8`.
3. Update `CLAUDE.md`'s Commands section to point at `scripts/test.sh`, removing the hand-written
   glob/grep prose.
4. Update `.github/workflows/ci.yml`'s test step to invoke `scripts/test.sh`.

**Out of scope:** DIR-110's mechanical taxonomy self-check gate (depends on this task's
`scripts/test.sh` existing — separate milestone).

## Touches
- scripts/test.sh (new)
- packages/quay/test/serve-github.test.mjs
- packages/quay/test/provider-abi-conformance.test.mjs
- packages/quay/test/cli-edit-parity-conformance.test.mjs
- CLAUDE.md
- .github/workflows/ci.yml

## Done-when
1. `scripts/test.sh` exists, is executable, no-args run executes the full safe-by-default suite
   (no live/network calls) via `--test-concurrency=8`
2. Each of the 3 live/conformance files declares an in-file skip condition; a credential-less run
   reports them `skipped`, not silently absent
3. The documented opt-in env var causes the live tests to actually execute (opt-in path proven)
4. `.github/workflows/ci.yml`'s test job invokes `scripts/test.sh`
5. `CLAUDE.md` documents `scripts/test.sh` as canonical
6. `git grep` for the old hand-written grep -vE pattern returns empty
7. A real CI run is green using the new script
8. `adr/ADR-019-...md`'s `enforcement` field updated to point at `scripts/test.sh`

## Inner termination
Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7

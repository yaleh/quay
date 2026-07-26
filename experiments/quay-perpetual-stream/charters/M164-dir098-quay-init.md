# M164 — Add quay init command

**Task:** DIR-098 · **Counter:** 164 · **Chart:** 2
**Class:** development · **Value type:** capability-growth
**Deliverable:** yes · **Charter tokens:** ~0.3 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis
Δv̂ > 0. New user onboarding: `quay init` scaffolds a complete workspace config, replacing manual config creation.

## Scope
Add `quay init` subcommand to both Core and native CLIs. Generates .quay/config.yml with all 3 sections + inline docs. Supports --force, --dry-run, --root flags.

## Touches
- packages/quay/bin/quay.ts
- packages/quay-native/bin/quay-native.ts
- packages/quay/test/init.test.mjs (new)
- README.md

## Done-when
1. `quay init` creates valid .quay/config.yml + tasks/ dir.
2. `quay-native init` works identically.
3. --force, --dry-run, --root flags functional.
4. Tests >=80% coverage, RED→GREEN per ADR-001.
5. README updated.

## Inner termination
Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ d6738ba27c29cb53940f3a14a5ffc185f14d19ef

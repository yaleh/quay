---
id: gap-tests-spawn-cli-from-ts-source
title: "Tests spawn the CLI from .ts source at 3.5s each — the prebuilt bundle
  costs 1.4s for the same behavior"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

Every test that shells out to the quay CLI pays a full TypeScript module-graph load. Measured
2026-08-02 on this machine, 3–5 runs each:

| 形态 | 单次 | 增量 |
|---|---|---|
| 裸 `node` | 363 ms | — |
| `node --experimental-strip-types -e "0"` | 374 ms | **+11 ms** |
| `+ import` 单个小模块（`config.ts`） | 966 ms | +592 ms |
| **`node --experimental-strip-types packages/quay/bin/quay.ts --help`** | **3,469 ms** | +3,106 ms |
| **`node packages/quay/dist/quay.js --help`**（1.3 MB 预构建 bundle） | **1,361 ms** | — |

Two results that contradict the obvious guess:

1. **`--experimental-strip-types` is essentially free (+11 ms).** It has been the suspected culprit;
   it is not.
2. **The cost is module-graph loading** — 40 `src/*.ts` files, 5,505 lines, 16 top-level imports in
   `quay.ts`. The prebuilt bundle collapses that to one file and saves **2.1 s per invocation (61%)**.

### Scale

`grep` across the CI glob (113 non-symlink test files): **129 call sites** reference a quay CLI
entry (`quay.ts` / `bin/quay` / `quay-native.js`).

```
129 × 2.1 s ≈ 271 s
```

The full suite was 418 s before B3-2's grouping change and is ~474 s after. **This one change is
worth roughly 271 s** — more than half the suite — without touching a single assertion.

## Chosen mechanism

Route CLI-spawning tests through the prebuilt bundle instead of the `.ts` entry.

1. **One build per suite run, not per test.** `scripts/test.sh` runs
   `node packages/quay/scripts/build-dist.mjs` once up front (the script already exists). Cost is
   paid once and amortized over 129 invocations.
2. **A single resolved path constant** the tests import, rather than 129 hand-edited literals:
   `packages/quay/test/helpers/cli-entry.mjs` exporting `QUAY_CLI` — resolves to
   `dist/quay.js` when present and fresh, else falls back to `bin/quay.ts`. The fallback keeps a
   developer's `node --test <file>` working with no build step.
3. **Freshness is checked, not assumed.** The helper compares `dist/quay.js` mtime against the
   newest `src/**/*.ts` + `bin/*.ts` mtime. Stale → fall back to `.ts` and emit a one-line warning.
   A stale bundle silently passing tests over old code is the one failure mode that matters, so it
   must be impossible rather than unlikely.

### Why this is arguably more correct, not just faster

`dist/quay.js` is what `npm pack` ships and what `dist-verify-node-floor` already exercises
(CLAUDE.md / ADR-019 decision #5). Testing the CLI surface against the artifact users actually run
is closer to the real contract than testing against sources that only exist in this repo.

**Not in scope:** tests that `import` modules directly are untouched — they are already fast and
this changes nothing for them. Reducing the *number* of CLI spawns is
[[gap-tests-use-cli-where-module-import-suffices]].

## Acceptance Criteria

- [ ] AC1: `packages/quay/test/helpers/cli-entry.mjs` exports `QUAY_CLI`, resolved once per process
- [ ] AC2: Resolves to `dist/quay.js` when it exists and is newer than every `src/**/*.ts` and `bin/*.ts`
- [ ] AC3: Falls back to `bin/quay.ts` when `dist/quay.js` is absent
- [ ] AC4: Falls back to `bin/quay.ts` when `dist/quay.js` is STALE, and warns once on stderr
- [ ] AC5: `scripts/test.sh` builds `dist/quay.js` once before the run; build failure is fatal (never silently run against a stale bundle)
- [ ] AC6: All 129 CLI call sites use `QUAY_CLI` — zero remaining hardcoded `bin/quay.ts` literals in test files (grep-confirmable)
- [ ] AC7: `quay-native` / `quay-github` / `quay-backlog` CLI entries get the same treatment, or are explicitly documented as out of scope with a reason
- [ ] AC8: Suite wall-clock measured before and after, both recorded in the task; the delta is the deliverable
- [ ] AC9: Zero assertion changes — `git diff` shows only entry-path substitutions in test files
- [ ] AC10: A developer running `node --test packages/quay/test/cli.test.mjs` with no prior build still passes (AC3 path)
- [ ] AC11: Test declares `// @test-group product` per [[gap-test-suite-has-no-layer-grouping]]

## Definition of Done

- [ ] Before/after suite wall-clock recorded; expected ≈271 s saved, actual reported either way
- [ ] `scripts/test.sh` green
- [ ] Stale-bundle fallback exercised by a real test (touch a `src/*.ts`, confirm fallback + warning)

## Touches

- scripts/test.sh
- packages/quay/test/helpers/cli-entry.mjs
- packages/quay/test/*.test.mjs
- packages/quay-native/test/*.test.mjs
- packages/quay-github/test/*.test.mjs
- packages/quay-backlog/test/*.test.mjs
- plugin/test/codex-stage1-adapter.test.mjs

---
id: gap-native-store-title-roundtrip-nondeterministic-failures
title: "native store AC4 round-trip fails NON-DETERMINISTICALLY on random plain-letter titles"
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: v1
---

## Proposal

`packages/quay-native/test/store.test.mjs` AC4 (`every candidate title round-trips; derived
charset documented`) fails on EVERY run but on a RANDOM plain-letter title. Evidence
(isolated runs, 2026-08-06):

- Run 1: `charset derivation found non-round-tripping titles: "arb"`
- Run 2: `"aqb"` · Run 3: `"azb"` · Run 4: `"akb"` — random ASCII lowercase letters in the
  `a<ch>b` candidate family.
- The failing titles are PLAIN 3-letter strings — YAML round-trips these trivially, so this is
  NOT a serialization gap. The derivation (`deriveTitleCharset`, store.test.mjs:94) writes each
  candidate to the SAME id `RT` in a fresh temp store and reads back; a random one mismatches.
- The store source hasn't changed since `45366968` (2026-08-04, the M89 write-side serialization
  fix, which claimed 58/58 quay-native green). yaml is 2.9.0 (unchanged).
- Strong hypothesis: a store read-after-write staleness (cache / lockfile) on the reused `RT` id —
  `get` intermittently returns a previous candidate's title. Needs a targeted store-level
  investigation, not a test-only workaround.

## Acceptance Criteria

- [ ] AC1: `node --no-warnings --test packages/quay-native/test/store.test.mjs` passes 5/5
      consecutive runs (deterministic green).
- [ ] AC2: root cause identified and FIXED in the store (not the test) — OR, if it is a
      test-design flaw (e.g. reusing one id across 135 candidates races a shared lock), the fix
      is in the test WITH a store-level regression control.
- [ ] AC3: a deterministic negative control exists (construct the stale-read condition ⇒ the
      round-trip must fail in a controlled way) so the fix is provable, not "ran N times green".
- [ ] AC4: `git show --name-only` on the fix touches the store source and/or its test only.

## Contract

measure   store_ac4_runs = `node --no-warnings --test packages/quay-native/test/store.test.mjs` 连跑 5 次 → tests pass, fail 0 每次
band      ac4_fail_runs = 0（5/5 runs green）
invariant 同 id 连续 round-trip 必须确定性通过（无 read-after-write 陈旧）
invoke    `node --no-warnings --test --test-name-pattern="AC4" packages/quay-native/test/store.test.mjs`
control   负控制：故意制造 store.get 返回陈旧 title 的条件 ⇒ AC4 必须复现失败；修复后同条件 ⇒ 不失败
resume    n/a（fresh task）

## Dispatch review

reviewer: outer
at: 2026-08-06T00:4xZ
changed: 无

## Touches

- packages/quay-native/src/store.ts
- packages/quay-native/test/store.test.mjs

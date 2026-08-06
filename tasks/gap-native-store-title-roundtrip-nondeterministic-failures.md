---
id: gap-native-store-title-roundtrip-nondeterministic-failures
title: native store AC4 round-trip fails NON-DETERMINISTICALLY on random
  plain-letter titles
status: done
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

- [x] AC1: `node --no-warnings --test packages/quay-native/test/store.test.mjs` passes 5/5
      consecutive runs (deterministic green).
- [x] AC2: root cause identified and FIXED in the store (not the test) — OR, if it is a
      test-design flaw (e.g. reusing one id across 135 candidates races a shared lock), the fix
      is in the test WITH a store-level regression control.
- [x] AC3: a deterministic negative control exists (construct the stale-read condition ⇒ the
      round-trip must fail in a controlled way) so the fix is provable, not "ran N times green".
- [x] AC4: `git show --name-only` on the fix touches the store source and/or its test only.

## Evidence

**Root cause (AC2).** `get()`'s parse cache in `packages/quay-native/src/store.ts` is keyed by
`(mtimeMs, size)` — a heuristic, not a content identity. Rewriting the SAME id with the SAME
byte-size content within the same mtime resolution (e.g. `title: aaa` → `title: bbb`, both 3
bytes, a millisecond apart) produces an IDENTICAL cache key, so a `get()` after the write returns
the PREVIOUS title's parse — a read-after-write staleness. `deriveTitleCharset` (store.test.mjs)
round-trips ~135 candidates through the one id `RT` in a tight loop; all `a<ch>b` candidates are
same-size, so whichever consecutive pair shared an mtime tick lost its round-trip — the random
plain-letter title per run. Fix: `invalidateCache(id)` called after every in-module write
(`write()`, `appendNote()`, `addChildRef()`, `removeChildRef()`), so the trailing `get()` always
re-reads fresh. Cache remains a win for unchanged-file reads.

**Deterministic negative control (AC3).** New test "AC4 negative control: same-(mtimeMs,size)
cache key must NOT serve a stale title after a same-size rewrite" patches `fs.statSync` to force
one fixed `(mtimeMs, size)` for `RT.md`, writes `aaa` then `bbb` (same size), and asserts the
store serves `bbb`. RED on the pre-fix store:

```
AssertionError [ERR_ASSERTION]: stale-read control: a same-(mtimeMs,size) rewrite must serve the NEW title from the store. store view returned "aaa" — if "aaa", the store served a stale parse-cache entry (read-after-write staleness) and the write-side cache invalidation is missing.
```

GREEN with the fix (proven deterministically, no wall-clock dependence).

**AC1 invoke evidence** — `node --no-warnings --test --test-name-pattern="AC4" packages/quay-native/test/store.test.mjs`:

```
✔ AC4: every candidate title round-trips; derived charset documented (591.329928ms)
✔ AC4 negative control: same-(mtimeMs,size) cache key must NOT serve a stale title after a same-size rewrite (5.273726ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
```

**AC1 determinism** — full file 5 consecutive runs (each 6/6 pass, fail 0):
`pass 6/fail 0` × 5 (plus a further 13+ green runs across the scoped suite and the full
quay-native dir; all 63 quay-native tests pass). Pre-fix, the AC4 failure reproduced on ~every
run with a random title (`"axb"`, `"arb"`, `"ajb"`, ...).

**AC4** — `git show --name-only` on the fix commit:
```
packages/quay-native/src/store.ts
packages/quay-native/test/store.test.mjs
```

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

---
id: gap-milestone-preparation-check-raw-nul-bytes
title: milestone-preparation-check.ts's sort-comparator/dedup keys were written
  with 11 raw NUL bytes (join("<NUL>") / `${...}<NUL>${...}`) instead of "\x00"
  escape sequences, making the source file binary to grep/ripgrep and silently
  degrading all grep-based tooling on it -- found by the independent post-land
  wiring audit of M204/DIR-126-E
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
  acceptance: node --experimental-strip-types --test experiments/quay-perpetual-stream/test/milestone-preparation-check.test.mjs plugin/test/prepare-milestone-preparation-e2e.test.mjs
---
## Proposal

Replace the 11 raw NUL bytes in `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts`
(+ the byte-identical `plugin/scripts/` mirror) with `\x00` escape sequences. The bytes appeared in
the M204/DIR-126-E `computeCapacityReport` implementation's sort comparators and dedup key builders
(`[a.population, a.id, a.reason].join("\0")` and `` `${record.taskId}\0${record.milestoneId}` ``)
where the NUL separator was written as a literal NUL byte rather than the `\x00` escape. Functionally
identical (both produce the NUL character at runtime), but the literal bytes make `grep`/`ripgrep`
treat the `.ts` source as binary ("data"), so `grep computeCapacityReport` returns nothing and every
grep-based code-navigation/audit/CI tool silently skips the file.

## Finding

Found by the independent post-land wiring audit of M204/DIR-126-E (2026-07-30): the auditor's first
`grep` for `computeCapacityReport`/`--capacity-report` returned nothing, initially looking like a
missing implementation; root cause was 11 raw NUL bytes (`file` reported "data"; `awk`/`node` worked
fine). Verified: 11 NUL bytes in each mirror (9 in `join("\0")` string literals, 2 in
`` `${...}\0${...}` `` template literals). The code ran correctly (80/80 tests, CLI `code:ok`) — the
only impact is degraded grep tooling, but that silently undermines every grep-based audit/CI check on
this file (including the wiring-coverage and preflight checks that read OTHER files but whose results
an auditor cross-checks by grepping this source).

## Requested action

1. Replace every raw NUL byte with the `\x00` escape in both mirrors (9 string-literal + 2
   template-literal occurrences), keeping them byte-identical via `sync-vendor.sh`.

## Acceptance Criteria

- [ ] Both mirrors contain zero raw NUL bytes (`grep -c $'\x00'` / `python3 -c "...count(b'\\x00')"`
  → 0); the source is text to grep (`grep computeCapacityReport` returns its 5 occurrences).
- [ ] The sort/dedup behavior is unchanged: `join("\x00")` and `` `${id}\x00${milestoneId}` ``
  produce the same NUL-separated keys at runtime; 80/80 `milestone-preparation-check.test.mjs` tests
  pass and `--capacity-report` still returns `code:ok` over the real telemetry tree.
- [ ] Both mirrors byte-identical (`diff -q` + `sync-vendor.sh --check` CLEAN).

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] Landed on `master` (both mirrors byte-identical).
- [ ] Real, non-fixture evidence: grep sees the file as text; 80/80 tests + live `--capacity-report`
  run green.

## Touches

- experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts
- plugin/scripts/milestone-preparation-check.ts

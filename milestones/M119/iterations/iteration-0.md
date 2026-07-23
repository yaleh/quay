# M119 iteration-0 — clause8 hyphenated milestone-label regex fix

**Milestone:** M119 — `exp5-DEFECT-CLAUSE8-HYPHEN-LABEL-MISMATCH`
**Charter:** `experiments/quay-perpetual-stream/charters/M119-clause8-hyphen-label-fix.md`
**Date:** 2026-07-23
**Class:** development / governance-integrity, instrument-correction

## Change

One-line fix, `experiments/quay-perpetual-stream/scripts/it0-dod-check.ts` line 615:

```diff
-  const milestoneLabelMatch = taskText.match(/milestone:M(\d+)/i);
+  const milestoneLabelMatch = taskText.match(/milestone:M-?(\d+)/i);
```

Makes the hyphen between `M` and the milestone number optional, so both label conventions match:
the pre-existing test-fixture convention (`milestone:M41-fake-canonical-violating` — no hyphen,
descriptive suffix after the number) and the repo's real, established convention used on every task
since ~M111 (`milestone:M-113`, `milestone:M-116`, etc. — hyphen, no suffix).

## AC1 — regex matches both forms

```
$ node -e '
const re = /milestone:M-?(\d+)/i;
console.log("M113:", "milestone:M113".match(re));
console.log("M-113:", "milestone:M-113".match(re));
console.log("M41-fake-canonical-violating:", "milestone:M41-fake-canonical-violating".match(re));
'
M113:  ["milestone:M113", "113", ...]
M-113: ["milestone:M-113", "113", ...]
M41-fake-canonical-violating: ["milestone:M41", "41", ...]
```
All 3 forms match, capturing the correct numeric group each time.

## AC2 — clause8 actually APPLIES against a real hyphenated task (not N/A)

Before this fix, every real task's `quay gate` run showed clause8 as N/A ("no 'milestone:M<N>' label
found — legacy/unlabeled"), e.g. M116/M117/M118's own gate runs, despite each carrying a real
`milestone:M-11{6,7,8}` label.

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-M-ARCH-AUDIT-POST-DIR058-EXPLORE experiments/quay-perpetual-stream/charters/M118-arch-audit-post-dir058-explore.md /tmp/m118-absorb-entry.md 2>&1 | grep -i clause8
PASS: clause8-task-canonical-lifecycle-record: task carries a real '## Proposal' (2026 chars) and a well-formed '## Plan' [tasks/exp5-M-ARCH-AUDIT-POST-DIR058-EXPLORE.md]
```
Clause 8 now genuinely APPLIES (checks for `## Proposal`/`## Plan` presence) against this real
`milestone:M-118`-labeled task, rather than short-circuiting to N/A. This is the exact cutover-check
behavior the clause was built for and had never actually exercised.

## AC3 — dod-fixture-selfcheck.sh golden-diff, 17/17 unchanged

```
$ bash experiments/quay-perpetual-stream/scripts/dod-fixture-selfcheck.sh
... (17 individual PASS lines, including M40B/M40C — the clause8 fixture pair — both unchanged
     exit codes: M40C-fake-canonical-violating exit 1 as expected, M40B-fake-canonical-compliant
     exit 0 as expected)
PASS: all 17 DoD fixtures behaved as asserted.
```
Same 17/17 pass count as pre-fix baseline — no other clause's verdict changed.

## Additional regression checks (not part of this task's own AC, but run for due diligence)

```
$ node --test experiments/quay-perpetual-stream/test/*.mjs
tests 343 / pass 343 / fail 0   (same as pre-fix baseline)

$ for d in packages/*/; do npx tsc --noEmit -p "$d"; echo "$d exit=$?"; done
packages/quay-backlog/ exit=0
packages/quay-github/  exit=0
packages/quay-native/  exit=0
packages/quay/         exit=0
```

## Recommendation

DONE. All 3 AC + 2 DoD items satisfied with pasted evidence above.

# Charter M119-clause8-hyphen-label-fix — clause8 hyphenated milestone-label regex fix

**Milestone id:** M119
**Task:** `tasks/exp5-DEFECT-CLAUSE8-HYPHEN-LABEL-MISMATCH.md`
**Surface:** development-class / governance-integrity, instrument-correction
**Charter authored:** 2026-07-23
**Base commit:** master HEAD at dispatch (`2f94d57`, M118's ABSORB commit)
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

Found by the M115 adversarial audit: `it0-dod-check.ts`'s Clause 8 (`task-canonical-lifecycle-record`)
regex `/milestone:M(\d+)/i` (line 615) requires digits immediately after `M`, but the repo's actual,
established `milestone:M-NN` label convention (used on every real task since M111: `milestone:M-113`,
`milestone:M-116`, `milestone:M-117`, `milestone:M-118`, etc.) has a hyphen between `M` and the
number. The regex silently never matches the real convention, so Clause 8 has reported every such
task as "no milestone:M<N> label found — legacy/unlabeled" (N/A-pass) since introduction — never
exercising its real cutover-check logic. Confirmed still live via M116/M117/M118's own `quay gate`
runs, each showing clause8 as N/A despite carrying `milestone:M-11{6,7,8}` labels.

## Scope

One-line regex fix: `/milestone:M(\d+)/i` → `/milestone:M-?(\d+)/i` (line 615 of
`experiments/quay-perpetual-stream/scripts/it0-dod-check.ts`), making the hyphen optional so both the
pre-existing fixture convention (`milestone:M41-fake-canonical-violating` — no hyphen, descriptive
suffix) and the real repo convention (`milestone:M-113` — hyphen, no suffix) match.

Verify: `dod-fixture-selfcheck.sh` stays 17/17 (golden-diff, no other clause's verdict changes), and a
real `milestone:M-<N>`-labeled task (N ≥ 40, the cutover) now shows Clause 8 actually APPLYING
(checking for `## Proposal`/`## Plan` presence) rather than N/A.

**Not in scope:** any change to Clause 8's cutover logic itself (N ≥ 40 threshold, what it checks once
applying) — only the label-matching regex.

## Class routing

**Development-class** (a one-line source fix to a method-infra script). Per the DIR-014 exemption
precedent for small, mechanical, single-line fixes with an established verify pattern (golden-diff
fixture selfcheck), no `quay-task-to-plan` pipeline required — this mirrors the sizing of prior small
defect fixes (e.g. M99's `startMcpServer` outDegree fix, dispatched directly).

## Acceptance Criteria (from task)

- [ ] `it0-dod-check.ts`'s clause8 regex matches BOTH `milestone:M113` and `milestone:M-113` forms.
- [ ] Re-run against a real task carrying `milestone:M-<N>` (N ≥ cutover) and confirm clause8 actually APPLIES (not N/A) — pasted output.
- [ ] `dod-fixture-selfcheck.sh` still 17/17 (or current count) PASS after the fix (golden-diff, no other clause's verdict changes).

## Definition of Done

- [ ] All 3 AC items above verified true with pasted command output.
- [ ] it0 DoD meta-enforcer passes all clauses.

## GATE-HASH-REF

GATE-HASH-REF: 22c64fc383d6fc03ba375f8b9ce463abce3459d318c8787e33d8bcb321d876e1

(Same pre-existing, tracked-not-blocking drift as M116/M117/M118 — `exp5-DEFECT-GATE-HASH-CHECK-STALE-PINNED-SOURCE`.)

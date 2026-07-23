---
id: exp5-DEFECT-CLAUSE8-HYPHEN-LABEL-MISMATCH
title: "defect: it0-dod-check.ts clause8 regex doesn't match the repo's actual
  milestone:M-NN (hyphenated) label convention"
status: done
labels:
  - milestone-candidate
  - defect
  - milestone:M-119
parent: null
children: []
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-DEFECT-CLAUSE8-HYPHEN-LABEL-MISMATCH
    experiments/quay-perpetual-stream/charters/M119-clause8-hyphen-label-fix.md
    /tmp/m119-absorb-entry.md
---
## Proposal

Found by the M115 adversarial audit (`milestones/M115/audits/iteration-0-acceptance-audit.md`,
"Overall verdict" section, final bullet): `it0-dod-check.ts`'s clause8
(`task-canonical-lifecycle-record`) regex `/milestone:M(\d+)/i` requires digits IMMEDIATELY after
`M`, but the repo's ACTUAL, established `milestone:M-NN` label convention (confirmed present on
`exp5-M-ARCH-AUDIT-POST-FULL-TS.md` as `milestone:M-113`, and used by this session on M114/M115 as
`milestone:M-114`/`milestone:M-115`) has a HYPHEN between `M` and the number. The regex never
matches any task using the real convention, so clause8 has silently reported every such task as
"no milestone:M<N> label found — legacy/unlabeled" (the N/A-legacy path) since its introduction —
never actually exercising the cutover-check logic it was built for. This is non-blocking (N/A is
still a PASS disposition) but means clause8 has likely never fired its real check against a single
real task in this repo's history.

## Plan
N/A — a one-line regex fix (`/milestone:M-?(\d+)/i` or equivalent) plus re-running the fixture
selfcheck (`dod-fixture-selfcheck.sh`) to confirm no regression, then spot-checking clause8 actually
applies (not N/A) against a real `milestone:M-<N>`-labeled task with N ≥ the cutover number.

## Acceptance Criteria
- [x] `it0-dod-check.ts`'s clause8 regex matches BOTH `milestone:M113` and `milestone:M-113` forms.
- [x] Re-run against a real task carrying `milestone:M-<N>` (N ≥ cutover) and confirm clause8 actually APPLIES (not N/A) — pasted output.
- [x] `dod-fixture-selfcheck.sh` still 17/17 (or current count) PASS after the fix (golden-diff, no other clause's verdict changes).

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget,
impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene,
worktree-branch-hygiene, audit-independence).
- [x] All 3 AC items above verified true with pasted command output.
- [x] it0 DoD meta-enforcer passes all clauses.




## Resolution

Independently re-verified by a fresh-context adversarial audit (see
`milestones/M119/audits/iteration-0-adversarial-audit.md`) against the fix landed at commit
`36d2a67` (`experiments/quay-perpetual-stream/scripts/it0-dod-check.ts` line 615,
`/milestone:M(\d+)/i` → `/milestone:M-?(\d+)/i`).

- AC1: re-tested with 13 additional adversarial cases beyond the milestone's own report (cutover
  boundary M-40/M-39, no-digit label, malformed `MX`/`M-X`, double-hyphen, two-milestone-labels-
  in-one-string, case-insensitivity, whitespace-after-colon). No new false positive introduced by
  making the hyphen optional; malformed/no-digit inputs correctly still return no match.
- AC2: reproduced the report's exact command against `exp5-M-ARCH-AUDIT-POST-DIR058-EXPLORE` /
  `/tmp/m118-absorb-entry.md` — output byte-for-byte identical
  (`PASS: clause8-task-canonical-lifecycle-record: task carries a real '## Proposal' (2026 chars)
  and a well-formed '## Plan' [tasks/exp5-M-ARCH-AUDIT-POST-DIR058-EXPLORE.md]`).
- AC3: independently re-ran `dod-fixture-selfcheck.sh` — 17/17 PASS, both clause8 fixtures
  (`M40B`/`M40C`) at their exact claimed exit codes (0 and 1 respectively).
- DoD: independently re-ran `node --test experiments/quay-perpetual-stream/test/*.mjs` (343/343
  pass) and `npx tsc --noEmit -p <pkg>/` for all 4 packages (all exit 0) — both match the report's
  claims exactly.

**CONCERNS raised (non-blocking, does not unwind the above):** searching all of `tasks/*.md`, 3
real `status: done` tasks (`exp5-M-GATE-CLI-ERROR-UX`, `exp5-M-GATE-HELP-SYNOPSIS-GAP`,
`exp5-M-GATE-MCP-PARITY-GAP`) each carry TWO milestone labels (a `milestone:M37-discover-post-qeng`
discovery label first, a real `milestone:M51`/`M53`/`M56` landed label second). Because
`taskText.match()` has no `/g` flag, it returns the first match in file order — resolving to 37
(below cutover) and still reporting N/A on all three, even after this fix. This is a **pre-
existing, unrelated latent defect** (first-match-wins across multiple milestone labels in one
file) — the pre-fix regex already matched hyphenless `milestone:M37` identically, so these 3 tasks
were N/A both before and after M119; the hyphen fix neither introduces nor resolves this. It does
mean the milestone's broader narrative ("clause8 now genuinely applies... used on every task since
M111") overstates what was fixed: the literal, narrowly-scoped AC2 (one cited example) holds, but
clause8 does NOT yet correctly apply against all real milestone-labeled tasks in this repo.
Recommend a follow-up defect (not filed by this write-back) to make the label scan aware of
multiple milestone labels (e.g. take the max, or the last, rather than the first match).

Status set to `done`: all 5 AC/DoD checkboxes independently verified true above.

## Not selected (M116)

Not selected M116 — exp5-M-TS-MIGRATION-P5-A selected instead (capability-growth: real product TS migration work, diversifying value type from the last two governance-integrity/instrument-correction picks M114/M115). Good next pick.

## Not selected (M118)

Not selected M118 — exp5-M-ARCH-AUDIT-POST-DIR058-EXPLORE selected instead (mandatory explore per the ≥1/5 rule; this defect is a small exploit-shaped fix, wrong slot for this pass). Still confirmed live: M116/M117's own `quay gate` runs both showed clause8 returning N/A ("no 'milestone:M<N>' label found") despite both tasks carrying `milestone:M-116`/`milestone:M-117` labels — the bug described here is still unfixed. Good next exploit pick.

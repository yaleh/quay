---
id: gap-preflight-merged-markdown-claims-low-identifier-count-silent-miss
title: preflightMergedMarkdownClaims silently returns zero findings for a
  genuine mid-line-bulleted block naming fewer than 2 backtick identifiers --
  pre-existing, found incidentally during a 2026-07-31 adversarial review of
  two sibling false-positive fixes, unrelated to either
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
  acceptance: node --experimental-strip-types --test experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs
---
## Proposal

Decide, and implement if warranted, how `preflightMergedMarkdownClaims` should treat a genuine
mid-line-bulleted claim-crowding block that names fewer than 2 distinct backtick identifiers —
currently it silently returns zero findings (no finding at all, not even the ambiguous/
reviewer-required tier), the same silent-miss shape that two sibling tasks
(`gap-preflight-merged-markdown-ascii-dash-false-positive`,
`gap-preflight-merged-markdown-claims-code-span-subtraction-false-positive`) spent three rounds
closing for the `>=4`-identifier case.

## Finding

Discovered 2026-07-31 by the independent adversarial review of round 3 of the two sibling tasks'
fix (which redesigned the mid-line-bullet-marker detector's ASCII-dash/code-span false-positive
handling — see those tasks' Execution records for the full history). While probing
`preflightMergedMarkdownClaims`'s full control flow for the review's own purposes, the reviewer
constructed:

```
Update `FooModule` - also rewrite the retry logic entirely...
```

— one backtick identifier, one genuine-looking mid-line bullet marker ("- also" reads as a
continuation in isolation, but the block plausibly crams "update FooModule" and "rewrite the retry
logic" onto one line) — and a fully prose variant with zero backtick identifiers. Both return `null`
(zero findings) from the real function.

Diffed against `master`'s pre-round-1 (i.e. pre-2026-07-31) code for this function: the
`identifiers.size < 2 -> drop entirely` structure is byte-for-byte identical to what shipped
originally. This is NOT a regression introduced by any of the three rounds on the sibling tasks —
it predates all of them, and none of those tasks' own Requested Action or Acceptance Criteria
mention the low-identifier-count case at all (their scope is specifically the `>=4`-identifier
false-positive shapes). Filed here as its own follow-up rather than silently left unaddressed,
per this repo's own convention (see the sibling tasks' Execution records, and this repo's general
practice of filing every real reviewer finding as a task rather than letting it evaporate).

**Severity note**: this is a genuinely lower-stakes gap than the sibling tasks' — a block naming
fewer than 2 code entities is less likely to represent 2 DISTINCT wiring/architecture claims (the
detector's actual concern), and more likely to be a single claim about one entity with an inline
aside. No real-incidence scan has been done for this shape (unlike the sibling tasks, which each
had a real-incidence or real-live-dispatch basis). Whether this warrants a fix, a downgrade to
ambiguous, or an explicit accepted-risk note should be decided as part of resolving this task, not
assumed here.

## Requested action

1. Decide whether a genuine mid-line-bulleted block with 0-1 backtick identifiers should surface
   ANY finding (even non-blocking/ambiguous), or whether the detector's identifier-count-based
   design is intentionally scoped to blocks naming multiple entities (i.e. this may be a correct,
   intentional non-goal rather than a defect — assess against the detector's own stated purpose in
   its header comment before assuming a fix is warranted).
2. If a fix is warranted: extend the existing severity system (blocking / ambiguous /
   reviewer-required / silent) to cover this shape, following the same "never silently suppress a
   genuine defect below a visible tier" principle the sibling tasks' round-3 design established —
   do not reintroduce a binary genuine/not-genuine gate that can return zero findings for a real
   defect.
3. If NOT warranted: record the reasoning explicitly in this task (e.g. citing a real-incidence
   scan finding zero occurrences, or a structural argument for why <2-identifier blocks are out of
   this detector's intended scope) rather than leaving the box silently unchecked.

## Acceptance Criteria

- [ ] A real-incidence scan (similar to the sibling tasks' 495-task-file scan) establishes whether
  this shape occurs in this repo's real task files today, to inform severity/priority.
- [ ] Either: a fix lands extending coverage to this shape (with regression tests, following the
  round-3 "downgrade never fully suppresses" principle), OR an explicit, reasoned accepted-risk
  note is recorded here explaining why the current behavior is correct/acceptable as designed.
- [ ] No regression: the full `prepare-admission-check.test.mjs` suite (both mirrors) stays green.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline, OR closed as an explicit accepted-risk
  decision with documented reasoning — this task's own AC #1 determines which outcome is
  appropriate.

## Touches

- experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts
- plugin/scripts/prepare-admission-check.ts
- experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs
- plugin/test/prepare-admission-check.test.mjs

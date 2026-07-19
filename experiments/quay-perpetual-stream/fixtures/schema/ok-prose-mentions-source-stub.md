---
id: FIX-OK-PROSE-MENTIONS
title: "False-positive guard: marked+conformant despite prose mentioning Source / Status mirror / dirFile"
status: todo
labels:
  - directive
parent: null
children: []
extra:
  schema: "v1"
  dirStatus: pending
---
## Proposal

This fixture is MARKED (extra.schema:"v1") and fully conformant, yet its body contains the exact
tempting text shapes that a naive scaffolding regex would false-positive on. It reproduces the
DIR-009/DIR-010 non-regression case named in FIX #6 / plan-check must-fix 1+2: the check MUST see
these as prose and PASS, never flag them. Detection of dirFile is frontmatter-only, so this prose
mention of extra.dirFile does not fire. The two lines below are copied VERBATIM from
tasks/DIR-009.md:231 and tasks/DIR-010.md:121 — both begin a line with `Status mirror:` (a
line-wrapped backtick fragment spilled to a new line) but END in prose, not a lone status word, so
the whole-line-status-word STATUS_MIRROR_RE does not match them:

Status mirror: ` body line). Design the
authoritative current state.

Status mirror: ` is stuck at `pending` while the file says `resolved`.

The mentions here of the word `Source` mid-sentence (e.g. "the Source of truth is the task"), the
inline `extra.dirFile` reference, and a `See \`backlog.md\`'s … Source … ` fragment are all prose and
must NOT trip the anchored `^Source: \`experiments/` regex.

## Acceptance Criteria

- [ ] a runnable check with an exit code confirms this fixture PASSes (not flagged).

## Definition of Done

- [ ] References the standard DoD clauses in inherited-core.md; proves 7a/7b/7c false-positive safety.

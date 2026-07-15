# Steering directives — mechanism

A **directive** is a persistent, out-of-band note that a human (or an
independent audit session) can drop into this experiment at any time,
without touching any file the currently-running iteration is writing —
and without needing to interrupt or wait for that iteration.

This exists because the experiment already had a narrower version of this
problem solved: each `experiment/iterations/iteration-N.md` ends with a
"Problems identified for next iteration" section, and iteration N+1's
"Context extraction" step reads `iteration-{N-1}.md` in full. That covers
one iteration's own backlog of open questions. It does **not** cover:

- a finding raised by someone *outside* the iteration loop (a human
  observing the repo, or a separate review session) while an iteration is
  live;
- a finding that needs to survive more than one iteration's lookback
  (only `N-1` is guaranteed to be read, not the full history);
- a finding that needs an explicit, auditable accept/defer/reject
  decision, rather than being left to prose that may or may not get
  re-surfaced.

Directives are for exactly that gap. They are not a replacement for
`provenance.md` (per-task evidence, source of σ) or `audits/` (G3
out-of-band co-sign) — they are a third, orthogonal artifact class:
**external input**, where those two are **output** (state) and
**verification** (of output), respectively.

## Lifecycle (one-time consumed)

```
pending/DIR-NNN-slug.md   →  (read + acted on by some iteration)  →  archive/DIR-NNN-slug.md
```

1. Anyone (human, this session, a future independent-audit session) may add
   a file to `pending/` at any time. It must not touch files an
   in-progress iteration is actively writing (`tasks/`, `provenance.md`,
   `audits/`, `iterations/iteration-N.md` for the live N) — directives are
   additive, never edits to those.
2. Every iteration's §0 preconditions checklist (`ITERATION-PROMPTS.md`)
   requires listing `pending/` at iteration start — mechanically (`ls`),
   not from memory.
3. For each pending directive, the iteration must reach one explicit
   outcome, recorded in that iteration's own report (mirroring how
   `provenance.md` entries are computed, not asserted):
   - **applied** — acted on this iteration; report cites the `DIR-id` and
     the specific evidence of what was done.
   - **deferred** — not this iteration, with a stated reason; the file
     stays in `pending/`, with a dated progress note appended (it must not
     silently sit unchanged run after run).
   - **rejected** — a reasoned decision not to act on it at all.
4. On **applied** or **rejected**, `git mv` the file to `archive/` and
   append a `## Resolution` section (resolved_by iteration, outcome,
   evidence pointer). Never delete — the archive is the audit trail.
   **deferred** stays in `pending/`.

## File format

```markdown
# DIR-NNN

- status: pending | applied | deferred | rejected
- created_by: human (name) | iteration-N (self-raised)
- created_at: YYYY-MM-DD
- title: one line

## Finding
(the concrete observation/evidence — not a vague impression)

## Requested action
(a specific, checkable action — not "consider this")

## Resolution (added when moved to archive/, or updated in place if deferred)
- resolved_by: iteration-N
- outcome: applied | deferred | rejected
- evidence: pointer to the iteration report section / commit / test output
```

## Relationship to the experiment's guardrails (G1-G6, protocol §6)

Directives introduce a new risk class the existing guardrails don't cover:
an iteration silently absorbing an external directive into its own
"autonomous strategy formation," which would corrupt the G4 fixpoint test
— reproducing v_n with v_{n-1} is not comparable if v_{n+1} was actually
steered by an external note that won't be present on a later reproduction
attempt. A candidate guardrail (**G7 — steering directives are visible
interventions, not silent autonomous decisions**) has been discussed but
is **not yet ratified** into `docs/proposal/quay-bootstrap-experiment.md`.
Until it is (via the protocol's own §10 resolved-decisions process), this
README's lifecycle rules are the operational discipline; do not treat them
as an already-ratified protocol guardrail.

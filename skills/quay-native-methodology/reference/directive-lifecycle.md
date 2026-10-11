# Directive mechanism and lifecycle

Source: `experiments/quay-native-bootstrap/directives/README.md`, `experiments/quay-native-bootstrap/directives/{pending,archive}/`.

## Why it exists

A directive is a persistent, out-of-band note a human (or an independent
audit session) can drop into a running experiment at any time, without
touching any file the currently-running iteration is writing, and without
interrupting or waiting for that iteration. It fills a gap the existing
"iteration N+1 reads iteration N-1's report" convention does not cover:

- a finding raised by someone *outside* the iteration loop while an
  iteration is live;
- a finding that needs to survive more than one iteration's lookback;
- a finding needing an explicit, auditable accept/defer/reject decision,
  rather than prose that may or may not get re-surfaced.

Directives are a **third, orthogonal artifact class**: external input,
where `provenance.md` is output/state and `audits/` is verification of
output.

## Lifecycle (one-time consumed)

```
pending/DIR-NNN-slug.md  →  (read + acted on by some iteration)  →  archive/DIR-NNN-slug.md
```

1. Anyone may add a file to `pending/` at any time. Directives are
   additive — never edits to `tasks/`, `provenance.md`, `audits/`, or a
   live iteration's own report file.
2. Every iteration's start-of-run preconditions checklist requires listing
   `pending/` mechanically (`ls`), not from memory.
3. For each pending directive, the iteration must reach one explicit,
   recorded outcome:
   - **applied** — acted on this iteration; cites the DIR-id and specific
     evidence of what was done.
   - **deferred** — not this iteration, with a stated reason; stays in
     `pending/` with a dated progress note appended (must not silently sit
     unchanged run after run).
   - **rejected** — a reasoned decision not to act on it at all.
4. On **applied** or **rejected**, `git mv` to `archive/` and append a
   `## Resolution` section (resolved_by iteration, outcome, evidence
   pointer). Never delete — archive is the audit trail. **deferred** stays
   in `pending/`.

## Extracted state at extraction time (iteration 88)

- `archive/`: 24 resolved directives (DIR-001 through DIR-020, DIR-022
  through DIR-024 — DIR-021 excluded, see below).
- `pending/`: 2 directives, both concerning the same underlying question
  at different scopes:
  - `DIR-021` — iterations must themselves run a fresh manda
    nested-subagent trial.
  - `DIR-025` — actively explore and adopt manda nested-subagent dispatch
    for *concurrent* work.
  Both remain genuinely `pending` as of iteration 88 — not silently
  abandoned, but not yet resolved one way or another. `DIR-012`'s
  narrower, original question (which mechanism G3 audit dispatch means)
  is already archived/resolved (deferred — manda did not complete
  reliably as a G3 dispatch primitive, 7/7 timeouts as of iteration 68);
  that resolution stands independent of DIR-021/025's newer, narrower
  concurrent-work question.

## Consuming-scope guidance

- Reuse the `pending/` → `archive/` convention verbatim for any new
  experiments/quay-native-bootstrap/scope that wants an out-of-band steering channel.
- Do not silently carry `DIR-021`/`DIR-025` forward as "resolved" or
  "adopted" — the v2 proposal's own precondition 5 explicitly requires
  resolving them (applied/deferred/rejected) before assuming manda
  nested-subagent dispatch as standing practice in a new scope.
- The one-time-consumed discipline (never edit a live iteration's files
  directly) is the load-bearing property — preserve it even if the
  consuming scope's directory layout differs.

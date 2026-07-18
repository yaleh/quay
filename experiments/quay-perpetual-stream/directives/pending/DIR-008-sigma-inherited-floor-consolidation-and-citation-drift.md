# DIR-008

- status: pending
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-18
- title: σ-inherited-floor trap never consolidated — VT₀'s uncritical carry-forward from exp4 already cost a silent −6.60 correction at m4; plus a lighter citation-drift instance (manda reliability envelope re-derived instead of cited)

## Finding

Following DIR-006 (Web UI browser-verification regression) and DIR-007 (G3
adversarial-audit-role weakening), a further check of exp5's kickoff
"delta chain" (`inherited-core.md`, first commit `8b994f8`) found that its
**"Known weakness ... First consolidation target"** clause explicitly named
THREE φ edges to merge into a single authoritative core: "§0c visual-review;
dispatch/G3 discipline; σ-floor handling." The first two are now DIR-006 and
DIR-007. This directive covers the third, plus one related lower-severity
instance of the same drift pattern.

1. **σ-inherited-floor trap — never consolidated, and it already bit.**
   `.claude/skills/quay-core-bootstrap-methodology/reference/
   sigma-inherited-floor-trap.md` states the general design trap precisely:
   when a new experiment inherits a scoring floor/baseline from a prior
   experiment without an explicit, design-time "reset to 0" vs. "design for
   enough throughput to clear the floor" decision, the inherited baseline
   silently dominates the score until the baseline itself is found to be
   wrong. `inherited-core.md`'s only mention of this concept, to date, is
   the single citation phrase "σ-floor handling" in its own kickoff-commit
   "known weakness" line — no expanded, operational content exists anywhere
   in the current `inherited-core.md`.

   exp5's own `VT₀ = 82.25` was set directly from exp4's `gap-list.md`
   "Closed" claims, with no explicit reset-vs-carry-forward decision ever
   recorded. This is structurally the same shape as the σ_strict trap
   (inheriting a prior experiment's baseline uncritically). The trap fired
   for real at m4: M04-discover's live persona pass found exp4's "Closed"
   claims were systematically overstated (MD-001 merge-drift), producing
   exp5's first genuine VT decrease (101.33→94.73/120, Δv=−6.60,
   `dashboard.md`'s own VT curve log for m4) — discovered only after the
   fact, not anticipated by a design-time check the way the older document's
   own "Consuming-scope guidance" section recommends doing before
   committing to an experiment's scope.

   The same uncritical-inheritance question applies, unanswered, to every
   subsequent chart transition (chart-0→chart-1 at m3 carried the 5 original
   surfaces 1:1 "out of scope," per `dashboard.md`'s m3 log) and to any
   future milestone that re-scores from another still-uncritically-inherited
   number.

2. **Lower-severity companion instance — manda reliability envelope
   re-derived instead of cited.** `.claude/skills/quay-core-bootstrap-
   methodology/reference/manda-reliability-envelope.md` already
   characterizes manda's dispatch-timing envelope and underlies exp4/5's
   **narrower, structural rule from DIR-020**: a session must never
   synchronously call manda's `Agent`/`Dispatch`/`request` as the caller
   side of its OWN bound-broker channel (self-deadlock — the session would
   block its own turn and be unable to service its own incoming
   cap-request); DIR-015/016/024 extend this by requiring background
   dispatch for iteration/audit/broker-spawn paths specifically. **This is
   not a blanket ban on manda dispatch** — corrected here after the human
   flagged, live in this conversation, that it applies to nested/
   result-dependent subagent dispatch, not to fire-and-forget paths.
   `packages/quay/src/action.js`'s Action Button delivery
   (`manda-dispatch submit ... --async`, never waits on or checks a
   result) is structurally outside DIR-020's scope entirely and remains a
   legitimate, currently-working use of manda. The just-drafted
   `docs/proposals/exp5-concurrent-background-agents-for-milestone-
   iteration.md` reaches a compatible conclusion for the nested-dispatch
   case it examines ("this is the native Agent/Task mechanism, not manda
   ... the old mechanical reason to avoid parallel dispatch is therefore
   gone") but does so via a fresh live re-verification, with zero
   reference to the existing envelope document or DIR-020's precise scope.
   The conclusions happened to be compatible this time, but the
   rediscovery — and this directive's own initial overstatement of the
   rule as a blanket ban, corrected above — is direct, live evidence that
   the kickoff commit's own disclosed risk ("citations can drift") is a
   real, currently-recurring friction, not a hypothetical one.

## Requested action

1. Perform an explicit reset-vs-carry-forward design decision for `VT₀`
   (and any other still-live inherited baseline, e.g. chart-transition
   carry-forwards) — per `sigma-inherited-floor-trap.md`'s "Consuming-scope
   guidance" — and record the decision and its rationale in
   `inherited-core.md`, not just as a citation.
2. Actually consolidate the σ-inherited-floor trap into `inherited-core.md`
   as operational content (not a bare citation phrase), completing the
   third of the three items the kickoff commit itself named as the "first
   consolidation target."
3. Audit for any OTHER still-uncritically-inherited baseline in exp5 beyond
   VT₀ (e.g., any health-track starting value, any carried-over cov number)
   and record an explicit disposition for each.
4. Decide whether a lightweight standing practice is warranted — e.g., a
   quick grep/check of the existing methodology-skill delta chain before
   drafting a new cross-cutting proposal or charter section — to reduce
   avoidable re-derivation like finding 2 above. Scope and cadence left to
   the disposing iteration's judgment; this is a minor finding, not a
   blocking one.
5. When consolidating the manda-dispatch discipline into `inherited-core.md`
   (action 4, or as part of action 2's broader consolidation pass), state
   the rule at its correct, narrow scope — DIR-020's self-deadlock
   condition plus DIR-015/016/024's background-dispatch requirement for
   result-dependent/nested paths — not as a blanket "never use manda."
   Explicitly note that fire-and-forget, non-result-checking dispatch
   (e.g. Action Button's `manda-dispatch submit --async`) is unaffected and
   remains a valid use, so future milestones don't have to re-derive this
   distinction from scratch either.

## Resolution

<!-- to be filled in by whichever iteration applies this directive -->

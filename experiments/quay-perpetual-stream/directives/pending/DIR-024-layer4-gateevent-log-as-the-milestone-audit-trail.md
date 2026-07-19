# DIR-024

- status: pending
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-19
- title: Layer 4 of switching exp5 onto the quay engine — make the engine's GateEvent log (`quay gate-log`) the queryable per-milestone audit trail: a real milestone's gate verdicts are reconstructable from `quay gate-log <its-task>` alone (real GateEvents), and the dashboard ABSORB entry references the log rather than only restating verdicts as prose

## Finding

exp5 records gate verdicts as dashboard.md PROSE. The engine's GateEvent log
(`quay gate-log`, QENG-1) exists but is not exp5's audit trail — with Layers 1-3 the
verdicts get LOGGED as GateEvents, but the dashboard prose remains the system of
record and the log is incidental. The audit trail should be the machine-queryable
log, not prose that can drift from what actually ran (the exact drift class this
whole program fights).

## Requested action

1. **Dashboard references the log.** `OUTER-LOOP.md` step 6/7: each milestone's
   ABSORB entry cites `quay gate-log <milestone-task>` as the source-of-record for
   its gate verdicts (link/quote the GateEvents), instead of (or in addition to)
   free-prose "gate X: PASS" claims.
2. **Log completeness.** Ensure every gate run at a milestone's ABSORB appends a
   GateEvent (follows from DIR-021/022), so `quay gate-log <task> --json` returns the
   FULL verdict history for that milestone — nothing verdict-bearing lives only in
   prose.

## Acceptance Criteria (runnable)
- [ ] For a real milestone, `quay gate-log <its-task> --json` returns the full set of
  gate verdicts run at its ABSORB (one GateEvent per applicable gate).
- [ ] `grep` its dashboard ABSORB entry: it references `quay gate-log <task>` as the
  verdict source-of-record (not only free prose).

## Definition of Done — REAL LANDING is the bar, not artifacts

**NOT done** when the log mechanism exists (it already does). Done **ONLY** when a
**REAL exp5 milestone's audit trail is reconstructable from `quay gate-log
<its-task>` ALONE** — i.e. every gate verdict that milestone's ABSORB claims is
present as a real GateEvent keyed to its task id — AND the dashboard entry defers to
the log as source-of-record. If any claimed verdict exists only in dashboard prose
with no corresponding GateEvent, it is NOT landed. Stays `pending` until a real
milestone's verdicts fully live in the log.

**Anti-"thin log" clause (depends on Layer 2's completeness).** "Reconstructable from
the log ALONE" is only real if the milestone actually RAN a full gate set — a milestone
that logged only a single `dod` GateEvent trivially satisfies "every claimed verdict is
in the log" while proving nothing. This DIR is landed only on a milestone whose log
carries the SAME multi-gate set [[DIR-022]] requires (≥2 distinct non-`dod` GateEvents),
so the "log is the audit trail" claim is tested against a real, non-trivial verdict set —
not a one-line log. Layer 4 presupposes [[DIR-021]]/[[DIR-022]]/[[DIR-023]]'s real landing
on that same milestone.

## Human verification when exp5 marks this DIR done
1. Pick a real milestone ABSORBed under this DIR. Cross-check its dashboard-claimed
   gate verdicts against `quay gate-log <its-task> --json` — every claimed verdict
   MUST have a matching GateEvent.
2. The dashboard entry MUST point to the gate-log as source-of-record.
3. If verdicts are still prose-only (no GateEvents), or the log is empty for that
   real milestone, it is NOT landed — send back.

## Resolution
<!-- added when moved to archive/, or updated in place if deferred -->

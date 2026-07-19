# V_meta Insight Ledger (fixture: over-threshold, unconsolidated, NO dated carry-forward → ALARM/FAIL)

<!--
milestone_counter: 6
Row below is `confirmed` at m3, milestone_counter=6 → milestones-since-confirmed = 6 − 3 = 3 > K=2,
status is NOT consolidated, and the status cell carries NO dated carry-forward reason. Must FAIL.
-->

## Rows

| insight | origin milestone | confirmation count | status |
|---|---|---|---|
| CI-job≡audit-channel pattern | m1 (M01-dist) | 2 — confirmed@m3 (2nd cross-domain confirmation) | confirmed — past φ threshold, folding into inherited-core.md still pending |

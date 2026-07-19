# V_meta Insight Ledger (fixture: past threshold BUT dated carry-forward → PASS)

<!--
milestone_counter: 6
Row is past threshold (confirmed@m3, lag = 6 − 3 = 3 > K=2) and NOT consolidated, BUT the status
cell carries an explicit DATED carry-forward reason (a YYYY-MM-DD date). No silent deferral → PASS.
-->

## Rows

| insight | origin milestone | confirmation count | status |
|---|---|---|---|
| CI-job≡audit-channel pattern | m1 (M01-dist) | 2 — confirmed@m3 | confirmed — carry-forward 2026-07-19: inherited-core §4.2 rewrite blocked on D3 R7; re-evaluate next ABSORB |

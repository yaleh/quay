# V_meta Insight Ledger (fixture: within threshold → PASS)

<!--
milestone_counter: 4
Row is `confirmed` at m3, milestone_counter=4 → milestones-since-confirmed = 4 − 3 = 1 <= K=2.
Within threshold, no carry-forward needed. Must PASS.
-->

## Rows

| insight | origin milestone | confirmation count | status |
|---|---|---|---|
| CI-job≡audit-channel pattern | m1 (M01-dist) | 2 — confirmed@m3 | confirmed — past φ threshold, not yet consolidated |
| repo-root isolation-leak lesson | m3 (M03-abi-eval) | 1 (m3 only) | proposed — noted, never applied |

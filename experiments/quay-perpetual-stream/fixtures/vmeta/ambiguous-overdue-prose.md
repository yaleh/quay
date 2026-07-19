# V_meta Insight Ledger (fixture: overdue row phrased "not consolidated yet, still confirmed" → FAIL)

<!--
milestone_counter: 40
R5 review must-fix #1 (fail-open): the status cell names BOTH 'consolidated' (negated: "not
consolidated") and 'confirmed'. It is a genuinely confirmed-not-consolidated OVERDUE row. rowStatus
must read the first NON-NEGATED word = confirmed → the arithmetic runs (40 − 3 = 37 > K=2) → ALARM.
It must NOT be silently read as consolidated by an unordered keyword scan.
-->

## Rows

| insight | origin milestone | confirmation count | status |
|---|---|---|---|
| CI-job≡audit-channel pattern | m1 (M01-dist) | 2 — confirmed@m3 (2nd cross-domain confirmation) | not consolidated yet, still confirmed — fold into inherited-core.md pending |

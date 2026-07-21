# V_meta Insight Ledger (fixture: bare prose status "not consolidated yet, still confirmed" → FAIL)

<!--
milestone_counter: 40
M70/D4 (ADR-004 structured field): the status cell does NOT start with a structured [tag] token.
rowStatus → null → fail-closed ALARM → FAIL. Under the structured-field rule, any prose status
(negated, ambiguous, or keyword-less) that omits the [tag] prefix is uniformly fail-closed.
-->

## Rows

| insight | origin milestone | confirmation count | status |
|---|---|---|---|
| CI-job≡audit-channel pattern | m1 (M01-dist) | 2 — confirmed@m3 (2nd cross-domain confirmation) | not consolidated yet, still confirmed — fold into inherited-core.md pending |

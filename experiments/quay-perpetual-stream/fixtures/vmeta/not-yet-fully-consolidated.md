# V_meta Insight Ledger (fixture: "not yet fully consolidated" — bare prose, no [tag] prefix → FAIL)

<!--
milestone_counter: 40
M70/D4 (ADR-004 structured field): the status cell does NOT start with a structured [tag] token.
rowStatus → null → fail-closed ALARM → FAIL. Previously this "not yet fully consolidated" phrasing
defeated the R5 leading-token heuristic; the structured [tag] rule uniformly rejects all non-[tag]
prose regardless of content.
-->

## Rows

| insight | origin milestone | confirmation count | status |
|---|---|---|---|
| CI-job≡audit-channel pattern | m1 (M01-dist) | 2 — confirmed@m3 (2nd cross-domain) | not yet fully consolidated, confirmed@m3 — fold into inherited-core.md pending |

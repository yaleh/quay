# V_meta Insight Ledger (fixture: bare prose status, no [tag] prefix → FAIL-closed)

<!--
milestone_counter: 40
M70/D4 (ADR-004 structured field): the status cell carries no structured [tag] prefix. rowStatus →
null → fail-closed ALARM → FAIL. All prose status cells (keyword-less or otherwise) without a
[consolidated]/[confirmed]/[proposed] leading tag are uniformly rejected.
-->

## Rows

| insight | origin milestone | confirmation count | status |
|---|---|---|---|
| repo-root isolation-leak lesson | m3 (M03-abi-eval) | 2 — confirmed@m3 | folding into inherited-core.md is still pending |

# V_meta Insight Ledger (fixture: overdue row with a keyword-less status cell → FAIL-closed)

<!--
milestone_counter: 40
R5 review must-fix #2 (fail-open): the status cell carries NO non-negated lifecycle word
(proposed/confirmed/consolidated) at all. rowStatus → null; a data row that cannot be classified must
FAIL-closed (never silent-skip to PASS), not drop to status=null and pass.
-->

## Rows

| insight | origin milestone | confirmation count | status |
|---|---|---|---|
| repo-root isolation-leak lesson | m3 (M03-abi-eval) | 2 — confirmed@m3 | folding into inherited-core.md is still pending |

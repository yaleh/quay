# V_meta Insight Ledger (fixture: "not yet fully consolidated" — the re-review's most-damaging fail-open → FAIL)

<!--
milestone_counter: 40
R5 re-review: "not yet fully consolidated, confirmed@m3" (TWO qualifier words "yet"+"fully") defeated
the earlier negation heuristic and silently PASSed. The status cell does NOT lead with a clean
lifecycle token (it leads with "not") → rowStatus returns null → fail-closed ALARM → FAIL.
-->

## Rows

| insight | origin milestone | confirmation count | status |
|---|---|---|---|
| CI-job≡audit-channel pattern | m1 (M01-dist) | 2 — confirmed@m3 (2nd cross-domain) | not yet fully consolidated, confirmed@m3 — fold into inherited-core.md pending |

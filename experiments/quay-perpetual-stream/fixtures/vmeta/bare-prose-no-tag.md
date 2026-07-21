# V_meta Insight Ledger (fixture: bare "consolidated (m7)" prose without [tag] prefix → FAIL)

<!--
milestone_counter: 9
M70/D4 (ADR-004 structured field): the status cell reads `consolidated (m7)` — syntactically a valid
lifecycle word followed by a note, which the OLD leading-token heuristic would have read as
"consolidated" (→ PASS). Under the NEW structured [tag] rule this is fail-closed: the cell does NOT
start with `[consolidated]` or `**[consolidated]**`, so rowStatus → null → ALARM → FAIL.
This is the canonical RED fixture demonstrating the hard fix closes the prose-leading-token residual.
-->

## Rows

| insight | origin milestone | confirmation count | status |
|---|---|---|---|
| CI-job≡audit-channel pattern | m1 (M01-dist) | 2 — confirmed@m3 | consolidated (m7) — folded into inherited-core.md |

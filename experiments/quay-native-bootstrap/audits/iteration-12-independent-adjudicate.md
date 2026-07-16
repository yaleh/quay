# Iteration 12 — Independent Out-of-Band Audit (G3)

**Auditor:** fresh `general-purpose` subagent, zero prior context, instructed not to read the same-session self-check, and instructed that DIR-001/002/003's authenticity is already closed (by direct human confirmation) — not to be re-litigated.

**Verdict: PASS-WITH-CONCERNS**

## Findings

1. **Effectiveness "permanent ceiling" reasoning** — sound, not evasive. Protocol's own definition matches the report's framing; QN-006 genuinely is the sole seed-era data point; iteration 5's prior timing-comparison attempt is accurately cited as precedent, not fabricated. The QN-026-as-counterexample timeline checks out exactly (drift introduced iteration 10, undetected through iteration 11, caught iteration 12 — genuinely 2 iterations of drift). No obviously superior untried idea found.

2. **QN-026 DESIGN.md drift fix** — real and substantive. Confirmed genuine pre-fix contradiction (DESIGN.md said "read-only"/`data.write: false` while `provider.yml` already said `data.write: true` since iteration 10). Fix is accurate and evidenced; provenance.md corroborates fully-native lifecycle.

3. **quay-github gate/skill manda-dispatch probe** — technically true and independently reproduced (async submit → queued forever, no executor claims it, clean cancel), but under-documented: no timing-log checkpoint for this step, zero mention in the same-session adjudicate self-check, and the report's CLI transcript syntax doesn't match the real tool's actual flags — suggesting the transcript was reconstructed after the fact rather than captured verbatim. The conclusion is correct; the evidentiary trail is thinner than implied.

4. **σ arithmetic** — CONFIRMED EXACTLY. 25 task files; 18/25=0.72, 24/25=0.96.

5. **V_instance/V_meta flat claim** — CONFIRMED. All 8 component factors byte-identical between iteration-11.md and iteration-12.md.

6. **Test suites** — all green, zero regressions, all 10 counts match baseline; QN-026 correctly added no new test (docs-only).

## Net assessment
No fabrication found. One process gap: the manda-dispatch re-confirmation (item 3) should have been logged with a timing checkpoint and cross-checked in the same-session self-check, and its transcript should be verbatim rather than reconstructed. Recommend iteration 13 tighten this practice for any future "we re-tested X and confirmed" claims — capture raw output, don't paraphrase.

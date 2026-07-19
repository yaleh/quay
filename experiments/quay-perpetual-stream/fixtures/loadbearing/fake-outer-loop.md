# FIXTURE OUTER-LOOP (loadbearing gate)

A stand-in for OUTER-LOOP.md. The gate splits this doc into bullet BLOCKS and detects criterion (c):
a scripts/*.mjs basename that appears in the SAME bullet block as a `milestone_counter++` token —
even when the reference and the token WRAP onto different physical lines (the realistic case).

   - **Consolidation-lag gate (HARD-BLOCKS step 7's**
     `milestone_counter++`): the single-source check is `scripts/fixture-counter-gate.mjs`; a non-zero
     exit blocks the increment. (Reference and token are on DIFFERENT wrapped lines of ONE bullet.)

Outside any bullet, the standalone script `scripts/fixture-standalone.mjs` is mentioned in this plain
paragraph, which also happens to contain the `milestone_counter++` token — but it is NOT a bullet
block, so the gate must NOT treat fixture-standalone as a counter-gate.

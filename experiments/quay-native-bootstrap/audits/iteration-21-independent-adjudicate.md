# Iteration 21 — Independent Out-of-Band Audit (G3)

**Auditor:** fresh `general-purpose` subagent, zero prior context. Had `gh` CLI/network access and ran all tests/scripts directly.

**Verdict: PASS** (with one minor process note, not affecting the substantive verdict)

## Findings

1. **`serve.test.mjs` genuinely demonstrates its claims, confirmed by direct execution and independent reproduction of the break/restore cycle.** Ran the test directly: exit 0, all 17 assertions pass, exercising GET / (list), GET /task/<id> (detail + button), a negative control (button absent for non-matching status), GET /task/<nonexistent> (404), POST .../action/... (302), and composePayload() unit checks — all against a real running server and a real `quay-native mcp` child process. The auditor found the working tree already contained the break/restore cycle's "broken" mutation left uncommitted (residue from the iteration's own live adversarial test); running the test in that state produced exactly one FAIL (the negative-control assertion) as claimed; restoring via `git checkout` returned it to 17/17 pass with a clean diff. **Minor process note**: this uncommitted residue should have been cleaned up before session handoff — a working-tree hygiene gap, not a substantive integrity issue, since the committed artifact itself (verified via `git show f85641a`) is correct.

2. **`serve.js`'s `server.client = client` extension confirmed a pure addition.** `git show f85641a` shows a 6-line addition only, at the end of `startServer()`. All callers of `startServer` repo-wide confirmed to be only `bin/quay.js`'s `serve` subcommand and the new test. Live-tested `quay serve` against a throwaway workspace: GET / and GET /task/<id> both still return 200 as before.

3. **`effectiveness` timing comparison: honest framing, generously-scored credit.** Both `experiments/quay-native-bootstrap/timing/iteration-0.log` (tracked) and `experiments/quay-native-bootstrap/timing/iteration-21.log` (confirmed gitignored, exists on disk, not fabricated) independently read; timestamps recomputed exactly as claimed (2m59s vs. 4m11s-4m51s). The report's core claim ("this is NOT a demonstrated speedup") is accurate and not spun. However, the auditor judges the resulting +0.04 score as on the generous side of what the evidence supports — the comparison is an apples-to-oranges eyeball estimate, and the only concrete number available (raw elapsed time) points the opposite direction from the credited score. The auditor characterizes this as a defensible-but-favorable, transparently-disclosed judgment call, not fabrication or a G1/G2 violation — reasonable people could argue for 0.00 instead of +0.04.

4. **Reusability re-check confirmed accurate.** Live `gh issue list --repo yaleh/quay`: exactly 2 primitive issues (#3, #4), matching the report.

5. **Regression suite confirmed 15/15 green** (the 2 non-standalone helper scripts correctly excluded from the count, consistent with established convention). `abi-symmetry.mjs` confirms all four surfaces symmetric.

6. **σ/V arithmetic confirmed exactly.** 30 task files. σ_strict=23/30=0.7667, σ_inclusive=25/30=0.8333, V_instance=0.62×0.94×0.76×0.94=0.4164, V_meta=0.74×0.24×0.68×0.64=0.0773 — all recompute exactly.

7. **Scope confirmed clean.** `git show --stat f85641a`: exactly 5 files (iteration-21.md, provenance.md, serve.js +6 lines, serve.test.mjs +184, QN-031.md +160). `experiments/quay-native-bootstrap/timing/iteration-21.log` confirmed gitignored and absent from all commits, correctly not staged.

8. **Convergence criterion 5's reset logic confirmed consistent** with the traceable lineage through iterations 16, 17, 20 — not a one-off reinterpretation.

9. **`experiments/quay-native-bootstrap/directives/pending/` confirmed empty.**

10. **Independent diligence check**: no undisclosed scope, no self-dispatch attempts, no recurrence of the G1 backfilling anti-pattern. The `skeleton` +0.02 vs. `gate_correctness`'s prior +0.01 differential reasoning (fully-closable gap vs. permanent architectural boundary) is internally consistent and correctly cross-referenced against iteration 20's own rationale.

## Net assessment
All ten checklist items check out against primary evidence independently reproduced, not merely re-read. The one non-trivial finding (uncommitted break/restore residue in the working tree at audit start) turned out to be a faithful accident that let the auditor directly reproduce the claimed adversarial behavior, while surfacing a minor session-hygiene gap worth flagging for future iterations (`git status --short` clean before ending a session). The `effectiveness` scoring is the one item the auditor would push back on under a stricter gate — honest interpretation, but a favorable-leaning +0.04 relative to what the raw numbers alone support. Nothing rises to the level of fabrication, undisclosed scope, or metric inflation warranting a FAIL.

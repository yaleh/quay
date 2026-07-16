# Iteration 25 — Independent Out-of-Band Audit (G3)

**Auditor:** fresh `general-purpose` subagent, zero prior context. Had `gh` CLI/network access and ran all tests/scripts and live GitHub round-trips directly. Special scrutiny applied to all 8 points named in iteration-25.md's own §9, given this iteration's claim of the largest-ever single-iteration V_instance/V_meta jump.

**Verdict: PASS WITH CONCERNS** — mechanical/factual claims all independently reproduce exactly; the `gate_correctness` (+0.10) increment is a genuine scoring error (double-counts evidence that belongs to `reusability` alone), contradicted by this project's own iteration-17 precedent for identical-kind work.

## Findings

1. **`childrenStatus()` port fidelity — VERIFIED, faithful.** Direct side-by-side read of `store.js#childrenStatus()` and `github-client.js`'s port confirms identical cycle-safety mechanism (copy-not-mutate `visited` Set) and identical `stale-done` rollup condition, differing only in the injected fetcher. No semantic divergence.

2. **`compound-gate.test.mjs`'s 24 assertions — VERIFIED, genuine.** Independently run: 24/24 pass. All claimed cases confirmed present by direct file inspection, including Case 8's no-`getChildTask`-argument primitive-task non-regression check.

3. **GitHub issues #5/#6/#7 — VERIFIED, existent and live-reproduced.** `gh issue view` confirms exact titles/states/labels. Independently reproduced the adversarial reopen(#6)→`ok:false`/exit 1→re-close(#6)→`ok:true` cycle against live state, exactly matching the claimed transcript. State fully restored, zero net GitHub side effect.

4. **Core-passthrough byte-identical claim — VERIFIED** by independently running both commands and diffing stdout (identical; the extra passthrough banner line goes to stderr, not stdout, so the "byte-identical stdout" framing is precise).

5. **Issues #1-#4 untouched — CONFIRMED** against live `gh issue list` and iteration-24's own audited snapshot.

6. **`gate_correctness` (+0.10) and `reusability` (+0.11) proportionality — CONCERN, real overclaim on `gate_correctness`.** `reusability`'s +0.11 is plausible and honestly hedged (report notes it's partial-transfer-only pending a third Provider). But `gate_correctness` is protocol-defined (§5.1) as scoped to native's own gate module. `git diff` confirms **zero changes to `packages/quay-native/` this iteration** — identical in kind to QN-028 (iteration 17), where the project's own report explicitly held `gate_correctness` flat with the reasoning: *"No change to `store.js`'s gate logic this iteration... the new work is entirely on `quay-github`'s side"* — crediting `reusability` alone (+0.05) for that class of work. Iteration 25 does the same kind of work (a quay-github-only gate/children-recursion port, again zero `store.js` diff) but this time moves **both** `gate_correctness` and `reusability`, double-counting one underlying fact (a second Provider's gate capability now matches native's) across two factors the protocol's product design intends to keep independent. Recomputing with `gate_correctness` correctly held at 0.76 (per the iteration-17 precedent): V_instance = 0.65 × 0.94 × 0.76 × 0.94 = 0.4365 — **unchanged from iteration 24**, not the claimed +0.0576 jump. The report itself flagged this exact risk for scrutiny ("the most judgment-laden, least mechanically-checkable claim") but did not check it against the directly-on-point iteration-17 precedent (it compared only to iterations 6/7, an inapposite comparator — native's own founding work, not a second-Provider port).

7. **DIR-006 Resolution honesty — VERIFIED, honest.** The archived directive's `## Resolution` section correctly scopes its claims and does not overclaim that `executeEpic`'s own Skill-level orchestration was run end-to-end — it precisely notes the gate dependency was fixed and defers the fuller characterization to iteration-25.md §10.

8. **`git status --short` clean — CONFIRMED**, both independently and after the auditor's own live GitHub round-trip (no local git footprint from a GitHub-side reopen/close).

9. **Regression suite confirmed 18/18 green** (all quay-native + quay-github + quay test files), plus `abi-symmetry.mjs` independently re-run: "ALL FOUR SURFACES SYMMETRIC."

10. **Zero unrelated source changes** — `git show 004adb3 --stat` touches exactly the 7 files the report claims (DIR-006 archive, iteration-25.md, provenance.md, quay-github DESIGN.md, github-client.js, compound-gate.test.mjs, QN-035.md).

11. **σ/V arithmetic recomputed exactly** from provenance.md's own counts: σ_strict = 27/34 = 0.7941, σ_inclusive = 29/34 = 0.8529, σ_author_only = 33/34 = 0.9706 — all match. V_meta = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973 — matches exactly (this factor's movement, `reusability`, is judged sound above).

12. **`experiments/quay-native-bootstrap/directives/pending/` is not empty** — DIR-006 correctly moved to `archive/`, but a new directive `DIR-007-implement-core-mcp-server.md` now sits in `pending/` (committed before iteration 25's own commit). This is outside DIR-006's scope, correctly not addressed by iteration 25, and is queued for iteration 26. Minor timeline note, not a finding against iteration 25.

## Net assessment

Every mechanically-checkable claim in this iteration — port fidelity, test coverage, live GitHub fixtures and adversarial regression test, byte-identical passthrough, untouched pre-existing issues, regression suite, git hygiene, σ arithmetic, and DIR-006's honest self-representation — independently reproduces exactly as claimed. No fabrication and no undisclosed scope. However, the `gate_correctness` +0.10 increment does not survive scrutiny against this project's own iteration-17 precedent for identical-kind work (a second-Provider-only gate port with zero `store.js` change): that increment double-counts evidence that belongs to `reusability` alone, per the protocol's own factor definitions. Correcting `gate_correctness` back to 0.76 (flat) yields V_instance = 0.4365, unchanged from iteration 24 — meaning this iteration's true V_instance movement is **zero**, with all genuine credit properly concentrated in V_meta's `reusability` factor (+0.0136 net V_meta gain, which stands as scored). This is not a fabrication finding — it is exactly the kind of judgment-laden scoring error G3 exists to catch — but it should be corrected in the record rather than merely noted, since a future reader relying on provenance.md/iteration-25.md's claimed "+0.0576, largest V_instance jump in the experiment's history" would be relying on a materially incorrect figure.

## Required correction

Iteration 26 (or a same-day amendment) must correct `gate_correctness` to 0.76 (flat, unchanged from iteration 24) and restate ΔV_instance = 0.0000 for iteration 25, with a note explaining the correction and citing this audit plus the iteration-17 precedent it is grounded in.

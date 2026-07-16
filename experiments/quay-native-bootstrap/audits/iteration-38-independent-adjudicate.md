# Iteration 38 — Independent Out-of-Band Audit (G3)

**Auditor:** fresh, zero-prior-context out-of-band review. Read
`docs/proposal/quay-bootstrap-experiment.md` in full, `experiments/quay-native-bootstrap/iterations/
iteration-38.md` in full, `experiments/quay-native-bootstrap/iterations/iteration-25.md` and
`experiments/quay-native-bootstrap/iterations/iteration-29.md` in full (iteration 38's cited
precedents), the relevant `experiments/quay-native-bootstrap/provenance.md` sections (the
iteration-25 `gate_correctness` post-hoc correction, the iteration-29
`completeness` post-hoc correction, the iteration-29 audit that produced it,
iteration 12's QN-026 `DESIGN.md`-drift record, and iteration 38's own new
sections), and ran all commands/tests/diffs directly against the working
tree, including a full 24-file regression-suite re-run and independent
re-execution of the live `task check gh-7` commands. Special scrutiny
applied, per the audit brief, to whether `completeness` — not a flat hold —
is the correct factor for this documentation-accuracy fix.

**Verdict: PASS** — every headline claim is independently verified accurate.
The precedent citations to iterations 25 and 29 are genuine (both were read
in full and accurately characterized), the mechanical claims (stale-comment
diff, zero `.js` diff, live gate re-verification, task/test counts, git
status) all reproduce exactly, and the all-eight-V-factors-flat conclusion
is correct on the merits — though one closer, non-cited precedent
(iteration 12 / QN-026) exists and is worth naming for completeness, without
changing the correct final answer. Iteration 38 continues iteration 37's
recovery from the session's seven-correction streak; no new overclaim or
misattribution found.

## Findings

1. **Stale-comment claim (`provider.yml`/`DESIGN.md` §5) — VERIFIED, real,
   and now corrected.**
   - `git log --oneline -- packages/quay-github/provider.yml` shows exactly
     four commits before this iteration's own (`95c23e5`): `def5c92`
     (QN-002), `3f3d4d1` (iteration 10), `1f3e27d` (iteration 17), `1edfb1a`
     (iteration 18) — matching the report's claim exactly that the file was
     "untouched since iteration 18," i.e. 20 iterations of subsequent drift.
   - `git show 95c23e5~1:packages/quay-github/provider.yml` confirms the
     pre-fix text: the `gate:` comment literally read *"QN-028 (iteration
     17): task_check, primitive tasks only (no compound/epic
     children-recursion — this experiment has never had a real compound
     GitHub task; ...)"* — the exact stale claim quoted in the report, and
     demonstrably false since iteration 25 (QN-035, DIR-006) implemented and
     live-verified `childrenStatus()`-based compound/epic gate recursion.
   - Current (post-fix) `provider.yml` and `DESIGN.md` text, read directly,
     correctly cites QN-035/iteration 25/DIR-006 and the real `gh-5`/`gh-6`/
     `gh-7` fixture. The claim is real, not fabricated, and genuinely
     closed.

2. **Zero `.js` source diff — VERIFIED.** `git show 95c23e5 --stat`: only
   `packages/quay-github/DESIGN.md` (19 changed), `packages/quay-github/
   provider.yml` (25 changed), `tasks/QN-049.md` (new), plus the iteration
   report and `provenance.md`. `git show 95c23e5 --stat -- '*.js'` returns
   empty. A pure documentation/comment fix, exactly as claimed.

3. **Live re-verification against real issues gh-5/gh-6/gh-7 — VERIFIED,
   genuine and reproduced independently.**
   - `gh issue list --repo yaleh/quay --state all` confirms issues #5, #6,
     #7 exist, all CLOSED, titled `[QN-035-fixture] Child A/B`/`Parent epic`
     exactly as iteration 25 (and this report) describe.
   - Independently re-ran `node packages/quay-github/bin/quay-github.js task
     check gh-7 --json` and `node packages/quay/bin/quay.js task check gh-7
     --provider github --json` myself: both return the identical JSON body
     (`{"id":"gh-7","gate":"none","ok":true,"reason":"terminal",
     "childrenStatus":[{"id":"gh-5","status":"done"},{"id":"gh-6",
     "status":"done"}]}`), matching the report's transcript exactly. (Core's
     passthrough additionally emits one harmless stderr banner line,
     `quay-github mcp: serving tasks from github.com/yaleh/quay (read-only
     v1)`, which does not affect the JSON stdout body and is consistent
     with "byte-identical" being scoped to the JSON result, as every prior
     iteration's analogous claim has meant.)

4. **Full regression suite + `abi-symmetry.mjs` — VERIFIED, unchanged.**
   `find . -name "*.test.mjs" -not -path "*/node_modules/*" | wc -l` = 24,
   matching the report's claim exactly (no new test file this iteration,
   consistent with a docs-only fix). All 24 re-run individually: 24/24 exit
   0. (One transient failure was observed on a first hasty loop-based rerun
   of `provider-env-symmetry.test.mjs` — re-run in isolation, it passes
   cleanly; this is attributable to environmental contention in the
   auditor's own rapid-fire loop, not a real regression, and was confirmed
   by a clean second full pass of all 24 files.) `node packages/quay-native/
   test/abi-symmetry.mjs` reports "ALL FOUR SURFACES SYMMETRIC," unchanged.

5. **All eight V-factors held flat, citing iterations 25/29 — VERIFIED
   accurate citation, correct final conclusion, with one closer precedent
   left uncited (non-disqualifying).**
   - Both iteration 25 and iteration 29 were read in full this audit. Iteration
     38's characterization of each is accurate:
     - Iteration 25's post-hoc `gate_correctness` correction (provenance.md,
       "Post-hoc correction (iteration 25's `gate_correctness` score)")
       genuinely holds that a second-Provider gate-conformance fix with zero
       `store.js` diff does not move `gate_correctness` — protocol §5.1
       scopes that factor to native's own gate module. Iteration 38's QN-049
       touches even less (prose only, zero `.js` diff anywhere) — the
       citation is accurate and, if anything, an a fortiori case.
     - Iteration 29's post-hoc `completeness` correction (independently
       verified against `experiments/quay-native-bootstrap/audits/iteration-29-independent-
       adjudicate.md`, read in full) genuinely establishes, via an
       independent out-of-band audit (not iteration 29's own self-serving
       claim), that `completeness` per protocol §5.2 is scoped to
       `quay:author`/`quay:execute`'s own SKILL.md Method-step content, not
       any other documentation artifact — there, `ITERATION-PROMPTS.md`;
       here, `provider.yml`/`DESIGN.md`. This is a real, audit-verified
       precedent, not a fabricated or selectively-read one, and the mapping
       (Provider self-declaration/design docs are further from
       "quay:author/quay:execute's own methodology" than
       `ITERATION-PROMPTS.md` was) is if anything conservative, not a
       stretch.
   - **Scrutiny of the `completeness` question, per the audit brief.**
     Protocol §5.2's literal text is: *"completeness: Methodology (Skills +
     gates + decomposition rule) fully documented and self-contained."*
     This wording is not perfectly unambiguous on its own — it could be read
     to include any prose describing the methodology's actual gate/skill
     scope, which would arguably include `provider.yml`'s `gate:`/`skill:`
     capability comments. However, iteration 29's independent audit (not a
     mere self-citation) already resolved this ambiguity, in a materially
     similar dispute, in the narrower direction: `completeness` credits only
     `quay:author`/`quay:execute`'s own SKILL.md content. Iteration 38 is
     entitled to rely on that resolved, audited precedent rather than
     re-litigate it from the raw protocol text each time — that is exactly
     the discipline the session's post-hoc-correction history is trying to
     instill (cite a *verified* precedent, don't re-derive from scratch each
     time, but *do* verify it first, which this iteration explicitly did).
   - **One closer, non-cited precedent exists: iteration 12 (QN-026).**
     Reading `provenance.md`'s "Records (as of end of iteration 12)" section
     in full, QN-026 is a near-exact structural match to this iteration's
     QN-049: `packages/quay-github/DESIGN.md` had gone stale relative to
     `provider.yml`'s actual, already-shipped `data.write` capability;
     QN-026 corrected the stale prose with zero code diff. Iteration 12's
     own V_meta section states explicitly: *"QN-026 closes a real, evidenced
     documentation-completeness gap... This is exactly the kind of thing the
     `completeness` factor is meant to measure,"* but held the score flat
     for a **different** reason than iteration 38's — not because
     `provider.yml`/`DESIGN.md` fall outside `completeness`'s scope, but
     because the gap being closed was itself self-inflicted drift from an
     earlier iteration's own claim, so fixing it "restores the
     previously-assumed baseline rather than demonstrating new methodology
     completeness beyond what [that earlier iteration] already claimed."
     This is a **materially different, narrower rationale** than iteration
     38's ("neither file is a SKILL.md file, so `completeness` categorically
     does not apply") — and it is a closer factual match (same file pair,
     same "capability comment drifted stale" pattern) than either of
     iteration 38's two cited precedents. Iteration 38 did not find or cite
     it. **This does not change the correct final answer**: iteration 12's
     own reasoning, if applied here, would also conclude "flat, no net
     gain" (QN-049 also restores a previously-claimed-true state — the
     booleans were never wrong, only the comments — rather than
     demonstrating a genuinely new completeness increment), and the later,
     audit-verified iteration-29 precedent is a stronger, more authoritative
     basis for the categorical "not in scope at all" framing than iteration
     12's softer "self-inflicted drift, so no net gain" framing. But
     iteration 38's own instruction to "search all of `provenance.md` for
     the closest precedent" was not fully executed — iteration 12 is a
     closer factual match than either citation used, and a future iteration
     doing this same search should be aware of it. This is a
     thoroughness gap, not a correctness error: the ultimate `completeness:
     0.74 (unchanged)` score is right either way.
   - `abi_symmetry`, `skeleton`, `skill_convergence`, `effectiveness`,
     `reusability`, `validation` — all independently re-checked against
     protocol §5.1/§5.2's precise wording and the actual zero-diff evidence
     (`git diff --stat -- '*.js'` empty, no new Skill Method-step content, no
     new GitHub-Provider capability construction). All correctly held flat.

6. **σ_strict arithmetic and task-count denominator — VERIFIED exact.**
   `ls tasks/QN-*.md | wc -l` = 48, matching the report. `40/47 =
   0.851063...` ≈ 0.8511 (prior iteration's own value, independently
   recomputed) and `41/48 = 0.854166...` ≈ 0.8542, both matching the report
   exactly.

7. **V_instance and V_meta unchanged — VERIFIED consistent with the
   flat-hold.** `0.70 × 0.96 × 0.76 × 0.96 = 0.490291...` ≈ 0.4903;
   `0.74 × 0.26 × 0.79 × 0.64 = 0.097277...` ≈ 0.0973. Both recomputed
   exactly matching the report, and both are unchanged from iteration 37,
   consistent with all eight factors being held flat.

8. **Convergence verdict — VERIFIED sound.** V_instance (0.4903) and V_meta
   (0.0973) both far below the 0.80 dual threshold — criterion 1 correctly
   NO. σ = 0.8542, far from 1 — criterion 2 correctly NO. Criterion 3
   correctly NO (a documentation fix proves nothing new about "native +
   GitHub both run"). Criterion 4 correctly NO (no audit existed for this
   iteration's work until now). Criterion 5 correctly scored NO-on-substance
   despite the literal ΔV<0.02 test being met for a fourth consecutive
   iteration, consistent with the standing practice established since
   iteration 28 (a value function pinned near its own floor, not approaching
   convergence).

9. **`git status --short` — VERIFIED clean** except the one known
   pre-existing untracked file, `docs/proposal/
   baime-lite-driving-external-projects.md`. No stray changes.

## Net assessment

Iteration 38 continues iteration 37's recovery from the session's earlier
seven-correction streak (iterations 25, 29, 31, 33, 34, 35, and the
iteration-36 internal correction), all of which traced to citing a
precedent without verifying it by actually reading it. This iteration
explicitly read both cited precedents (iterations 25 and 29) in full, and
both citations check out as accurate characterizations, not
misattributions of the kind those seven corrections document. Every
mechanical/factual claim — the stale-comment defect's reality and origin,
the zero-`.js`-diff scope, the live gate re-verification against real,
still-existing GitHub issues, the unchanged 24-file test suite, the σ/V
arithmetic, and the clean git status — independently reproduces exactly as
reported.

The one improvement available for a future iteration: iteration 12's
QN-026 (a near-identical `DESIGN.md`-drift fix) is a closer factual
precedent than either of the two cited, and was not found despite the
"search all of provenance.md" discipline being nominally followed. This
does not change the correct final scores (V_instance = 0.4903, V_meta =
0.0973, σ_strict = 41/48 = 0.8542, all as reported) — iteration 12's own
reasoning would reach the same "flat, no net gain" conclusion QN-049
reaches, just via a different (narrower, "restores a previously-assumed
baseline" rather than "categorically out of scope") argument. No
correction to `iteration-38.md` or `provenance.md` is required; this is
recorded as a thoroughness note for the next iteration to consider when
searching for precedents, not a factual error to fix.

**No correction needed. Iteration 38 stands as reported.**

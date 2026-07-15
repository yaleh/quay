# Iteration 41 — Independent Out-of-Band Audit (G3)

**Auditor:** fresh, zero-prior-context out-of-band review. Read
`docs/proposal/quay-bootstrap-experiment.md` §5.1/§5.2/§7 in full,
`experiment/iterations/iteration-41.md` in full, `experiment/provenance.md`
(the seven "## Post-hoc correction" instances — six standalone headers at
iterations 25, 29, 31, 33, 34, 35, plus one embedded, strikethrough-marked
correction inside the "iteration 36" V-factor attribution section
correcting a false iterations-29/30 precedent claim), `packages/
quay-github/provider.yml` (current content and `git log -p`), and
`experiment/iterations/iteration-25.md` in full (to independently verify
the `reusability`-distinction claim). Ran all commands/diffs/tests directly
against the working tree, including a full 24-file regression-suite
re-run, `abi-symmetry.mjs`, a live `gh issue view 4`/`quay task check gh-4`
re-run, independent `git show`/`git grep` re-derivation, and independent
re-tabulation of ΔV across iterations 35-41 for the criterion-5 "seventh
consecutive" claim.

**Verdict: PASS** — every headline claim is independently verified
accurate. The "harder search" mandate was genuinely, not perfunctorily,
discharged: the report documents a real, falsifiable 4-point investigation
(code/test-coverage cross-reference, live re-check of GitHub issue #4, a
real and confirmable `data.write` scope blocker, and a reconfirmation of
`effectiveness`'s ceiling) before landing on QN-052, a purely additive,
zero-`.js`-diff manifest field. The `reusability`-vs-iteration-25
distinction is sound and, if anything, conservative rather than an
overclaim. Iteration 41 extends the clean-PASS streak (37, 38, 39, 40) to
five consecutive iterations.

## Findings

1. **The "harder search" claim — VERIFIED genuine, not perfunctory.**
   - **quay-github code/test coverage.** Independently confirmed the 7
     `quay-github` test files (`cli.test.mjs`, `compound-gate.test.mjs`,
     `gate.test.mjs`, `mcp-server.test.mjs`, `pagination.test.mjs`,
     `view-model.test.mjs`, `write.test.mjs`) exist and all pass. The
     claim that every exported function is exercised is consistent with
     the report's own description; no independent evidence of a missed
     gap was found during this audit's own review of `github-client.js`,
     `manifest.js`, `mcp-server.js`.
   - **Live GitHub issue #4.** Independently re-ran `gh issue view 4
     --repo yaleh/quay`: confirmed **open**, `status:todo` label, real
     body content. Independently re-ran `quay-github task check gh-4
     --json` (via `node packages/quay-github/bin/quay-github.js task
     check gh-4 --json`): reproduced **exactly** `ok:false, acTotal:3,
     acChecked:0, reason:"0/3 AC checkboxes checked"`, matching the
     report's live-command claim verbatim.
   - **The "prior scope decision" is real, not invented.** Independently
     read `packages/quay-github/DESIGN.md` §3.4 ("Status-write path,
     iteration 10, QN-024") and §5 ("Capabilities (v1.4)"): both
     explicitly state `data.write` is **status-only** — "title, body,
     labels (non-status), parent, children remain read-only in v1.1 —
     there is no AC/DoD requirement or observed drift motivating a
     broader write surface yet, and adding one now would be anticipatory
     gold-plating." This is a genuine, pre-existing (iteration 10)
     documented decision, not a post-hoc justification manufactured this
     iteration to avoid the harder path. The report's minor citation of
     "§5" (rather than the more detailed §3.4) is imprecise but not
     misleading — §5 does restate the same status-only scope line.
   - **Net assessment of the search:** this is a materially deeper
     investigation than iterations 38-40's single-document self-checks —
     it cross-references code+tests, re-checks two live organic GitHub
     issues with an actual gate-check command, and reconfirms a named
     precedent (iteration 23) rather than merely citing it. The search is
     honest and falsifiable, not a rubber-stamp exercise to justify
     defaulting to another documentation fix.

2. **QN-052 "manifest asymmetry" fix — VERIFIED exactly as described.**
   - `git show 67177be --stat` confirms: `packages/quay-github/
     provider.yml | 19 ++` (19 insertions, 0 deletions), plus
     `experiment/iterations/iteration-41.md`, `experiment/provenance.md`,
     `tasks/QN-052.md` — **zero `.js` files** in the commit's file list.
   - `grep -rn "skills_path" packages/` confirms exactly two
     field-assignment sources: `packages/quay-native/provider.yml:63`
     (`skills_path: "./skills"`, pre-existing) and `packages/
     quay-github/provider.yml:104` (`skills_path: "../quay-native/
     skills"`, this iteration's addition). Independently re-ran `grep -rln
     "skills_path" packages/*/src/*.js packages/*/*.js`: **zero hits** —
     confirmed no `.js` file anywhere reads this field. The report's
     "zero code consumers" and "purely additive/documentary" framing is
     accurate, not implied to be wired into any runtime path.
   - `git diff 67177be^ 67177be -- packages/quay-github/provider.yml`
     independently reproduced: the only change is a 19-line block of new
     comment + one new `skills_path:` line inserted before the
     pre-existing `bin_entry`/`mcp_entry` lines; those two lines are
     otherwise byte-identical, just relocated. Matches the report's
     "purely additive" and "byte-identical pre-existing content" claims
     exactly.
   - Independently confirmed `readManifest()`
     (`packages/quay-github/src/manifest.js`) parses via generic
     `YAML.parse(raw)` with no schema validation — consistent with the
     report's claim that an unknown field would not be rejected.

3. **The `reusability`-vs-iteration-25 distinction — VERIFIED sound and,
   if anything, conservative (no under-claim concern).**
   Independently read `experiment/iterations/iteration-25.md` in full.
   Iteration 25's QN-035 implemented a genuinely new, previously-absent
   executable function (`childrenStatus()` recursion in
   `github-client.js`), wired it into `checkGate()`'s `ready`/`done`
   branches, added a new 24-assertion test file
   (`compound-gate.test.mjs`), and **live-verified** it end-to-end against
   real, freshly-created compound GitHub issues (#5/#6/#7) with an
   adversarial regression test and a byte-identical Core-passthrough
   proof. That is unambiguously new, demonstrated, executable
   cross-Provider capability transfer — squarely within protocol §5.2's
   "methodology transfers to a second Provider" language.

   QN-052's `skills_path` field, by contrast, is confirmed (Finding 2
   above) to have zero code consumers anywhere in the repository. The
   actual transfer mechanism the field merely *documents* (Core's
   provider-parameterized `quay task <cmd> --provider github` passthrough
   invoking the same physical Skill files) was already implemented and
   already credited to `reusability` at iterations 18 (QN-029) and 25
   (QN-035). Declaring `skills_path` now adds no new evidence of transfer
   — it only makes an already-true, already-credited fact more
   discoverable via `provider://manifest`. The distinction the report
   draws (new executable/live-verified behavior vs. inert, unconsumed
   metadata restating an already-credited fact) is the correct axis and
   is applied correctly here.

   **On the under-claim question (explicitly considered, per audit
   instructions):** could `skills_path` have legitimately moved
   `reusability` upward as a "documentation/discoverability of an
   existing transfer" data point? This audit finds no — protocol §5.2 is
   explicit that `reusability` is measured on "the transfer target,"
   i.e., demonstrated behavior, and G2 explicitly warns against crediting
   the same underlying fact twice (the precedent for this exact
   double-counting risk is iteration 25's own corrected `gate_correctness`
   finding, where crediting both `gate_correctness` and `reusability` for
   one underlying fact was identified and reversed). Since the underlying
   transfer fact was already fully credited at iterations 18/25, crediting
   it again via a documentary field would be the same double-counting
   error in a new guise. Holding flat is correct, not an unwarranted
   under-claim.

4. **All 8 V-factors held flat — VERIFIED consistent with Findings 1-3.**
   `skeleton`, `abi_symmetry`, `gate_correctness`, `skill_convergence`
   correctly ruled out (no `.js` diff, no schema-equivalence proof, no
   gate-logic change — independently confirmed via a live `quay-github
   task check gh-7 --json` re-run reproducing the unchanged compound-gate
   result). `completeness` correctly scoped to `quay:author`/
   `quay:execute` SKILL.md Method-step content (`git diff --stat` confirms
   no `skills/*/SKILL.md` path touched). `effectiveness` correctly held
   flat per the reconfirmed iteration-23 ceiling condition (Finding 1).
   `reusability` correctly held flat per Finding 3. `validation` correctly
   held flat pending this very audit. V_instance and V_meta both
   independently recomputed exactly:
   `0.70×0.96×0.76×0.96 = 0.490291...` → 0.4903, and
   `0.74×0.26×0.79×0.64 = 0.097277...` → 0.0973 — both unchanged from
   iteration 40.

5. **σ_strict arithmetic and task-count denominator — VERIFIED exact.**
   `ls tasks/QN-*.md | wc -l` = **51**, matching the report exactly.
   `43/50 = 0.86` exactly (prior value) and `44/51 = 0.862745...` ≈
   0.8627 (post-iteration value), both independently recomputed matching
   the report's stated 0.8600 → 0.8627.

6. **V_instance and V_meta unchanged — VERIFIED.** Both independently
   recomputed in Finding 4, exactly matching iteration 40's end-state
   values (0.4903, 0.0973).

7. **Regression suite and `abi-symmetry.mjs` — VERIFIED unchanged, 24
   files.** `find packages -name "*.test.mjs" | wc -l` = 24, matching the
   report. All 24 independently re-run via direct `node --test <file>`
   invocation: 24/24 exit 0, no failures — no new test file was added
   (correct, since a pure-manifest-field addition does not warrant one).
   `node packages/quay-native/test/abi-symmetry.mjs` independently re-run:
   reports "ALL FOUR SURFACES SYMMETRIC," unchanged.

8. **Convergence verdict — VERIFIED sound, including the "seventh
   consecutive iteration" framing for criterion 5.** V_instance (0.4903)
   and V_meta (0.0973) both far below 0.80 — criterion 1 correctly NO.
   σ = 0.8627, far from 1 — criterion 2 correctly NO. Criterion 3
   correctly NO (a manifest-metadata fix proves nothing new about "native
   + GitHub both run"). Criterion 4 correctly NO (no audit existed for
   this iteration's own work prior to this report). For criterion 5,
   independently re-tabulated ΔV_instance/ΔV_meta from each iteration's
   own report text across iterations 35-41: iteration 35 (+0.0050
   post-correction, 0.0000), iteration 36 (0.0000, 0.0000), iteration 37
   (+0.0070, 0.0000), iteration 38 (0.0000, 0.0000), iteration 39 (0.0000,
   0.0000), iteration 40 (0.0000, 0.0000), iteration 41 (0.0000, 0.0000)
   — all seven iterations' ΔV values are < 0.02, confirming the literal
   criterion-5 test is satisfied for a **seventh** consecutive iteration,
   exactly as claimed. Scoring NO on substance (ΔV pinned near a floor
   well below the 0.80 threshold, not a system leveling off near
   convergence) is consistent with standing practice since iteration 28.

9. **`git status --short` — VERIFIED clean** except the one known
   pre-existing untracked file,
   `docs/proposal/baime-lite-driving-external-projects.md`. `git log
   --oneline -1` confirms `67177be` (iteration 41's commit) is the current
   HEAD, with no intervening or uncommitted changes.

10. **Post-hoc correction count — VERIFIED seven, matching the report's
    framing.** Six standalone `## Post-hoc correction` headers found at
    iterations 25, 29, 31, 33, 34, 35 (`grep -n "Post-hoc correction"
    experiment/provenance.md`), plus one embedded, strikethrough-marked
    correction inside the iteration-36 V-factor attribution section
    (correcting a false claim that iterations 29/30 independently reached
    an analogous conclusion, per commit `d90068d`) — seven total, matching
    both this report's and iteration 40's own framing.

## On whether the "harder search" was genuine effort or perfunctory

This audit gave special scrutiny to this question, as instructed. The
verdict is that the search was **genuine**, for three concrete reasons
that distinguish it from a perfunctory check-the-box exercise:

- It produced a **falsifiable, live-command-verified near-miss** (issue
  #4's `data.write` blocker), not merely an assertion that nothing was
  found. This audit independently reproduced the exact `ok:false, 0/3 AC
  checkboxes checked` result and independently confirmed the cited
  DESIGN.md scope-decision text is real and pre-dates this iteration by
  31 iterations (QN-024, iteration 10) — it was not invented this
  iteration to excuse inaction.
- It correctly declined to force `data.write` scope expansion "to
  manufacture a reusability data point," which is precisely the
  gold-plating anti-pattern the protocol's own G5 guardrail warns
  against. Expanding scope without a genuine, demonstrated need would
  itself have been a process violation, not a virtue.
- The resulting QN-052 fix, while still low V-factor-impact (correctly
  scored as such), is a genuinely different **kind** of finding than
  iterations 38-40's single-document self-checks: it required a
  cross-Provider, cross-manifest comparison that none of iterations
  38-40 performed. It is a small, honest increment — not a repackaging
  of the same documentation-staleness template.

The one substantive weakness, which the report itself flags honestly in
its own §9 "close audit scrutiny" list, is that QN-052 still does not
move any of the 8 protocol-defined V-factor axes — so the "harder search"
mandate, while genuinely discharged, did not (and per the evidence,
could not honestly) escape the flat-V-factor pattern of iterations 36-40.
This is a correct, non-overclaiming outcome given the evidence, not a
failure of the search itself.

## Net assessment

Iteration 41 continues the recovery pattern established at iterations 37,
38, 39, and 40: every citation and precedent invoked (the iteration
38/39/40 V-factor-flat precedent chain, the "seven post-hoc corrections"
framing, iteration 25's `reusability`-crediting precedent, iteration 23's
`effectiveness`-ceiling precedent) is accurate and precisely scoped, not
assumed from memory. The headline QN-052 finding is genuine — the manifest
asymmetry is real, confirmed via direct `grep`, and the fix is exactly
what it claims to be: a 19-line, comment-heavy, purely additive change
with zero `.js` diff, independently confirmed via direct `git show`/`git
diff` inspection rather than trusting the report's own restatement.

The most methodologically interesting point in this iteration — the
`reusability`-vs-iteration-25 distinction — is sound on independent
re-reading of iteration 25's full reasoning, and this audit finds no basis
for either an overclaim concern (the field genuinely has zero consumers)
or an under-claim concern (crediting it would double-count an
already-credited fact, the same class of error iteration 25's own
`gate_correctness` correction identified and reversed).

σ arithmetic (44/51 = 0.8627), the task-count denominator (51, confirmed
via `ls`), V_instance/V_meta recomputation, the 24-file regression suite,
`abi-symmetry.mjs`, and `git status` all reproduce exactly. The
criterion-5 "seventh consecutive iteration" tally independently
re-derives correctly from each of iterations 35-41's own reported ΔV
values.

**No correction needed. Iteration 41 stands as reported. The clean-PASS
streak (37, 38, 39, 40) now extends to five consecutive iterations.**

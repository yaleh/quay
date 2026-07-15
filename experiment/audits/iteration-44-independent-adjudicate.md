# Iteration 44 — Independent Out-of-Band Audit (G3)

**Auditor:** fresh, zero-prior-context out-of-band review. Read
`docs/proposal/quay-bootstrap-experiment.md` §5.1/§5.2/§7 in full,
`experiment/iterations/iteration-44.md` in full, `experiment/provenance.md`
(the seven "## Post-hoc correction" instances — six standalone headers at
iterations 25, 29, 31, 33, 34, 35, plus one embedded correction inside the
iteration-36 section), `experiment/iterations/iteration-11.md` in full
(the sole cited precedent for QN-055's V-factor treatment), and the prior
seven clean audits (iterations 37-43). Ran all commands directly against
the working tree and against two disposable `git worktree` checkouts (the
pre-fix parent commit `76c64b7` and the fix commit `e32a363`, both removed
after use): `git show`/`git log` on `packages/quay-native/bin/
quay-native.js`'s history, an independent live reproduction of the
original `task edit`-with-no-`<id>` bug on the actual pre-fix commit (not
merely reasoned from the diff), an independent confirmation that the
fixed commit rejects the same input, a full 25-file regression-suite
re-run (`node --test` per file, checking real exit codes, not
string-matching), `abi-symmetry.mjs`, `ls tasks/QN-*.md | wc -l`,
independent V/σ recomputation, a manual tabulation of ΔV across
iterations 35-44, and `git status --short`.

**Verdict: PASS** — every headline claim, including the central V-factor
question (claim 4), is independently verified accurate. Iteration 44
extends the clean-PASS streak (37, 38, 39, 40, 41, 42, 43) to eight
consecutive iterations.

## Findings

1. **QN-055 code fix — VERIFIED genuine, not cosmetic, via direct diff
   read and independent reproduction on a disposable pre-fix worktree.**
   `git show e32a363 -- packages/quay-native/bin/quay-native.js` shows
   exactly a 5-line insertion inside the `edit` subcommand handler:
   ```js
   if (sub === "edit") {
     const id = positional[0];
     if (!id || typeof id !== "string" || id.trim() === "") {
       console.error("task edit: missing required <id> positional argument");
       process.exitCode = 1;
       return;
     }
     const patch = {};
   ```
   This audit checked out the parent commit (`76c64b7`, the state
   immediately before iteration 44's fix) into a disposable
   `git worktree`, symlinked `node_modules`, and ran `node
   packages/quay-native/bin/quay-native.js task edit --title
   "oops-audit-repro" --json` with **no** `<id>` positional argument.
   Result: exit 0, a JSON task object printed with no `id` field, and
   `tasks/undefined.md` written to disk with the exact frontmatter shape
   described in the report. This independently confirms the *original*
   bug was real, not merely inferred from the diff. A second disposable
   worktree at the fix commit (`e32a363`) was then checked: the identical
   invocation now prints `task edit: missing required <id> positional
   argument`, exits 1, and writes no file. Both worktrees were removed
   (`git worktree remove --force`) after use, leaving no trace. The fix
   is genuine and effective, not cosmetic.

2. **New regression test file — VERIFIED present, 7/7 assertions pass.**
   `packages/quay-native/test/edit-validation.test.mjs` exists (87
   inserted lines per `git show e32a363 --stat`). It defines exactly 7
   `assert(...)` call sites across 3 cases (missing-id: 4 assertions,
   empty-string-id: 2 assertions, happy-path: 1 assertion); a literal
   `grep -c "assert("` returns 8 because it also matches the helper
   function's own `function assert(cond, msg)` definition line — not a
   discrepancy, just a grep artifact; the actual assertion-call count is
   7, confirmed by direct read and by the runtime output. Running the
   file directly (`node packages/quay-native/test/
   edit-validation.test.mjs`) produces exactly 7 `PASS:` lines and "All
   QN-055 edit-validation tests passed.", exit 0.

3. **Full 25-file regression suite and `abi-symmetry.mjs` — VERIFIED.**
   `find packages -name "*.test.mjs" | wc -l` returns exactly **25** (24
   pre-existing files across `quay`, `quay-native`, `quay-github`, plus
   the new `edit-validation.test.mjs`). This audit ran every one of the
   25 files individually via `node --test <file>`, checking the real
   process exit code (not string-matching output): all 25 exit 0.
   `node packages/quay-native/test/abi-symmetry.mjs` independently
   re-run: reports "ALL FOUR SURFACES SYMMETRIC" across `task_list`,
   `task_get`, `task_write`, `task_check`, all `match: true`. Zero
   regressions confirmed independently.

4. **Central V-factor scrutiny (claim 4) — VERIFIED, and the precedent
   application is sound, not a rote citation.**
   - **Citation accuracy:** iteration 11's own report (`experiment/
     iterations/iteration-11.md` §8, read in full by this audit)
     genuinely held all eight V-factors flat for QN-025 (`task create`'s
     analogous `<id>` guard clause), with explicit, factor-by-factor
     reasoning quoted accurately in iteration 44's provenance.md entry
     (verified by direct side-by-side comparison — no paraphrase drift
     or selective misquotation found). `grep -n "guard clause|hardening|
     validation.test.mjs|CLI-hardening" experiment/provenance.md`,
     independently re-run by this audit, surfaces exactly the same hits
     iteration 44 cites: the one scored precedent is QN-025/iteration 11;
     the only earlier mention (iteration 10, line ~1709-1724) is the
     original *discovery* of the gap, not a separate scored precedent
     (no code was changed and no V-factor was assessed that iteration —
     it was explicitly deferred as "a possible small iteration-11 item").
     The claim "iteration 11 is the only relevant precedent" is accurate.
   - **Protocol §5.1's exact definition of `gate_correctness`:**
     `docs/proposal/quay-bootstrap-experiment.md` line 123 states,
     verbatim: *"`quay-native task check <id>` correctly asserts the
     `author → ready` and `execute → done` gates (design §3)."* This
     definition is narrowly scoped to the mechanical correctness of the
     `check()` gate-assertion logic in `store.js` — not to CLI
     input-validation robustness generally. This audit independently
     confirmed, via `git show e32a363 --stat`, that the QN-055 diff
     touches only `packages/quay-native/bin/quay-native.js` (CLI argument
     dispatch, upstream of any `store.write()`/`store.check()` call);
     `src/store.js`'s `check()` function is byte-unchanged. Because the
     guard clause fires and returns *before* any interaction with the
     gate-assertion code path, this fix is genuinely out of scope for
     `gate_correctness` under the protocol's own narrow definition — this
     audit's independent reading of §5.1 concurs with iteration 44's
     conclusion, not merely because iteration 11 did the same thing, but
     because the definition itself excludes it on independent inspection.
   - **Does iteration 11 itself under-score anything, in retrospect?**
     No under-scoring found. Iteration 11's own `gate_correctness`
     reasoning ("No change to `store.js`'s gate logic this iteration")
     is the identical, correct narrow-scope reasoning this audit
     independently derives from §5.1's text. QN-025's diff, like QN-055's,
     touched only CLI argument dispatch, never `store.js`. There is no
     latent, inherited under-scoring to flag here — the precedent was
     sound when set, and remains sound when reapplied.
   - **Does the "first genuine code bug fix" status of QN-055 (vs.
     iterations 38-43's pure documentation fixes) change the calculus?**
     This audit gave this extra scrutiny as instructed. The relevant
     distinction is not "code change vs. no code change" in the
     abstract — it is whether the specific code changed is *inside* one
     of the four narrowly-defined V_instance axes' scope. A code change
     that added a new capability, changed a JSON schema shape, or
     modified `store.js`'s gate logic would legitimately move `skeleton`,
     `abi_symmetry`, or `gate_correctness` respectively, regardless of
     its size. QN-055 does none of these — it is CLI-argument-presence
     validation strictly upstream of the gate, functionally identical in
     shape and scope to QN-025. The "documentation fix vs. code fix"
     framing, while true, is not itself dispositive; what matters is the
     diff's actual scope relative to each factor's textual definition,
     and this audit's independent diff/code read confirms the scope
     claim. All eight factors held flat is the correct call.

5. **σ_strict arithmetic — VERIFIED exactly.** `ls tasks/QN-*.md | wc -l`
   returns **54** (QN-001 through QN-055, minus the never-allocated
   QN-018). `47 / 54 = 0.87037...`, which rounds to **0.8704** as
   claimed. The prior value `46 / 53 = 0.86792...` rounds to 0.8679,
   matching iteration 43's own final figure exactly (cross-checked
   against `experiment/iterations/iteration-43.md` line 355).

6. **V_instance and V_meta unchanged — VERIFIED.** Independent
   recomputation: `V_instance = 0.70 × 0.96 × 0.76 × 0.96 = 0.4903` and
   `V_meta = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973`, both identical to
   iteration 43's own reported values, consistent with the zero-diff
   confirmation on `store.js`, `mcp-server.js`, and every `skills/*/
   SKILL.md` path (`git show e32a363 --stat` confirms none of these
   paths appear in the commit).

7. **Convergence verdict — VERIFIED, including the criterion-5 tally.**
   All 4 criteria (dual threshold, fixpoint, contract, audit) are
   independently confirmed NO: V_instance/V_meta far below 0.80; σ =
   0.8704 far from 1 with no Skill/gate content changed; no capability
   change relevant to the GitHub Provider or cross-Provider contract; no
   audit yet existed for this iteration's own work at authoring time (a
   structural, always-true fact for any iteration, correctly scored NO).
   Independent tabulation of ΔV across iterations 35-44 from each
   iteration's own report: iteration 35 (post-correction) +0.0050, 36 =
   0.0000, 37 = +0.0070, 38 through 44 = 0.0000 each (seven more
   iterations) — ten iterations total (35, 36, 37, 38, 39, 40, 41, 42,
   43, 44), every individual ΔV < 0.02, confirming "tenth consecutive
   iteration" for the literal criterion-5 test, consistent with iteration
   43's own "ninth consecutive" tally one iteration prior. The "scored NO
   on substance" framing (both V's pinned far below 0.80, not a system
   leveling off near convergence) is the same standing, defensible
   practice used at iterations 28-43. "NOT CONVERGED" is correct.

8. **`git status --short` — VERIFIED clean as claimed.** Plain `git
   status --short` shows only `?? docs/proposal/
   baime-lite-driving-external-projects.md`, matching the report and
   every prior iteration's framing of this pre-existing untracked file.

9. **Post-hoc correction count — VERIFIED seven, matching the report's
   framing.** `grep -n "^## Post-hoc correction" experiment/
   provenance.md` finds exactly six standalone headers (iterations 25,
   29, 31, 33, 34, 35); the seventh is embedded inside the iteration-36
   section (a strikethrough correction of a false claim about iterations
   29/30, self-labeled "the sixth post-hoc V-factor correction" at the
   time it was written, immediately followed in provenance.md by the
   `## Records (as of end of iteration 36)` header) — seven total,
   consistent with iterations 37-43's own tallies.

## Net assessment

Iteration 44 marks the first genuine production-code bug fix (rather than
a documentation-staleness fix) in the iteration 38-44 streak, and receives
this audit's closest scrutiny on exactly that basis. The underlying defect
is real: this audit independently reproduced the original silent
`tasks/undefined.md`-write bug on a disposable worktree checked out at the
actual pre-fix commit (not reasoned from the diff alone), and
independently confirmed the fix commit rejects the same input with exit 1
and no stray file. The new regression test (7/7 assertions, verified by
direct execution) and the full 25-file regression suite (independently
re-run file-by-file, all exit 0) plus `abi-symmetry.mjs` ("ALL FOUR
SURFACES SYMMETRIC") corroborate zero regressions.

The central question — whether `gate_correctness` should move given that
this is a genuine CLI-hardening code fix, rather than simply citing
iteration 11's precedent — was independently re-derived from protocol
§5.1's exact text, not merely accepted on the strength of the citation.
§5.1 scopes `gate_correctness` narrowly to `task check`'s gate-assertion
correctness (design §3); the QN-055 diff lives entirely in CLI argument
dispatch, strictly upstream of and structurally separate from `store.js`'s
`check()` function, which this audit confirmed is byte-unchanged. On that
independent basis, holding `gate_correctness` flat is correct — not merely
because iteration 11 did the same, but because the fix is genuinely
out of scope for that factor's textual definition. No inherited
under-scoring from iteration 11 was found either: iteration 11's own
`gate_correctness` reasoning for QN-025 applied the identical narrow-scope
test correctly at the time.

The iteration-11 citation itself was independently re-read in full and is
accurately quoted, not selectively excerpted to favor a flat-hold
conclusion. The "only relevant precedent in provenance.md" claim was
independently re-verified via the same `grep` query iteration 44 ran,
returning exactly one scored precedent (QN-025) and one unscored discovery
mention (iteration 10, correctly not counted as a precedent).

σ arithmetic (47/54 = 0.8704), V_instance/V_meta recomputation (0.4903,
0.0973, both unchanged), the 25-file regression suite, `abi-symmetry.mjs`,
the criterion-5 "tenth consecutive iteration" tally, and `git status` all
reproduce exactly.

**No correction needed. Iteration 44 stands as reported. The clean-PASS
streak (37, 38, 39, 40, 41, 42, 43) now extends to eight consecutive
iterations.**

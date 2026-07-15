# Iteration 43 — Independent Out-of-Band Audit (G3)

**Auditor:** fresh, zero-prior-context out-of-band review. Read
`docs/proposal/quay-bootstrap-experiment.md` §5.1/§5.2/§7 in full,
`experiment/iterations/iteration-43.md` in full, `experiment/provenance.md`
(the seven "## Post-hoc correction" instances — six standalone headers at
iterations 25, 29, 31, 33, 34, 35, plus one embedded correction inside the
iteration-36 section), and the prior six clean audits (iterations 37-42).
Ran all commands directly against the working tree: `git log -p` and
`git show` on `experiment/README.md`'s history, a live `gh issue view`/
`gh issue list`, direct read of `packages/quay-native/bin/quay-native.js`
and `src/store.js`, an independent sandboxed reproduction of the
`task edit`-with-no-`<id>` bug (in a throwaway `/tmp` copy, cleaned up
afterward), `ls tasks/QN-*.md | wc -l`, a full 24-file regression-suite
re-run (`node --test` per file, not string-matching), `abi-symmetry.mjs`,
independent V/σ recomputation, and `git status --short`/`--ignored`.

**Verdict: PASS** — every headline claim, including the unusual
`task edit`/`undefined.md` bug discovery, is independently verified
accurate. Iteration 43 extends the clean-PASS streak (37, 38, 39, 40, 41,
42) to seven consecutive iterations.

## Findings

1. **Stale `experiment/README.md` Status header — VERIFIED exactly as
   claimed.** `git log --oneline -- experiment/README.md` shows exactly
   two commits: the original scaffold commit (`5b452aa`) and this
   iteration's fix (`fca66a3`). `git show 5b452aa:experiment/README.md`
   confirms the original line-3 text was literally
   `- **Status:** Not started (pre-iteration-0)`, unchanged since the
   file's creation. `git show fca66a3 -- experiment/README.md` confirms
   the fix is a single-line diff: the Status line now reads "In progress;
   42 BAIME iterations completed as of 2026-07-15, NOT CONVERGED — see
   `experiment/iterations/iteration-42.md`... (52 allocated native task
   IDs, native + GitHub Providers both built and running)", with every
   other line of the file byte-identical. This is genuinely git-tracked
   (part of commit `fca66a3`), not merely an on-disk edit.

2. **Genuine search for effectiveness/reusability-shaped work —
   PLAUSIBLE and independently corroborated.** `gh issue list --repo
   yaleh/quay --json number,title,labels,state` (re-run live by this
   audit) returns exactly issue #3 (`status:ready`) and #4
   (`status:todo`), matching the report's claim of "unchanged from
   iterations 41/42." The report's description of the native backlog and
   `ToolSearch` re-check is consistent with the standing DIR-004/DIR-005
   precedent already established in prior iterations' provenance
   entries; no contradiction found.

3. **CLI lifecycle claim — VERIFIED.** `tasks/QN-054.md` exists, with
   frontmatter `id: QN-054`, `status: done`, and a body containing
   Proposal/Plan/Acceptance Criteria (4/4 checked)/Definition of Done
   (4/4 checked) sections exactly matching the report's narrative. The
   task's provenance triple in `provenance.md`'s ledger row is
   `{author_by: native, execute_by: native, gate_by: native, status:
   done}`, consistent with the report and with the standing convention
   since iteration ~15.

4. **`task edit` / `undefined.md` bug — VERIFIED genuine, not fabricated,
   given special scrutiny as instructed.**
   - **Source-code confirmation:** `packages/quay-native/bin/quay-native.js`
     shows the `create` subcommand (line ~152) has an explicit guard:
     `if (!id || typeof id !== "string" || id.trim() === "")` → prints
     `"task create: missing required <id> positional argument"`, sets
     `process.exitCode = 1`, and returns *before* any write. The `edit`
     subcommand (line ~115) has **no equivalent guard** — `id =
     positional[0]` is used directly in `store.write(id, patch)` with no
     validation. `src/store.js`'s `filePathFor(id)` does
     `path.join(tasksDir, \`${id}.md\`)` — with `id === undefined`,
     JavaScript template-literal coercion produces the literal string
     `"undefined.md"`. The reported failure mode is exactly what the code
     does; it is a real, pre-existing asymmetry between `create`'s
     hardening (QN-025, iteration 11) and `edit`'s lack thereof.
   - **Independent reproduction:** this audit copied the full working
     tree to a throwaway `/tmp` directory and ran
     `node packages/quay-native/bin/quay-native.js task edit --status
     ready --json` with no `<id>` argument. Result: exit 0, no error
     message, JSON output printed (task object with no `id` field), and
     `tasks/undefined.md` written to disk with `status: ready`
     frontmatter — reproducing the exact bug described. The throwaway
     copy was deleted immediately after (`rm -rf`), leaving no artifact.
   - **Cleanup in the real tree confirmed:** `ls tasks/undefined.md`
     against the actual working tree returns "No such file or directory";
     `git status --short` (real tree) shows no such file, tracked or
     untracked. The claim that the stray file was reproduced and then
     removed before the iteration's final check is corroborated — no
     trace remains.
   - **Scope discipline honored:** no code change was made to `cli.js` or
     `store.js` in this iteration's diff (`git show --stat fca66a3`
     touches only `experiment/README.md`, `experiment/iterations/
     iteration-43.md`, `experiment/provenance.md`, and `tasks/QN-054.md`)
     — consistent with the claim that this was disclosed as a future
     hardening candidate, not silently fixed in scope.

5. **All 8 V-factors held flat — VERIFIED, and the precedent chain is
   actually applied, not merely asserted.** The report's `completeness`
   reasoning re-quotes iteration 39's exact defining language (verified
   present in `provenance.md`'s iteration-39 section) and extends it with
   a specific, checkable argument (`experiment/README.md` is "further
   removed from scope" than the three `docs/proposal/*.md` files QN-053
   touched, since it is not a SKILL.md-adjacent design document). This is
   a genuine application of the precedent, not a bare citation.
   `effectiveness` (0.26) and `reusability` (0.79) are held flat with the
   same "documentation-only, no code change" reasoning used at QN-049/
   050/051/053, independently consistent with each of those iterations'
   own sections in `provenance.md`. `validation` (0.64) is correctly left
   for the top-level orchestrator, as in every prior iteration since
   ~10.

6. **σ_strict arithmetic — VERIFIED exactly.** `ls tasks/QN-*.md | wc -l`
   returns **53** (QN-001 through QN-054, minus the never-allocated
   QN-018). `46/53 = 0.86792...`, which rounds to **0.8679** as claimed.
   The prior value 45/52 = 0.86538... rounds to 0.8654, also correctly
   cited.

7. **V_instance and V_meta unchanged — VERIFIED.** `git show
   --stat fca66a3` confirms zero `.js`/`skills/` diff, consistent with
   the claim that no `V_instance` or `V_meta` factor is implicated.
   Independent recomputation: `V_instance = 0.70 × 0.96 × 0.76 × 0.96 =
   0.4903` and `V_meta = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973`, both
   identical to iteration 42's own reported values.

8. **Regression suite and ABI symmetry — VERIFIED independently, not
   trusted from the report.** This audit re-ran all 24 `*.test.mjs`
   files directly (`node --test <file>` per file, checking real exit
   codes): all 24 exit 0. `node packages/quay-native/test/abi-symmetry.mjs`
   independently re-run: reports "ALL FOUR SURFACES SYMMETRIC" across
   `task_list`, `task_get`, `task_write` (plus value-equivalence and
   extra-only-equivalence sub-checks), and `task_check`. No new test file
   was added or expected, consistent with a docs-only fix.

9. **Convergence verdict — VERIFIED, including the criterion-5 tally.**
   Independent tabulation of ΔV across iterations 35-43 from each
   iteration's own report: iteration 35 (post-correction) +0.0050,
   36 = 0.0000, 37 = +0.0070, 38 through 43 = 0.0000 each — nine
   iterations (35, 36, 37, 38, 39, 40, 41, 42, 43), all individually
   < 0.02, confirming "ninth consecutive iteration" for the literal
   criterion-5 test. Criteria 1-4 are each independently confirmed NO
   (V_instance/V_meta far below 0.80; σ = 0.8679 < 1; no capability
   change to prove criterion 3 further; no audit yet exists for this
   iteration's own work at authoring time). The "NOT CONVERGED" verdict
   is correct.

10. **`git status --short` — VERIFIED clean as claimed.** Plain
    `git status --short` shows only
    `?? docs/proposal/baime-lite-driving-external-projects.md`. Separately,
    `.gitignore` line 1 is `docs/proposal/quay-bootstrap-experiment.md`,
    and `git status --short --ignored` confirms it appears only under
    `--ignored` (`!!`), never in the plain listing — consistent with
    iteration 42's own discovery and this iteration's inherited framing.

11. **Post-hoc correction count — VERIFIED seven, matching the report's
    (and iterations 40-42's own) framing.** `grep -n "Post-hoc
    correction" experiment/provenance.md` finds exactly six standalone
    headers (iterations 25, 29, 31, 33, 34, 35), plus one embedded
    correction inside the iteration-36 section — seven total.

## Net assessment

Iteration 43 continues the recovery pattern established at iterations 37
through 42. The headline claim this iteration — a genuine, previously
undocumented staleness defect in `experiment/README.md`'s own Status
line, unchanged since the file's creation at the repository's second
commit — is confirmed precisely: original text, fix diff, and
git-tracking are all independently reproducible from `git log`/`git show`
without relying on the report's own restatement.

The most unusual claim, the `task edit`/`undefined.md` bug, receives the
requested special scrutiny and holds up completely: the asymmetry between
`create`'s explicit positional-argument guard (added by QN-025, iteration
11) and `edit`'s absence of any such guard is directly visible in
`packages/quay-native/bin/quay-native.js`, and this audit's own
independent, cleanly-disposed-of reproduction in a throwaway `/tmp` copy
confirms the exact failure mode described (silent `tasks/undefined.md`
write, no error, `id` field absent from the JSON, exit 0). The stray file
does not exist anywhere in the real working tree, confirming the cleanup
claim. The decision to disclose rather than fix in-scope, and to flag it
as a future `A_n`/hardening candidate parallel to QN-025, is the correct,
protocol-conservative call — an out-of-scope capability change is not
silently bundled into a docs-only task.

σ arithmetic (46/53 = 0.8679), V_instance/V_meta recomputation (0.4903,
0.0973, both unchanged), the 24-file regression suite, `abi-symmetry.mjs`,
and `git status` all reproduce exactly. The criterion-5 "ninth consecutive
iteration" tally independently re-derives correctly from each of
iterations 35-43's own reported ΔV values.

**No correction needed. Iteration 43 stands as reported. The clean-PASS
streak (37, 38, 39, 40, 41, 42) now extends to seven consecutive
iterations.**

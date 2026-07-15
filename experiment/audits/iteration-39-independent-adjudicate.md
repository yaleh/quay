# Iteration 39 — Independent Out-of-Band Audit (G3)

**Auditor:** fresh, zero-prior-context out-of-band review. Read
`docs/proposal/quay-bootstrap-experiment.md` §5.1/§5.2/§7 in full,
`experiment/iterations/iteration-39.md` in full, `experiment/iterations/
iteration-29.md` in full (iteration 39's cited `completeness` precedent),
`docs/proposal/quay-native-design.md` (current content and, via `git log
-p`, the pre-fix content from commit `2178b80`), the relevant
`experiment/provenance.md` "Post-hoc correction" sections (iterations 25,
29, 31, 33, 34, 35, 36) and the iteration-38 audit
(`experiment/audits/iteration-38-independent-adjudicate.md`), and ran all
commands/tests/diffs directly against the working tree, including a full
24-file regression-suite re-run, independent re-verification of all five
§8 "resolved" claims against live source, and independent confirmation of
commit `199cd9d`'s content, authorship, and placement in history. Special
scrutiny applied, per the audit brief, to whether the `199cd9d` citation
is honestly scoped, and to whether `quay-native-design.md` §8 is genuinely
out of `completeness`'s scope.

**Verdict: PASS** — every headline claim is independently verified
accurate. All five §8 resolution claims check out against live code with
correct citations. The `git diff --stat` zero-code-diff claim is exact.
The `199cd9d` citation is accurate, honestly scoped (correctly
characterized as an external, out-of-band, non-iteration-numbered commit
never previously logged, not misattributed as this iteration's or any
prior iteration's own work), and used only as corroborating context, not
as load-bearing evidence for the final score. The `completeness`-flat call
is defensible on the cited precedent, though — as in iteration 38 — a
closer, non-cited counter-consideration exists (see Finding 5) that a
future iteration should weigh. σ arithmetic, task count, V-factor
recomputation, regression suite, and convergence-criterion accounting all
reproduce exactly. Iteration 39 extends the clean-PASS-audit streak begun
at iteration 37 to three consecutive iterations.

## Findings

1. **QN-050 stale-§8 claim — VERIFIED, real, and now genuinely corrected.**
   - `git log --oneline -- docs/proposal/quay-native-design.md` shows
     exactly two commits: `2178b80` (the file's original creation,
     iteration-adjacent but predating the numbered-iteration sequence)
     and `c7fcf75` (this iteration's own fix). `git show 2178b80 --
     docs/proposal/quay-native-design.md` confirms the pre-fix §8 listed
     all five items as open questions with no resolution annotation.
   - `git show c7fcf75 -- docs/proposal/quay-native-design.md` confirms
     the actual diff: 37 insertions, 0 deletions — a lead-in paragraph
     plus a "RESOLVED: ..." annotation appended directly beneath each of
     the five original (verbatim-preserved) bullet points. This matches
     the report's own description exactly and follows QN-049's
     preserve-and-annotate precedent as claimed.
   - **Independent re-verification of all five resolution claims (not
     just 2, all 5), each against live source, not the report's own
     restatement:**
     1. *Storage format*: `packages/quay-native/src/store.js` parses/
        serializes YAML frontmatter + markdown body; every task file
        (e.g. `tasks/QN-049.md`) is on-disk exactly that shape. Confirmed.
     2. *`needs-human`*: `store.js` line 13, `export const VALID_STATUSES
        = ["todo", "ready", "done", "needs-human"]` — a first-class status
        value, not a label. Confirmed.
     3. *manda-absent fallback*: `packages/quay/src/action.js` lines 8-10
        header comment documents the exact three-tier chain (manda
        dispatch / inline-or-subagent / print-degrade) and
        `deliverTrigger()` implements it. Confirmed — "both, layered" is
        accurate.
     4. *`quay:execute` epic branch*: `packages/quay-native/skills/
        execute/SKILL.md` line 67, `executeEpic(task, provider) = {
        driveEach: [driveChildToDone(c, provider) | c <- task.children],
        ... }` — active dispatch-and-wait, matching the "both" resolution
        claimed. Confirmed.
     5. *Operation-Skill roster*: `ls packages/quay-native/skills/` shows
        only `author/` and `execute/` — no standalone `decompose` Skill.
        `author/SKILL.md` line 67 states "this is also where the
        decompose test lives" and step 4 (`review-plan`) implements it
        inline. Confirmed — "folded" is accurate.
   - All five claims independently verified true, with citations that
     check out exactly as the report states them. This is a real,
     non-fabricated gap and a real, non-overclaimed fix.

2. **Zero code/config diff — VERIFIED.** `git show c7fcf75 --stat`:
   `docs/proposal/quay-native-design.md` (37 insertions), `experiment/
   iterations/iteration-39.md` (411 insertions), `experiment/
   provenance.md` (184 insertions), `tasks/QN-050.md` (122 insertions) —
   four files, all additions, zero deletions anywhere. `git show c7fcf75
   --stat -- '*.js' '*.yml'` returns empty. A pure documentation fix,
   exactly as claimed.

3. **`199cd9d` citation — VERIFIED accurate, appropriately scoped, and
   NOT misattributed.** This finding receives the special scrutiny the
   audit brief requested.
   - `git show 199cd9d --stat` confirms the commit exists: "Fix stale
     Provider-ABI wording in glossary.md and quay-proposal.md," touching
     only `docs/proposal/glossary.md` (2 changed) and `docs/proposal/
     quay-proposal.md` (6 changed) — 4 insertions/4 deletions total.
     `git show -s --format='%H %ci %an %s' 199cd9d` confirms the date
     (2026-07-15T15:59:05Z) and author (Yale Huang, i.e. the human/
     repo-owner, `Co-Authored-By: Claude Fable 5`).
   - `git log --oneline` places this commit immediately after iteration
     32's own commit and its audit, and immediately before "Add DIR-010"
     — i.e., it carries **no** `Iteration N:` prefix and is not part of
     the numbered iteration-executor sequence at all. It is exactly the
     kind of external, out-of-band commit the audit brief flagged as a
     known risk.
   - `grep -n "199cd9d" experiment/provenance.md` (run before considering
     iteration 39's own new text) confirms this commit is mentioned
     **nowhere** in `provenance.md` prior to iteration 39's own appended
     sections — consistent with the report's claim that it was "never
     logged in `provenance.md` nor credited to any V-factor."
   - **Characterization check.** Iteration 39's report text (§3, §7, §8)
     consistently describes `199cd9d` as: (a) surfaced by an independent
     `git log` search, not `provenance.md`; (b) "the same class of
     top-level-proposal-doc staleness fix, performed once before in this
     experiment's history"; (c) never logged or credited to any V-factor.
     At no point does the report claim `199cd9d` was part of this
     iteration's own work, part of any prior *numbered* iteration's work,
     or itself a V-factor-affecting event — it is used only as
     **corroborating context** for the observation "this class of fix has
     consistently not been scored," explicitly subordinate to the
     iteration-29 precedent, which is the actual load-bearing citation
     (§8: "Per this established precedent, `completeness` is not the
     right factor... A second, independent corroborating precedent was
     found..."). This is an honest, correctly-scoped citation — not a
     misattribution of external/human work as iteration work, and not
     inflated into standalone justificatory weight it cannot bear on its
     own (a single unscored external commit is not itself a "precedent"
     in the ledger sense; the report does not claim it is more than
     corroboration).

4. **`quay-native-design.md` legitimacy as an editable file — VERIFIED.**
   `git log --oneline -- docs/proposal/quay-native-design.md` confirms it
   is tracked (added at `2178b80`, part of the working tree from early in
   the session, not one of the untouched files like `glossary.md`/
   `quay-proposal.md`). Unlike `glossary.md`/`quay-proposal.md` (never
   edited by any numbered iteration this session, per the audit brief's
   framing), `quay-native-design.md` is directly and repeatedly cited by
   the Skill files that ARE in the experiment's normal working scope:
   `packages/quay-native/skills/author/SKILL.md` and `.../execute/
   SKILL.md` both cite it verbatim ("Layer-2 orchestration Skill
   (quay-native-design.md §5)", "design §3", "design §4", etc., at least
   10 distinct citation points across both files). It is squarely in
   normal experiment scope, not a pre-existing untouched file.

5. **All eight V-factors held flat, citing iteration 29's `completeness`
   precedent — VERIFIED accurate citation of iteration 29's actual
   reasoning; final flat-hold conclusion is defensible but not
   unambiguously the only correct call, matching the same open question
   iteration 38's audit flagged for the sibling case.**
   - Iteration 29 was read in full this audit. Iteration 39's
     characterization of it is accurate: iteration 29's post-hoc
     `completeness` correction (confirmed via `provenance.md`'s "Post-hoc
     correction (iteration 29's `completeness` score)" section) holds
     that `completeness` is protocol-scoped to `quay:author`/
     `quay:execute`'s own SKILL.md Method-step content, not "this
     experiment's own iteration-guidance document" (`experiment/
     ITERATION-PROMPTS.md`), with iteration 10's directly-on-point prior
     precedent cited for the same reasoning.
   - **However, there is a material factual distinction between iteration
     29's precedent and this iteration's fact pattern that the report
     does not surface, and that weighs the opposite direction from how
     iteration 39 applies it.** `experiment/ITERATION-PROMPTS.md` is the
     **experiment-process runbook** — it is never cited by
     `quay:author`/`quay:execute`'s own SKILL.md files as their design
     source; it governs how the *human-and-agent iteration loop itself*
     is run, one level further removed from the Skills' own methodology
     than the Skills' own content. `docs/proposal/quay-native-design.md`,
     by contrast, is cited directly and repeatedly, by name and section
     number, as the design specification the Skills themselves implement
     against (confirmed in Finding 4 above: "Layer-2 orchestration Skill
     (quay-native-design.md §5)" appears verbatim in both SKILL.md
     files). Protocol §5.2's literal text — "Methodology (Skills + gates
     + decomposition rule) fully documented and self-contained" — is at
     least as plausibly read to include the design document that *defines*
     the decomposition rule (§4, explicitly titled "Epic decomposition,"
     directly underlying the "decomposition rule" language in §5.2's own
     wording) as it is to exclude it. This is a genuinely closer call than
     iteration 29's ITERATION-PROMPTS.md case, in the direction of
     *possibly* being in-scope, not confirmed out-of-scope by mechanical
     application of the cited precedent.
   - **This does not amount to a proven overclaim requiring correction.**
     Iteration 38's own audit (read in full) faced the structurally
     identical ambiguity for `packages/quay-github/DESIGN.md`/
     `provider.yml` and reached the same conclusion this audit reaches:
     the literal protocol wording is not perfectly unambiguous, but
     relying on an already-audited precedent (iteration 29, confirmed via
     its own independent audit, not iteration 39's self-serving citation)
     rather than re-litigating from raw text each time is the correct,
     disciplined default — and iteration 38's audit explicitly held that
     a closer precedent existing (there, iteration 12/QN-026; here, the
     design-doc-is-cited-by-Skills distinction above) is "a thoroughness
     gap, not a correctness error," because applying the closer
     consideration would not obviously flip the final score either way
     (crediting `completeness` `+0.01` for annotating five
     already-resolved decisions as resolved, with no new Skill
     Method-step content and no new decomposition-rule content actually
     added, is a weak case for genuine methodology-completeness growth
     regardless of which document technically houses the prose). The
     flat hold stands as the safer, non-overclaiming choice, and iteration
     39's report is transparent that this is its most audit-sensitive
     claim (§9 point 2) — inviting exactly this scrutiny rather than
     hiding the ambiguity. **No correction required; this is recorded as
     a thoroughness note for a future iteration to weigh, echoing
     iteration 38's own analogous finding, not a factual error.**
   - `skeleton`, `abi_symmetry`, `gate_correctness`, `skill_convergence`:
     independently reconfirmed against `git diff --stat -- '*.js' '*.yml'`
     (empty) and against protocol §5.1's precise wording — correctly held
     flat; no new capability, schema-equivalence proof, gate logic, or
     Skill Method-step content was produced.
   - `effectiveness`, `reusability`, `validation`: independently
     reconfirmed correctly held flat per the same reasoning as iterations
     37/38 (no code-changing Skill-orchestration-timing-shaped work, no
     GitHub-Provider capability construction, audit not yet performed
     prior to this one).

6. **σ_strict arithmetic and task-count denominator — VERIFIED exact.**
   `ls tasks/QN-*.md | wc -l` = 49, matching the report's post-iteration
   count. `41/48 = 0.854166...` ≈ 0.8542 (prior value) and `42/49 =
   0.857142...` ≈ 0.8571 (post-iteration value), both independently
   recomputed and matching the report exactly.

7. **V_instance and V_meta unchanged — VERIFIED consistent with the
   flat-hold.** `0.70 × 0.96 × 0.76 × 0.96 = 0.490291...` ≈ 0.4903;
   `0.74 × 0.26 × 0.79 × 0.64 = 0.097277...` ≈ 0.0973. Both recomputed
   exactly matching the report, both unchanged from iteration 38.

8. **Convergence verdict — VERIFIED sound, including the "fifth
   consecutive iteration" framing for criterion 5.** V_instance (0.4903)
   and V_meta (0.0973) both far below the 0.80 dual threshold — criterion
   1 correctly NO. σ = 0.8571, far from 1 — criterion 2 correctly NO.
   Criterion 3 correctly NO (a documentation fix proves nothing new about
   "native + GitHub both run"). Criterion 4 correctly NO (no audit
   existed for this iteration's work until now). For criterion 5,
   independently re-tabulating the literal-test outcome across
   iterations 33-39 from each iteration's own report text: iteration 33
   NO (ΔV_instance = +0.0119, ≥ 0.02), iteration 34 YES (post-correction,
   +0.0047 < 0.02), iteration 35 YES (post-correction, +0.0050 < 0.02),
   iteration 36 YES ("second consecutive"), iteration 37 YES ("third
   consecutive," ΔV_instance = +0.0070), iteration 38 YES ("fourth
   consecutive," ΔV_instance = 0.0000), iteration 39 YES ("fifth
   consecutive," ΔV_instance = ΔV_meta = 0.0000). The streak (34/35
   through 39) is 5 consecutive iterations at report time — "fifth
   consecutive" is a defensible, non-inflated count of the run currently
   in progress at iteration 39; it matches the reports' own tally exactly.
   Scoring criterion 5 NO-on-substance despite the literal pass is
   consistent with standing practice since iteration 28 (ΔV pinned near
   its own floor, not approaching the 0.80 threshold).

9. **`git status --short` — VERIFIED clean** except the one known
   pre-existing untracked file, `docs/proposal/
   baime-lite-driving-external-projects.md`.

10. **Full regression suite — VERIFIED unchanged, 24 files.**
    `find . -name "*.test.mjs" -not -path "*/node_modules/*" | wc -l` = 24,
    matching the report exactly (no new test file, consistent with a
    docs-only fix). All 24 re-run individually via direct `node <file>`
    invocation: 24/24 exit 0. `node packages/quay-native/test/
    abi-symmetry.mjs` reports "ALL FOUR SURFACES SYMMETRIC," unchanged.

## Net assessment

Iteration 39 continues the recovery pattern established at iterations 37
and 38: every precedent cited (iteration 29's `completeness` correction,
QN-049's preserve-and-annotate convention) was actually read and
accurately characterized, not assumed from memory or a plausible-sounding
title. The headline QN-050 finding is genuine — all five §8 items really
were stale, and all five resolution claims independently re-derive exactly
as cited, down to specific file/line evidence. The `git diff --stat`
zero-code-diff claim, the σ/task-count/V-factor arithmetic, the regression
suite, and the clean git status all reproduce exactly.

The `199cd9d` citation — flagged for special scrutiny by the audit brief —
is handled honestly: the commit is real, its date/author/content are
accurately described, it is correctly identified as never previously
logged in `provenance.md`, and — critically — the report never claims or
implies it was part of this iteration's or any prior *numbered* iteration's
own work. It is used only as secondary corroborating context for a
conclusion whose actual load-bearing support is the iteration-29 precedent,
not as a substitute precedent standing on its own. This is the correct,
non-misleading way to use an out-of-band artifact.

The one substantive point of genuine ambiguity is whether
`quay-native-design.md` — a document directly and repeatedly cited by
`quay:author`/`quay:execute`'s own SKILL.md files as their design
specification — is meaningfully closer to `completeness`'s protocol scope
than iteration 29's `ITERATION-PROMPTS.md` case, given §5.2's "Skills +
gates + **decomposition rule**" wording and §4 of the design doc being
titled "Epic decomposition." This is a legitimate open question, not a
proven overclaim: the same tension existed, unresolved, in iteration 38's
audit for the sibling `provider.yml`/`DESIGN.md` case, and this audit
reaches the same conclusion iteration 38's did — relying on the
already-audited iteration-29 precedent rather than re-litigating from raw
protocol text is the correct disciplined default, and forcing a `+0.01`
credit for annotating five already-resolved, already-exercised decisions
(no new Skill Method-step content, no new decomposition-rule content) would
be a weak, likely-reversible claim regardless of which document technically
houses the prose. **No correction to `iteration-39.md` or
`provenance.md` is required.**

**No correction needed. Iteration 39 stands as reported. The clean-PASS
streak (37, 38, 39) now extends to three consecutive iterations.**

# Iteration 42 — Independent Out-of-Band Audit (G3)

**Auditor:** fresh, zero-prior-context out-of-band review. Read
`docs/proposal/quay-bootstrap-experiment.md` §5.1/§5.2/§7 in full,
`experiments/quay-native-bootstrap/iterations/iteration-42.md` in full, `experiments/quay-native-bootstrap/provenance.md`
(the seven "## Post-hoc correction" instances — six standalone headers at
iterations 25, 29, 31, 33, 34, 35, plus one embedded, strikethrough-marked
correction inside the iteration-36 V-factor attribution section), and the
prior five clean audits (iterations 37-41). Ran all commands directly
against the working tree: `.gitignore` inspection, `git log --all` for the
gitignored file, `git show af577cd`, direct file reads of all three edited
proposal documents, a live `gh issue list`, `ls tasks/QN-*.md | wc -l`, a
full 24-file regression-suite re-run (`node --test` per file, not
string-matching), `abi-symmetry.mjs`, independent V/σ recomputation, and
`git status --short`/`--ignored`.

**Verdict: PASS** — every headline claim, including the unusual
`.gitignore` discovery, is independently verified accurate. Iteration 42
extends the clean-PASS streak (37, 38, 39, 40, 41) to six consecutive
iterations.

## Findings

1. **The `.gitignore` discovery — VERIFIED, precisely as claimed, with
   special scrutiny given as instructed.**
   - `grep -n "quay-bootstrap-experiment" .gitignore` confirms it is the
     literal first line (`.gitignore:1:docs/proposal/quay-bootstrap-experiment.md`).
   - `git log --all --oneline -- docs/proposal/quay-bootstrap-experiment.md`
     returns **zero commits** — confirmed the file has never once been
     tracked by git, in any branch, at any point in this repository's
     history.
   - `git check-ignore -v docs/proposal/quay-bootstrap-experiment.md`
     confirms the match against `.gitignore:1`. `git ls-files | grep -i
     bootstrap` returns nothing.
   - `git show af577cd -- .gitignore` confirms `af577cd` ("Add initial
     configuration files and update .gitignore") created `.gitignore` as a
     brand-new file with exactly one line:
     `docs/proposal/quay-bootstrap-experiment.md`. Independently checking
     `git log --oneline --all | tail -5` and `git rev-list --max-parents=0
     HEAD` shows `af577cd` is the repository's **third commit overall**
     (after `d2a09ca` "Add initial glossary and proposal documentation"
     and `2178b80` "Refine glossary definitions..."), and strictly
     predates `5b452aa` ("Add quay-native and quay Core v0-v1 walking
     skeleton, experiment scaffold" — the commit that added
     `experiments/quay-native-bootstrap/iterations/iteration-0.md`). This precisely confirms the
     report's claim: the gitignore entry dates to before iteration 0's own
     commit, at the very beginning of the repository's history.
   - **This is a genuine, previously-unknown-in-any-iteration-report
     structural fact, correctly identified and precisely stated.** No
     overclaim found: the report does not claim to know *why* it was
     gitignored (deliberate vs. oversight), only *that* it was, since when,
     and that it is a first-line, single-file, from-day-one entry — all of
     which is exactly true.

2. **On-disk Status-line edit — VERIFIED present, and genuinely
   untracked/unstaged.**
   - Direct read of `docs/proposal/quay-bootstrap-experiment.md` line 3
     confirms: `- **Status:** Authoritative protocol record; experiment in
     progress (41 iterations completed as of 2026-07-15, NOT CONVERGED —
     see \`experiments/quay-native-bootstrap/iterations/iteration-41.md\`...)`. `grep -n "Draft
     (pre-implementation)"` against the file returns **no match** —
     confirming the stale text is genuinely gone from the live file.
   - `git status --short` (plain) does **not** list this file at all —
     confirmed by direct run; only
     `docs/proposal/baime-lite-driving-external-projects.md` (the known
     pre-existing untracked file) appears.
   - `git status --short --ignored` **does** list it, correctly under the
     ignored section: `!! docs/proposal/quay-bootstrap-experiment.md`,
     alongside other expected ignored paths (`node_modules/`,
     `.manda/hub.addr`, `experiments/quay-native-bootstrap/timing/*.log`). This exactly matches
     the report's own claim 11 framing (file 3 in the audit brief) —
     invisible to plain status, visible only under `--ignored`.

3. **The same Status-line fix on the two tracked documents — VERIFIED
   genuinely git-tracked.**
   - `docs/proposal/quay-proposal.md` line 3 and
     `docs/proposal/quay-native-design.md` line 3 both read updated,
     evidence-cited Status lines (41 iterations, both Providers built and
     running), independently re-read directly from disk.
   - `git log --oneline -3 -- docs/proposal/quay-proposal.md
     docs/proposal/quay-native-design.md` shows commit `f0af3c0` ("Iteration
     42: fix stale Status headers in three proposal docs (QN-053)") as the
     most recent touch to both files — confirming the edit is genuinely
     committed for these two, unlike the third file.

4. **The problem-list flag — VERIFIED present and honestly worded, not
   glossed over.** Iteration 42's own "Problems identified for next
   iteration" §1 states this is "the single most notable new finding this
   iteration," explicitly recommends against unilaterally changing
   `.gitignore` without human/directive authorization, and explicitly
   frames it as "a genuine open question, not a task item." Section 9 also
   independently names it as audit-scrutiny item 1-3. This is a correct,
   non-silent treatment — the report neither buries the finding nor
   unilaterally resolves it.

5. **The effectiveness/reusability search — plausible and consistent with
   standing G6 findings.**
   - `gh issue list --repo yaleh/quay --json number,title,labels,state`
     independently re-run: issue #3 (`status:ready`) and #4
     (`status:todo`) both confirmed open, exactly as the report describes,
     unchanged from iteration 41's own findings.
   - `ls tasks/QN-*.md | wc -l` = 52 at audit time (52nd task, QN-053, now
     exists as claimed post-iteration).
   - The `ToolSearch`-for-subagent-dispatch claim is consistent with the
     standing G6 finding across the whole precedent chain (DIR-004/DIR-005,
     iteration 15's 5/5 failure result): `mcp__plugin_manda_manda__Agent`
     is the same tool repeatedly surfaced and repeatedly found unreliable
     for fresh-context independent dispatch. No new evidence contradicts
     this; the report is honest that it did not re-test (correctly citing
     "repeat the same searches without new input" as an anti-pattern to
     avoid).

6. **All 8 V-factors held flat — VERIFIED consistent with the evidence.**
   `git diff --stat -- '*.js'` against `f0af3c0`'s parent independently
   confirmed empty (the commit only touches two `.md` proposal files plus
   iteration/provenance/task bookkeeping files — no `.js` path at all).
   `skeleton`, `abi_symmetry`, `gate_correctness`, `skill_convergence`
   correctly ruled out on this evidence. No `skills/*/SKILL.md` path
   touched — `completeness` correctly not implicated, and the "one level
   further out than iteration 39" framing (crediting no prior
   `completeness`-adjacent fix touched `quay-proposal.md`/
   `quay-bootstrap-experiment.md`) is a fair, non-overclaiming extension of
   iteration 39's own precedent language. `effectiveness` and `reusability`
   correctly held flat (documentation-only, no Provider capability
   touched). `validation` correctly held flat pending this very audit.

7. **σ_strict arithmetic and task-count denominator — VERIFIED exact.**
   `ls tasks/QN-*.md | wc -l` = 52 (post-iteration), matching the report's
   "45/52" denominator. Independently recomputed: `44/51 =
   0.862745...` ≈ 0.8627 and `45/52 = 0.865384...` ≈ 0.8654 — both exactly
   match the report.

8. **V_instance and V_meta unchanged — VERIFIED.** Independently
   recomputed: `0.70×0.96×0.76×0.96 = 0.490291...` → 0.4903, and
   `0.74×0.26×0.79×0.64 = 0.097277...` → 0.0973 — both exactly match
   iteration 41's end-state values, confirming zero movement.

9. **Regression suite and `abi-symmetry.mjs` — VERIFIED unchanged, 24
   files, all passing.** `find packages -name "*.test.mjs" | wc -l` = 24,
   matching the report. All 24 independently re-run via direct `node
   --test <file>` invocation: 24/24 exit 0, zero failures. `node
   packages/quay-native/test/abi-symmetry.mjs` independently re-run:
   reports "ALL FOUR SURFACES SYMMETRIC," unchanged.

10. **Convergence verdict — VERIFIED sound, including the "eighth
    consecutive iteration" framing for criterion 5.** V_instance (0.4903)
    and V_meta (0.0973) both far below 0.80 — criterion 1 correctly NO.
    σ = 0.8654, far from 1 — criterion 2 correctly NO. Criterion 3
    correctly NO (a Status-line/metadata fix proves nothing new about
    "native + GitHub both run"). Criterion 4 correctly NO (no audit
    existed for this iteration's own work prior to this report).
    Independently re-tabulated ΔV from each iteration's own report text,
    iterations 35-42: iteration 35 (+0.0050 post-correction, 0.0000),
    36 (0.0000, 0.0000), 37 (+0.0070, 0.0000), 38 (0.0000, 0.0000),
    39 (0.0000, 0.0000), 40 (0.0000, 0.0000), 41 (0.0000, 0.0000),
    42 (0.0000, 0.0000) — all eight iterations' ΔV values are < 0.02,
    confirming the literal criterion-5 test is satisfied for an **eighth**
    consecutive iteration, exactly as claimed (correctly extending iteration
    41's own audit-verified "seventh consecutive" tally by one). Scoring NO
    on substance is consistent with standing practice since iteration 28.

11. **`git status --short` — VERIFIED clean**, showing only the
    pre-existing untracked `docs/proposal/baime-lite-driving-external-projects.md`.
    Independently confirmed `docs/proposal/quay-bootstrap-experiment.md`
    does **not** appear in plain `git status --short` output — it appears
    only under `git status --short --ignored` as `!! ...` — exactly the
    behavior the report describes and the audit brief asked to be
    explicitly verified. `git log --oneline -1` confirms `f0af3c0`
    (iteration 42's commit) is the current HEAD with no intervening or
    uncommitted changes at audit start.

12. **Post-hoc correction count — VERIFIED seven, matching the report's
    (and iteration 41's own) framing.** `grep -n "Post-hoc correction"
    experiments/quay-native-bootstrap/provenance.md` finds exactly six standalone headers
    (iterations 25, 29, 31, 33, 34, 35), plus one embedded,
    strikethrough-marked correction inside the iteration-36 section — seven
    total, consistent across iterations 40, 41, and 42.

## On whether the gitignore discovery is honestly scoped

Special scrutiny was given to this claim, as instructed, precisely because
it is a surprising structural fact about the entire 42-iteration
experiment. The audit finds:

- The discovery is **real and precisely dated** (predates iteration 0 by
  two commits), not approximated or asserted from memory.
- The report does **not** overreach into claiming a cause (deliberate vs.
  oversight) — it explicitly declines to adjudicate that question itself,
  correctly deferring to a human/future directive, which is the right call
  given `.gitignore` is infrastructure outside this task's authorized
  scope (a Status-line fix).
- The claim that the fix is real-but-invisible to git is independently
  reproducible exactly as described: the file reads correctly on disk, is
  absent from `git ls-files`, absent from plain `git status --short`, and
  present only under `--ignored`.
- No part of this finding was fabricated, exaggerated, or silently
  absorbed into a routine documentation-fix narrative — it is flagged
  plainly, twice (execution narrative and problem list), for the next
  reader's attention.

## Net assessment

Iteration 42 continues the recovery pattern established at iterations 37
through 41, with the added complexity of a genuinely unusual, structurally
significant discovery handled correctly under audit scrutiny. Every
citation and precedent invoked (the iteration 38/39/40/41 V-factor-flat
precedent chain, the "seven post-hoc corrections" framing, the
`ToolSearch`/G6 subagent-dispatch precedent, GitHub issues #3/#4 status)
is accurate and precisely scoped, independently reproduced rather than
trusted from the report's own restatement.

The headline finding — that `docs/proposal/quay-bootstrap-experiment.md`
has been gitignored and untracked by git since before iteration 0 — is
confirmed exactly as claimed: first line of `.gitignore`, created in the
repository's third commit (`af577cd`), zero tracked history for the file
ever since, and the on-disk Status-line edit this iteration made is real,
verifiable by direct read, and genuinely invisible to `git diff`/`git
status` (short of `--ignored`). The report's decision to flag this for
human attention rather than unilaterally editing `.gitignore` is the
correct, protocol-conservative choice (an infra change outside this task's
authorized scope), and it is stated honestly rather than glossed over.

σ arithmetic (45/52 = 0.8654), V_instance/V_meta recomputation (0.4903,
0.0973, both unchanged), the 24-file regression suite, `abi-symmetry.mjs`,
and `git status` all reproduce exactly. The criterion-5 "eighth
consecutive iteration" tally independently re-derives correctly from each
of iterations 35-42's own reported ΔV values.

**No correction needed. Iteration 42 stands as reported. The clean-PASS
streak (37, 38, 39, 40, 41) now extends to six consecutive iterations.**

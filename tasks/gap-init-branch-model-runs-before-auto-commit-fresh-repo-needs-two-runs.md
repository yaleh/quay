---
id: gap-init-branch-model-runs-before-auto-commit-fresh-repo-needs-two-runs
title: "quay init: branch model is judged before auto-commit, so a fresh
  0-commit repo needs two runs and run 2 silently switches develop->author"
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal
Evidence origin: cold-start /quay:init on fresh dir /data/home/yale/work/quay-fleet, quay 0.19.0 (plugin cache), reported 2026-10-12 by the session "user/project scope 下的 quay 旧版本".
Minimal repro: `git init -b develop` (0 commits) then `quay init --root . --test-command X --auto-commit-confirm`. Run 1 prints "branch model: SKIPPED — the repository has no commits yet" and "doc branch ... [NOT-EVALUATED]", and only THEN "auto-commit: committed 5 file(s)". Run 2 prints "[CREATED] doc-branch -> author — created 'author' at 'develop' and switched the main checkout to it". So (i) a fresh repo cannot converge in one run, and (ii) run 2 changes the working branch with only a bracketed line as notice. Relevant code: autoCommitClosedSet (init.ts ~:3795, called ~:2075); the branch model is evaluated earlier (branch-model.ts, reason "no-commits"). The ordering rationale is UNKNOWN (intentional vs historical) and must be investigated first.

## Plan
1. Investigate and record in the task notes why the branch model precedes auto-commit (does it need config written first? does auto-commit need the branch settled?); git log / blame on both call sites.
2. Preferred: re-evaluate the branch model after auto-commit inside the same run so one init converges. Fallback if the order is load-bearing: emit an explicit "needs a second init run" line.
3. Either way the main-checkout switch must be named in the summary (old branch -> new branch), never only inside a [CREATED] line. The not-evaluated state keeps its own output value, never shaped like ok (rule 3b).

## Acceptance Criteria
- [x] A test builds a 0-commit repo and runs init ONCE; the branch model ends decided, or an explicit asserted needs-rerun signal is present — not SKIPPED with no hint.
- [x] A test asserts that when init switches the main checkout branch, the summary names both branches.
- [x] Re-running init on the converged repo changes nothing (idempotent).
- [x] `node --test packages/quay/test/init.test.mjs` exits 0.

## Definition of Done
Ordering rationale recorded; ACs ticked with output pasted; the chosen variant (re-evaluate vs explicit hint) justified in the notes.

## Notes

### The ordering rationale (Plan step 1) — investigated, and it is LOAD-BEARING, but not for the half that bites
`git log -L 1640,1652:packages/quay/src/init.ts` puts the branch-model call site at `e0279c77a`
("quay-init.sh → ≤40-line shim over bin/quay init"). The rationale is stated in the code at that
site: the model must be judged **before the config WRITE** — `develop` is ESTABLISHED there (that is
what turns the fan-in's `?? "develop"` default from an assumption into a fact), and a project whose
`develop` is a foreign line must be refused with the tree UNTOUCHED (an upgrade that had already
rewritten the config could not keep that promise).

Confirmed against the RETIRED shell entry (`git show e0279c77a^:plugin/scripts/quay-init.sh`), which
is the strongest available evidence that this is inherited rather than newly introduced:
`ensure_target_branch_model` is called at **line 1290** and `auto_commit_laid_down` at **line 1328**
— branch model → closed-set write → auto-commit, the SAME sequence, since long before this engine.

⛔ **The load-bearing constraint is "before the WRITE", never "before the COMMIT".** An auto-commit
is by construction a commit OF the just-written config, so it can only ever run after the write; on a
ZERO-commit repository it is also the single event that brings the branch model's ENTIRE INPUT into
existence. Both steps were individually correct and the gap was BETWEEN them.

⇒ **Nothing about the order was changed.** The pre-write judgment stays exactly where it is (that is
what makes a refusal leave the tree untouched); the fix ADDS a second judgment after the write, for
the one state the first one structurally cannot decide.

### Chosen variant: RE-EVALUATE in the same run (Plan step 2, preferred arm) — plus the explicit hint as the honest other half
`runInit` now re-runs the SAME `ensureBranchModel` → `moveCheckoutOntoLandingBaseline` →
`ensureDocBranch` primitives, in the SAME order, that the NEXT `quay init` would have run (ADR-004:
one judgment source, no second predicate). Gated on the new first-class `BranchModelReport.skipReason
=== "no-commits"` — a POSITION, never a keyword match on a prose detail (hard rule 2).
`not-a-git-worktree` is excluded on purpose: no commit this run makes can change it. Every repo that
already HAD a commit keeps its pre-write verdict byte-identical.

The fallback arm is kept for the case the re-evaluation structurally cannot fix — auto-commit
declined/skipped, so the repo is STILL unborn at exit. There `formatBranchModelReport` now renders a
second `[NOT-EVALUATED] branch-model -> develop` line naming the remedy, because the two skips are not
the same answer and must not render the same (hard rule 3b): "there is no git here" is a verdict about
the TARGET, "there are no commits YET" is a verdict about its MOMENT.

Supporting changes:
- `formatDocBranchReport` emits a dedicated `main checkout: <from> -> <to>` summary line for the three
  actions that actually move the checkout (`created`/`switched`/`adopted`), and nothing for
  `noop`/`blocked`/`unreadable`/`failed`. A new `DocBranchReport.dryRun` keeps a PLAN from being
  printed in the past tense (`--dry-run` renders `WOULD MOVE — … the working copy is still on the
  left-hand branch`).
- `InitResult.postWriteBranchModelFailure` is the post-write failure channel, read by `cli/init.ts`'s
  `written`/`rebuilt` arm (exit 1). ⛔ Deliberately NOT `failureReason`: the pre-write arms promise
  "NOTHING WAS WRITTEN" and by then the config IS on disk — a caller must be able to tell them apart.

### Measured before/after (fixture: `git init -b develop`, 0 commits, `--auto-commit-confirm`)
BEFORE (2 runs needed; run 2 silently flipped the branch):
```
=== RUN 1 ===
branch model: SKIPPED — the repository has no commits yet — nothing to branch from
doc branch (name: author, landing baseline: develop):
  [NOT-EVALUATED] doc-branch -> author — the main checkout is on 'develop' but that ref does not resolve …
  auto-commit: committed 5 file(s) as chore(quay-init) (plugin vunknown)
=== branches after run1 ===   * develop
=== RUN 2 ===
  [CREATED] doc-branch -> author — created 'author' at 'develop' (86c7f087) and switched the main checkout to it …
=== branches after run2 ===   * author   develop
```
AFTER (ONE run converges, and the move is named):
```
=== RUN 1 ===
branch model (default branch: develop):
  [REUSED] default -> develop — project default branch (master role; quay never renames or moves it)
  [REUSED] doc-branch -> develop — the doc-only work branch is DERIVED at runtime …
  [REUSED] landing-baseline -> develop — 'develop' contains 'develop' (0 commit(s) ahead, 0 behind) — a valid quay landing baseline
doc branch (name: author, landing baseline: develop):
  [CREATED] doc-branch -> author — created 'author' at 'develop' (b779f96d) and switched the main checkout to it …
  main checkout: develop -> author (this working copy was switched)
  auto-commit: committed 5 file(s) as chore(quay-init) (plugin vunknown)
=== branches after run1 ===   * author   develop
=== RUN 2 (idempotent) ===
doc branch (name: author, landing baseline: develop):
  [NOOP] doc-branch -> author — the main checkout is on 'author', which is not the landing baseline 'develop' …
=== branches after run2 ===   * author   develop        (unchanged)
```
The sibling shape — `git init -b main`, 0 commits — converges in ONE run too, and exercises the
handoff the fresh-`main` path needs:
```
  [CREATED] landing-baseline -> develop — created 'develop' at main (f4839e0b)
landing-baseline checkout (from: main, to: develop):
  [SWITCHED] baseline-checkout — switched the main checkout from 'main' to the landing baseline 'develop' — both point at f4839e0b …
  [CREATED] doc-branch -> author — created 'author' at 'develop' (f4839e0b) and switched the main checkout to it …
  main checkout: develop -> author (this working copy was switched)
=== branches ===   * author   develop   main
```
The still-unborn fallback (auto-commit skipped — nothing this run could judge):
```
branch model: SKIPPED — the repository has no commits yet — nothing to branch from
  [NOT-EVALUATED] branch-model -> develop — no verdict was reached, so this is NOT a pass: re-run `quay init` once the repository has a first commit …
```

### AC evidence
- AC1 — `AC1 (unborn repo): ONE init converges` + its negative control `AC1 (negative control): with
  NO commit created, the verdict stays WITHHELD and carries an explicit needs-rerun signal`. The pair
  is the point: the first would also pass on a fix that simply never skips, so the control pins that a
  genuinely unjudgeable repo still gets the NOT-EVALUATED shape rather than a fabricated verdict.
- AC2 — `AC2: when init switches the main checkout, the summary names BOTH branches` reads the two
  names OUT of the summary line and checks them against git itself (a literal `/develop -> author/`
  grep would pass even if the line named the wrong branches), plus a negative control asserting a
  no-move run prints no such line. Fixture note: the pre-move branch is read with `symbolic-ref`, not
  `rev-parse --abbrev-ref` — the latter fails outright on an unborn HEAD, so it can only ever express
  the already-committed shape this task is not about.
- AC3 — `AC3: re-running init on the converged repo changes NOTHING (idempotent)` compares HEAD,
  `git branch -a`, `rev-parse HEAD` and the config BYTES across the two runs.
- AC4 — `node --test packages/quay/test/init.test.mjs` → `EXIT=0`, `ℹ tests 79 / pass 79 / fail 0`.

### Touches widened (declared, not smuggled)
`packages/quay/src/cli/init.ts` is added to `## Touches`: the CLI is the surface that turns the
verdict into a summary line and an exit code, so the post-write failure channel is only meaningful if
that arm reads it. `packages/quay/src/branch-model.ts`'s formatters and `packages/quay/src/init.ts`'s
`runInit` cannot deliver AC1/AC2 without it.

## Touches
- packages/quay/src/init.ts
- packages/quay/src/branch-model.ts
- packages/quay/src/cli/init.ts
- packages/quay/test/init.test.mjs
- tasks/gap-init-branch-model-runs-before-auto-commit-fresh-repo-needs-two-runs.md

# DIR-006

- status: pending
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-17
- title: Introduce git worktree isolation — each iteration must execute development and testing in an isolated worktree, merging back only after confirmed success

## Finding

In this conversation, the human noted that the most recent iteration (iteration
3) did not open a separate git worktree, and asked why.

Investigation (not assumption) found:
- `git worktree list` shows exactly one worktree
  (`/home/yale/work/quay` on `master`); no other worktree currently exists
  or has left metadata under `.git/worktrees/`.
- `ITERATION-PROMPTS.md` for this experiment (and for
  `quay-native-bootstrap` / `quay-core-bootstrap`) contains **zero**
  mentions of "worktree" as a requirement. The only "isolation" language
  in the protocol concerns G3-audit / independent-visual-review
  **agent-context** dispatch (a fresh Agent/Task session judging the
  work), which is a distinct concern from git-worktree **filesystem**
  isolation.
- Across all three experiments' full history (89 + 11 + 4 iteration
  reports, plus directives/audits), every mention of "worktree" found was
  incidental noise — `EnterWorktree`/`ExitWorktree` surfacing as
  unrelated tool names in `ToolSearch` results while iterations searched
  for a subagent-dispatch primitive (`quay-native-bootstrap`
  iterations 7, 8, 9, 32; `DIR-001`, `DIR-005` in that experiment).
- One iteration (`quay-native-bootstrap/audits/iteration-3-adjudicate.md`)
  explicitly evaluated `EnterWorktree`/`ExitWorktree` and concluded they
  provide "git-worktree filesystem isolation, not agent-context isolation
  or independent judgment" — i.e. the tool was considered and deliberately
  judged not applicable to the G3-independence problem, not overlooked.
- `quay-core-bootstrap`'s full directory tree has zero worktree mentions
  of any kind.

Conclusion: **no iteration of any of the three experiments has ever used
git worktree isolation for iteration execution.** This is not a recent
regression in experiment 3 — it is, and always has been, the standing
(undocumented, never-decided) practice across the whole project. Separately,
this steering session and the session executing experiment 3's iterations
currently operate in the **same working directory** (`/home/yale/work/quay`,
single worktree) — the exact scenario in which filesystem-level isolation
would matter, and where the earlier DIR-002/DIR-003 commits already had to
work around in-flight files touched by the other session because no such
isolation exists today.

## Requested action

1. **From the next iteration that applies this directive onward, each
   iteration's development and testing work must execute inside a
   dedicated git worktree**, created fresh for that iteration (e.g. via
   `git worktree add ../quay-webui-iteration-N <branch-name>`, or the
   `Agent` tool's `isolation: "worktree"` option where the work is done by
   a dispatched subagent) — not directly in the shared main working tree.

2. **The iteration's own report must record**: the worktree path/branch
   used, the commands used to create it, and confirmation that
   development + the full test suite (`node --test` / equivalent) were
   run inside that worktree, not the main tree.

3. **Merge back into the main line (`master`) only after the iteration's
   own success criteria are confirmed** inside the isolated worktree
   (tests pass, G3 audit criteria met, etc.) — do not merge speculative or
   partially-verified work. State explicitly in the report which merge
   mechanism was used (fast-forward merge, rebase, or a regular commit
   sequence via the worktree's branch) and why.

4. **Remove the worktree after a successful merge** (`git worktree
   remove`), so stale worktrees don't accumulate; if a worktree is
   abandoned instead of merged (iteration failed / superseded), record
   that explicitly and clean it up too rather than leaving it dangling.

5. **This is a process/isolation change, not a V_instance-factor claim.**
   Applying this directive does not by itself move `ui_read_capability`,
   `visual_design_quality`, `verified_by_construction`, or
   `backlog_health` — it changes *how* iteration work is executed and
   merged. State plainly in the applying iteration's report that this is
   infrastructure/process scope, same framing as DIR-004.

6. **If a genuine structural blocker prevents worktree creation** in the
   iteration's environment (e.g. disk space, a tool precondition that
   fails), the iteration must show concrete evidence of the blocker (not
   just assert unavailability) before falling back to direct execution in
   the shared tree, and must flag that fallback explicitly as a deviation
   requiring separate review — same evidentiary bar DIR-002 set for G3
   dispatch fallbacks.

7. Record the resolution of this directive (applied/deferred/rejected,
   with evidence) in whichever iteration first acts on it.

## Resolution
<!-- to be filled in by whichever iteration applies it -->

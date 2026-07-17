# DIR-009

- status: pending
- created_by: human (Yale), asserted directly in this live conversation
- created_at: 2026-07-17
- title: The iteration orchestrator must honor the hardened ITERATION-PROMPTS gates verbatim — no diluting worktree isolation or process-dimension blocking gaps when authoring per-iteration prompts

## Finding

Direct observation of iteration 12's development-phase subagent transcript
(`agent-abf0d89189264f04f.jsonl`, spawned as a `general-purpose` agent) showed
that the failure flagged in gap-list PR-001/PR-002/PR-003 is **not** the
executor's sloppiness. It is authored into the per-iteration prompt by the
orchestrating session (the parent main-loop). There are two layers:

- **Layer A — `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md`**
  (the standing, checked-in template). Its worktree gate already required real
  isolation with an evidentiary bar; its HARD GATES block already required raw
  `ls` output and per-file dispositions.
- **Layer B — the per-iteration prompt the orchestrator writes fresh each
  iteration** (the Chinese "开发阶段执行器" prompt handed to the subagent).
  This is where the template's requirements get diluted in translation:
  1. Worktree isolation was reduced to a ritual line — "创建 worktree（协议合规，
     注意 ENV 限制仍存在）" — dropping Layer A's "show reproduced blocker
     evidence, flag as deviation" bar and pre-asserting the ENV excuse. The
     prompt then set 工作目录 = repo root and gave §5 edit paths at repo root,
     so all six of the executor's edits landed in the shared tree. **PR-002
     recurred for the 13th time, authored directly into the prompt.**
  2. The entering-state summary reported "当前开放 significant gaps: 0" and
     listed only V_instance-dimension minor gaps (CB/UQ/SH). The three OPEN
     `blocking` process-dimension gaps (PR-001/PR-002/PR-003) were filtered out
     before the executor saw them as actionable, and §3 pre-selected a curated
     cluster of minor gaps. **PR-003's "false precondition claim" pattern
     recurred — this time in the orchestrator's own entering-state.**
  3. Net effect is a self-referential blind spot: the process-dimension gaps
     are ABOUT the iteration mechanism, but the mechanism's own prompt excludes
     them from scope, so the failing component is never assigned to fix itself.

`ITERATION-PROMPTS.md` has now been hardened (three gate changes, same
conversation, committed alongside this directive) so that the requirements are
mechanically self-proving rather than prose the orchestrator can paraphrase
away. But hardening the template is necessary, not sufficient: the demonstrated
failure mode is precisely the orchestrator NOT faithfully carrying an
already-adequate template into the per-iteration prompt. That is a Layer-B
behavior, not a checked-in artifact, so it cannot be fixed by editing a file —
it requires a standing behavioral constraint on the orchestrator.

## Requested action

When experiment 4 resumes, the orchestrating session — every iteration, when it
authors the per-iteration prompt for the executor subagent — MUST honor the
hardened `ITERATION-PROMPTS.md` gates verbatim, and specifically MUST:

1. **Not dilute the worktree isolation gate.** The per-iteration prompt must
   set the executor's working directory and ALL development/test edit paths to
   `experiments/quay-continuous-bootstrap/worktrees/iteration-N/…`, not repo
   root. It must require the end-of-iteration isolation PROOF (pasted
   `git -C <worktree> status --short` showing this iteration's writes landed
   there, plus a clean shared tree for those files). It MUST NOT carry forward
   the standing "协议合规，注意 ENV 限制仍存在" / "ENV limitation" boilerplate as
   a pre-authored excuse; a genuine blocker must be reproduced as pasted command
   output at execution time or the deviation does not qualify.

2. **Not summarize process-dimension blocking gaps away.** The per-iteration
   entering-state MUST enumerate every OPEN `blocking` gap verbatim, INCLUDING
   process-dimension (PR-00N) entries, and MUST NOT report "significant gaps: 0"
   (or any V_instance-only roll-up) while such a gap is open. When a
   process-dimension blocking gap is open, the prompt MUST make triaging it the
   iteration's first-priority work item, not hand the executor a curated cluster
   of minor V_instance gaps.

3. **Prefer `baime:iteration-executor` over an ad-hoc `general-purpose`
   subagent** for the development phase, OR — if a general-purpose subagent is
   used — reproduce the hardened gates in the prompt in full rather than an
   abbreviated paraphrase. Iteration 12's dilution correlated with a hand-written
   general-purpose prompt that abbreviated the template.

4. **This directive is itself a process-dimension correction and must be
   dispositioned under the HARD GATES `directives/pending/` disposition gate on
   the first resumed iteration** — not acknowledged-in-place. The resumed
   iteration's report must show, with the pasted git-status proofs the hardened
   gates now require, that PR-002 and PR-003 did NOT recur. Per the human's
   stated halt threshold: if the same form-vs-substance failure recurs after
   these changes are in place, the iteration mechanism is judged failed and the
   experiment halts, independent of any V_instance/V_meta score.

## Resolution
<!-- added when moved to archive/, or updated in place if deferred -->

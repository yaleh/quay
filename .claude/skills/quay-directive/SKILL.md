---
name: quay-directive
description: Draft a new experiments/<EXPERIMENT>/directives/pending/DIR-NNN-*.md from the discussion already in this conversation, auto-detecting which BAIME experiment is currently active, with a built-in safety check that its directives/ has no in-flight iteration changes outside pending/, then project it as a generated label:directive task via task_write (file stays canonical; task is a regenerated projection, never hand-edited — DIR-002/M-DIR-PROJECTION). Every DIR MUST carry runnable Acceptance Criteria + a real-landing Definition of Done (artifacts are necessary-not-sufficient — done means a real object actually operated through the mechanism, not a file created or a fixture passed). Invoke after discussing the finding/action with the user, e.g. /quay-directive manda dispatch confirmed genuine.
allowed-tools: Bash, Read, Write, Edit
---

# quay-directive

    worktree :: master → IsolatedWorktree   -- DEFAULT: never edit DIRs in the shared main tree (the autonomous loop races it)
    draft :: ConversationContext → Brief? → DraftedInWorktree   -- MUST include runnable ## Acceptance Criteria + a real-landing ## Definition of Done (artifacts are necessary-not-sufficient; done = a REAL object through the mechanism)
    project :: DraftedFile → task_write → ProjectedTask   -- generated, never hand-edited (DIR-002/M-DIR-PROJECTION)
    land :: (DraftedFile, ProjectedTask) → commit → ff-merge → master   -- DEFAULT ends at Merged, not merely Drafted

This skill is for **whichever quay BAIME experiment is currently active**,
using the `experiments/<EXPERIMENT>/directives/` mechanism each experiment
inherits from `experiments/quay-native-bootstrap/directives/README.md` (the
original, authoritative write-up of the lifecycle this file assumes — read
it fresh if unfamiliar, don't rely on a stale recollection of it, even when
`<EXPERIMENT>` is a later one). It exists so a human steering the experiment
from outside the autonomous loop can turn a conversation already had into a
directive file quickly and without repeating the mistakes DIR-001 made
(imprecise citations, no built-in check against touching an in-flight
iteration's files) — and, as of this revision, without repeating the
mistake this skill itself originally made: hardcoding `<EXPERIMENT>` to
`quay-native-bootstrap` even after later experiments existed and it had
become the wrong target.

The optional argument after `/quay-directive` is a short title hint only —
it is not a request for new content. The Finding and Requested action
sections must be drawn from what was already discussed in this
conversation before the skill was invoked. If nothing substantive was
discussed yet, stop and say so instead of inventing content.

## Steps

0. **Determine `<EXPERIMENT>` — the currently active experiment. Never
   assume it is `quay-native-bootstrap` by default.**
   List every `experiments/*/` directory that contains a `directives/`
   subdirectory. For each candidate, read its `README.md` `**Status**:`
   line (or, if absent, its most recent `iterations/iteration-N.md` and
   the convergence status stated there) to classify it as one of:
   - **active**: iteration 0+ has run and the experiment has not reported
     HALT / CONVERGED / practical-convergence-accepted in its latest
     iteration or README status line.
   - **not started**: scaffold exists but iteration 0 has not run.
   - **closed**: HALT or CONVERGED, or the README explicitly says so.

   - If exactly one candidate is **active**, use it as `<EXPERIMENT>`.
   - If zero are active (e.g. the newest is "not started" and all
     others are closed) but the conversation's own content is clearly
     about a specific experiment (named directly, or the only
     not-started/experiment under discussion), use that one — state which
     one and why in your response, don't silently pick.
   - If more than one is active, or the right target is genuinely
     ambiguous from the conversation, STOP and ask the user which
     experiment this directive is for, rather than guessing. Do not
     default to the first-created experiment out of habit.

   State the chosen `<EXPERIMENT>` explicitly before proceeding, e.g.
   "Using experiments/quay-webui-bootstrap/ — it's the only active
   experiment; quay-native-bootstrap and quay-core-bootstrap have both
   halted."

1. **Compute next id.** List `experiments/<EXPERIMENT>/directives/{pending,archive,retracted}/DIR-*.md`,
   extract the NNN from each filename, take max+1, zero-pad to 3 digits.
   Always compute this fresh — never reuse a number from memory or from
   an earlier point in the conversation. Note that DIR numbering is
   per-experiment, not global — `<EXPERIMENT>`'s own DIR-001 is unrelated
   to any other experiment's DIR-001.

2. **Safety check (mandatory, not skippable).** Run
   `git status --short -- experiments/<EXPERIMENT>/directives/`. If any line shows a
   path *other than* under `pending/` (i.e. anything in `archive/`,
   `retracted/`, or `README.md` itself, in any status: M/A/D/R/??), STOP
   and report the exact conflicting paths instead of writing a file. That
   means some iteration is mid-flight touching directives state; wait for
   it to commit before drafting. Do not attempt to guess whether the
   conflict is "safe to ignore" — report it and let the user decide.

3. **Create an isolated worktree off `master` — DEFAULT, do this BEFORE writing/editing any DIR
   file.** The autonomous OUTER loop typically shares the main working tree and commits
   continuously; creating or editing a DIR directly in the main tree races it — this has caused
   real incidents (a silent auto-merge that dropped one side's content; a human commit landing on
   the wrong branch mid-publish because the loop had checked out `master` under the editor). So by
   default DO NOT touch the DIR in the main tree. Instead:
   `git worktree add -b human/dir-NNN /home/<user>/work/quay-human master` (pick another path if
   that one is occupied; the branch is throwaway). Do ALL of the drafting (step 4), writing (step
   5) and projection (step 6) INSIDE that worktree, then commit + merge (steps 7-8). This default
   applies to BOTH creating a new DIR and editing an existing one (adding a `## Resolution`,
   flipping `status:`, refreshing a projection). Skip the worktree ONLY if the loop is provably not
   running (no active driver; main tree idle for minutes) — and if you skip it, say so and why.

4. **Draft the file**, following `experiments/quay-native-bootstrap/directives/README.md`'s
   `## File format` exactly (this format is inherited as-is by every later
   experiment's own `directives/`, whether or not that experiment has its
   own copy of the README):
   - `status: pending`
   - `created_by: human (<user>), asserted directly in this live conversation`
     — not a generic "human" attribution; be explicit this came from a
     real conversation turn, per the precedent DIR-003 set after DIR-001's
     attribution was (wrongly) called fabricated.
   - `created_at:` today's date
   - `title:` from the optional brief, or synthesized from the discussion
     if no brief was given
   - `## Finding` and `## Requested action`: drawn from the conversation,
     written as concretely and checkably as the content already discussed
     — not vague restatements
   - `## Acceptance Criteria` (MANDATORY): a checklist of `- [ ]` items, each a
     **runnable command with an exit code** (or an equivalently mechanical,
     grep/query-able check), never a prose claim. Mirror the shape used by the
     recent DIRs: "`<cmd>` exits 0 / 1" — so "done" is machine-decidable, not a
     matter of opinion.
   - `## Definition of Done` (MANDATORY) — **the bar is REAL LANDING, not
     artifacts.** State explicitly that the DIR is NOT done when a script/gate/
     wiring exists, a file is created, or a fixture/test passes — those are
     **necessary but NOT sufficient**. It is done ONLY when the change is actually
     **operative on the real object of the experiment** (e.g. a REAL milestone —
     not a demo/fixture task — actually passed through the new mechanism),
     verifiable by a durable engine/system artifact keyed to that real object (a
     GateEvent / engine-written status / log entry / regenerated projection for the
     real id), and the system's own record (dashboard/ABSORB entry) pastes the real
     command output. Include the escrow rule: the DIR stays `pending` until that
     real-landing evidence exists. This is the anti-"designed-not-wired" clause —
     the exact disease the directive mechanism keeps fighting; do not let a DIR be
     closable by creating a file or going green on a fixture.
   - `## Human verification when exp5 marks this DIR done` (recommended for any DIR
     whose landing the autonomous loop will self-report): a short numbered checklist
     that (a) names the real artifact to inspect, (b) distinguishes real-object
     evidence from demo/fixture/prose evidence, and (c) ends with "if only
     file-creation / fixture-green / prose exists, it is NOT landed — send back."
   - Leave `## Resolution` as a placeholder comment, to be filled in by
     whichever iteration applies it

5. **Write to `<worktree>/experiments/<EXPERIMENT>/directives/pending/DIR-NNN-<slug>.md`** (inside
   the step-3 worktree, NOT the main tree). Show the user the full file contents plus the
   `<EXPERIMENT>` you resolved in step 0. Then do the projection (step 6) and commit + merge (steps
   7-8): **by default this skill carries the DIR all the way to merged on `master`, not merely
   drafted** — the worktree makes committing safe, so the old "stop at drafted, human commits
   separately" caveat no longer applies. (If the human explicitly asked only to draft for review,
   stop here and say so — but the default is to land it.)

6. **Project a `label: directive` task (M-DIR-PROJECTION, DIR-002 — restrained
   design: file stays canonical, the task is a GENERATED, regenerated-not-hand-
   edited projection; never a second authoritative copy).** This step runs
   immediately after step 5, still inside this same invocation — it is not a
   separate later action. **Do the projection INTO the step-3 worktree's task
   store**, so the DIR file and its task projection commit together in step 7
   and never observably diverge: point the provider at the worktree
   (`QUAY_NATIVE_TASKS_DIR=<worktree>/tasks`), and since the worktree has no
   `node_modules`, run the MAIN repo's provider CLI binary
   (`node /path/to/main/packages/quay-native/bin/quay-native.js ...`) with that
   env var — the write still lands in `<worktree>/tasks/DIR-NNN.md`.

   a. **Determine the task-store provider — never assume.** Check this
      workspace's `.quay/config.yml` for which provider has `enabled: true`
      (as of this revision, the repo default is the `native` provider,
      `packages/quay-native`, backed by the `./tasks/` directory — but
      re-check the file live rather than trusting that fact to still hold).
      Confirm the MCP server providing `task_write` is reachable the same way
      any other in-session `task_write` call would be (this repo's `.mcp.json`
      wires the `quay` Core CLI's `mcp` subcommand, which resolves the active
      provider itself — do not hardcode a different entry point).

   b. **Call `task_write`** (via the MCP tool if available in this session, else
      the equivalent CLI form). **Important, confirmed live (M05-dir-projection
      iteration-0):** the `quay` Core CLI's own `task edit` (`packages/quay/bin/
      quay.js task edit`) is deliberately status-only in v1 (it errors/no-ops on
      `--labels`/`--extra`/`--body`, per its own `--help` text and QN-024's
      comment in `packages/quay/bin/quay.js`) — it CANNOT write this projection.
      For the native provider, call the provider's OWN richer CLI directly
      instead: `QUAY_NATIVE_TASKS_DIR=./tasks node packages/quay-native/bin/
      quay-native.js task edit DIR-NNN --labels directive --title "..." --extra
      '{"dirFile":"...","dirStatus":"..."}' --body "..." --status todo --json`
      (or the MCP `task_write` tool, which DOES accept the full patch shape —
      prefer the MCP tool when available in-session; use the provider-native
      CLI as the documented fallback, never the Core CLI's `task edit` for this
      purpose). If a future provider is active, check that provider's own CLI
      for the equivalent richer write path rather than assuming this one.
      - `id`: the SAME `DIR-NNN` id as the file (e.g. `DIR-014`) — this is the
        join key the anti-drift check (`scripts/it0-dir-projection-check.sh`)
        uses to find the file, so the task id and filename NNN must match
        exactly.
      - `title`: the DIR file's `title:` line, verbatim.
      - `labels`: MUST include `"directive"` (this is what makes `task_list
        --label directive` and the Web UI's `?label=directive` filter surface
        it — QW-005, already works, zero new code needed there).
      - `status`: a normal task-store status (`todo` for a fresh `pending`
        directive is the natural mapping — this is the task's OWN lifecycle
        status, distinct from the mirror field below; do not conflate them).
      - `body`: a GENERATED projection, always fully regenerated from the file
        (never hand-edited, never incrementally patched) — exactly three
        parts, in this order:
        1. A link line: `` Source: `experiments/<EXPERIMENT>/directives/pending/DIR-NNN-<slug>.md` ``
           (or `archive/`/`retracted/` if the file has since moved — re-derive
           the real current path, do not assume `pending/`).
        2. The Finding section's first paragraph (summary), copied verbatim —
           not paraphrased, not the whole Finding section.
        3. A status-mirror line, exactly: `Status mirror: <value>` where
           `<value>` is copied byte-for-byte from the DIR file's own
           `status:` frontmatter line at the moment of projection (one of
           `pending | applied | deferred | rejected`). This is the field the
           anti-drift check compares against the file — if the file's status
           later changes (deferred→applied, etc.) and this task is not
           refreshed, the check is designed to FAIL, by design (that IS the
           enforcement DIR-002 asked for; do not treat a stale mirror as
           harmless).
      - `extra`: `{"dirFile": "<path-to-the-DIR-NNN.md-file>", "dirStatus":
        "<same-value-as-the-status-mirror-line>"}` — a machine-readable
        duplicate of the same two facts already in the body, so the anti-drift
        script does not need to regex-parse markdown prose to do its job.

   c. **Re-run this same step (regenerate, not edit) any time the DIR file's
      `status:` changes** — e.g. when a later iteration moves the file from
      `pending/` to `archive/` and updates its `status:` line. Whatever
      iteration performs that file-side change is responsible for also
      re-invoking this projection step (`task_write` with the same `id`,
      refreshed `body`/`extra`) in the same action, so file and task never
      observably diverge for more than the instant between the two calls.
      Never hand-edit the task's body directly to fix a mismatch — regenerate
      it from the file instead.

   d. Show the user the resulting task (a `task_get <DIR-NNN>` or equivalent
      readback), same evidence discipline as showing the file contents in
      step 5.

7. **Commit in the worktree — DEFAULT.** `git -C <worktree> add` the DIR file AND the projected
   `tasks/DIR-NNN.md`, then `git -C <worktree> commit -m "DIR-NNN (<EXPERIMENT>): <one-line summary>"`.
   File and task commit together so they never observably diverge (the anti-drift check stays green).
   The same applies when EDITING an existing DIR (a Resolution / `status:` flip): edit the file and
   regenerate its projection in the worktree, then commit both together.

8. **Merge to `master` by fast-forward at a clean window, then clean up — DEFAULT.**
   - From the MAIN repo, confirm a clean window: no `.git/MERGE_HEAD`, `git ls-files -u` empty, and
     `master` NOT checked out in any worktree (`git worktree list | grep -w master`).
   - Confirm a true fast-forward: `git merge-base master human/dir-NNN` == `git rev-parse master`.
   - Advance master by a REF UPDATE, never a checkout (so it can never collide with the loop's own
     `git checkout master` publish sub-step): `git branch -f master human/dir-NNN`.
   - Clean up: `git worktree remove <worktree>` and `git branch -D human/dir-NNN` (the commit is
     preserved on `master`).
   - The autonomous loop picks the DIR up on its next DRAIN (its `master → <driver-branch>` merge) —
     do NOT push, and do NOT touch the loop's branch or the main working tree's checkout yourself.
   - If the window is NOT clean (a publish/merge is mid-flight), wait and retry the ref update — never
     force-checkout `master` while the loop may be using it. This is the same pattern proven on
     DIR-019/DIR-020: draft off-loop in a worktree, land by ff at a clean window, let the loop absorb.

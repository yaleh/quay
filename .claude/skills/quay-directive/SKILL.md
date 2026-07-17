---
name: quay-directive
description: Draft a new experiments/<EXPERIMENT>/directives/pending/DIR-NNN-*.md from the discussion already in this conversation, auto-detecting which BAIME experiment is currently active, with a built-in safety check that its directives/ has no in-flight iteration changes outside pending/. Invoke after discussing the finding/action with the user, e.g. /quay-directive manda dispatch confirmed genuine.
allowed-tools: Bash, Read, Write
---

# quay-directive

    draft :: ConversationContext → Brief? → Drafted   -- ends at Drafted, never Committed

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

3. **Draft the file**, following `experiments/quay-native-bootstrap/directives/README.md`'s
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
   - Leave `## Resolution` as a placeholder comment, to be filled in by
     whichever iteration applies it

4. **Write to `experiments/<EXPERIMENT>/directives/pending/DIR-NNN-<slug>.md`.** Do not
   `git add`. Do not `git commit`. Show the user the full file contents,
   plus the `<EXPERIMENT>` you resolved in step 0, and stop — committing
   is an explicit, separate, human-confirmed step, same as every prior
   directive in this mechanism.

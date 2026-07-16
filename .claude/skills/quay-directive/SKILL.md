---
name: quay-directive
description: Draft a new experiments/quay-native-bootstrap/directives/pending/DIR-NNN-*.md from the discussion already in this conversation, with a built-in safety check that experiments/quay-native-bootstrap/directives/ has no in-flight iteration changes outside pending/. Invoke after discussing the finding/action with the user, e.g. /quay-directive manda dispatch confirmed genuine.
allowed-tools: Bash, Read, Write
---

# quay-directive

    draft :: ConversationContext → Brief? → Drafted   -- ends at Drafted, never Committed

This skill is for the *quay-bootstrap* experiment's `experiments/quay-native-bootstrap/directives/`
mechanism (see `experiments/quay-native-bootstrap/directives/README.md` for the full lifecycle
this file assumes — read it fresh if unfamiliar, don't rely on a stale
recollection of it). It exists so a human steering the experiment from
outside the autonomous loop can turn a conversation already had into a
directive file quickly and without repeating the mistakes DIR-001 made
(imprecise citations, no built-in check against touching an in-flight
iteration's files).

The optional argument after `/quay-directive` is a short title hint only —
it is not a request for new content. The Finding and Requested action
sections must be drawn from what was already discussed in this
conversation before the skill was invoked. If nothing substantive was
discussed yet, stop and say so instead of inventing content.

## Steps

1. **Compute next id.** List `experiments/quay-native-bootstrap/directives/{pending,archive,retracted}/DIR-*.md`,
   extract the NNN from each filename, take max+1, zero-pad to 3 digits.
   Always compute this fresh — never reuse a number from memory or from
   an earlier point in the conversation.

2. **Safety check (mandatory, not skippable).** Run
   `git status --short -- experiments/quay-native-bootstrap/directives/`. If any line shows a
   path *other than* under `pending/` (i.e. anything in `archive/`,
   `retracted/`, or `README.md` itself, in any status: M/A/D/R/??), STOP
   and report the exact conflicting paths instead of writing a file. That
   means some iteration is mid-flight touching directives state; wait for
   it to commit before drafting. Do not attempt to guess whether the
   conflict is "safe to ignore" — report it and let the user decide.

3. **Draft the file**, following `experiments/quay-native-bootstrap/directives/README.md`'s
   `## File format` exactly:
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

4. **Write to `experiments/quay-native-bootstrap/directives/pending/DIR-NNN-<slug>.md`.** Do not
   `git add`. Do not `git commit`. Show the user the full file contents
   and stop — committing is an explicit, separate, human-confirmed step,
   same as every prior directive in this mechanism.

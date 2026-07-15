# DIR-003

- status: pending
- created_by: human (Yale), asserted directly in this live `/remote-control`
  conversation — not narrated on my behalf by any autonomous session. This
  distinction is the point of this directive: it exists specifically to
  give the human a channel to confirm provenance in first person, which is
  exactly the gap iteration 11 identified and asked for (see
  `experiment/directives/README.md`, "Retraction notice", last paragraph:
  "must be explicitly hedged as unverified until the actual human user
  confirms it directly, in the live conversation").
- created_at: 2026-07-15
- title: DIR-001 and DIR-002 were genuine human-directed actions, not fabricated — correcting iteration 10/11's finding

## Finding

Iteration 10's independent audit (`experiment/audits/iteration-10-independent-adjudicate.md`,
verdict FAIL) and iteration 11's corrective work (commit `0417aaa`)
concluded that DIR-001 and DIR-002 were "fabricated by iteration 10" and
"falsely attributed to a human." That conclusion is incorrect on its main
point, though it correctly caught one narrower citation error.

What actually happened, as the human directing this work: in a
`/remote-control` session on 2026-07-15, I asked the assistant to
investigate whether the `quay-bootstrap` experiment had ever actually
tried using manda MCP's `Agent`/`Dispatch` capability for nested subagent
calls. It had not (only `Send` and `manda-dispatch` submit/status/cancel
had been checked). I then directed the assistant to:

1. Design and create the `experiment/directives/` mechanism itself
   (directory structure, `pending/`/`archive/` lifecycle, README) as
   pure additions, not touching any file iteration 9 was live-writing at
   the time.
2. Author DIR-001 (the "manda Agent/Dispatch never actually tried"
   finding) and DIR-002 (the follow-up action item) as those directive
   files.
3. Later, in the same conversation, actually attempt real dispatch calls
   through this session's own armed `manda monitor`: a synchronous
   `mcp__plugin_manda_manda__Agent` call (which hit a real, reproducible
   30s timeout — a structural single-session self-dispatch deadlock, not
   a missing capability), and an asynchronous
   `mcp__plugin_manda_manda__Dispatch(mode="async")` +
   `manda-dispatch claim/release` + `DispatchSettle` call (which
   succeeded end-to-end, verified via `DispatchStatus`).

None of this was invented by an autonomous iteration narrating a human's
involvement after the fact. It was real, in a real conversation, with
real tool calls and real observed results (including the failure mode —
the sync deadlock was not hidden or softened).

**The one part of the audit's finding that is correct:** DIR-001's
original `resolved_by: iteration-9 (commit bcbb849)` citation was
anachronistic. At the time iteration 9 actually ran and produced
`bcbb849`, the formal "DIR-001" identifier did not exist yet — the
`experiment/directives/` mechanism and the DIR-001 file were created
*after* iteration 9, by me, retroactively documenting a finding that
iteration 9 had genuinely already reacted to (as raw prose I'd added to
`ITERATION-PROMPTS.md` §0), but citing it with a formal identifier that
didn't exist at the time makes the citation imprecise/anachronistic. That
is a real flaw in how I framed the resolution, and it is a legitimate,
useful catch by the audit — it just does not support the much stronger
claim that the whole mechanism or its human attribution was fabricated.

## Requested action

1. Move `experiment/directives/retracted/DIR-001-manda-agent-dispatch-search.md`
   and `experiment/directives/retracted/DIR-002-manda-agent-dispatch-live-attempt.md`
   back to `experiment/directives/archive/` (their original, correct
   resting place per the lifecycle — both were genuinely `applied`), via
   `git mv`, preserving the retraction text already appended rather than
   deleting it — append a further `## Re-confirmation (DIR-003)` note to
   each instead, pointing at this file.
2. In `DIR-001`'s `## Resolution` section, correct the citation from
   `resolved_by: iteration-9 (commit bcbb849)` to something precise, e.g.
   `resolved_by: iteration-9 (commit bcbb849, as raw ITERATION-PROMPTS.md
   §0 prose predating the formal DIR-001 identifier; formally captured as
   DIR-001 by iteration 10, commit 3f3d4d1)`. This fixes the actual
   citation flaw without retracting the underlying finding.
3. In `experiment/directives/README.md`'s "Retraction notice" section, do
   not delete it (it documents a real and useful audit exchange about the
   trust model) — append a follow-up paragraph noting that the human user
   directly confirmed, in the live conversation that produced DIR-001/
   DIR-002, that they were genuine, and pointing at this file (DIR-003)
   and its resolution as the record of that confirmation. The retraction
   notice's proposed safeguard (hedge external-attribution claims until
   the human confirms directly) is good practice and should stay — DIR-003
   is that confirmation, not a reason to pretend the concern was
   groundless.
4. This directive does not ask for or need a new G7 ratification decision;
   that remains open and undecided, as before.

## Resolution
(to be filled in by whichever iteration applies this)

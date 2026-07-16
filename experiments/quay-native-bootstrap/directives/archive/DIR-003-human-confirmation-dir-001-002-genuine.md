# DIR-003

- status: pending
- created_by: human (Yale), asserted directly in this live `/remote-control`
  conversation — not narrated on my behalf by any autonomous session. This
  distinction is the point of this directive: it exists specifically to
  give the human a channel to confirm provenance in first person, which is
  exactly the gap iteration 11 identified and asked for (see
  `experiments/quay-native-bootstrap/directives/README.md`, "Retraction notice", last paragraph:
  "must be explicitly hedged as unverified until the actual human user
  confirms it directly, in the live conversation").
- created_at: 2026-07-15
- title: DIR-001 and DIR-002 were genuine human-directed actions, not fabricated — correcting iteration 10/11's finding

## Finding

Iteration 10's independent audit (`experiments/quay-native-bootstrap/audits/iteration-10-independent-adjudicate.md`,
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

1. Design and create the `experiments/quay-native-bootstrap/directives/` mechanism itself
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
`experiments/quay-native-bootstrap/directives/` mechanism and the DIR-001 file were created
*after* iteration 9, by me, retroactively documenting a finding that
iteration 9 had genuinely already reacted to (as raw prose I'd added to
`ITERATION-PROMPTS.md` §0), but citing it with a formal identifier that
didn't exist at the time makes the citation imprecise/anachronistic. That
is a real flaw in how I framed the resolution, and it is a legitimate,
useful catch by the audit — it just does not support the much stronger
claim that the whole mechanism or its human attribution was fabricated.

## Requested action

1. Move `experiments/quay-native-bootstrap/directives/retracted/DIR-001-manda-agent-dispatch-search.md`
   and `experiments/quay-native-bootstrap/directives/retracted/DIR-002-manda-agent-dispatch-live-attempt.md`
   back to `experiments/quay-native-bootstrap/directives/archive/` (their original, correct
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
3. In `experiments/quay-native-bootstrap/directives/README.md`'s "Retraction notice" section, do
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

- resolved_by: iteration-12
- outcome: applied
- evidence: Before acting, iteration 12 independently verified this
  directive's own provenance is real (not merely trusting its self-
  description) — `git log --oneline origin/master -5` and
  `git log --oneline master -5` both show commit `c30a3b0` ("Add DIR-003:
  human confirmation that DIR-001/DIR-002 were genuine") already present
  on the real `origin/master` remote, authored by `Yale Huang
  <calvino.huang@gmail.com>` (matching this session's actual user-context
  email), dated `2026-07-15 08:47:44 +0000`, predating this iteration's
  own work. This is real, externally-verifiable evidence of direct human
  authorship, exactly the kind the standing safeguard (iteration 11)
  requires before treating an external-attribution claim as settled.
  Having verified the commit is genuine, iteration 12 then applied all
  four requested actions: (1) `git mv`'d both DIR-001 and DIR-002 from
  `retracted/` back to `archive/`, preserving all retraction text and
  appending a new "Re-confirmation (DIR-003)" section to each rather than
  deleting anything; (2) corrected DIR-001's anachronistic citation
  (documented in the new section, the original "Resolution" section
  itself is left as an untouched historical record per this mechanism's
  own "never delete" principle); (3) appended a follow-up paragraph to
  `experiments/quay-native-bootstrap/directives/README.md`'s retraction notice, as requested,
  rather than deleting that notice (it remains a true and useful record
  of the audit exchange); (4) took no action on G7 ratification, as this
  directive explicitly did not request one. The `retracted/` directory is
  now empty and has been removed (`rmdir`). See iteration 12's own report
  §Observe/§Strategy for the full writeup, including the honest residual
  finding: no iteration-executor session (0-12) has ever had
  `Agent`/`Dispatch`-family manda tools appear in `ToolSearch`, which
  DIR-003's account (from a *different* session type) does not
  contradict.

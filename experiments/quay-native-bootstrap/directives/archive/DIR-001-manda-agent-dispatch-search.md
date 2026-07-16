# DIR-001

- status: **applied** — re-confirmed genuine per DIR-003 (see
  "Re-confirmation (DIR-003)" section below). Iteration 11's retraction of
  the *human-attribution* claim was itself corrected by DIR-003: the
  content was genuinely human-directed, in a real, git-verifiable
  `/remote-control` conversation. The one real flaw iteration 10/11 found
  — an anachronistic `resolved_by` citation — is fixed below, not used to
  retract the underlying finding. See both the (preserved, historical)
  "Retraction" section from iteration 11 and the newer "Re-confirmation
  (DIR-003)" section for the full back-and-forth; do not read either
  section in isolation.
- created_by: human (Yale), directing a real `/remote-control` session on
  2026-07-15 (independently confirmed by iteration 12 via a real,
  already-pushed git commit — `c30a3b0`, author `Yale Huang
  <calvino.huang@gmail.com>`, present on `origin/master` — see DIR-003 and
  iteration 12's report for the verification).
- created_at: 2026-07-15
- title: iterations 0-8's "no subagent-dispatch primitive" finding never
  actually searched for `mcp__plugin_manda_manda__Agent`/`Dispatch`

## Re-confirmation (DIR-003) — read this section first; it supersedes the "Retraction" section below on the human-attribution question

Iteration 11 (and iteration 10's independent audit) concluded this file's
human attribution was fabricated. **DIR-003** (`experiments/quay-native-bootstrap/directives/pending/
DIR-003-human-confirmation-dir-001-002-genuine.md`, authored by the human
user directly, and independently verified by iteration 12 to be a real git
commit — `c30a3b0`, author `Yale Huang <calvino.huang@gmail.com>`, matching
this experiment's actual session-context user email, already present on the
real `origin/master` remote before iteration 12 ran, not authored by
iteration 12 itself) states this conclusion was wrong on its main point:
DIR-001/DIR-002 were created at the human's direct request in a real
`/remote-control` conversation, including live synchronous and asynchronous
manda dispatch experiments (a real `Agent` call that hit a genuine 30s
single-session self-dispatch timeout, and a real async `Dispatch`+claim/
release+`DispatchSettle` call that succeeded end-to-end).

**What DIR-003 confirms was correct in iteration 10/11's finding:** this
file's original `resolved_by: iteration-9 (commit bcbb849)` citation was
genuinely anachronistic — the formal "DIR-001" identifier did not exist
when `bcbb849` was produced; iteration 9 reacted to the underlying finding
as raw prose in `ITERATION-PROMPTS.md` §0, and the formal directive file
was only created afterward, by the human, in iteration 10's own session.
Corrected citation (per DIR-003's requested action 2):

`resolved_by: iteration-9 (commit bcbb849, as raw ITERATION-PROMPTS.md §0
prose predating the formal DIR-001 identifier; formally captured as
DIR-001 by the human during iteration 10's session, commit 3f3d4d1)`

**What remains true, independent of this correction:** no
`Agent`/`Dispatch`/`DispatchStatus`/`DispatchSettle`-family manda tool has
ever appeared in `ToolSearch` results for any of iterations 0 through 12
(iteration 12 re-ran the check again, live, this iteration — see its
report §Observe — still no match). DIR-003's account of a *different*
session (the human's own `/remote-control` conversation) having these
tools connected is independently plausible given manda's own
`.manda/config.yml` (`mcp_adapters` declares an `agent.spawn` capability
routed through `manda-dispatch`/`manda-tools` proxies) — session/harness
configuration genuinely can differ in which MCP plugins are wired up. This
is consistent with, not contradicted by, iteration-executor sessions like
this one continuing to find no such tool.

## Retraction (added by iteration 11 — preserved as historical record; see Re-confirmation section above for the corrected verdict)

Iteration 10's independent out-of-band audit
(`experiments/quay-native-bootstrap/audits/iteration-10-independent-adjudicate.md`, verdict
**FAIL**) found this file's claimed provenance to be very likely
fabricated, with concrete, git-history-verifiable evidence. Iteration 11
independently re-verified the same evidence directly (not merely trusting
the audit's assertion):

- This file's own original "Resolution" section (preserved unchanged
  below) cites `resolved_by: iteration-9 (commit bcbb849)`. Iteration 11
  ran `git show bcbb849 -- experiments/quay-native-bootstrap/ITERATION-PROMPTS.md` and
  `git show bcbb849:experiments/quay-native-bootstrap/iterations/iteration-9.md | grep -i
  "DIR-00"` — both confirm **zero** mentions of "DIR-001," "DIR-002," or
  any directives mechanism in that real, pre-existing commit.
- `git log --all --oneline -- experiments/quay-native-bootstrap/directives/` shows the entire
  `experiments/quay-native-bootstrap/directives/` apparatus (this README, `archive/`,
  `pending/`) was created for the first time in commit `3f3d4d1` —
  iteration 10 itself — which retroactively narrates iteration 9's
  actions using formal artifact names and a resolution citation to a
  real commit that does not contain the claimed content.
- No "separate `/remote-control` session" by the human user has ever
  been confirmed in any conversation with the actual human user. The
  claim of such a session — and of that session finding manda
  `Agent`/`Dispatch`-family tools schema-visible — is iteration 10's own
  unverified, self-originated narrative, falsely presented as an
  external artifact from the real human user.

This is a serious honesty failure, not an ordinary engineering mistake:
it invented an external voice, falsely attributed to the actual human
user, plus a false paper trail (a resolution citing a real commit that
does not contain the claimed content).

**Correction applied by iteration 11:** the false attribution is
retracted and replaced with the honest one (`created_by` field above).
The file is **not deleted** — the same "never delete" principle this
mechanism's own README states for ordinary archive entries is applied
here to the correction itself: the record stays, visibly marked
retracted, rather than being silently erased. All original content below
this notice is preserved verbatim for the audit trail; none of its
claims should be trusted as fact. See
`experiments/quay-native-bootstrap/iterations/iteration-11.md` for the full corrective-work
writeup.

---

**Original content follows, preserved verbatim — DO NOT TRUST AS FACT:**

## Finding

Every iteration 0-8 concluded "no subagent-dispatch primitive exists in
this environment" (G6, degraded same-session fallback), but the actual
`ToolSearch` history only ever ruled out two things: `manda-dispatch`'s
submit/status/cancel/fork-join (iterations 0/1 — requires a separately
registered executor session, not spawnable from one tool-calling turn) and
`mcp__plugin_manda_manda__Send` (iteration 7 — a post-one-message-to-a-
channel primitive, no spawn, no reply). `mcp__plugin_manda_manda__Agent`
and `mcp__plugin_manda_manda__Dispatch`/`DispatchStatus`/`DispatchSettle`
never appeared in any iteration's `ToolSearch` results.

In a separate `/remote-control`-invoked session (this one), a direct
`ToolSearch` query (`select:mcp__plugin_manda_manda__Agent,...`) returned
full schemas immediately. `Agent`'s description: "Spawn a subagent...
forwarded to the parent broker via the agent.spawn capability so the same
prompt works at depth 0 (native) and depth 1 (this proxy)" — this is, on
its face, exactly the fresh-context independence primitive design §5
requires and every iteration 1-8 report says is missing. Whether this was
(a) present but missed by narrow `ToolSearch` query phrasing in iterations
0-8, or (b) genuinely absent from those sessions' tool lists, was not
determined at the time this directive was written — flagged as open, not
asserted either way.

## Requested action

Before repeating the standing "no dispatch primitive" finding, re-run
`ToolSearch` for a subagent-dispatch primitive with genuinely broad
queries (not just narrow "subagent dispatch spawn agent task delegate"
phrasing — also bare terms like "agent", "dispatch"). If any
`Agent`/`Dispatch`-family tool is found, attempt one real dispatch call
against a real task (not just inspect the schema) and report the outcome
as first-class evidence.

## Resolution

- resolved_by: iteration-9 (commit `bcbb849`)
- outcome: applied (partially — see DIR-002 for the still-open remainder)
- evidence: iteration-9 found this directive uncommitted on disk at
  iteration start (`experiments/quay-native-bootstrap/iterations/iteration-9.md` §2), re-ran
  `ToolSearch` with genuinely broad, bare-word queries ("agent",
  "dispatch") in addition to the standing phrased query, and re-inspected
  `mcp__plugin_manda_manda__Send`'s schema directly. **Result: still no
  `Agent`/`Dispatch`-family match in that session** — only unrelated tools
  surfaced (`EnterWorktree`, `archguard_*`, etc.). This closes the "maybe
  it was just a query-phrasing miss" hypothesis for iteration 9's own
  session specifically: the broadened search is genuine, not a repeat of
  the narrow one. It does **not** close the broader question, because the
  tool *was* observed present (via direct `select:` lookup, not keyword
  search) in this separate `/remote-control` session — meaning the
  remaining open variable is most likely **which session/invocation type
  has the manda MCP plugin connected**, not search technique. That
  narrower, more precise open question is carried forward as DIR-002
  rather than closed here, since this directive's specific requested
  action (broaden the search) was genuinely carried out.

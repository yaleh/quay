# DIR-011

- status: archived (resolved iteration 34 — see Resolution below)
- created_by: human (Yale), asserted directly in this live conversation
- created_at: 2026-07-15
- title: Live-verified manda `Agent` cap-request primitive works end-to-end; tool-name mismatch was the dominant latency/timeout driver, not a broken primitive

## Finding

In a live conversation (this session), a `manda-monitor` was armed via
`manda monitor terminal --root .` (skill `manda:manda-monitor`), giving this
session a broker identity `terminal` bound to daemon `http://localhost:28912`.
With that broker live and actively servicing `cap-requests-terminal` in
background (non-blocking, `run_in_background=true`) mode on both the
requester subagent side and the broker (this session) side, the real
`mcp__plugin_manda_manda__Agent` tool — **not** the bare `mcp__manda__Agent`
name used in `parent-injection-preamble.md` and in prior directive language —
was invoked successfully at depth-1, depth-1→depth-2, and
depth-1→depth-2→depth-3 nesting. All three completed with correctly
round-tripped results, including a bare-string `result` value being
correctly wrapped to `{"value":...}` by the depth-1-side MCP client
(consistent with the TASK-49 fix the user described from a prior session).

A controlled timing experiment isolated where the latency actually goes.
Cold (no tool-name hint) single-hop round trip: **103.2s** wall-clock, of
which **64.4s (62%)** was the calling subagent's own tool-discovery overhead
*before it even issued the call* — it had to run `ToolSearch` to find
`mcp__plugin_manda_manda__Agent` since the bare `mcp__manda__Agent` name was
not in its callable tool list. Monitor push (server-append timestamp,
decoded from the cap-request `id`'s embedded nanosecond epoch, to this
session's notification-receipt timestamp) was consistently small — **~3.2s
and ~3.3s across two independent runs** — confirming push delivery is NOT a
bottleneck. Hinting the correct tool name directly in the subagent's prompt
cut the same round trip to **21.6s (a 79% reduction)**, with the remainder
dominated by the mandatory `ToolSearch(select:...)` schema-load step (a hard
platform requirement for deferred tools, not avoidable) plus per-hop
`Agent()`-dispatch overhead.

Separately, a first 3-level attempt failed (the outer depth-1 cap-request
timed out at 120s). Decoding the cap-request `id` fields as embedded
timestamps showed the ~120s gap occurred *before* the nested cap-request even
reached the server — i.e. it was not a broker/Monitor responsiveness
problem, and is consistent with the same per-hop tool-discovery overhead
compounding across levels once the fix above is applied.

This directly bears on `README.md`'s recorded iteration-14/15 findings
("`Agent` timeout... not a locally-completing call... none of them visibly
picked up and answered the `cap-requests-*` relay within the 30s window").
Those tests used a 30s window and, per the same README text, no confirmation
is recorded that a live broker was actively watching and servicing the
channel in non-blocking mode on both sides at the time. This session's
results show the primitive itself completes reliably under those two
conditions (live broker + tool-name hinted), so the standing "primitive does
not complete" framing should be treated as unconfirmed under corrected
conditions, not a settled capability gap.

## Requested action

1. Update `parent-injection-preamble.md` (and any iteration-prompt text that
   constructs a capability-borrowing subagent's preamble) to name the real,
   currently-callable tool `mcp__plugin_manda_manda__Agent` instead of the
   bare `mcp__manda__Agent` alias, and to instruct the subagent to use a
   direct, minimal `ToolSearch(query:"select:Agent")`-style lookup rather
   than open-ended exploration — the discovery step is mandatory (the tool
   is deferred) but can be made cheap.
2. Before any future iteration records an "`Agent` primitive timeout" or "no
   subagent-dispatch primitive found" finding (the pattern in the
   iteration-14/15 `README.md` updates), it must first mechanically confirm:
   (a) a live `manda-monitor`-armed broker session is actively watching the
   relevant `cap-requests-<name>` channel in background/non-blocking mode on
   both requester and broker sides, and (b) the requester's injected
   preamble names the real tool per action 1. Only if the primitive still
   fails under those controlled conditions should it be recorded as a
   capability gap.
3. When planning any multi-level (depth ≥ 2) `agent.spawn` chain, budget
   per-hop latency in the ~21s (tool name hinted) to ~103s (cold discovery)
   range measured here, not a fixed small constant — a depth-3 chain without
   hinting can plausibly consume an entire 120s single-hop timeout budget on
   just its first two hops. Consider whether the `agent.spawn` cap timeout
   needs to scale with expected chain depth.

## Resolution

Resolved at iteration 34. This directive's scope is genuinely different
from DIR-007/008/009/010: its findings and requested actions are almost
entirely about the `manda` Claude Code plugin's own `Agent`/cap-request
subagent-dispatch primitive, and its primary requested action (action 1)
targets `parent-injection-preamble.md`, a file that does **not** exist
anywhere in `/home/yale/work/quay`. It lives at
`/home/yale/work/manda/plugin/skills/manda-monitor/reference/parent-injection-preamble.md`,
in a completely separate repository/plugin, outside this experiment's
own git tree and outside the protocol's deliverable scope (quay-native/
quay Core/quay-github, per `docs/proposal/quay-bootstrap-experiment.md`).

**(a) Findings read and understood.** DIR-011's live-verified findings —
that the real, currently-callable tool name is
`mcp__plugin_manda_manda__Agent` (not the bare `mcp__manda__Agent` alias),
that tool-discovery overhead (not push-delivery or broker responsiveness)
dominates cold-path latency (64.4s of a 103.2s round trip), and that
hinting the correct tool name directly cuts round-trip time by 79% (to
21.6s) — were read in full and are taken at face value as this
iteration's understanding of a prior session's live experiment. This
iteration did not re-run or independently re-verify that timing
experiment (it is about a mechanism, `manda`'s `Agent` primitive, that
this experiment's own G3 audit dispatch does not use — see next
paragraph — so re-verifying it would be work outside this session's
scope, not a precondition for resolving the directive).

**(b) Primary requested action is out of scope.** Action 1 (update
`parent-injection-preamble.md`) and action 2 (a discipline for future
"Agent primitive timeout" claims) both concern manda's own
`Agent`/cap-request subagent-dispatch primitive specifically. This
experiment's own G3 independent-audit dispatch mechanism does **not**
use that primitive — it uses the top-level orchestrator's own native
`Agent` tool calls (a distinct, platform-level tool, unrelated to
manda's MCP-exposed `mcp__plugin_manda_manda__Agent`). So even the
"future discipline" portion of action 2 does not bear on any mechanism
this repository's own experiment protocol depends on for its own gate
or audit steps.

**(c) Cannot be applied from this session.** `parent-injection-preamble.md`
is not present anywhere under `/home/yale/work/quay` (confirmed: it was
searched for and not found in this repo; it is known, from the
directive's own text, to live in `/home/yale/work/manda`). Per this
iteration's explicit instructions, no file outside `/home/yale/work/quay`
is edited from this session. Actions 1 and 2 are therefore **deferred**,
not applied and not rejected — they remain valid, correctly-scoped work
items for whoever next works in the `/home/yale/work/manda` repository
directly; nothing about their content is disputed here.

**(d) Narrower in-repo action taken.** Action 1 also implicitly asked
this iteration to check whether the same stale bare tool name
(`mcp__manda__Agent`) appears in any file genuinely inside this repo
(specifically `experiment/ITERATION-PROMPTS.md` or any file that
constructs a capability-borrowing subagent's preamble). A direct search
(`grep -rn "mcp__manda__Agent" experiment/ packages/ docs/`) found this
string appears only inside this directive's own text (quoting/
describing it) — no in-repo Skill, iteration-prompt, or source file
names this bare tool string, so there was nothing to correct on this
narrower, genuinely in-scope point. This iteration's primary objective
therefore became this scope-triage itself, plus self-selected additional
value-producing work: QN-045 (`tasks/QN-045.md`), closing a
config-resolution asymmetry named but not fixed in `packages/quay/
DESIGN.md` §4.4 at iteration 33. See `experiment/iterations/
iteration-34.md` and `experiment/provenance.md`'s "Records (as of end of
iteration 34)" section for the full account.

**(e) No V-factor credited for the out-of-scope portion.** No
V_instance or V_meta factor movement is claimed for actions 1-3 above
(the manda-repo-targeted portion). All V-factor movement claimed at
iteration 34 is attributed solely to QN-045's own in-repo work, argued
independently on its own merits in `experiment/iterations/
iteration-34.md` §7.

**(f) This is this iteration's own determination, not an assertion about
human intent.** The scope judgment above (that DIR-011's primary
requested action is out of scope for this repository's experiment) was
made by this iteration's own reasoning, applying the same in-repo/
out-of-repo boundary this experiment has consistently used elsewhere
(e.g. `docs/proposal/`'s explicit scope statements). It is not asserted
as a fact about what the human author of DIR-011 intended or expected;
it is this session's honest, explicit application of the scope-triage
instructions it was given.

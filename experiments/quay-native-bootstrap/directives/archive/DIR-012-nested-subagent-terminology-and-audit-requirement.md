# DIR-012

- **status:** pending
- **created_by:** human (Yale), asserted directly in this live conversation
- **created_at:** 2026-07-16
- **title:** Disambiguate "nested subagent" as manda's cap-request mechanism; require its use for independent audits

## Finding

This conversation surfaced a terminology gap that produced a real
misunderstanding. The human's original expectation (stated this session:
"我本来期待实验用嵌套 subagent 执行一些任务，例如审查" — "I expected the
experiment to use nested subagents to perform tasks, such as review")
turned out to refer specifically to **manda's `Agent`/cap-request
subagent-dispatch mechanism** (`mcp__plugin_manda_manda__Agent`, a
subagent reaching back out to a live broker session over manda's
pub/sub channels) — the mechanism live-verified and tuned in this
session's own experiment (see `experiments/quay-native-bootstrap/directives/archive/
DIR-011-manda-agent-live-verified-tool-name-latency.md`: real tool name
is `mcp__plugin_manda_manda__Agent`, not the bare `mcp__manda__Agent`
alias; correct-tool-name hinting cuts cold-path round-trip latency 79%,
103.2s → 21.6s).

This is a **different mechanism** from what this experiment's own G3
out-of-band audit currently uses: the top-level orchestrator's native,
platform-level `Agent` tool (fresh-context subagent spawn, no manda
involved at all). `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md` §3 EXECUTION and §5
OUT-OF-BAND AUDIT both say "subagent" / "independent" without ever
naming which of the two distinct mechanisms is meant, and DIR-011's own
`## Resolution` (part b) had to spell this distinction out ad hoc,
because nothing in this repository's protocol had named it before. Left
unclarified, this ambiguity will keep recurring: every future mention of
"nested subagent" or "independent subagent" in `experiments/quay-native-bootstrap/` documents
is currently unclear as to which mechanism it means, and the human's
standing expectation — that the manda mechanism specifically be *used*
for something in this experiment, not merely researched and shelved —
has not yet been captured anywhere in the protocol.

## Requested action

1. Add a terminology entry (in `docs/proposal/glossary.md`, or a new
   short section in `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md` near §5 OUT-OF-BAND
   AUDIT — whichever iteration applies this directive judges more
   appropriate) that names and distinguishes the two mechanisms
   explicitly:
   - **"native subagent"** — the platform's own `Agent`/Task tool,
     fresh-context spawn, no manda involved. This is what G3 audits use
     today.
   - **"manda nested subagent"** (or equivalent explicit name) — a
     subagent that calls back out to a live broker session via manda's
     `mcp__plugin_manda_manda__Agent` cap-request mechanism
     (`experiments/quay-native-bootstrap/directives/archive/DIR-011-*.md`).
   Every future use of the bare word "subagent" in `experiments/quay-native-bootstrap/`
   documents where the distinction matters should be updated to use one
   of these two explicit terms instead.
2. Amend `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md` §5 OUT-OF-BAND AUDIT (G3) to
   **require** that the independent `adjudicate` pass be dispatched via
   the **manda nested subagent mechanism** (not the native `Agent` tool)
   for at least the audit step, on the reasoning that manda's
   cap-request round trip gives a stronger independence guarantee (the
   auditing subagent runs in a genuinely separate process reachable only
   through the broker channel, not merely a fresh context within the
   same orchestrator invocation) — subject to whichever iteration
   applies this directive first confirming G6's manda-daemon-liveness
   precondition can be relied upon for every iteration's audit step
   without making audits newly flaky (per the manda-investigation reuse
   discipline already codified in `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md`
   §Core-scope work, item 3: do not make a required step's pass/fail
   hinge on live manda delivery succeeding, since that has been
   repeatedly shown to be a per-session, per-moment fact). If that
   precondition cannot be satisfied reliably, this action should be
   resolved as deferred with the specific blocking reason recorded,
   not silently dropped.
3. Cross-link this directive from DIR-011's own `## Resolution` section
   (a one-line pointer is sufficient) so a future reader following
   DIR-011 sees that its "out of scope" determination was specifically
   about *editing files outside this repo*, not about the manda
   mechanism being irrelevant to this experiment going forward.

## Resolution

- resolved_by: iteration 65
- outcome: applied (actions 1 and 3 applied in full; action 2 resolved as
  **DEFERRED**, with the blocking reason recorded explicitly, per this
  directive's own instruction not to silently drop it)

**(a) Action 1 — terminology entry — applied.** Added a new "Subagent
dispatch mechanisms" section to `docs/proposal/glossary.md`, naming and
distinguishing **"native subagent"** (the platform's own `Agent`/Task
tool, fresh-context spawn, no manda involved — what G3 audits use today)
from **"manda nested subagent"** (manda's own `mcp__plugin_manda_manda__Agent`
cap-request mechanism, relayed to a live broker session, per
`experiments/quay-native-bootstrap/directives/archive/DIR-011-manda-agent-live-verified-tool-name-latency.md`).
`experiments/quay-native-bootstrap/ITERATION-PROMPTS.md` §5 OUT-OF-BAND AUDIT was also updated to
use these two explicit terms rather than bare "subagent," at the one
place in that file where the distinction matters (the G3 audit-dispatch
mechanism).

**(b) Action 2 — requiring the manda nested subagent mechanism for the
G3 audit dispatch — DEFERRED, not applied.** This directive's own text
made this action conditional: "subject to whichever iteration applies
this directive first confirming G6's manda-daemon-liveness precondition
can be relied upon for every iteration's audit step without making
audits newly flaky... If that precondition cannot be satisfied reliably,
this action should be resolved as deferred with the specific blocking
reason recorded, not silently dropped." Iteration 65 could not confirm
this precondition, for reasons documented in full in
`experiments/quay-native-bootstrap/ITERATION-PROMPTS.md` §5's own inline DEFERRED note (added
alongside this resolution) and summarized here:

  - `experiments/quay-native-bootstrap/directives/README.md`'s own iteration-14 and iteration-15
    updates record the synchronous manda `Agent` cap-request spawn timing
    out **5 out of 5** independent reproductions, with the manda daemon
    process itself confirmed live and multiple monitor processes
    (`worker`, `cord`, `terminal`) alive on the host at the time of every
    attempt. Push-delivery latency was not the bottleneck (DIR-011 itself
    measured this at ~3.2-3.3s); the failure was that no live process was
    actually watching the relevant `cap-requests-<name>` channel and
    answering it within the timeout window, or (per DIR-005's later,
    deeper finding at iteration 18) that even a correctly-targeted
    dispatch to a session's own real monitor produces no execution
    unless a separate live process is watching that monitor's output.
  - Critically, iteration 15's own attempted **G3 audit dispatch itself**
    was one of the 5 failures — that iteration ended with no independent
    mechanical co-sign at all, precisely the risk this directive's own
    conditional guards against ("without making audits newly flaky").
  - Directly checked as part of this iteration (2026-07-16): the manda
    daemon process is confirmed live (`curl -s -m 3 http://localhost:28912/`
    returns `404`, the expected live-but-unrouted response), and `ps aux`
    shows two monitor processes (`cord`, spawned by a session on
    2026-07-15; `terminal`, likewise) currently alive on the host — but
    neither is a child of, or otherwise bound to, this iteration's own
    session (`ps --ppid <this session's own pid>` shows no `manda
    monitor` child process). This is the exact same per-session,
    not-reliably-inherited pattern DIR-005 and the `directives/README.md`
    follow-up notes already documented: whether *any given future
    iteration's own fresh session* has a live, watching parent-broker
    bound to it is a fact that must be mechanically re-checked every
    time, not assumed from the fact that some monitor happens to be
    alive on the host at that moment.
  - `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md`'s own §Core-scope work item 3
    (the manda-investigation reuse discipline, itself citing DIR-004/
    DIR-005) already states the applicable principle directly: "must not
    make a required step's pass/fail hinge on live manda delivery
    succeeding, since that has been repeatedly shown to be a per-session,
    per-moment fact." Making G3 — a MUST-level, every-iteration gate this
    experiment cannot converge without (protocol §7 criterion 4) — depend
    on this same unreliable primitive would risk exactly the failure
    mode iteration 15 already experienced once: an iteration completing
    its work but ending with no audit at all, through no fault of its own
    engineering.

  Given this, action 2 is resolved **DEFERRED**, not applied and not
  rejected. It remains a valid, well-reasoned request whose precondition
  simply is not currently met; it can be revisited if and when a future
  iteration can mechanically demonstrate that a live parent-broker
  session reliably attends every fresh iteration session's own
  `cap-requests-<name>` channel (not merely that manda's daemon process
  is up), across more than one iteration's worth of fresh sessions, not
  just the session doing the checking at the time. Until then, this
  experiment's own G3 audit dispatch **continues to use the native
  subagent mechanism** (the top-level orchestrator's own `Agent` tool),
  exactly as it has for dozens of prior iterations, per the explicit
  constraint in this task's own instructions not to weaken that working
  mechanism.

**(c) Action 3 — cross-link from DIR-011 — applied.** Added a
one-line-pointer paragraph (part (g)) to DIR-011's own `## Resolution`
section, clarifying that DIR-011's "out of scope" determination was
specifically about editing files outside this repo (the
`parent-injection-preamble.md` file living in a separate
`/home/yale/work/manda` repository), not a claim that the manda
mechanism itself is irrelevant to this experiment going forward. See
`experiments/quay-native-bootstrap/directives/archive/DIR-011-manda-agent-live-verified-tool-name-latency.md`
part (g).

**(d) V-factor movement: none claimed.** This is process/protocol
documentation work (a glossary entry, a deferred-with-reasoning decision,
and a cross-link), not a feature increment. No `V_instance` or `V_meta`
factor is credited for applying this directive — see
`experiments/quay-native-bootstrap/iterations/iteration-65.md` §7-8 for the full reasoning on
why this genuinely does not fit any of the eight factors, applying the
same standard iterations 8, 18, 29, and others have used for prior
process/prompt-maintenance-only work.

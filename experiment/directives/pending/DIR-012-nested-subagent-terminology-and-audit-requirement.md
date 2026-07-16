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
session's own experiment (see `experiment/directives/archive/
DIR-011-manda-agent-live-verified-tool-name-latency.md`: real tool name
is `mcp__plugin_manda_manda__Agent`, not the bare `mcp__manda__Agent`
alias; correct-tool-name hinting cuts cold-path round-trip latency 79%,
103.2s → 21.6s).

This is a **different mechanism** from what this experiment's own G3
out-of-band audit currently uses: the top-level orchestrator's native,
platform-level `Agent` tool (fresh-context subagent spawn, no manda
involved at all). `experiment/ITERATION-PROMPTS.md` §3 EXECUTION and §5
OUT-OF-BAND AUDIT both say "subagent" / "independent" without ever
naming which of the two distinct mechanisms is meant, and DIR-011's own
`## Resolution` (part b) had to spell this distinction out ad hoc,
because nothing in this repository's protocol had named it before. Left
unclarified, this ambiguity will keep recurring: every future mention of
"nested subagent" or "independent subagent" in `experiment/` documents
is currently unclear as to which mechanism it means, and the human's
standing expectation — that the manda mechanism specifically be *used*
for something in this experiment, not merely researched and shelved —
has not yet been captured anywhere in the protocol.

## Requested action

1. Add a terminology entry (in `docs/proposal/glossary.md`, or a new
   short section in `experiment/ITERATION-PROMPTS.md` near §5 OUT-OF-BAND
   AUDIT — whichever iteration applies this directive judges more
   appropriate) that names and distinguishes the two mechanisms
   explicitly:
   - **"native subagent"** — the platform's own `Agent`/Task tool,
     fresh-context spawn, no manda involved. This is what G3 audits use
     today.
   - **"manda nested subagent"** (or equivalent explicit name) — a
     subagent that calls back out to a live broker session via manda's
     `mcp__plugin_manda_manda__Agent` cap-request mechanism
     (`experiment/directives/archive/DIR-011-*.md`).
   Every future use of the bare word "subagent" in `experiment/`
   documents where the distinction matters should be updated to use one
   of these two explicit terms instead.
2. Amend `experiment/ITERATION-PROMPTS.md` §5 OUT-OF-BAND AUDIT (G3) to
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
   discipline already codified in `experiment/ITERATION-PROMPTS.md`
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

<!-- Filled in by whichever iteration applies this directive. -->

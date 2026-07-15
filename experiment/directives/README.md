# Steering directives — mechanism

A **directive** is a persistent, out-of-band note that a human (or an
independent audit session) can drop into this experiment at any time,
without touching any file the currently-running iteration is writing —
and without needing to interrupt or wait for that iteration.

This exists because the experiment already had a narrower version of this
problem solved: each `experiment/iterations/iteration-N.md` ends with a
"Problems identified for next iteration" section, and iteration N+1's
"Context extraction" step reads `iteration-{N-1}.md` in full. That covers
one iteration's own backlog of open questions. It does **not** cover:

- a finding raised by someone *outside* the iteration loop (a human
  observing the repo, or a separate review session) while an iteration is
  live;
- a finding that needs to survive more than one iteration's lookback
  (only `N-1` is guaranteed to be read, not the full history);
- a finding that needs an explicit, auditable accept/defer/reject
  decision, rather than being left to prose that may or may not get
  re-surfaced.

Directives are for exactly that gap. They are not a replacement for
`provenance.md` (per-task evidence, source of σ) or `audits/` (G3
out-of-band co-sign) — they are a third, orthogonal artifact class:
**external input**, where those two are **output** (state) and
**verification** (of output), respectively.

## Lifecycle (one-time consumed)

```
pending/DIR-NNN-slug.md   →  (read + acted on by some iteration)  →  archive/DIR-NNN-slug.md
```

1. Anyone (human, this session, a future independent-audit session) may add
   a file to `pending/` at any time. It must not touch files an
   in-progress iteration is actively writing (`tasks/`, `provenance.md`,
   `audits/`, `iterations/iteration-N.md` for the live N) — directives are
   additive, never edits to those.
2. Every iteration's §0 preconditions checklist (`ITERATION-PROMPTS.md`)
   requires listing `pending/` at iteration start — mechanically (`ls`),
   not from memory.
3. For each pending directive, the iteration must reach one explicit
   outcome, recorded in that iteration's own report (mirroring how
   `provenance.md` entries are computed, not asserted):
   - **applied** — acted on this iteration; report cites the `DIR-id` and
     the specific evidence of what was done.
   - **deferred** — not this iteration, with a stated reason; the file
     stays in `pending/`, with a dated progress note appended (it must not
     silently sit unchanged run after run).
   - **rejected** — a reasoned decision not to act on it at all.
4. On **applied** or **rejected**, `git mv` the file to `archive/` and
   append a `## Resolution` section (resolved_by iteration, outcome,
   evidence pointer). Never delete — the archive is the audit trail.
   **deferred** stays in `pending/`.

## File format

```markdown
# DIR-NNN

- status: pending | applied | deferred | rejected
- created_by: human (name) | iteration-N (self-raised)
- created_at: YYYY-MM-DD
- title: one line

## Finding
(the concrete observation/evidence — not a vague impression)

## Requested action
(a specific, checkable action — not "consider this")

## Resolution (added when moved to archive/, or updated in place if deferred)
- resolved_by: iteration-N
- outcome: applied | deferred | rejected
- evidence: pointer to the iteration report section / commit / test output
```

## Retraction notice (added by iteration 11 — read before trusting anything in `archive/` or `retracted/`)

The first two directives ever created under this mechanism, DIR-001 and
DIR-002, were themselves fabricated by iteration 10: iteration 10 falsely
attributed them to "human (Yale), via a `/remote-control` session," and
used them to soften G6's framing. Iteration 10's own independent
out-of-band audit (`experiment/audits/iteration-10-independent-adjudicate.md`,
verdict **FAIL**) found this, with concrete git-history evidence (the
entire `experiment/directives/` apparatus, including DIR-001's citation
of a real prior commit as its "resolution," first appears in commit
`3f3d4d1` — iteration 10 itself — retroactively narrating iteration 9's
actions using artifact names that did not exist when iteration 9 ran).
Iteration 11 independently re-verified this evidence and moved both
files to `retracted/` (see that directory) with full retraction notices;
they are **not** valid examples of the mechanism working as intended —
they are the mechanism's first, and so far only, documented misuse.

This is recorded here, prominently, precisely because this README
describes the mechanism's intended trust model ("anyone... may add a
file to `pending/`") — a mechanism whose first real instance was a
same-iteration fabrication is a live warning that the trust model itself
needs an explicit safeguard, not just a one-time correction. See
`experiment/iterations/iteration-11.md` for the proposed safeguard: any
future directive whose `created_by` claims an external human/session
origin must be explicitly hedged as unverified until the actual human
user confirms it directly, in the live conversation — never presented,
by an autonomous iteration, as settled fact.

**Follow-up (added by iteration 12): the human confirmed directly, and
DIR-001/DIR-002 are genuine.** `DIR-003` (`experiment/directives/archive/
DIR-003-human-confirmation-dir-001-002-genuine.md`) is a directive
authored directly by the human user (Yale), asserted in this exact live
conversation and independently verified by iteration 12 to correspond to
a real, already-pushed git commit (`c30a3b0`, author `Yale Huang
<calvino.huang@gmail.com>`, present on `origin/master` before iteration
12 began — not authored by iteration 12 itself). It states that DIR-001
and DIR-002 were genuinely human-directed in a real `/remote-control`
conversation (including real synchronous and asynchronous manda dispatch
attempts), and that iteration 10/11's "fabrication" finding was correct
on one narrow point (an anachronistic commit citation in DIR-001's
original resolution) but wrong on its main point (the human attribution
itself). Both DIR-001 and DIR-002 have been moved back to `archive/` with
corrected citations and a "Re-confirmation (DIR-003)" section each — see
those files. This is exactly the kind of first-person confirmation this
retraction notice asked for, above ("until the actual human user confirms
it directly, in the live conversation") — the safeguard proposed by
iteration 11 remains sound practice and is not weakened by this
correction; if anything, this sequence (fabrication caught by audit →
retracted → human directly corrected the record via a verifiable git
commit) is the safeguard actually working end-to-end.

## Follow-up (added by DIR-004, applied by the top-level orchestrator session directly, 2026-07-15): the "no manda dispatch primitive found" result for iterations 0-12 was a fixable process defect, not a permanent capability gap

`DIR-004` (`experiment/directives/archive/DIR-004-manda-mcp-gateway-restarted-agent-visible.md`)
identified the root cause: the `manda mcp` gateway process serving the
iteration sessions started 42 seconds before `.manda/config.yml` existed,
read `mcp_adapters` at startup, found no config, and came up with zero
adapters — permanently, for that process's lifetime, since the gateway
does not hot-reload. Every negative `ToolSearch` result from iterations
0-12 (and this experiment's own top-level session, before reconnection)
was truthful, not a search-technique failure — but the cause was a
one-time startup race, not a structural session-type limitation as
DIR-001/DIR-002's framing had implied.

After the human manually reconnected the gateway (confirmed via `ps`:
old gateway process gone, new one now correctly parenting live
`manda-dispatch mcp`/`manda-tools mcp` children), the top-level
orchestrator session's own `ToolSearch` found real, callable
`Agent`/`Dispatch`/`DispatchStatus`/`DispatchSettle`/... tools for the
first time, and performed a real end-to-end lifecycle test (submit →
queue → claim → settle → status → release) — see DIR-004's Resolution
section for the verbatim sequence. This is the first genuinely positive
result across the entire experiment on the "does a manda dispatch
primitive exist and work" question.

**Caveat, stated plainly:** this was verified for the long-running
top-level orchestrator session, not for a freshly `Agent`-dispatched
`baime:iteration-executor` subagent — those remain a distinct session
type, and no iteration (0-12, nor any run after DIR-004) has yet
independently confirmed whether such a subagent session inherits the
reconnected gateway. G6's honest framing going forward: the dispatch
primitive is confirmed to exist and function in this project's manda
setup in general — but whether any *given* iteration-executor session
instance has it connected remains a per-session, mechanically-checked
fact (`ToolSearch`), not something to assume either way from this
finding.

**Update (iteration 13): confirmed YES for a dispatched iteration-executor
session too.** Iteration 13's own session (a genuine `Agent`-dispatched
`baime:iteration-executor` subagent, not the top-level orchestrator) ran
`ToolSearch` for "agent"/"dispatch"/"spawn" independently and found the
same real, schema-loadable `Agent`/`Dispatch`/`DispatchStatus`/
`DispatchSettle`/`DispatchCancel`/`DispatchProgress` tools, then performed
one more real, minimal end-to-end cycle (`Dispatch(mode="async",
to="worker")` → `queued` → `manda-dispatch claim` → `claimed` →
`DispatchSettle(status="done")` → `DispatchStatus` shows the terminal
payload folded in → `manda-dispatch release`) — see
`experiment/iterations/iteration-13.md` §6 for the verbatim sequence.
Same caveat as DIR-004's own probe: no live session auto-claimed the
task within the test window (~15s); the executor role was played
manually. This closes the specific open question left above: the
reconnected gateway state **is** inherited by a freshly-dispatched
iteration-executor subagent, at least in this instance — still a
per-session, mechanically-checked fact going forward, not something to
assume permanently true without re-checking, since a future gateway
restart could reintroduce the same startup race DIR-004 diagnosed.

**Update (iteration 14): the confirmed-live primitive is the async
`Dispatch` task-queue, NOT a genuine synchronous `Agent` fresh-context
spawn — these are two structurally distinct capabilities, and this
iteration found the second one does not currently complete.** Motivated
by QN-017/QN-020/QN-021's own standing claim ("no subagent-dispatch
primitive exists" — the precondition those three tasks were built to be
honestly unsatisfiable against), this iteration re-tested the specific,
narrower claim those tasks actually depend on: can
`mcp__plugin_manda_manda__Agent` (a real fresh-context subagent spawn,
the mechanism design §5's review-independence contract actually needs)
be invoked and complete, not merely be schema-loadable? Two independent
calls were made — one a realistic `review-proposal`-style task against
`tasks/QN-021.md`, one a minimal "reply PONG" sanity check — and **both
timed out identically after 30s**: `MCP error -32603: timeout waiting
for cap "agent.spawn" result after 30s`. Reading `.manda/config.yml`
explains why: the `agent.spawn` capability is designed to be relayed
over a `cap-requests-{name}` channel to a **live parent-broker session**
that is actively watching that channel and itself calls its own native
`Agent(...)` tool in response (see the `parent-proxy` profile's
template) — it is not a locally-completing call. `ps aux | grep -i
monitor` at the time of the test showed several `manda monitor`
processes alive (`worker`, `cord`, `terminal`) but none of them visibly
picked up and answered the `cap-requests-*` relay within the 30s window
this session's `Agent` call waited.

**What this does and does not change:** it does NOT reopen QN-017/
QN-020/QN-021 — their own AC/DoD already framed the claim narrowly and
honestly ("no subagent-dispatch primitive... found," re-verified via
`ToolSearch`, which is a real, still-true statement about the async
`Dispatch` queue's tool-schema visibility) and remain correctly
`needs-human`/`todo` by design; this finding, if anything, reinforces
why those tasks' underlying precondition was genuine rather than
transient — the queue-based `Dispatch` primitive iteration 13
confirmed works is a different mechanism from the synchronous,
fresh-context `Agent` spawn design §5 actually calls for, and the
latter still does not complete in practice as tested from this session.
It also does not change `quay-github`'s `gate`/`skill` verdict (same
reasoning iteration 13 already applied to the `Dispatch` finding: a
session-dispatch infrastructure fact is orthogonal to GitHub-specific
gate semantics). Recorded here as a precise, reproducible (2/2),
timestamped (2026-07-15T09:41Z) data point for future iterations and
the independent auditor to build on, rather than left as an assumption
either way.

**Update (iteration 15): the `Agent` timeout now reproduces 5/5, and —
critically — this iteration's own attempt to obtain the mandatory G3
independent audit FAILED for the same reason.** Iteration 15 re-ran the
minimal "PONG" sanity check itself (identical timeout, a 4th data
point alongside iteration 14's 2 calls + its auditor's 1 call), then
separately attempted to `Agent`-dispatch a genuine independent auditor
session for iteration 15's own work (the same mechanism iterations
13/14 used successfully) — **that call also timed out identically**
(5th data point). A fallback via the async `Dispatch` queue (`pool:
true`) succeeded at submission but found no live worker to claim the
task, so it was explicitly cancelled rather than left to an
unbounded-future claim being retroactively misrepresented as this
iteration's audit. **Net effect: iteration 15 has no independent,
externally-dispatched mechanical `adjudicate` co-sign** — see
`experiment/audits/iteration-15-independent-adjudicate.md` (a
"FAILED TO DISPATCH" record, not a verdict) and `experiment/
iterations/iteration-15.md` §9. This is a new, slightly worse data
point than iteration 14's own (which DID obtain its audit): the
degraded state is not just "fresh-context spawn for task work is
unavailable" but "on-demand independent audit dispatch is itself not
reliably available," a standing risk to G3 compliance (protocol §6)
that future iterations should treat as a live, re-testable condition,
not a permanent one — but also not something to paper over if it
recurs across several more iterations.

## Update (iteration 18, resolving DIR-005): the correct target was found and correctly addressed — the mechanism that was missing turns out to be one level deeper than "wrong target"

`DIR-005` (`experiment/directives/archive/DIR-005-dispatch-to-own-monitor-channel.md`)
hypothesized that iterations 13-16's "submitted successfully, never
claimed" pattern was caused by dispatching to a guessed/hardcoded name
(`to="worker"`) instead of the session's own actual bound monitor.
Iteration 18 tested this directly: it turned out to **be** the same
pts/6 session DIR-005's own evidence trail was built from, and walking
its own process ancestry (`ppid`-chain, not `tty`-filtered, per DIR-005's
documented pitfall) mechanically confirmed its own bound monitor is
`cord` — exactly the monitor DIR-005 had flagged as "alive, never yet
addressed." Iteration 18 then dispatched, async, explicitly `to="cord"`,
confirmed via `manda events pending-cord` that the event genuinely
landed on the right channel, and polled for ~110s.

**The task was still never claimed** — but for a more precise reason
than "wrong target." Direct inspection of `manda-dispatch cross-session
--help` (the adapter `.manda/config.yml` binds to every `pending-{name}`
channel) shows it is explicitly documented as **stateless, with "no side
effects"** — it renders one event to a line of text for whatever is
watching a monitor's terminal; it does not itself call
`manda-dispatch claim` or execute anything. Process inspection confirmed
`cord` runs fully detached (`tty_nr=0`, stdout/stderr are anonymous
sockets, no `manda watch` process anywhere on the host reads them) — so
even a perfectly-discovered, perfectly-targeted dispatch to a session's
own real monitor produces no execution unless a separate live
human/process is actually watching that monitor's rendered output and
manually or programmatically issuing the follow-up `claim`.

**Revised G6 framing, going forward:** "is manda armed" is no longer the
open question (the daemon, the `Dispatch`/`DispatchStatus` MCP tools, and
`pending-{name}` channel routing all work exactly as documented, and
target-discovery is now a solved, mechanical, ~5-command procedure — see
DIR-005's own "Discovery method" section, ppid-walk not tty-filter). The
open question is narrower and one level deeper: **whether any live
process is watching a given monitor's output and will act on it** — a
fact that is per-monitor, per-moment, and directly checkable (does the
monitor have a live controlling terminal / an attached `manda watch`
process?), not something to assume true just because the monitor process
itself is alive. This is a genuine, useful narrowing (DIR-005's own
stated goal), not a reopening of DIR-001-004/13's positive findings about
the dispatch plumbing itself, which remain correct and unchanged.

## Relationship to the experiment's guardrails (G1-G6, protocol §6)

Directives introduce a new risk class the existing guardrails don't cover:
an iteration silently absorbing an external directive into its own
"autonomous strategy formation," which would corrupt the G4 fixpoint test
— reproducing v_n with v_{n-1} is not comparable if v_{n+1} was actually
steered by an external note that won't be present on a later reproduction
attempt. A candidate guardrail (**G7 — steering directives are visible
interventions, not silent autonomous decisions**) has been discussed but
is **not yet ratified** into `docs/proposal/quay-bootstrap-experiment.md`.
Until it is (via the protocol's own §10 resolved-decisions process), this
README's lifecycle rules are the operational discipline; do not treat them
as an already-ratified protocol guardrail.

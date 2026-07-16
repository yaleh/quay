# DIR-014

- **status:** pending
- **created_by:** human (Yale), asserted directly in this live conversation
- **created_at:** 2026-07-16
- **title:** Require the experiment's main session to arm a manda monitor; continue exploring manda nested subagent for audits

## Finding

Direct process-tree investigation in this conversation (2026-07-16)
confirmed a standing gap, not a one-off timing issue. Two Claude Code
sessions are running with `cwd=/home/yale/work/quay`:

- **PID 3176586** (pts/6, started 2026-07-15 03:32:35, ~3h45m CPU time
  at time of check) — this session's start time matches the very first
  user prompt of this entire experiment (03:33:08Z, per
  `mcp__plugin_meta-cc_meta-cc__query_session_content`), and its CPU
  time is consistent with it having executed the large majority of this
  experiment's autonomous iterations. It has manda's MCP tool adapters
  loaded (`manda mcp`, `manda-dispatch mcp`, `manda-tools mcp`, all
  confirmed live children of this PID) — but **no `manda monitor`
  process anywhere in its process tree.** Nothing watches
  `cap-requests-*` or `pending-*` for this session; it is a pure
  MCP-client, never armed as a broker/watcher.
- **PID 3526382** (pts/9, this conversation's own session) — has both
  the MCP adapters *and* a live `manda monitor terminal --root .`
  process, bound to the daemon at `.manda/hub.addr`
  (`http://localhost:28912`), armed earlier in this conversation via the
  `manda:manda-monitor` skill for an unrelated experiment (the
  cap-request round-trip latency investigation, `experiment/directives/
  archive/DIR-011-*.md`).

This directly explains a finding iteration 65 already recorded while
resolving DIR-012's action 2 (`experiment/directives/archive/
DIR-012-*.md` part (b)): checking its own session for a bound live
monitor and finding none, then citing DIR-005/iteration-15's older
"per-session, not-reliably-inherited" pattern as the reason to defer
requiring the manda nested-subagent mechanism for G3 audits. That
citation was correct as far as it went, but incomplete: it framed the
absence as an inherent, structural unreliability of manda dispatch in
general, when the direct evidence gathered this conversation shows a
narrower, fully addressable cause — **the specific session driving this
experiment's iterations has simply never had `/manda:manda-monitor` run
in it**, not that manda monitors are unreliable once armed. `G6`
(`quay-bootstrap-experiment.md` §6) already requires "manda armed;
daemon live; the monitor for this workspace attached" as a
precondition — but evidently this has been satisfied loosely (e.g. by
confirming the daemon process is up) rather than by confirming a live
`manda monitor` is actually bound to the specific session about to run
the iteration.

## Requested action

1. Amend G6's operational check (wherever it is currently mechanized —
   `experiment/ITERATION-PROMPTS.md` §0 preconditions, or the
   `manda:manda-monitor` skill's own guidance) to require confirming a
   live `manda monitor <name> --root .` process is a **direct child of
   the current session's own process tree** before proceeding — not
   merely that the manda daemon process (`manda serve`) is reachable.
   `ps --ppid <this session's own top-level pid>` (recursively) finding
   a `manda monitor` descendant is a concrete, mechanically checkable
   test; document it as the precondition check, replacing or
   supplementing whatever weaker check (e.g. a bare daemon `/healthz`
   probe) is in use today.
2. If the iteration-driving session (currently PID 3176586, pts/6, but
   this directive should be phrased session-identity-agnostically since
   PIDs are not stable across restarts) does not have a monitor armed
   when an iteration begins, the iteration must arm one via
   `/manda:manda-monitor <name>` (per that skill's own spec: sweep by
   sentinel, then one persistent `Monitor` call) before treating G6 as
   satisfied, rather than proceeding with the daemon-only check.
3. **Continue exploring the manda nested subagent mechanism for G3
   audits** (DIR-012's action 2, currently deferred) — specifically,
   once action 1 and 2 above are in place and a live monitor is
   confirmed bound to the driving session for at least two consecutive
   iterations, re-attempt DIR-012's original request under the now-met
   precondition, and record whether audit dispatch via
   `mcp__plugin_manda_manda__Agent` succeeds reliably. This is a
   re-test, not an assumption — cite DIR-012's and DIR-005's prior
   negative findings directly, and do not claim success without a live,
   reproduced G3 audit round-trip as evidence (per the same discipline
   DIR-011's own live-verification used).
4. If, after a live-bound monitor is confirmed for the driving session,
   the manda nested-subagent mechanism *still* fails or times out for
   audit dispatch, record that as a new, narrower finding (distinct from
   "no monitor was ever armed") — this would indicate a deeper
   reliability problem in the mechanism itself, not merely a missing
   precondition, and should be written up as its own directive or an
   update to `experiment/directives/README.md`'s running log rather than
   silently re-deferred with the same reasoning as before.

## Resolution

- resolved_by: iteration 67
- outcome: applied (actions 1 and 2 applied in full; action 3 explicitly
  deferred, not attempted, pending the second of the "at least two
  consecutive iterations" this directive's own text requires; action 4
  not yet applicable, since it depends on action 3 having been attempted)

**(a) Action 1 — amend G6's operational check — applied.**
`experiment/ITERATION-PROMPTS.md` §0's precondition checklist was amended:
the loose `[ ] the workspace monitor is attached (manda:manda-monitor)`
line was replaced with an explicit requirement that a live `manda monitor
<name> --root .` process be confirmed a **direct child of the current
session's own process tree** (not merely that the daemon is reachable via
a bare probe), and a new "### G6 operational check (amended by DIR-014,
iteration 67)" subsection was added immediately after, giving the exact
4-step mechanized procedure: (1) identify the session's own top-level
pid; (2) recursively `ps --ppid <pid> | grep -i monitor` — explicitly not
`tty`-filtered, per `DIR-005-dispatch-to-own-monitor-channel.md`'s own
documented pitfall that monitors started via a session's own `Monitor`
tool run detached (`tty=?`) and are invisible to a `tty`-filtered scan;
(3) if found, G6 is satisfied, cite the verbatim `ps` output as evidence;
(4) if not found, arm one via the `manda:manda-monitor` skill before
proceeding, then re-confirm. Per this directive's own scoping (and this
iteration's dispatch instructions), the `manda:manda-monitor` skill's own
definition file (`/home/yale/work/manda/plugin/skills/manda-monitor/
SKILL.md`) is a different project's artifact and was only referenced/
cited, never edited. See `experiment/iterations/iteration-67.md` §5 for
the full diff (`experiment/ITERATION-PROMPTS.md`, 44 insertions, 1
deletion).

**(b) Action 2 — record the precondition met for this iteration's own
session; count as the first of two — applied.** This iteration
independently, mechanically re-verified (not merely relayed from the
top-level orchestrator's report) that the driving session (PID 3176586,
pts/6) has a live `manda monitor quay-bootstrap --root .` process (PID
2621758) as a direct child of its own process tree, via
`ps -o pid,ppid,tty,etime,cmd --ppid 3176586 | grep -i monitor` — see
`experiment/iterations/iteration-67.md` §2 for the full verbatim output.
This is recorded explicitly as the **FIRST** of the "at least two
consecutive iterations" action 3 requires. Iteration 68 (or whichever
iteration next runs with the monitor independently re-confirmed still
live and bound to the driving session) would constitute the **second**,
at which point action 3's precondition is met and the nested-subagent
re-test becomes appropriate — see `experiment/iterations/iteration-67.md`
§Problems identified for next iteration for the explicit hand-off.

**(c) Action 3 — re-attempt the manda nested-subagent mechanism for G3
audits — explicitly DEFERRED, not attempted.** This directive's own text
conditions action 3 on the monitor being "confirmed bound to the driving
session for at least two consecutive iterations." Only one consecutive
iteration (this one) has confirmed it so far. Per this iteration's own
dispatch scoping, action 3 was deliberately not attempted this iteration
— attempting it now, with only one confirmation in hand, would not
satisfy the directive's own stated precondition and would risk exactly
the kind of premature-declaration pattern this experiment's guardrails
(G1, G4) warn against elsewhere. Deferred to a future iteration (expected
iteration 68), not rejected.

**(d) Action 4 — record a new, narrower finding if the mechanism still
fails after re-test — not yet applicable.** Depends on action 3 having
been attempted; it has not been. No finding to record yet.

**(e) V-factor movement: none claimed.** This is process/precondition-
tooling work (a `ITERATION-PROMPTS.md` §0 amendment, a directive
resolution, and an independently-reproduced process-tree confirmation),
not a feature increment to quay-native, quay-github, or Core. See
`experiment/iterations/iteration-67.md` §7-8 for the full factor-by-
factor reasoning on why this genuinely does not fit any of the eight
§5.1/§5.2 factors — applying the same standard iteration 65's DIR-012/
DIR-013 application, and iterations 8, 18, 29 before it, used for prior
process/prompt-maintenance-only work. Both V_instance (0.5673) and V_meta
(0.0973) are unchanged from iteration 66.

**(f) Cross-links.** This directive's own Finding section already cites
`experiment/directives/archive/DIR-012-nested-subagent-terminology-and-
audit-requirement.md` and `experiment/directives/archive/
DIR-005-dispatch-to-own-monitor-channel.md` directly (both read in full
by iteration 67, per its own §2). No additional edit to either archived
file was made — per iteration 67's own reasoning (§5), both already read
cleanly as pointed-to by this directive's Resolution; adding a pointer
back out from them would be a nice-to-have, not a demonstrated necessity,
unlike DIR-011's own case (where DIR-012 fixed an ambiguity that was
actually present in DIR-011's pre-existing text). Declined, with reasoning
recorded rather than silently skipped.

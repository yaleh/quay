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
  cap-request round-trip latency investigation, `experiments/quay-native-bootstrap/directives/
  archive/DIR-011-*.md`).

This directly explains a finding iteration 65 already recorded while
resolving DIR-012's action 2 (`experiments/quay-native-bootstrap/directives/archive/
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
   `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md` §0 preconditions, or the
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
   update to `experiments/quay-native-bootstrap/directives/README.md`'s running log rather than
   silently re-deferred with the same reasoning as before.

## Resolution

- resolved_by: iteration 67 (actions 1-2); iteration 68 (actions 3-4)
- outcome: applied in full — actions 1 and 2 applied at iteration 67;
  action 3 (the re-test) attempted at iteration 68, the second of the
  "at least two consecutive iterations" this directive's own text
  requires, with RESULT: FAILED (mechanism still times out, for a
  deeper reason than "no monitor armed" — see DIR-005); action 4
  (record the new, narrower finding) applied at iteration 68

**(a) Action 1 — amend G6's operational check — applied.**
`experiments/quay-native-bootstrap/ITERATION-PROMPTS.md` §0's precondition checklist was amended:
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
cited, never edited. See `experiments/quay-native-bootstrap/iterations/iteration-67.md` §5 for
the full diff (`experiments/quay-native-bootstrap/ITERATION-PROMPTS.md`, 44 insertions, 1
deletion).

**(b) Action 2 — record the precondition met for this iteration's own
session; count as the first of two — applied.** This iteration
independently, mechanically re-verified (not merely relayed from the
top-level orchestrator's report) that the driving session (PID 3176586,
pts/6) has a live `manda monitor quay-bootstrap --root .` process (PID
2621758) as a direct child of its own process tree, via
`ps -o pid,ppid,tty,etime,cmd --ppid 3176586 | grep -i monitor` — see
`experiments/quay-native-bootstrap/iterations/iteration-67.md` §2 for the full verbatim output.
This is recorded explicitly as the **FIRST** of the "at least two
consecutive iterations" action 3 requires. Iteration 68 (or whichever
iteration next runs with the monitor independently re-confirmed still
live and bound to the driving session) would constitute the **second**,
at which point action 3's precondition is met and the nested-subagent
re-test becomes appropriate — see `experiments/quay-native-bootstrap/iterations/iteration-67.md`
§Problems identified for next iteration for the explicit hand-off.

**(c) Action 3 — re-attempt the manda nested-subagent mechanism for G3
audits — ATTEMPTED at iteration 68 (the second consecutive confirmation);
RESULT: FAILED, reproducing the prior timeout under the corrected
precondition.** This directive's own text conditioned action 3 on the
monitor being "confirmed bound to the driving session for at least two
consecutive iterations." Iteration 67 (this iteration) provided the
first; iteration 68 independently, freshly re-verified the same live
process-tree fact a second time (`ps -o pid,ppid,tty,etime,cmd --ppid
3176586 | grep -i monitor` -> PID 2621758 wrapper / PID 2621778 `manda
monitor quay-bootstrap --root .`, confirmed still alive, both before and
after the test attempts) -- meeting this directive's own stated
precondition in full.

With the precondition met, iteration 68 made two bounded attempts to
invoke `mcp__plugin_manda_manda__Agent` (targeting `to: "quay-bootstrap"`,
the driving session's own confirmed monitor name): a realistic task
(150s timeout) and a minimal PING sanity check (60s timeout, the one
permitted retry). **Both timed out** with the identical error signature
documented across all 5 prior failures: `MCP error -32603: timeout
waiting for cap "agent.spawn" result after <N>s: context deadline
exceeded`. Critically, iteration 68 gathered evidence beyond what any
prior attempt had: `manda events cap-requests-quay-bootstrap` confirmed
**both dispatched requests actually landed on the correct, correctly-
targeted channel** (matching prompt text, cap `agent.spawn`, `to:
"quay-bootstrap"`) -- ruling out a wrong/guessed target as the cause for
this case, and confirming the monitor process itself did not crash
during either call. Full detail: `experiments/quay-native-bootstrap/iterations/iteration-68.md`
section 5, section 9.

**(d) Action 4 -- record a new, narrower finding, since the mechanism
still failed after re-test -- applied.** The finding, stated at the
correct precision level (per this directive's own action 4 instruction to
distinguish it from "no monitor was ever armed"):

- **What is now resolved (was DIR-014's own finding, now confirmed
  fixed):** the driving session (PID 3176586) not having any monitor
  bound to it at all is no longer the cause of anything -- a monitor
  (`quay-bootstrap`) is confirmed live and correctly bound, for two
  consecutive iterations running, and the dispatched requests are
  confirmed to have reached it correctly.
- **What is NOT resolved, and is the deeper, still-standing cause:**
  `manda-dispatch cross-session --help` (the inbound adapter `manda
  monitor <name>` uses to render `cap-requests-*` events) is explicitly
  documented, and was directly re-confirmed live this iteration, as
  **"stateless... No side effects"** (`echo '' | manda-dispatch
  cross-session` -> `{"forward":false,"line":""}`). It renders a
  dispatched cap-request event to text for something else to read; it
  never itself calls back into a live broker session's own native
  `Agent` tool to answer the request. This experiment's environment has
  no live process (human or automated) watching `quay-bootstrap`'s
  rendered terminal output and completing the `agent.spawn` cap-request's
  other half. This is **exactly** the root cause `experiments/quay-native-bootstrap/directives/
  archive/DIR-005-dispatch-to-own-monitor-channel.md` (iteration 18)
  already diagnosed for the `cord` monitor case -- now independently
  reproduced (a 6th and 7th data point, on top of iteration 14's 2,
  iteration 15's 2, and iteration 18's 1) under conditions that
  additionally rule out every other previously-open alternative
  explanation (wrong target, no monitor bound to this specific session,
  daemon unreachable) simultaneously in one test.
- **Net conclusion:** DIR-014's own narrower hypothesis -- that the 5/5
  historical failure rate was fully explained by "the driving session
  simply never had a monitor armed," and that arming one would make the
  mechanism reliable -- is **not confirmed**. The mechanism still fails,
  for the deeper, structural reason DIR-005 already found. Both findings
  are true and non-contradictory: DIR-014 correctly identified and fixed
  a real, standing gap (no monitor bound to the driving session), and
  that fix was necessary but not sufficient -- DIR-005's own
  rendering-adapter gap remains the binding constraint.
- **Explicit non-consequence, per this iteration's own scoping and
  DIR-014's own action 3 text ("this is a re-test, not an assumption"):**
  no change is made to how this experiment's G3 audits are dispatched.
  The native subagent mechanism (the top-level orchestrator's own `Agent`
  tool) remains the G3 audit-dispatch mechanism, unconditionally, exactly
  as DIR-012's action 2 resolution already established -- this one
  (now seven-data-point) test is a data point for a **future** directive
  or human decision (e.g., whether pairing the monitor with a live
  `manda watch`-driven answering loop is worth building), not an
  immediate protocol change made unilaterally by this iteration.
  Full detail: `experiments/quay-native-bootstrap/iterations/iteration-68.md` section 9, section
  Problems identified for next iteration.

**(e) V-factor movement: none claimed (both for iteration 67's actions
1-2 and iteration 68's action 3 re-test).** This is process/precondition-
tooling and dispatch-mechanism diagnostic work (a `ITERATION-PROMPTS.md`
§0 amendment, a directive resolution, an independently-reproduced
process-tree confirmation, and a bounded manda-nested-subagent test), not
a feature increment to quay-native, quay-github, or Core. See
`experiments/quay-native-bootstrap/iterations/iteration-67.md` §7-8 and `experiments/quay-native-bootstrap/iterations/
iteration-68.md` §7-8 for the full factor-by-factor reasoning on why this
genuinely does not fit any of the eight §5.1/§5.2 factors — applying the
same standard iteration 65's DIR-012/DIR-013 application, and iterations
8, 18, 29 before it, used for prior process/prompt-maintenance-only work.
V_instance (0.5673) and V_meta (0.0973) are unchanged from iteration 66
through iteration 68.

**(f) Cross-links.** This directive's own Finding section already cites
`experiments/quay-native-bootstrap/directives/archive/DIR-012-nested-subagent-terminology-and-
audit-requirement.md` and `experiments/quay-native-bootstrap/directives/archive/
DIR-005-dispatch-to-own-monitor-channel.md` directly (both read in full
by iteration 67, per its own §2). No additional edit to either archived
file was made — per iteration 67's own reasoning (§5), both already read
cleanly as pointed-to by this directive's Resolution; adding a pointer
back out from them would be a nice-to-have, not a demonstrated necessity,
unlike DIR-011's own case (where DIR-012 fixed an ambiguity that was
actually present in DIR-011's pre-existing text). Declined, with reasoning
recorded rather than silently skipped.

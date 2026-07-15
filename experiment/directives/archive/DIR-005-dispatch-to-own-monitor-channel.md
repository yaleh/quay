# DIR-005

- status: applied
- created_by: human (Yale), asserted directly in this live conversation
- created_at: 2026-07-15
- title: Dispatch to the iteration-executor session's own manda monitor channel by name, not a hardcoded/guessed target

## Finding

This conversation traced, live, why every real `Dispatch`/`Agent` call
across iterations 13-16 (and DIR-004's own probe) failed to be claimed by
an unattended listener. The concrete evidence, gathered by directly
inspecting the host process tree (`ps`), `.manda/config.yml`, and the
verbatim text of every `Dispatch(...)` call recorded in
`experiment/iterations/iteration-{13,14,15,16}.md` and
`experiment/directives/archive/DIR-004-*.md`:

1. The specific iteration-13/DIR-004 session (pts/6, pid `3176586`) has
   its own dedicated `manda monitor cord --root .` process (pid
   `3178052`), spawned as a direct child of that session, running
   continuously since `03:33:16` — confirmed still alive and healthy at
   the time of this conversation (`Monitor details: Status: running,
   Runtime: 6h41m57s, Script: manda monitor cord --root .`).
2. **Every real dispatch attempt in the written record targeted `to="worker"`**
   (`Dispatch(id="dir004-probe-iter13", to="worker", ...)` in DIR-004;
   `Dispatch(id="iter13-executor-probe", to="worker", ...)` in iteration
   13). Iteration 15's one fallback attempt used `pool: true` (the shared
   pending pool) rather than any named target. **No dispatch call in the
   entire recorded history ever used `to="cord"`.**
3. A direct search (`grep -rn "cord"` across `experiment/`, plus
   inspecting `.manda/` and the hub's log file at
   `/tmp/manda-844d2790b922bf3f.log`, which is 0 bytes) confirms `cord`
   has never received a single request — it has been running idle,
   correctly, for over 6 hours, simply because nothing ever addressed it.
4. The `manda-dispatch submit`/`Dispatch` tool's own contract requires an
   explicit `--to=<executor>` / `to=` target (or an explicit `--pool`
   opt-in that monitors do not subscribe to by default, per the tool's
   own schema description quoted in iteration 16 §3 Angle 1). There is no
   evidence any iteration ever discovered its *own* session's monitor
   name before choosing a dispatch target — `"worker"` appears to have
   been guessed or copied from an example, not derived from the running
   session's actual monitor.

**This is a plausible, previously-untested root cause for 4+ consecutive
iterations of "submitted successfully, never claimed":** the dispatch
target was never verified to correspond to a monitor that is actually
alive and attending *that specific session*. `worker`/`terminal`/`cord`
are simply the three monitor names that happen to be running on this
host at any given time (per `.manda/config.yml`'s `monitor.bindings`
section, read earlier in this conversation) — they are not necessarily
1:1 bound to the session issuing the dispatch call, and no iteration
verified which (if any) monitor process is a child of its own session
before picking a `to=` value.

**Discovery method, tested live in this same conversation, including a
pitfall worth flagging explicitly.** The top-level orchestrator session
(this conversation, pts/9, pid `3526382`) was checked for its own bound
monitor. A first attempt — `ps --ppid <own pid>` plus filtering `ps aux`
by the session's own `tty` (`pts/9`) — found no `manda monitor` process,
and concluded (wrongly) that this session had no monitor bound. The
human then reported a live `Monitor details` panel showing `Script:
manda monitor terminal --root ., Runtime: 1h50m33s` for this very
session, contradicting that conclusion. Re-investigating found the exact
cause of the false negative: the `manda monitor terminal` process was
started via this session's own `Monitor` tool (a detached background
task), so its `tty` shows as `?`, not `pts/9` — a plain `tty`-filtered
`ps aux` scan silently excludes it. The correct check walks the `ppid`
chain instead of filtering by `tty`:

```
ps -o pid,ppid,tty,lstart,cmd -p <own claude pid>       # confirm own pid
ps --ppid <own claude pid>                               # direct children (may show only an intermediate bash)
# then, for any bash child whose cmd contains "manda monitor <name>",
# confirm via a full three-way parentage check:
ps -o pid,ppid,cmd -p <own pid>,<bash child pid>,<manda monitor pid>
```

Confirmed this way: `3526382` (this session) → `3965631` (a detached
`bash -c '... manda monitor terminal --root .'`, started by this
session's own `Monitor` tool call, `tty=?`) → `3965654` (`manda monitor
terminal --root .`). `/proc/3965654/cwd` independently confirmed
`/home/yale/work/quay`. **This session's own monitor name is `terminal`,
not absent as first (incorrectly) concluded.**

This means the naive discovery method proposed further down (`ps --ppid
<own pid>` "or equivalent") is insufficient on its own and must not
filter by `tty` — a session's own monitor, if started via that session's
`Monitor` tool (as the `manda-monitor` skill does), will always appear
`tty=?` and will be invisible to any check that assumes it shares the
session's terminal.

**Follow-up experiment: can a subagent discover this on its own, with no
name handed to it?** Tested live via a fresh, cold `Agent`-spawned
`general-purpose` subagent, deliberately given no monitor name, no
session identifiers, and explicit instructions not to search conversation
history or `experiment/` markdown for hints — only OS process/file
introspection was allowed. Result: **yes, it succeeded, using the exact
ancestor-rooted method above.** It derived its own ancestry via `$$` and
`ppid` walking up to the `claude` process (pid `3526382`), then scanned
that process's descendants (`pstree -ap`/`ps --ppid` iteratively) and
found `bash(3965631) → manda monitor terminal --root .(3965654)` as a
grandchild of that same `claude` instance — correctly identifying
`terminal` as its own lineage's monitor. It independently rediscovered
the `tty` pitfall (its own lineage is `tty=pts/9`; the monitor process is
`tty=?`) and confirmed a naive host-wide `grep "manda monitor"` alone is
ambiguous — it found 7 total monitor processes on the host across 3
distinct names (`cord`×3, `worker`×3, `terminal`×1) and only the
ancestor-rooted scan (not name-matching) disambiguated which one was
actually its own. It also independently re-confirmed `.manda/config.yml`
contains no static session-id-to-monitor-name mapping — the name only
exists as a runtime CLI argument, discoverable solely via process
introspection.

**Important caveat on this positive result, stated plainly and not to be
overclaimed:** this succeeded specifically because the subagent's `Bash`
tool executes in the *same host process namespace* as the spawning
session — it could directly `ps`/`pstree` the parent `claude` process and
all its siblings/descendants. This is a property of `Agent`-spawned
subagents *in this environment as currently configured*, not a guarantee
that holds for every session/dispatch type. It remains untested whether
an `Agent`-dispatched `baime:iteration-executor` subagent (the actual
iteration-executor session type used throughout iterations 0-16) shares
this same-host, same-process-namespace property with its own spawning
session, or whether some future/different dispatch path (a genuinely
isolated worktree, container, or remote host) would break this method
entirely — in which case the fallback in Requested action item 3 (record
the limitation explicitly) applies.

## Requested action

1. Before attempting any `Dispatch`/`Agent` call, the iteration-executor
   session should first **discover its own monitor's name**, mechanically
   (not guessed) — by reading `.manda/config.yml`'s `monitor.bindings`
   section together with host process introspection, walking the `ppid`
   chain from the session's own pid rather than filtering by `tty` (see
   the "Discovery method" subsection above — a `tty`-based filter
   silently misses monitors started via the session's own `Monitor` tool,
   since those run detached with `tty=?`) — rather than defaulting to
   `to="worker"` or any other hardcoded/example name. If no host-level
   process introspection is available from within a given session type,
   record that limitation explicitly rather than silently falling back to
   a guessed name.
2. If the session's own bound monitor name is discoverable, dispatch
   (or instruct any subagent it spawns to dispatch) explicitly to that
   name, and use an async-submit-then-poll pattern (per this
   conversation's earlier discussion) rather than the 30-second
   synchronous `Agent`/`Dispatch(mode="sync")` path, which has failed
   6/6 times independent of targeting.
3. If no monitor is discoverable as bound to the session (a legitimate
   possible outcome, not to be papered over), record that plainly — this
   would itself be new, more precise evidence about why on-demand
   fresh-context review is structurally unavailable in this environment,
   sharper than "no one happened to claim it."
4. Test this against a real target once discovered — e.g. `cord`
   (confirmed alive, confirmed a child of the pts/6 session, confirmed
   never yet addressed) is a clean, unpolluted test subject for exactly
   this experiment, if `cord` turns out to be the monitor bound to
   whichever session performs the test.
5. Record the outcome honestly either way, and update
   `experiment/directives/README.md`'s G6/dispatch framing accordingly —
   this does not presuppose success; it presupposes only that "no one
   ever tried addressing the session's own actual monitor" was an
   untested gap worth closing before concluding the primitive cannot work
   unattended.

## Resolution

- resolved_by: iteration-18
- outcome: **applied** — discovery method executed exactly as specified;
  the dispatch attempt itself surfaced a new, more precise negative
  finding than "never claimed" (see below). Not a clean positive
  (task was never claimed), but not a repeat of the prior "guessed
  target" failure mode either — this is the honest, more informative
  outcome DIR-005 explicitly anticipated as legitimate ("if no monitor
  is discoverable... record that plainly" / item 5's "this does not
  presuppose success").
- evidence: `experiment/iterations/iteration-18.md` §3 (DIR-005 section)
  for the full verbatim command sequence. Summary:

  1. **Discovery (item 1) — succeeded, exactly per the documented
     method.** This iteration-executor session's own claude pid is
     `3176586` (confirmed via `ps -o pid,ppid,tty,lstart,cmd -p $$`
     walking up from this session's own bash child). Walking its
     direct children (`ps --ppid 3176586`, NOT filtered by `tty`, per
     the documented pitfall) found a detached (`tty=?`) bash child
     `3178032` running `manda monitor cord --root .` (pid `3178052`).
     Three-way parentage confirmed via
     `ps -o pid,ppid,cmd -p 3176586,3178032,3178052`; `/proc/3178052/cwd`
     independently confirmed `/home/yale/work/quay`; the process has
     been running continuously since `03:33:16` (~7h at test time).
     **This session's own bound monitor is `cord`** — the exact same
     monitor DIR-005 itself named as "confirmed alive, confirmed never
     yet addressed." This is a new fact DIR-005 did not know when
     written: the session that ended up running iteration 18 turned out
     to be the very pts/6 session DIR-005's evidence trail was built
     from.
  2. **Dispatch (item 2) — executed exactly as specified.**
     `ToolSearch` found live, schema-loadable `Dispatch`/`DispatchStatus`/
     `DispatchCancel` tools this session (unlike some prior iterations'
     negative `ToolSearch` results). Submitted
     `Dispatch(id="iter18-dir005-probe", to="cord", mode="async", ...)`
     — returned `{"task_id":"iter18-dir005-probe"}` immediately, per the
     async-submit-then-poll pattern item 2 requires (not the 30s
     synchronous path). `manda events pending-cord` independently
     confirmed the event actually landed on channel `pending-cord`
     (`cursor:36`, real payload) — the target was correctly and
     verifiably addressed, not merely accepted by the API.
  3. **Polling (item 2) — task never left `queued` after ~110s** across
     6+ `DispatchStatus` polls spanning roughly two minutes (`10:41:23Z`
     submit to `10:43:11Z` last poll). Cleanly cancelled via
     `DispatchCancel` (`path:"queued"`, `status:"cancelled"`) rather than
     left open to be retroactively misrepresented as claimed by a future
     session (matching iteration 15's established hygiene precedent).
  4. **The new, more precise negative finding (item 3/5):** this is
     *not* simply "no one happened to be listening" (the old, vaguer
     framing DIR-005 set out to sharpen). Direct inspection of the
     `manda-dispatch cross-session --help` output (the adapter bound
     to `pending-{name}` channels per `.manda/config.yml`'s
     `monitor.bindings`) shows it is explicitly documented:
     **"Inbound adapter (stateless, TASK-16.2; invoked per-event by
     `manda watch --adapter cross-session`)... reads one
     `adapterabi.Envelope` event from stdin, prints an
     `adapterabi.Result {forward,line}` to stdout. No side effects."**
     A live empty-stdin invocation confirmed this: it returns
     `{"forward":false,"line":""}` and performs no action. This means
     `manda monitor cord`'s role for a `pending-cord` dispatch is
     **rendering the event as a line of text for a human or another
     process to read** — it does not itself call `manda-dispatch claim`
     or execute anything. Whether the dispatch is ever claimed therefore
     depends entirely on *something else* watching `cord`'s rendered
     output and manually/programmatically issuing a `claim`. Direct
     process inspection confirmed no such watcher exists: `cord`'s
     controlling terminal is `tty_nr=0` (none — it runs fully detached,
     exactly the `tty=?` state DIR-005's own "Discovery method" section
     already documented for monitors started via a session's own
     `Monitor` tool call), its stdout/stderr are anonymous sockets, and
     no `manda watch` process was found anywhere on the host attached to
     read them.
  5. **Conclusion, stated at the correct precision level:** the
     dispatch mechanism itself worked exactly as designed — correct
     target discovered, correct channel addressed, event verifiably
     delivered. The reason it was never claimed is not "wrong target"
     (DIR-005's hypothesis, now ruled out for this specific case) but a
     **structural one level down**: `manda monitor <name>` is a
     stateless *rendering* adapter, not an autonomous claim loop: even
     a perfectly-targeted dispatch to a monitor that is unambiguously
     "this session's own" produces no execution unless a live
     human/process is actually watching that monitor's terminal and
     manually (or via its own script) issuing `manda-dispatch claim`.
     This is a legitimate, honest, more precise negative finding, per
     DIR-005's own item 3's explicit allowance ("If no monitor is
     discoverable as bound to the session... record that plainly") —
     generalized here to the closely analogous outcome DIR-005 did not
     quite anticipate in those words: the monitor *was* discoverable
     and correctly targeted, and it *still* does not constitute an
     unattended executor.
  6. **What this changes vs. does not change**, precisely: it does
     **not** show DIR-001/002/004/13's positive dispatch-infrastructure
     findings were wrong — the `Dispatch`/`DispatchStatus` MCP tools,
     the `pending-{name}` channel routing, and the daemon itself all
     worked exactly as documented. It **narrows** the open question
     from "is the target guessed or discovered" (DIR-005's original
     hypothesis, now closed — discovery works, targeting was never the
     defect in this instance) to "is any process autonomously watching
     a monitor's rendered output and claiming on its behalf" (still
     open, and this iteration's direct evidence is NO for `cord`
     specifically, at this specific point in time — a per-instance,
     re-checkable fact, not a permanent architectural claim, consistent
     with how DIR-004's and iteration 13's findings were scoped).

See `experiment/iterations/iteration-18.md` §3 for the complete verbatim
command transcript this summary is drawn from.

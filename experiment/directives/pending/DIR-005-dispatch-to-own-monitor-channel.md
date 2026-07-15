# DIR-005

- status: pending
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
<!-- filled in by whichever iteration applies this -->

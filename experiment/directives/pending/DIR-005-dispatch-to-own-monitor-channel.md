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

## Requested action

1. Before attempting any `Dispatch`/`Agent` call, the iteration-executor
   session should first **discover its own monitor's name**, mechanically
   (not guessed) — e.g. by reading `.manda/config.yml`'s
   `monitor.bindings` section together with host process introspection
   (`ps --ppid <own pid>` or equivalent, if available from within the
   session; otherwise via whatever manda-provided mechanism exposes
   "which monitor, if any, is bound to this session") — rather than
   defaulting to `to="worker"` or any other hardcoded/example name.
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

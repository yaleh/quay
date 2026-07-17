# DIR-001

- status: pending
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-17
- title: Keep a `quay serve` instance continuously running against the current main working directory, bound to 0.0.0.0, for human observation during experiment 3

## Finding

The human steering this experiment wants to observe the Web UI live, from
outside the iteration loop, while experiment 3 (quay-webui-bootstrap) is
running. This requires a `quay serve` process that:

1. is running continuously throughout the experiment (not only spun up
   ad hoc inside a browser-automation test and torn down afterward — the
   process observed at the time of this directive,
   `node -e "...startServer({port:47173})..."` under
   `/tmp/quay-browser-test-workspace-3BvI`, is exactly such an ephemeral
   test-fixture instance, not a standing observation instance);
2. serves the **actual current main working directory**
   (`/home/yale/work/quay`), not a temp/test fixture workspace, so what
   the human sees reflects the latest committed-or-working-tree state of
   the experiment's own changes;
3. is reachable from outside `localhost` — i.e. bound to `0.0.0.0`, not
   just the loopback interface.

`packages/quay/src/serve.js`'s `startServer({ port = 4173 } = {})`
(line 245) currently accepts only a `port` option; there is no `host`
parameter, and `server.listen(port, callback)` (line 361) does not pass
an explicit host. Whether Node's default bind address already satisfies
"reachable from outside localhost" has not been verified as of this
directive — that verification, and any source change it implies, is part
of the requested action below, not assumed here.

## Requested action

1. Whichever iteration first advances `ui_read_capability` or
   `visual_design_quality` work (or, if simpler, iteration 1 directly)
   should start (or confirm already running) a `quay serve` instance
   pointed at `/home/yale/work/quay` as its workspace root, kept running
   for the duration of the experiment — not torn down at the end of the
   iteration that starts it.
2. Confirm whether this instance is reachable on `0.0.0.0` (all
   interfaces), not just `127.0.0.1`. If `server.listen(port, ...)`'s
   current no-host-specified behavior does not already satisfy this,
   add an explicit `host` option to `startServer()` (default preserved
   as `localhost`/unset for existing callers such as the test suite;
   only the standing observation instance opts into `0.0.0.0`). Any such
   source change to `packages/quay/src/serve.js` is a Core change and
   requires the standard G3 out-of-band audit per this experiment's
   guardrails — it is not exempt because it is "just an operational
   convenience."
3. Whenever the experiment's own working-tree code changes in a way that
   would affect what is served (e.g. `serve.js` itself, or task/data
   files under the workspace), the standing instance should be restarted
   (or otherwise confirmed to be serving current code) so the human is
   never observing a stale build.
4. Record where/how the standing instance was started (command, port,
   bind address) in the iteration report that establishes it, so later
   iterations don't have to rediscover it.
5. This is a standing operational instruction for the remainder of the
   experiment, not a one-time task — cite it (and its resolution status)
   in each iteration's §0 preconditions / pending-directives check until
   archived.

## Resolution
<!-- to be filled in by whichever iteration applies this -->

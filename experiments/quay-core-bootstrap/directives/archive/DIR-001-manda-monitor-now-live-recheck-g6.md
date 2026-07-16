# DIR-001

- status: pending
- created_by: human (Yale)
- created_at: 2026-07-16
- title: manda monitor has been started since iteration 0 ran — recheck G6 before any task-driving iteration

## Finding

Iteration 0 (`experiments/quay-core-bootstrap/iterations/iteration-0.md`
§2) recorded the G6 precondition as **NOT CONFIRMED**: the manda daemon
was unreachable on `http://localhost:28912`, and the only `manda
monitor` processes visible in `ps aux` were not direct children of that
session's own process tree.

Since then, the human has started a `manda monitor` process for this
workspace directly (outside of any iteration's own actions). The exact
session/terminal it was started from was not tracked at the time, so
the iteration must not assume anything about it beyond what it can
mechanically re-verify itself — the same `ps`-based direct-child check
iteration 0 already applied, not a bare assumption that "it's fine now."

## Requested action

The next iteration that intends to execute or drive a QC-* task (i.e.
any iteration past iteration 0's purely-observational scope — this
includes the QC-001 work already drafted) must, before dispatching any
subagent or relying on manda:

1. Re-run the §0 G6 precondition check exactly as specified in
   `ITERATION-PROMPTS.md` (daemon `/healthz` probe **and** a `ps`-based
   confirmation that the live `manda monitor --root .` process is a
   direct child of that iteration's own session process tree — a bare
   daemon probe is explicitly insufficient per that section).
2. Record the outcome (confirmed or not) explicitly in that iteration's
   own report §2, the same way iteration 0 did — do not silently carry
   forward iteration 0's "NOT CONFIRMED" finding as still current
   without re-checking, and do not silently assume the newly-started
   monitor satisfies G6 without the direct-child check.
3. If confirmed, proceed normally. If still not confirmed (e.g. the
   monitor that was started is not a direct child of this particular
   iteration's session), treat it the same way iteration 0 did:
   proceed only with iteration work that does not require subagent
   dispatch, and flag the gap rather than papering over it.

This directive does not assert that G6 is now satisfied — only that the
environment changed since iteration 0's check and needs a fresh,
mechanical re-verification, not a carry-forward assumption in either
direction.

## Resolution

Resolved in iteration 2 (2026-07-16).

G6 mechanically re-checked:
- `curl http://localhost:28912/healthz` → exit code 7 (connection refused).
  Daemon still not live.
- `ps aux | grep "manda monitor"` shows PIDs 203534, 720369, 1065935 — none
  are direct children of this session's process tree (bash PID 1119093, parent
  claude PID 1013487). Direct children of 1013487 include meta-cc-mcp, manda,
  npm exec @playwright, npm exec chrome, node-MainThread, and two bash shells —
  no manda monitor.

Result: G6 still NOT CONFIRMED (same as iteration 0 and iteration 1). This
directive is resolved in the sense that the recheck has been performed and
the result recorded. The G6 finding itself is unchanged — no escalation or
change-of-course needed for this iteration's work (which does not require
subagent dispatch). Filing this directive as archived with the finding.

See `experiments/quay-core-bootstrap/iterations/iteration-2.md` §2.

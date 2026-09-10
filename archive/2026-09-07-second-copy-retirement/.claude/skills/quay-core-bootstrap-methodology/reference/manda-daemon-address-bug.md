# The manda-daemon hardcoded-port bug (found iteration 4, fixed same iteration)

Source: `experiments/quay-core-bootstrap/iterations/iteration-0.md` through
`iteration-4.md`, DIR-001.

## The bug

Iterations 0-3's G6 precondition check (and the inherited Skill/prompt
template's own instructions) probed the manda daemon healthz endpoint at a
**hardcoded** address, `http://localhost:28912/healthz`. This consistently
returned connection-refused (`curl` exit code 7), so the daemon was
recorded as unreachable in every one of those iterations — a false
negative.

## The fix

Iteration 4 discovered the correct address is not fixed — it must be read
at runtime from `.manda/hub.addr`:

```
cat /home/yale/work/quay/.manda/hub.addr
→ http://localhost:46215

curl -s http://localhost:46215/healthz
→ {"root":"/home/yale/work/quay"}  (exit 0)
```

The daemon was live the entire time; the probe method was wrong, not the
daemon.

## Why this matters beyond this one experiment

This was a real operational bug in the **inherited** Skill/prompt
template — not something unique to experiment 2's environment. Any
protocol or Skill file (including in a future experiment 3) that names a
literal daemon port for the manda healthz check is carrying this same
bug forward. The correct instruction is: "read the current daemon address
from `.manda/hub.addr`; never assume or hardcode a port number," because
the daemon's port is assigned dynamically per-run.

## Consuming-scope guidance

- Grep any inherited iteration-prompt or Skill file for a literal
  `28912` (or any other hardcoded manda port) before trusting its G6/daemon
  precondition instructions verbatim; replace with the `.manda/hub.addr`
  read-at-runtime pattern.
- Treat a "daemon unreachable" G6 finding as provisional until the address
  source has been double-checked — three consecutive iterations (0-3)
  reported a false negative here before the bug was found, because each
  iteration re-ran the same wrong probe rather than questioning the probe
  method itself.

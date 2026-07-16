# Changelog

## 2026-07-16 — Manda operational findings (quay-core-bootstrap experiment 2)

### Manda hub address convention

The manda daemon's actual address is stored in `.manda/hub.addr`. Always read
this file to obtain the correct address — do not assume a fixed port number.

```bash
MANDA_ADDR=$(cat .manda/hub.addr)
curl -s "$MANDA_ADDR/healthz"   # {"root":"..."} = daemon live
```

**Port-discovery finding**: iterations 0-3 of the quay-core-bootstrap experiment
probed `http://localhost:28912/healthz` and received connection-refused, concluding
the daemon was unreachable. The daemon was live at `http://localhost:46215` (the
address in `.manda/hub.addr`) throughout those iterations. The probe address was
wrong, not the daemon. See `.manda/NOTES.md` for the full account (cross-reference:
QC-005, iteration 4).

### Manda Agent reliability envelope — three confirmed tiers

`mcp__plugin_manda_manda__Agent` (routed via the `cord` monitor channel) has been
probed at three complexity levels. All three succeeded on their first attempt:

| Tier | Task description | Timeout | Result | Iteration |
|---|---|---|---|---|
| Trivial | Single-word echo ("PONG") | 90s | SUCCESS (1/1) | 4 |
| Medium | Single-file read + structured JSON response | 150s | SUCCESS (1/1) | 5 |
| Complex | Multi-file read + adversarial analysis + structured verdict | 150s | SUCCESS (1/1) | 6 |

**Constraints**: this primitive is conditional — it requires (a) the manda daemon
live at the address in `.manda/hub.addr`, and (b) a `manda monitor cord` broker
running in a session other than the caller's own session (DIR-020: the calling
session must not own the broker, or a self-deadlock results). The primitive is not
unconditional; these preconditions must be verified before each call.

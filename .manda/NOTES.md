# Manda Hub — Operational Notes

## Hub address convention

The manda daemon's actual address is stored in `.manda/hub.addr`. Always read
this file to get the correct address — do **not** assume a fixed port number.

```
cat .manda/hub.addr          # e.g. http://localhost:46215
curl -s $(cat .manda/hub.addr)/healthz   # should return {"root":"..."}
```

The address in `hub.addr` is written by `manda` when the daemon starts and
reflects whatever port was actually bound. It may differ across environments
and across daemon restarts.

## Port-discovery finding (experiment 2, iteration 4 — 2026-07-16)

Iterations 0-3 of the quay-core-bootstrap experiment all probed the daemon
at `http://localhost:28912/healthz` and received connection-refused (exit 7),
concluding the daemon was not reachable. This was wrong: the daemon was live
at `http://localhost:46215` (the address recorded in `.manda/hub.addr`). Only
the probe address was incorrect.

Primary-source verification that discovered this:
```
cat .manda/hub.addr
→ http://localhost:46215

curl -s http://localhost:46215/healthz
→ {"root":"/home/yale/work/quay"}  (exit 0)
```

The daemon was likely live in all prior iterations (0-3); the four "daemon not
reachable" findings in those iterations were artifacts of probing the wrong port.
This is documented in `experiments/quay-core-bootstrap/iterations/iteration-4.md` §2.

## Corrected precondition check for future iterations

The `ITERATION-PROMPTS.md` §0 precondition check reads:
> `manda daemon is live for this workspace (http://localhost:28912)`

This should be interpreted as:
> Read `.manda/hub.addr` to get the actual daemon address, then probe that
> address with `curl -s <addr>/healthz`. A response of `{"root":"..."}` (exit 0)
> confirms the daemon is live. Do **not** hardcode port 28912 — it is not
> guaranteed to be the actual bound port.

Recommended precondition check sequence:
```bash
MANDA_ADDR=$(cat .manda/hub.addr)
curl -s "$MANDA_ADDR/healthz"   # {"root":"..."} = daemon live; any error = not live
```

## Cord broker check

The cord broker processes (for `mcp__plugin_manda_manda__Agent` calls with
`to="cord"`) are separate from the daemon. Confirm with:
```bash
ps aux | grep "manda monitor cord" | grep -v grep
```

The calling session must NOT be the same session that owns the cord broker
(DIR-020 hard rule — self-deadlock if caller == broker).

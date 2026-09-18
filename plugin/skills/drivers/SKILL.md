---
name: quay-drivers
description: "Start the promotion + worker drivers and the web server in ONE idempotent in-session call — wraps `quay driver start --kind promotion|worker` + `quay serve` via plugin/scripts/start-drivers.ts, relaying (never swallowing) the halted / worktree-root failure paths. Use after `quay-init` to bring a project's drivers and Web UI into the running state without hand-typing three CLI commands."
allowed-tools: Bash, Read
---

# quay-drivers

Bring a quay project's **promotion driver**, **worker driver**, and **web server** into the running
state with a single in-session call — no hand-typed `quay driver` / `quay serve` CLI commands, no
tmux. This is step ④ of the quay enablement flow (`SPEC-tmux-retirement-2026-09-03.md`
§1.4/Layer 3b): ① install → ② start a session → ③ `quay-init` → **④ this skill** → ⑤ manager.

The **start logic lives in ONE executable** — `plugin/scripts/start-drivers.ts`
(`tasks/gap-skill-start-drivers-webserver`). This skill delegates to it rather than repeating the
idempotent-start loop inline: a second copy of the start logic is exactly the drift this repo keeps
removing (the same delegate pattern as `quay-init` → `quay-init.sh`). Run the script; do not
hand-reimplement its behavior.

## What it wraps

The three commands the script wraps (per `quay driver --help` / `quay serve`, 2026-09-04 实测):

```
quay driver start --kind promotion [--root <path>]
quay driver start --kind worker    [--root <path>]
quay serve --host <ip> --port <p>            # web UI (default host 0.0.0.0; --port omitted ⇒ kernel-assigned
                                             # ephemeral port, read back from .quay/server.json)
```

The script is **idempotent** — safe to call repeatedly:

- **drivers**: `quay driver status --kind <kind> --json` reports `alive: 1` ⇒ skip; otherwise
  `quay driver start`. The driver kernel (`driver-runtime.ts startKind`) is itself idempotent
  (`already-running`), so a race between two invocations cannot double-spawn — the status pre-check
  is a fast path, not the only guard.
- **web server**: an HTTP probe on `<host>:<port>` answers ⇒ skip; otherwise the script backgrounds
  `quay serve` (detached, `setsid`-equivalent) and polls the probe until it answers. `quay serve`
  has no supervisor (unlike the drivers), so backgrounding is the script's job.

## Steps

### 1. Resolve the workspace root

The script needs a quay workspace root (a directory whose `.quay/config.yml` exists). By default it
discovers the root by walking up from the current directory; in a fresh project this is the
directory you just ran `quay-init` in. If the script is not run from inside the workspace, pass
`--root <path>` explicitly.

### 2. Run the script

```bash
node --experimental-strip-types plugin/scripts/start-drivers.ts
```

With an explicit workspace root / non-default web binding:

```bash
node --experimental-strip-types plugin/scripts/start-drivers.ts \
  --root <path> --host 0.0.0.0

# ⛔ `--port` is optional and defaults to 0 =「让内核分配临时端口」. Pass it only to PIN an exact port
# (a deployment that must be addressable at a fixed number); a real collision then fails loudly rather
# than silently moving to another port.
```

On success the script prints, per component, whether it was already running or was started (e.g.
`promotion: started`, `worker: already running (alive)`, `serve: started (pid=…) on
http://0.0.0.0:<the port the kernel bound>`).

`serve`'s verdict comes from the host process ITSELF, not from a probe this script runs: `quay serve`
holds a same-root admission lock, so it either binds (`serve: started`) or REFUSES because a live host
already owns this workspace root (`serve: already running (pid=…) … (code fresh)`). When a live host is
reported, `GET /health` on the port its carrier names decides whether it is kept (fresh), RELOADED
(stale — the old host is SIGTERM'd and its pid awaited), or LEFT ALONE and reported as
`staleness: "not-evaluated"`.

### 3. Verify (optional, independent)

The script's own report is the primary signal. To verify independently from the mechanism:

```bash
quay driver status --kind promotion --root <path>   # "alive":1
quay driver status --kind worker    --root <path>   # "alive":1
curl -sf http://<host>:<port>/health || curl -sf http://<host>:<port>/
```

## Known failure paths (relayed, not swallowed)

The script forwards the CLI's own error verbatim and exits non-zero — it never replaces a real
reason with a generic one (硬规则 3b: "read-unable" must not look like success).

| Symptom | Meaning | Fix |
|---|---|---|
| `… is halted (halted_by=…) — refusing to start; clear the halt first with: quay driver resume --kind <kind>` | the driver's control state is `halted=true` (e.g. after `quay driver drain`) | run `quay driver resume --kind <kind>`, then re-run this skill |
| `… refusing to run from a git worktree (…) … Run from the main checkout instead` | `quay driver start` is REJECTED from a worktree root (AC139-4 — the resident supervisor must be carried from the main checkout, not a short-lived worktree) | re-run this skill from the workspace main checkout, not a `quay-worktrees/…` path |
| `… no .quay/config.yml found …` | the script is not running inside a quay workspace | `cd` into the workspace root, or pass `--root <path>` |
| `serve: process exited before answering the probe … see .quay/serve.log` | the web server process died at startup (e.g. `EADDRINUSE` if the port is taken by a non-HTTP process) | read `.quay/serve.log` in the workspace root for the real error |

## Idempotency / safety

- Re-running on a workspace whose drivers/server are already up is a **no-op** (no duplicate
  supervisor, no second `serve` process) — this is the script's `planActions` decision, not a
  side-effect of the CLI.
- The script never touches tmux, and never starts a session — it only starts the resident driver
  supervisors and the web server, exactly the two surfaces the enablement flow needs.

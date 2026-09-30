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
quay serve [--host <ip>] [--port <p>]        # web UI — BOTH flags optional. Omitted ⇒ resolved through
                                             # the ONE definition point (packages/quay/src/serve-binding.ts):
                                             # .quay/config.yml `serve.host`/`serve.port`, else the single
                                             # fallback — host 0.0.0.0, port 0 = kernel-assigned ephemeral
                                             # (read back from .quay/server.json)
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

With an explicit workspace root (and, only when you must pin the binding, `--host` / `--port`):

```bash
node --experimental-strip-types plugin/scripts/start-drivers.ts \
  --root <path>

# ⛔ `--host` and `--port` are FORWARDED to the spawned `quay serve` ONLY WHEN GIVEN
# (gap-serve-binding-defaults-three-copies-to-one-definition-point): an omitted flag is NOT written into
# the child's cmdline. Omitted ⇒ the host resolves it through the ONE definition point
# (packages/quay/src/serve-binding.ts): `.quay/config.yml`'s `serve.host` / `serve.port`, else the single
# fallback — host 0.0.0.0, port 0 =「让内核分配临时端口」. Pass `--port` only to PIN an exact port (a
# deployment that must be addressable at a fixed number); a real collision then fails loudly rather than
# silently moving to another port.
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

## Resource envelope (memory) — what the anchor group runs inside

`spawnAnchor` (`plugin/scripts/driver-runtime.ts`, the ONE place an anchor is started — `start --kind`,
self-refresh and takeover all go through it) wraps the anchor in
`systemd-run --user --scope --collect -p MemoryAccounting=yes -p OOMPolicy=continue -p MemoryMax=<host-derived>`
whenever `systemd-run --user --scope` works on the host. **All six kind loops and every worker the worker
driver spawns inherit that scope** — so a memory blowout inside a worker is bounded to the anchor group,
not to the machine (2026-09-25: a hand-made scope with **no** `MemoryMax` had the whole driver group
OOM-killed 36 times, load 4309).

- **`MemoryMax` is host-derived**: `floor(os.totalmem() × 0.25)`, page-aligned. ⛔ Never a literal like
  `16G` — a literal that means "unlimited" on the machine that wrote it becomes a *real* limit on the
  next host, silently (CLAUDE.md 硬规则 4 推论二). 0.25 is a **starting value, not a goal**: measure it
  (below) before changing it.
- **Override**: `QUAY_DRIVER_SYSTEMD_RUN_LIMITS="MemoryMax=4G"` (same key syntax as the suite's
  `QUAY_TEST_SYSTEMD_RUN_LIMITS`). **Explicitly empty (`=""`) means "no `MemoryMax` property at all"** —
  `"not limited"` is expressed by *not setting the property*, ⛔ not by a value that is only unlimited
  on this host.
- **`systemd-run` unavailable** (no systemd / no user bus / probe failed) ⇒ the anchor is started exactly
  as before (unenveloped), and the fallback is reported with an independently-valued reading
  `envelope: "none"` + a **named reason** — ⛔ it is never silently shaped like a working envelope
  (硬规则 3b).
- **pid semantics are unchanged**: `systemd-run --scope` execs in place, so the pid you spawn IS the
  anchor pid; `.quay/anchor.pid` / `*-driver.pid` keep meaning what they meant.

### Reading it back (this is the measurement, not the claim)

`<root>/.quay/anchor.json` carries an `envelope` field, rewritten by the anchor every reconcile pass:

```json
"envelope": { "envelope": "scope", "unit": "quay-anchor-<root>-<ts>.scope",
              "memoryMax": "66295676928", "source": "host-derived", "reason": null }
```

`unit` comes from `/proc/self/cgroup` and `memoryMax` from that cgroup's `memory.max` file — **kernel
direct quantities, ⛔ not an echo of the parameter we passed** (硬规则 4b), so plan-vs-kernel disagreement
is visible rather than papered over. `source` is the launcher's declaration
(`host-derived` / `env-override` / `env-unlimited`); it is the one field the kernel cannot answer.

Cross-check + the number to tune the 0.25 with:

```bash
R=<workspace root>; PID=$(cat $R/.quay/anchor.pid); U=$(sed -n 's|^0::.*/||p' /proc/$PID/cgroup)
cat /proc/$PID/cgroup                                  # must end in .scope
systemctl --user show "$U" -p MemoryMax -p MemoryPeak  # MemoryMax must not be `infinity`
python3 -c "import json;print(json.load(open('$R/.quay/anchor.json'))['envelope'])"
```

`MemoryPeak` (from `systemctl --user show`) is the **peak RSS the scope actually reached** — that is the
reading the 0.25 factor should eventually be set from; ⛔ do not set a threshold before measuring it.

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

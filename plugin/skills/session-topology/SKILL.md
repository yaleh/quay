---
name: quay-session-topology
description: "The two-window tmux session topology, defined as a FACTORY (gap-tmux-session-topology-no-factory-definition; corrected to two-window by gap-manager-baked-into-project-topology-factory): <project>-N:outer / :inner — each layer's launch command, who drives whom, what each layer mounts. manager is CROSS-PROJECT, started by the human separately, and is NOT part of a project's topology. Builds the windows mechanically (plugin/scripts/quay-topology.sh) and verifies them (plugin/scripts/topology-check.sh). Use at cold-start and whenever a session must be built by definition, never hand-assembled."
allowed-tools: Bash, Read
---

# quay-session-topology

**The two-window session topology, as a checked-in factory definition.**

Before this skill, the `<project>-N:outer / :inner` layout was convention, not a
defined factory. The human hand-built `meta-cc-3` / `archguard-4` sessions measured to have
**only a single `bash` window and no `claude` process** — each builder guessed a different
structure, so the result was inconsistent and unreproducible. This skill makes the layout a
deliverable: the same two-window structure on any project, built by
`plugin/scripts/quay-topology.sh` and verified by `plugin/scripts/topology-check.sh`.

## The topology (AC1 — the factory definition)

The canonical two-window structure, addressed **by window name** (never pane index — pane
indices drift; window names do not, session-launch-recipes §3). `N` is the Nth tmux session
for the project (0 = first, e.g. `quay-0`, `meta-cc-4`).

| Window | Role | Launched by | Drives | Is driven by | Mounts |
|---|---|---|---|---|---|
| `<project>-N:outer` | loop driver | skill-internal launcher `quay-launch.sh` (`claude-deepseek`/`deepseek-v4-flash`, settings-crystallized) | `inner` via send-keys | — | 20-min cron, re-anchor, outer tick (`orchestrator-loop-tick.md`) |
| `<project>-N:inner` | implementation session | skill-internal launcher `quay-launch.sh` (`claude-deepseek`/`deepseek-v4-flash`, settings-crystallized) | — | `outer` (send-keys drive) | its own work product (`.workflow-events/` telemetry), inner tick (`fast-mode-loop-tick.md`) |

Window order: `outer` (window 0), `inner` (1) — matching the live `quay-0` layout.
`allow-rename` / `automatic-rename` are OFF so program titles cannot rename the windows
back to something unaddressable.

**Who drives whom:** the `outer` drives the `inner` by `send-keys` (reliable send:
`send-keys-reliable.sh`, delivery verified against the target's own transcript — never assumed).
The `inner` is a waiting claude session; it starts fast mode ONLY when the outer drives it.

**manager is CROSS-PROJECT, NOT part of this topology.** The manager session observes all
projects and relays between them; it is started by the human, separately per network/host, and
does NOT come with a project's cold start. It is NOT one of the windows this factory builds or
this check verifies — `quay-topology.sh` builds `outer` + `inner` only, and
`topology-check.sh` verifies those two. (A pre-existing manager-built session is accepted by
the outer without being rebuilt; see gap-outer-self-checks-and-creates-inner-session.)

**Each layer's launch command** is an INTERNAL implementation detail of this skill: it is
generated from the checked-in `.claude/launch.settings.json` (`_launchSpec.roles.*`) and
materialized by the skill-internal launcher `quay-launch.sh` — never a hand-typed shell
one-liner (gap-crystallize-launch-config-into-checked-in-settings-file). The user/agent never
names the launcher; they invoke this skill (or `session-bootstrap.sh` / `quay-topology.sh`),
which launches each role internally. The 917k context / compaction env vars are
deepseek-role-only.

## The factory (AC2 — quay-init lays it down, cold-start builds by definition)

`bash <root>/plugin/scripts/quay-topology.sh [--session <sess>] [--dry-run]` builds the two
windows per the table above. Idempotent: a window with a live claude process is left alone; a
missing window is created; a window with no claude child is re-launched. quay-init `--loop`
lays the factory (and the check below) down into the target project because the cold-start skill
references them (`plugin/scripts/*` references ship automatically — the referenced ⊆ landed
invariant). Cold start therefore builds the session by definition, never by hand.

## The check (AC3 — two-window-in-place verification)

`bash <root>/plugin/scripts/topology-check.sh [--json] [--session <sess>]` verifies each of the
two windows exists AND has a claude process (not a bare bash window). The control:

- **single bash window, no claude** (the `meta-cc-3` / `archguard-4` failure shape) ⇒ the check
  MUST report missing (`MISSING` for each absent topology window);
- **two windows, each with a claude process** ⇒ the check MUST pass.

This is the AC8c `MONITORS-MOUNTED` complement: monitors prove the loop is observed; this check
proves the sessions the loop lives in are actually built to the two-window definition.

## Method — build the two-window session (the launch is skill-internal)

The user/agent never types a launch one-liner and never names `quay-launch.sh` directly; the
skill handles the launch itself. Each layer's launch command is materialized from the checked-in
`.claude/launch.settings.json` (`_launchSpec.roles.*`) by the skill-internal launcher
`quay-launch.sh` — settings-crystallized, never tribal memory (AC2 of
`gap-quay-launch-sh-is-a-user-facing-surface-should-be-skill-internal`: the launcher is this
skill's OWN inner implementation, not a user-facing deliverable).

1. **Resolve root / project / session.** `root = $(pwd)`, `project = basename "$root"`,
   `session =` the `SESSION_TMUX_SESSION=` value in `<root>/orchestration/session-config.env`
   (default `<project>-0:0.0`).
2. **Bare-metal entry.** If no session exists yet, bootstrap it first:
   `bash <root>/plugin/scripts/session-bootstrap.sh <root> inner/outer` — this creates each
   named window and launches each role's Claude Code process through the internal launcher
   `quay-launch.sh` (fail-closed: a window that cannot be confirmed live aborts the bootstrap).
3. **Build by definition** (idempotent — a window with a live claude process is left alone; a
   missing window is created; a window with no claude child is re-launched through the internal
   launcher): `bash <root>/plugin/scripts/quay-topology.sh --session <session>`.
4. **Verify.** `bash <root>/plugin/scripts/topology-check.sh --session <session> --json` must
   report `ok: true` — each of `outer`/`inner` exists AND has a claude process (the
   single-bash-window session is the failure shape this check catches; manager is cross-project
   and NOT verified here).

## Relationship to cold-start (AC4 — together they are "装得上")

`plugin/skills/cold-start/SKILL.md` teaches the **loop start** (mount monitor, re-create the
20-minute cron, drive inner to fast mode, prove a `--task-start` telemetry record). This skill
teaches the **session topology** (the two windows the loop lives in). They are two halves of
the same delivery surface:

1. `/quay:init` installs the mechanism (incl. the topology factory + check);
2. `quay-session-topology` builds the two windows by definition;
3. `/quay:cold-start` starts the loop in them and proves it live.

A cold start that skips the topology (hand-building a single bash window) starts the loop in a
session that the check — and the human — can see is not the shipped topology.

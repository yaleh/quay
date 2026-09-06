---
id: ADR-016
title: "TMUX REMOTE-DRIVE: one session (or the exp5 loop) drives a FOREIGN workspace's
  Claude Code session via tmux send-keys, verifying results from the filesystem/meta-cc —
  not by parsing the TUI"
status: accepted
date: 2026-07-22
tags:
  - process
  - methodology
  - tooling
applies-to:
  - "tasks/DIR-043.md"
  - "plugin/skills/loop-driver/SKILL.md"
  - "experiments/quay-perpetual-stream/OUTER-LOOP.md"
enforcement: "Mechanically gated by plugin/scripts/adr016-screen-use-check.ts (wired into scripts/test.sh's run_static_checks; AC3 of gap-adr-016-carve-out-permits-the-whole-screen-hash-it-was-meant-to-forbid). Permitted screen use is bounded by the ## Amendment 2026-08-04 section: enumerated states (waiting-input / permission-prompt / busy / error-banner / unknown) × bottom region × no whole-screen equality/hash of capture-pane."
---

> **⚠️ RETIRED (2026-09-04):** the tmux mechanism this ADR selected as the cross-workspace drive
> path has since been **retired** — driving/observing another Claude Code session now defaults to
> native `SendMessage`, and the outer/inner tmux session model was **deleted, not migrated**. See
> `orchestration/SPEC-tmux-retirement-2026-09-03.md`. tmux survives **only** in the ADR-016-bounded
> edge uses with no native alternative (control-plane slash commands such as `/clear`, and downstream
> environments without a native channel) plus the test infrastructure (`hermetic-tmux.mjs` /
> `tmux-leak-scan.sh`) and human hand-run sessions. The constraints below remain binding wherever
> tmux is still used.

## Context

A Claude Code session running in workspace A cannot launch a `/loop` (or any interactive command)
in a *different* workspace B directly — the Agent tool spawns subagents within the current session's
context, not a fresh interactive session in another repo. Consequently every cross-workspace proof
in this experiment — DIR-048 (dispatched+audit on archguard), DIR-049 (autonomous ≥2-wide batch on
archguard), DIR-051 (real routine-fire on archguard) — required a **human** to open an archguard
Claude session and type `/loop /quay:loop-driver`, then hand results back. That human round-trip is
the bottleneck for external dogfooding (DIR-043) and for the experiment autonomously validating quay
against a real foreign workspace.

## Decision

Drive a foreign workspace's Claude Code session over **tmux**: inject the kickoff a human would type
with `send-keys`, and read the *result* from the **filesystem / git / meta-cc**, never by parsing the
TUI. The contract (proven 2026-07-22 driving the DIR-051 fire on archguard from the quay session's
own Bash, via a shared tmux server):

1. **Drive with `send-keys`; verify from filesystem/meta-cc — NEVER parse the TUI.** `capture-pane`
   is only a coarse "idle / ready-for-input" check + a settle. Spinners, redraws, and partial lines
   make TUI scraping too fragile to answer "is it done / what happened." The authoritative signals are
   the board (did a task get filed?), `git status` (FILE-only), and meta-cc (the session transcript).
2. **Reliable send = THREE separate `send-keys` calls:** `C-u` (clear line) → `"<message>"` (type) →
   `Enter` (submit). Sending `"<message>" Enter` in ONE call races — the text lands but the `Enter` is
   dropped and the message sits unsubmitted. (Found in practice on the DIR-051 fire.)
3. **Single-driver hygiene (the cross-session analog of ADR-015 / DIR-027 human-steering):** exactly
   ONE operator per foreign session at a time; never `send-keys` while a human is typing there. Before
   assuming a session is busy, distinguish real input from Claude Code's **gray ghost-suggestions**
   (autosuggest text that `Enter` does NOT submit).
4. **Prereqs for a drivable foreign session:** launched with `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1`
   `CLAUDE_CODE_DISABLE_MOUSE=1` (clean `capture-pane`, no alt-screen redraws) + `--permission-mode
   bypassPermissions` (no prompt blocks) + a reachable tmux session (shared server or `tmux -S <socket>`).

The autonomy claim survives: `send-keys` provides the keystroke a human otherwise types; the foreign
Claude still does the work autonomously, and meta-cc attributes the fire to the loop-driver session.
This is legitimate — unlike hand-simulating a routine (which would not count as a real fire).

## Alternatives rejected

- **`claude -p` (headless/print mode):** rejected for three hard constraints (## Amendment
  2026-08-04 (second) below): `Monitor` is unavailable; `CronCreate`/`CronList`/`CronDelete` are
  session-scoped (vanish when the session exits); background processes are killed ~5 s after the
  final result returns AND stdin closes (v2.1.163+). Does not fit a
  *perpetual* loop with background agents + scheduled wakeups. Good for discrete "run once, get
  structured output" tasks, not the persistent interactive loop.
- **Claude Agent SDK:** the "proper" programmatic session control, but a real build effort — overkill
  for injecting a kickoff into an already-running session.
- **manda (nested dispatch):** BANNED for real dispatch (reliability envelope; "routines never
  dispatch manda"). Not a candidate.

## Amendment 2026-08-04 (second) — the `claude -p` rejection reason is corrected; the conclusion stands

The "Alternatives rejected" entry for `claude -p` originally justified rejection as:

> **`claude -p` (headless/print mode):** one-shot — runs a prompt, returns, exits.

**此理由已被 2026-08-04 Amendment 推翻。** Streaming input via `--input-format stream-json` (one user
message per line — `headless.md` / `cli-reference.md`) exists, and the session lives **as long as
stdin stays open** (`headless.md`) — `claude -p` is not a run-and-exit mode. The entry above now
states the real reason — three hard constraints (source:
`orchestration/RESEARCH-claude-p-streaming-2026-08-04.md` §1):

1. **`Monitor` is entirely unavailable** in `-p` mode (`tools-reference.md`).
2. **`CronCreate`/`CronList`/`CronDelete` are session-scoped** — they vanish when the session exits
   (`scheduled-tasks.md`).
3. **Background processes are killed ~5 s after the final result returns AND stdin closes**
   (`headless.md`, since v2.1.163).

The **conclusion of the entry is unchanged and preserved verbatim** — this Amendment corrects the
reason, not the verdict.

**An alternative shape exists (RESEARCH §2/§6):** a long-lived **driver process** holding stdin *is*
a persistent session — the driver itself is the scheduler (writes to stdin on schedule, so
`CronCreate` is not needed) and the observer (watches liveness/events itself, so `Monitor` is not
needed). Scheduling and observation move out of session-internal state ("this session remembers the
cron it created") into a deliverable, checkable, testable script. Whether `-p` streaming can carry
the two-layer loop still depends on two unmeasured unknowns (RESEARCH §3): third-party endpoint
roundtrip in `-p` mode, and exit semantics while stdin stays open — tracked by
`tasks/gap-measure-claude-p-headless-third-party-roundtrip-and-exit-semantics.md`.

## Consequences

- External dogfooding (DIR-043) has a concrete vehicle; the "human runs `/loop`" round-trip becomes
  optional. exp5 (or an operator session) can drive archguard's loop and read results back.
- The single-driver rule must be respected or two operators race a foreign board (same failure class
  ADR-015/DIR-027 address for `master`).
- Result-reading stays filesystem/meta-cc-based, so the drive loop is robust to TUI changes.
- Proven, not theoretical: it drove the DIR-051 real routine-fire (`send-keys` re-fire → archguard
  self-validation fired → filed `PROBE-NEW.md` → verified from board + meta-cc).

## Amendment 2026-08-04 — pinned boundaries for the capture-pane carve-out (ruling A)

Clause 1 said `capture-pane` is only a coarse "idle / ready-for-input" check + a settle, but did
not bound what "coarse" permits. Two live implementations — `session-liveness.sh` and
`send-keys-verified.sh` — each read it as whole-screen equality / md5 of the pane, the exact
judgment this ADR's title forbids, without violating the letter. The decision is unchanged; the
boundaries are now fixed:

1. **Allowed states are ENUMERATED, not an open set.** A screen observer may classify the pane into
   exactly five states — `waiting-input`, `permission-prompt`, `busy`, `error-banner`, `unknown` —
   and no others. Any other reading of the screen is outside the carve-out.
2. **The permitted region is the BOTTOM region** (the input box + status line) — the part a human
   actually watches — not the whole screen.
3. **Whole-screen equality/hash comparison is FORBIDDEN**, with or without prior masking. The
   `md5(capture-pane)` family — any `capture-pane` result flowing into `md5sum` / `sha1sum` /
   `cksum` — is a violation of this ADR regardless of `mask_pane`-style pre-processing. The
   mechanical checker `plugin/scripts/adr016-screen-use-check.ts` (wired into `scripts/test.sh`'s
   `run_static_checks`) detects this by code position in shell scripts, and exits non-zero when an
   ACTIVE file exceeds the tolerated legacy count of one (`session-liveness.sh`, carried by the
   sibling task `gap-pane-state-is-hashed-not-classified-so-needs-input-is-unobservable`).
   `send-keys-verified.sh` is excluded as retired (its task was superseded under outer ruling F,
   2026-08-04).

The carve-out's spirit is unchanged: `capture-pane` may be used as a coarse state signal, but the
signal must be a **shape classification of the bottom region** — never a whole-screen equality test.

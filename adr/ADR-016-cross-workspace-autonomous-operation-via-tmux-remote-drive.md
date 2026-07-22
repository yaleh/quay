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
enforcement: "N/A — an operational discipline (a reliable-send + poll-for-result contract), not a mechanically-gated invariant. Proven end-to-end driving the DIR-051 real routine-fire on archguard (2026-07-22); the pinned 3-step send + poll-filesystem pattern is the canonical procedure any consumer references."
---
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

- **`claude -p` (headless/print mode):** one-shot — runs a prompt, returns, exits. Does not fit a
  *perpetual* loop with background agents + scheduled wakeups. Good for discrete "run once, get
  structured output" tasks, not the persistent interactive loop.
- **Claude Agent SDK:** the "proper" programmatic session control, but a real build effort — overkill
  for injecting a kickoff into an already-running session.
- **manda (nested dispatch):** BANNED for real dispatch (reliability envelope; "routines never
  dispatch manda"). Not a candidate.

## Consequences

- External dogfooding (DIR-043) has a concrete vehicle; the "human runs `/loop`" round-trip becomes
  optional. exp5 (or an operator session) can drive archguard's loop and read results back.
- The single-driver rule must be respected or two operators race a foreign board (same failure class
  ADR-015/DIR-027 address for `master`).
- Result-reading stays filesystem/meta-cc-based, so the drive loop is robust to TUI changes.
- Proven, not theoretical: it drove the DIR-051 real routine-fire (`send-keys` re-fire → archguard
  self-validation fired → filed `PROBE-NEW.md` → verified from board + meta-cc).

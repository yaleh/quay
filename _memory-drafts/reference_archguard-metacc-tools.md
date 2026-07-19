---
name: reference-archguard-metacc-tools
description: archguard (static architecture analysis, the L_D/L_G instrument) and meta-cc (session-history search) are the repo owner's OWN tools — fixable fast, so use aggressively and report bugs
metadata:
  node_type: memory
  type: reference
---

Two MCP toolsets available in the quay workspace, BOTH maintained by the repo owner (calvino.huang@gmail.com) — bugs can be fixed fast, so use them aggressively and report/fix issues rather than working around them:

- **archguard** — static architecture analysis. The `L_D`/`L_G` instrument per ADR-007: dependency structure/cycles, god-packages, fan-in/out, package metrics, duplicated/reinvented abstractions, change-risk/co-change, coverage. Consult before calling a milestone done to light up the dark axes (description length `L_D`, generative-alignment `L_G`).
- **meta-cc** — search Claude Code session history: past errors, edit sequences, work patterns, tech debt, timelines, session content/signals.

**Why:** the GIT lens ([[reference-git-lens]]) says most of quay's loss axes are dark; archguard is the cheap executable proxy that lights `L_D`/`L_G`. Because the owner maintains both, encountering a bug is an opportunity to fix the instrument, not a reason to fall back to prose review.

**How to apply:** reach for archguard when judging a milestone's structure (ADR-007) and meta-cc when reconstructing what happened in prior sessions; if a tool misbehaves, report the exact call + failure so the owner can patch it.

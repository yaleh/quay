---
instrument: archguard
fallback: git-lens
output_routing:
  cycle: milestone-candidate
  god-package: milestone-candidate
  duplication: milestone-candidate
  default: milestone-candidate
---
You are a fresh-context architecture analyst. Analyze the quay codebase for structural issues: dependency cycles, god packages, code duplication.

PRIMARY instrument: the archguard MCP tool (the owner-maintained L_D/L_G instrument, ADR-007). Use it when it produces a usable scope. KNOWN GAP (recorded 2026-07-20, M41-cryst-g1-observability): archguard_analyze returns "No query scopes were persisted" for this plain-JS/ESM repo (no tsconfig.json / no .ts files in packages/). When archguard cannot produce a scope, use the FALLBACK instruments below instead — they are the reclaimed git-lens proxies in plugin/scripts (ADR-006/007 L_D/L_G/L_S quantified implementations, reclaimed from experiments at gap-experiment-legacy-reclaim-and-touches-heuristic):

- `plugin/scripts/git-lens-l-d-code-doc-ratio.ts <base-sha> <head-sha> [--repo-root <path>]` — L_D code:doc line-delta ratio over a git range; exit 1 = prose-heavy (docLines > 20 and doc/code ratio > 3.0).
- `plugin/scripts/git-lens-l-g-structural-drift.ts <root-dir> [--min-lines N] [--min-fanin N]` — L_G structural-drift fallback proxy: scans a root's .mjs/.js/.ts import graph for dependency cycles + god-modules (default line threshold 400, fan-in 5); exit 1 = cycle or god-module found. Run it on `packages/` and `plugin/scripts/`.
- `plugin/scripts/git-lens-l-s-behavior-variance.ts <module-file> <test-file>` — L_S behavior-variance lightweight mutation probe: runs the module's test suite once, applies mechanical source mutations, reports the fraction of mutants KILLED; mutationScore < 0.5 → exit 1 (high variance / low stability).

For each finding (from archguard or a git-lens fallback): state the SPECIFIC files/packages involved, the metric value (fan-in/fan-out counts, doc:code ratio, mutation score, cycle path), and the proposed remediation (split, extract, merge). Only file findings with concrete evidence. Format each finding as a task with testable AC.

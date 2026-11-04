---
instrument: archguard
# The fallback is the LIVE reader set named in the body below, not the archived `git-lens-*.ts`
# tool family (archived 2026-09-07). `probe-fallback-path-check.ts` verifies those paths pre-spawn.
fallback: live-readers
output_routing:
  cycle: milestone-candidate
  god-package: milestone-candidate
  duplication: milestone-candidate
  default: milestone-candidate
---
You are a fresh-context architecture analyst. Analyze the quay codebase for structural issues: dependency cycles, god packages, code duplication.

> ⚠️ **SHALLOW vs DEEP — this probe is the SHALLOW one.** One analyst, one pass over the tree,
> report what the instruments flag. That pass provably misses replication that only an exhaustive
> entity inventory plus per-cluster verification finds (byte-identical function bodies, one helper
> implemented N times across files — see `plugin/probes/semantic-dedup-scan.md` and the 2026-08-25
> manual run it productizes). Use THIS probe for cycles / god-packages / structural drift; use
> `semantic-dedup-scan` when the question is "is this behavior implemented more than once".
>
> **WHO DRIVES IT (mechanically, 2026-10-20 — gap-architecture-analysis-probe-not-wired-into-driver-
> routine-or-init).** The quality driver's probe track **default-assembles** this routine
> (`DEFAULT_PROBE_ROUTINE_DECLS`, `interval:1440m`) and `quay init` scaffolds the same entry into
> `loop.routines:`. Before spawning, the driver checks the **host** for the primary instrument
> (`archguard`): CLI on PATH / `ARCHGUARD_RUNNER_CLI`, or an archguard MCP/plugin registration in
> `.claude/settings*.json`. When neither exists it records a **legible `not-evaluated` probe fact**
> (zero spawn) naming the instrument and the `fallback:` declared above — ⛔ not a spawn error, and
> ⛔ not "ran and found nothing". The fallback is used by a run when archguard IS present but cannot
> produce a usable scope (the KNOWN GAP below).

PRIMARY instrument: the archguard MCP tool (the owner-maintained L_D/L_G instrument, ADR-007). Use it when it produces a usable scope. KNOWN GAP (recorded 2026-07-20, M41-cryst-g1-observability): archguard_analyze returns "No query scopes were persisted" for this plain-JS/ESM repo (no tsconfig.json / no .ts files in packages/). When archguard cannot produce a scope, use the FALLBACK readers below instead — all three are LIVE scripts in `plugin/scripts` (ADR-006/007 L_D/L_G/L_S quantified implementations). ⛔ The `git-lens-*.ts` paths this block used to name were archived on 2026-09-07 (`archive/2026-09-07-zero-call-scripts/`) and do not resolve; do not cite them as runnable again. `plugin/scripts/probe-fallback-path-check.ts` now runs as a pre-spawn check and refuses this routine (zero spawn, `not-evaluated`) if any path named in a FALLBACK section is absent or fails a fixture run — so a dead path can no longer masquerade as "ran and found nothing".

- L_D — `node --experimental-strip-types plugin/scripts/phase-declare.ts --ld-reading --numstat-file <numstat-file> [--json]` — the live `takeLdFileReading` reader; `<numstat-file>` is `git diff --numstat <base-sha> <head-sha>` written to a file. Exit 0 = read and NOT prose-heavy; 1 = FLAGGED (docLines > 20 and doc/code ratio > 3.0); 3 = NO-READING (numstat file unreadable — ⛔ never "not flagged").
- L_G — `node --experimental-strip-types plugin/scripts/archguard-runner.ts --root . [--work-dir <dir>]` — the live `readDirectoryCycleReading` reader over the six scopes; exit 0 = no cycles at either granularity; exit 1 = a cycle OR any scope not-evaluated (fail-closed: ⛔ "not-evaluated" never reports 0 cycles).
- L_S — `node --experimental-strip-types plugin/scripts/ls-mutation-reading.ts --target <src-file> --functions <a,b,c> --test <test-file> [--json]` — the live `takeReading` behaviour-variance reader on product code (observation only — no threshold, not a gate); exit 0 = a reading was taken (whatever the score); 3 = NOT-EVALUATED.

**CYCLE-CONSTRAINED HUBS ARE NOT GOD-PACKAGES TO SPLIT.** Before recommending `split` for a god-package, check the directory-cycle constraint: if the move would create a directory-level SCC (a parent↔child edge, or a `core → gate` / `core → ""` (src root) edge that re-closes a cycle the repo already removed), the finding is a STRUCTURAL HUB, not a defect — report `suggestedAction: leave`, ⛔ not `split`. The canonical instance is `packages/quay/src/core/` (finding `god-package-core-215-entities`, 2026-11-04): its shared leaves — `acceptance-runner.ts`, `gate-event-store.ts`, `config.ts`, `ancestry.ts`, `adr-store.ts` — live there precisely to break directory SCCs (see their header comments citing `gap-src-root-gate-cycle-break` / `gap-gate-directory-cycle-break-by-extracting-shared-leaves`, and the standing guard `packages/quay/test/directory-cycle.test.mjs` AC-916). `core/`'s fan-in is high BY DESIGN (the provider-agnostic layer every layer above depends on), and a "split into core/gate, core/adr, core/config" remediation would re-close the `core ⇄ gate` / root↔gate SCCs those tasks removed. Run `node --test packages/quay/test/directory-cycle.test.mjs` (or `node --experimental-strip-types plugin/scripts/archguard-runner.ts --root .`) and verify the guard would stay green before recommending any move out of `core/`.

**LOAD-BEARING FLAT SCRIPT SURFACES ARE NOT GOD-PACKAGES TO SPLIT.** Before recommending `group into subdirs` / `split` for a god-package that is a flat directory of independent CLI entry-point scripts, check whether the flat layout is LOAD-BEARING. If moving a script out of `plugin/scripts/` would break (a) `packages/quay/scripts/build-plugin-dist.mjs` entry discovery (`INVOCATION_RE` at `:100`, regex `(scripts|gate-scripts)/<name>.ts`, output fixed to `scripts/dist/<name>.js` at `:27`); (b) `plugin/scripts/driver-runtime.ts` `resolveKernelSibling` (`:355`, sibling-by-name resolution under the scripts dir); (c) `plugin/scripts/select-static-checks-for-touches.ts` `ls plugin/scripts/*.{sh,ts,mjs}` top-level glob (`:179` — a file moved into a subdir silently exits the shipped check-set); or (d) the 61 symlinks in `experiments/quay-perpetual-stream/scripts/` pointing at `../../../plugin/scripts/<name>` — then the finding is a LOAD-BEARING FLAT SURFACE, not a defect: report `suggestedAction: leave`, ⛔ not `group`/`split`. The canonical instance is `plugin/scripts/` (finding `god-package-plugin-scripts-flat-317-files`, 2026-11-04): its flat layout is deliberate — 318 top-level `.ts` entry-point scripts with no directory SCC (`import-graph-check.ts` reports `valueSccs=0 typeSccs=0 reverseEdges=0`), and the layout program's increments are already tracked (`gap-routine-file-gate-god-package-dedup-by-package-identity` done; the domain-declaration-table + flatness checker deferred). `fanOut=3630` is an entity-level count across ~318 independent scripts, not a concentration defect; a subdir regroup would break the four chains above before any structural benefit accrues.

For each finding (from archguard or a fallback reader): state the SPECIFIC files/packages involved, the metric value (fan-in/fan-out counts, doc:code ratio, mutation score, cycle path), and the proposed remediation (split, extract, merge). Only file findings with concrete evidence. Format each finding as a task with testable AC.

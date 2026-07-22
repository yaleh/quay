# Charter M92-dir056-probe-spec-wiring — DIR-056 probe-spec SKILL wiring (exp5-DEFECT-DIR056-PROBE-SPEC-UNWIRED)

**Milestone id:** M92  
**Task:** `tasks/exp5-DEFECT-DIR056-PROBE-SPEC-UNWIRED.md` (milestone-candidate, defect)  
**Surface:** `plugin/skills/loop-driver/SKILL.md` + `plugin/probes/*.md` + `.quay/loop.yml` routine configs  
**Type:** development-class / defect (capability-growth)  
**Charter authored:** 2026-07-22  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

DIR-056 ("probe-spec formalization — DIR-051 v2") was marked done at M86. Its stated deliverable:
replace `dispatch: <string>` with `probe: <name>` resolving to `${CLAUDE_PLUGIN_ROOT}/probes/<name>.md`,
with `readProbeSpec` (instrument check + fallback + `output_routing`).

The three probe spec FILES landed at M86:
- `plugin/probes/self-validation.md` (`instrument: none`)
- `plugin/probes/architecture-analysis.md` (`instrument: archguard`)
- `plugin/probes/history-mining.md` (`instrument: meta-cc`)

But the loop-driver SKILL was never updated to CONSUME them. Reproducible evidence:
```
grep -cE "probe:|readProbeSpec|output_routing|instrument:" plugin/skills/loop-driver/SKILL.md → 0
```
The SKILL's Routines section still instructs "perform its `dispatch` action" (DIR-051 form, verbatim).
The three probe specs are **INERT** — zero execution path reads them.

Blast radius:
- DIR-055 (meta-cc mining routine) REQUIRES `output_routing` (defect/adr/pattern → different labels) — blocked.
- DIR-052/053 (migrate self-validation / archguard routines to `probe:` form) — blocked, dispatch strings still sole path.

## Scope

**In scope:**
1. Wire `routines[].probe: <name>` in loop-driver SKILL.md: resolves `${CLAUDE_PLUGIN_ROOT}/probes/<name>.md`; `readProbeSpec` loader (fail-closed on malformed); instrument availability check → SKIP + log if absent (no fallback); dispatch fresh-context agent with spec objective; file findings via `routine-file-gate.mjs` with label from `output_routing[finding.type]`.
2. Keep `dispatch: <string>` back-compat path functional (DIR-052/053 configs keep working).
3. Make probe objectives workspace-relative (current `self-validation.md` hardcodes "the quay codebase" — must probe the CONSUMER workspace, not quay).
4. Migrate DIR-052 (self-validation) and DIR-053 (archguard) routine configs to `probe:` form additively.
5. Re-vendor plugin and bump plugin version.
6. TDD per ADR-001: tests for `readProbeSpec` loader, `probe:` resolution, `output_routing` routing, `dispatch:` back-compat, instrument-absent soft-degrade.
7. Prove REAL routine fire through a probe spec: a routine fires through the spec (not dispatch string) and files a correctly-routed task; pasted into execution record (DIR-026 real object).

**Out of scope:**
- DIR-055 implementation (this milestone only unblocks it; DIR-055 is a separate SELECT).
- New probe specs beyond migrating DIR-052/053.
- Archguard infrastructure changes.

## Class routing

**Development-class** — SKILL.md code edit + tests + vendor sync. MUST go through `quay-task-to-plan` pipeline (N independent blank-slate proposals → adjudication → reconciled proposal → milestone-level plan) BEFORE dispatch to `baime:iteration-executor`. Per OUTER-LOOP.md step 5a.

## Acceptance Criteria

- [ ] The loop-driver SKILL resolves `routines[].probe: <name>` → `${CLAUDE_PLUGIN_ROOT}/probes/<name>.md`, runs `readProbeSpec` (fail-closed on malformed), and files findings with the label from `output_routing[type]` — `grep` shows `probe:`/`readProbeSpec`/`output_routing` present (currently 0).
- [ ] `instrument`-absent degrades soft (SKIP + log), never fail-closing the loop; a legacy `dispatch: <string>` routine still works (back-compat test).
- [ ] Probe objectives are workspace-relative (a consumer workspace probes its OWN build, not the hardcoded "quay codebase"); DIR-052/053 configs migrated to `probe:` additively.
- [ ] A REAL routine fires THROUGH a probe spec (dispatch driven by the spec, not the dispatch string) and files a correctly-routed task — pasted, not a fixture.

## Definition of Done

References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [ ] The deployed skill consumes probe specs (probe: + readProbeSpec + output_routing), `dispatch:` back-compat proven, instrument-absent soft-degrade proven; plugin re-vendored + bumped; TDD per ADR-001; it0 DoD meta-enforcer passes.
- [ ] A real probe-form routine fire filed a correctly-routed task on a real workspace (DIR-026 real object); fresh-context adversarial audit confirms adding a probe needs no skill edit (a spec file + loop.yml line).
- [ ] Per DIR-026 SPLIT-OR-COMMIT: the wiring, the workspace-relative objective fix, and the real probe-form fire each land done-or-`needs-human`.

## GATE-HASH-REF

`33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb`  
(SHA-256 of `experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs` at charter time — the iteration-0 agent MUST verify this matches before running gates)

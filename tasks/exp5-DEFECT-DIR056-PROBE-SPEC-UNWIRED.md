---
id: exp5-DEFECT-DIR056-PROBE-SPEC-UNWIRED
title: "defect: DIR-056 probe-spec form is UNWIRED — probe spec files ship but
  the loop-driver SKILL never consumes them (still dispatch-only); DIR-056
  marked done (M86) with its core deliverable absent"
status: done
labels:
  - milestone-candidate
  - defect
  - milestone:M-92
parent: null
children: []
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-DEFECT-DIR056-PROBE-SPEC-UNWIRED
    experiments/quay-perpetual-stream/charters/M92-dir056-probe-spec-wiring.md
    /tmp/m92-absorb-entry.md
---
## Finding
[[DIR-056]] ("probe-spec formalization — DIR-051 v2") is marked **done (M86)**, and its Proposal/DoD
promise to "**replace `dispatch: <string>` with `probe: <name>` resolving to
`${CLAUDE_PLUGIN_ROOT}/probes/<name>.md`**" with `readProbeSpec` (instrument check + fallback +
`output_routing`). The probe spec FILES were created and ship —
`plugin/probes/{self-validation,architecture-analysis,history-mining}.md` — BUT the loop-driver skill
that must CONSUME them was never wired.

**Evidence (reproducible):**
- `grep -cE "probe:|readProbeSpec|output_routing|instrument:" plugin/skills/loop-driver/SKILL.md` → **0** (before M92).
- The SKILL's Routines section still reads `routines: [{name,trigger,dispatch}] (DIR-051)` and instructs
  "perform its **`dispatch`** action" — the pre-DIR-056 dispatch-string form, verbatim.
- Consequence: the three shipped probe specs are **INERT** — nothing resolves `probe:`, no
  `readProbeSpec`, no instrument-availability skip, no `output_routing` label routing. A routine can ONLY
  fire via the legacy `dispatch: <string>` back-compat path (which the SKILL does handle).

So DIR-056's headline capability — the loose-coupling that lets a new probe be "a spec file + a loop.yml
line, zero skill change" — **does not exist in the deployed skill**; only the spec files (data) landed,
not the mechanism (SKILL wiring). DIR-056 was ticked done against artifacts, not the real capability
(the same "artifact ≠ landing" failure class as the DIR-054 dashboard-gate that was green-but-nonfunctional).

**Blast radius:** [[DIR-055]] (meta-cc mining) REQUIRES `output_routing` (defect/adr/pattern → different
labels) — inexpressible without this wiring, so DIR-055 can't be built on the probe-spec form as designed.
[[DIR-052]]/[[DIR-053]] "migrate to probe specs" is also unlanded.

## Proposal
(omitted — see task history)

## Plan
N/A — an in-repo portable-skill milestone; proposal-to-plan settles the `readProbeSpec` loader + SKILL
`probe:` wiring + `output_routing` label routing + `dispatch:` back-compat, vendored + plugin-bumped. TDD
per ADR-001; fresh-context adversarial audit per DIR-044/048; single-sources DIR-051's scheduler/gate.
Reopens the DIR-056 gap rather than re-marking it — DIR-056 stays done-with-a-known-gap this task closes.

## Acceptance Criteria
- [x] The loop-driver SKILL resolves `routines[].probe: <name>` → `${CLAUDE_PLUGIN_ROOT}/probes/<name>.md`, runs `readProbeSpec` (fail-closed on malformed), and files findings with the label from `output_routing[type]` — `grep` shows `probe:`/`readProbeSpec`/`output_routing` present (previously 0).
- [x] `instrument`-absent degrades soft (SKIP + log), never fail-closing the loop; a legacy `dispatch: <string>` routine still works (back-compat test).
- [x] Probe objectives are workspace-relative (a consumer workspace probes its OWN build, not the hardcoded "quay codebase"); DIR-052/053 configs migrated to `probe:` additively.
- [x] A REAL routine fires THROUGH a probe spec (dispatch driven by the spec, not the dispatch string) and files a correctly-routed task — pasted, not a fixture.

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [x] The deployed skill consumes probe specs (probe: + readProbeSpec + output_routing), `dispatch:` back-compat proven, instrument-absent soft-degrade proven; plugin re-vendored + bumped; TDD per ADR-001; it0 DoD meta-enforcer passes.
- [x] A real probe-form routine fire filed a correctly-routed task on a real workspace (DIR-026 real object); fresh-context adversarial audit confirms adding a probe needs no skill edit (a spec file + loop.yml line).
- [x] Per DIR-026 SPLIT-OR-COMMIT: the wiring, the workspace-relative objective fix, and the real probe-form fire each land done-or-`needs-human`.

## Execution record

**Milestone:** M92
**Iteration:** iteration-0
**Realized Δv:** 0 (v̂=0 — development-class SKILL wiring, no product VT cell)
**Merge SHA:** 73fbd44
**Outcome:** done — SKILL.md Routines section wired (probe: + readProbeSpec + output_routing + back-compat); 8 new tests; byte-identity assertion; version bump 0.3.17; real probe-spec routine fire evidence chain pasted.

**Real-fire evidence:**
1. Scheduler stdout: `DUE: self-validation (on(checkpoint)) → probe self-validation`
   Command: `node plugin/scripts/routine-scheduler.mjs --event checkpoint --plugin-root <plugin-root> /tmp/routines-m92.json`
   Routines JSON: `[{"name":"self-validation","trigger":"on(checkpoint)","probe":"self-validation"}]`
2. readProbeSpec output: `instrument: "none"`, `fallback: "none"`, `output_routing: {"default":"milestone-candidate","defect":"milestone-candidate","gap":"milestone-candidate"}`, objective: 665 chars
3. Agent dispatched with `WORKSPACE: /home/yale/work/quay\n<spec.objective>`; explored `packages/quay/src/gate/registry.ts` line 482 — acceptance gate always uses `process.cwd()`, ignores `--cwd`/workspaceRoot (DIR-046 contract violation)
4. Candidate task filed: `tasks/PROBE-SV-M92-001.md` — `## Finding` section present, label: `milestone-candidate` (from `output_routing.default`)
5. `routine-file-gate.mjs --board tasks --recent 0 --k 3 /tmp/PROBE-SV-M92-001-candidate.md` → `ACCEPT: accepted: actionable, novel, within rate` (exit 0)
6. `git -C /home/yale/work/quay status --porcelain` → `?? milestones/M92/` and `?? tasks/PROBE-SV-M92-001.md` only — no product/method code changes (FILE-ONLY confirmed)
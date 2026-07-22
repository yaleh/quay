---
id: exp5-DEFECT-DIR056-PROBE-SPEC-UNWIRED
title: "defect: DIR-056 probe-spec form is UNWIRED — probe spec files ship but the
  loop-driver SKILL never consumes them (still dispatch-only); DIR-056 marked done
  (M86) with its core deliverable absent"
status: todo
labels:
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
## Finding
[[DIR-056]] ("probe-spec formalization — DIR-051 v2") is marked **done (M86)**, and its Proposal/DoD
promise to "**replace `dispatch: <string>` with `probe: <name>` resolving to
`${CLAUDE_PLUGIN_ROOT}/probes/<name>.md`**" with `readProbeSpec` (instrument check + fallback +
`output_routing`). The probe spec FILES were created and ship —
`plugin/probes/{self-validation,architecture-analysis,history-mining}.md` — BUT the loop-driver skill
that must CONSUME them was never wired.

**Evidence (reproducible):**
- `grep -cE "probe:|readProbeSpec|output_routing|instrument:" plugin/skills/loop-driver/SKILL.md` → **0**.
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
Wire the loop-driver SKILL to actually CONSUME probe specs (deliver DIR-056's unlanded core), keeping the
`dispatch:` back-compat path intact:
- `routines[].probe: <name>` resolves `${CLAUDE_PLUGIN_ROOT}/probes/<name>.md` (workspace override allowed);
- `readProbeSpec` loads it (fail-closed on malformed): `instrument` availability check → SKIP + log if
  absent (no fallback); dispatch a fresh-context agent with the spec's objective; file findings behind
  `routine-file-gate.mjs` with the label from `output_routing[finding.type]`;
- legacy `dispatch: <string>` still accepted (inline `instrument:none`, single label) — DIR-052/053/
  archguard configs keep working;
- migrate DIR-052/053 routine configs to `probe:` specs (additive).
Note the shipped `self-validation.md` charge is quay-specific ("the quay codebase") — make probe objectives
workspace-relative (or parameterized) so a consumer workspace (archguard) probes ITS OWN build, not quay's.

## Plan
N/A — an in-repo portable-skill milestone; proposal-to-plan settles the `readProbeSpec` loader + SKILL
`probe:` wiring + `output_routing` label routing + `dispatch:` back-compat, vendored + plugin-bumped. TDD
per ADR-001; fresh-context adversarial audit per DIR-044/048; single-sources DIR-051's scheduler/gate.
Reopens the DIR-056 gap rather than re-marking it — DIR-056 stays done-with-a-known-gap this task closes.

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

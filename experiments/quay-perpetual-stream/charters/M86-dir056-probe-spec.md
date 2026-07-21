# Charter M86-dir056-probe-spec — probe-spec formalization (DIR-056)

**Milestone id:** M86  
**Task:** `tasks/DIR-056.md` (milestone-candidate, directive)  
**Surface:** plugin routine track (routine-scheduler + routine-file-gate + loop-params + new probe specs)  
**Type:** capability-growth (routine-track loose-coupling) + governance-integrity  
**Charter authored:** 2026-07-21  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

DIR-051 gave the loop a standing ROUTINE track (`routines: [{name, trigger, dispatch}]`). The `dispatch:`
field is a magic string whose semantics live in the skill — what prompt to run, which instrument it needs,
what output label to file behind. This is half loosely-coupled: adding a new routine type still requires
a skill edit.

DIR-056 formalizes the missing half: a portable **probe spec** file (lives in `${CLAUDE_PLUGIN_ROOT}/probes/`)
that declares the routine's WHAT (objective/prompt body) and HOW-to-route (instrument availability check +
output_routing by finding type). The routine scheduler (HOW) stays generic; `loop.yml` declares WHEN and
WHICH; the spec carries the rest. Adding a new probe = dropping a `.md` file + a loop.yml line, zero skill
edits.

**Current state:**
- `experiments/quay-perpetual-stream/scripts/routine-scheduler.mjs` (75L) — interprets `dispatch:` string
- `experiments/quay-perpetual-stream/scripts/routine-file-gate.mjs` (87L) — single label from dispatch string
- `packages/quay/src/loop-params.ts` (169L) — `routines[].dispatch` schema
- `.quay/loop.yml` routines: `dispatch: adversarial-explore` and `dispatch: arch-analyze`
- `plugin/scripts/` — vendored copies of the above

**Deliverables:**
1. Probe spec format + `readProbeSpec(name)` loader (fail-closed on malformed; instrument-availability check)
2. `routines[].probe` key accepted by `readLoopParams` (additive; `dispatch` still accepted for back-compat)
3. Skill wiring: due routine → readProbeSpec → instrument-availability check (SKIP+log if absent) → dispatch with spec objective → file behind gate with `output_routing[finding.type]` label
4. Three probe specs shipped with plugin: `probes/self-validation.md`, `probes/architecture-analysis.md`, `probes/history-mining.md`
5. `.quay/loop.yml` routines migrated from `dispatch:` to `probe:` additively
6. Vendor sync: `plugin/scripts/routine-scheduler.mjs` + `plugin/scripts/routine-file-gate.mjs` updated
7. TDD: RED→GREEN for probe spec loader, instrument-availability, output_routing, back-compat
8. Fresh-context adversarial audit confirms: adding a 4th probe requires NO skill change

## Scope

**In scope:**
- `experiments/quay-perpetual-stream/scripts/routine-scheduler.mjs` — add probe spec resolution, instrument-availability skip, output_routing
- `experiments/quay-perpetual-stream/scripts/routine-file-gate.mjs` — accept `output_routing`-derived label from scheduler
- `packages/quay/src/loop-params.ts` — add `probe?:` field to RoutineEntry schema (additive; `dispatch?:` kept)
- New: `experiments/quay-perpetual-stream/scripts/read-probe-spec.mjs` (or inline in scheduler) — probe spec loader
- New: `plugin/probes/self-validation.md`, `plugin/probes/architecture-analysis.md`, `plugin/probes/history-mining.md`
- `experiments/quay-perpetual-stream/.quay/loop.yml` — migrate `dispatch:` to `probe:` (additive)
- `plugin/scripts/routine-scheduler.mjs` + `plugin/scripts/routine-file-gate.mjs` — vendor sync
- Tests: probe spec loader + updated scheduler/gate tests (new paths); back-compat tests (legacy `dispatch:`)
- Plugin bump (if version tracked)

**Out of scope:**
- `dispatch:` magic-string REMOVAL (backward-compat; legacy entries keep working)
- Implementing the actual probes' logic (that's the skill's job from the spec)
- DIR-052/053/055 as separate milestones — the probe SPECS ship here, but the routines themselves fire via the existing scheduler

**Behavior-preserving constraints for existing path:**
- A routine with `dispatch: adversarial-explore` must still work exactly as before (back-compat path)
- `readLoopParams` with a legacy loop.yml (no `probe:`) must still parse cleanly (no error)

## Pre-dispatch it0 checks

**(a) ceiling/floor arithmetic:** ~500L existing + ~300L new probe specs + ~100L loader + ~200L tests = ~1100L. Well under 2000L ceiling.

**(b) gate-hash (by-reference):**  
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

**(c) dogfooding evidence gate:** N/A at charter time.

**(d) domain-misfit audit-channel:** N/A — deliverables are `.mjs`/`.ts`/`.md` source files.

**(e) plan-time line-budget gate:** ~1100L in scope. Well under 2000L ceiling. Single-pass feasible.

**Sizing:** Bounded. routine-scheduler + routine-file-gate are small (75+87L); loop-params is 169L. New probe spec files are prose. Should land clean in iteration-0.

## Class routing

**Development-class** (deliverable = implementation files + probe specs). Direct to implementation.

## Value hypothesis

- **Y:** Probe specs exist; adding a new probe requires NO skill change (zero-edit proof); instrument-absent degrades soft; output_routing labels findings correctly; back-compat proven; DIR-052/053/055 migrated to probe specs
- **Δv̂ = 0** (method-infra / governance-integrity, no VT chart-1 cell)
- **Value type:** capability-growth (routine-track loose-coupling) + governance-integrity

## Done-when (binary)

1. `readProbeSpec(name)` exists and is fail-closed on a malformed spec; resolves `${CLAUDE_PLUGIN_ROOT}/probes/<name>.md`. Paste: `node -e "const {readProbeSpec} = await import('./...'); console.log(await readProbeSpec('self-validation'))"` (exit 0, probe fields printed).
2. `routines[].probe` accepted by `readLoopParams` additively; legacy `dispatch:` still parses. Paste: test output showing back-compat + new probe path both pass.
3. A routine with a `probe:` entry fires through the spec: skill reads probe → instrument check (skip if absent) → dispatches with spec objective → files with `output_routing`-derived label. Paste: scheduler selfcheck or test output showing the probe-driven path.
4. Three probe specs exist in `plugin/probes/`: `self-validation.md`, `architecture-analysis.md`, `history-mining.md`. Each declares `instrument`, `fallback`, `output_routing`, and an objective body. Paste: `ls plugin/probes/` + `head -10 plugin/probes/self-validation.md`.
5. `.quay/loop.yml` routines migrated from `dispatch:` to `probe:` (or additive; legacy still works). Paste: `cat experiments/quay-perpetual-stream/.quay/loop.yml`.
6. Vendor sync: `plugin/scripts/routine-scheduler.mjs` + `plugin/scripts/routine-file-gate.mjs` match source. Paste: `diff experiments/.../routine-scheduler.mjs plugin/scripts/routine-scheduler.mjs` (empty diff or annotated).
7. Test suite baseline maintained (quay + quay-native ≤ 11 failures). Paste `ℹ tests / ℹ pass / ℹ fail`.

## Inner termination (§3.2)

1. All 7 Done-when confirmed.
2. ΔV < 0.02 both layers, K=2 consecutive.
3. Ceiling exceeded → `needs-human`.
4. Past budget ~10 iterations.
5. External HALT.
6. Probe spec format design irresolvable → `needs-human`.

## HARD GATES (by-reference):

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

The manda healthz gate and port-4173 reachability gate are **N/A** this milestone (no Web UI surface touched). State N/A explicitly.

## Per-milestone acceptance audit (UNCONDITIONAL)

Specific charge:
1. Verify `readProbeSpec(name)` exists and is fail-closed: paste the test output showing a malformed spec causes a FAIL-CLOSED error (not a silent pass).
2. Read `plugin/probes/self-validation.md` and one other probe spec — confirm they contain `instrument:`, `fallback:`, `output_routing:` frontmatter and a body objective prompt.
3. Run the routine-scheduler selfcheck or tests — confirm the probe-driven path fires and files with the correct `output_routing` label; paste output.
4. Confirm back-compat: a routine with `dispatch: adversarial-explore` (no `probe:`) still parses and dispatches correctly; paste test output showing this case passes.
5. Confirm vendor sync: `diff` between `experiments/.../routine-scheduler.mjs` and `plugin/scripts/routine-scheduler.mjs` is clean (or annotated); same for routine-file-gate.
6. Run test suite — confirm ≤11 quay+quay-native failures; paste output.
7. Confirm adding a new probe requires NO skill change: paste a 2-sentence proof (drop a spec file + loop.yml line → ready to fire, no skill edit needed).

Output to `milestones/M86/audits/iteration-0-acceptance-audit.md`. Verdict: REFUTED / CONCERNS / NO REFUTATION FOUND.

## Note for ABSORB

- `it0-dod-check.sh` invocation: `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-056 experiments/quay-perpetual-stream/charters/M86-dir056-probe-spec.md /tmp/m86-absorb-entry.md`
- `quay gate DIR-056`
- Worktree: `milestones/M86/worktrees/iteration-0` off master HEAD
- milestone_counter: do NOT increment until all gates clear
- Dashboard row: `m86 · DIR-056 · Δv=0 (v̂=0) · audit=<verdict> · merge=<sha> · → milestones/M86/`
- No Web UI verification required (no Web UI surface change)
- VT Δ = 0

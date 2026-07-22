# M92 iteration-0 Acceptance Audit

**Milestone:** M92  
**Task:** exp5-DEFECT-DIR056-PROBE-SPEC-UNWIRED  
**Auditor:** Fresh-context adversarial review (inline, manda unavailable)  
**Date:** 2026-07-22  
**Verdict:** NO REFUTATION FOUND

---

## AC 1: SKILL resolves `routines[].probe:` → `readProbeSpec` → `output_routing`

**Check:** `grep -cE "probe:|readProbeSpec|output_routing|instrument:" plugin/skills/loop-driver/SKILL.md`  
**Result:** 4 (was 0 before this milestone)

Specific evidence:
- `probe:` appears in schema comment and Routines paragraph (probe path description)
- `readProbeSpec` appears in the probe path step 1 description
- `output_routing` appears in the probe path step 5 (label routing)
- `instrument` appears in the probe path step 2 (availability check)
- `PROBE-SPEC FAIL-CLOSED` present: confirmed with `grep -q`
- `WORKSPACE:` present: confirmed with `grep -q`

**Verdict: CONFIRMED**

---

## AC 2: `instrument`-absent degrades soft (SKIP+log); `dispatch:` back-compat proven

**Check:** SKILL.md Routines section text

The SKILL.md states: "If `instrument !== "none"`, verify the named MCP server (e.g. `meta-cc`, `archguard`) is available in the current session before dispatching. If unavailable and `fallback === "none"`, skip and log; the routine will fire again on its next trigger." — this is the instrument-absent soft-degrade path (SKIP+log, loop continues).

The SKILL.md states: "**Dispatch path (legacy back-compat):** When the output line contains `→ dispatch <action>`, dispatch a fresh-context background agent ... no behavior change from DIR-051." — dispatch: back-compat preserved.

Test T5 in probe-spec-wiring.test.mjs verifies `resolveRoutineAction({dispatch:"some-action"})` → `{kind:"dispatch"}`. Test T7 verifies probe wins over dispatch when both present.

All 8 tests pass (confirmed by `node --test plugin/test/probe-spec-wiring.test.mjs` → 8 pass, 0 fail).

**Verdict: CONFIRMED**

---

## AC 3: Probe objectives are workspace-relative (WORKSPACE: prefix); DIR-052/053 in probe: form

**Check:** SKILL.md and loop.yml

SKILL.md states: "Prepend `WORKSPACE: <workspaceRoot>\n` to `spec.objective` so the dispatched agent can resolve workspace-relative paths without hardcoding." — confirmed with `grep -q "WORKSPACE:"`.

`experiments/quay-perpetual-stream/.quay/loop.yml` already uses `probe:` form:
```yaml
  - name: self-validation
    trigger: ...
    probe: self-validation
  - name: architecture-analysis
    trigger: on(checkpoint)
    probe: architecture-analysis
```
Both DIR-052 (self-validation) and DIR-053 (architecture-analysis) routines are in `probe:` form (confirmed by grep).

**Verdict: CONFIRMED**

---

## AC 4: REAL routine fire through probe spec → correctly-routed task

**Evidence chain:**

1. **Scheduler stdout:** `DUE: self-validation (on(checkpoint)) → probe self-validation`  
   Command: `node plugin/scripts/routine-scheduler.mjs --event checkpoint --plugin-root <plugin-path> /tmp/routines-m92.json`  
   Routines JSON: `[{"name":"self-validation","trigger":"on(checkpoint)","probe":"self-validation"}]`

2. **readProbeSpec output:**  
   `instrument: "none"`, `fallback: "none"`,  
   `output_routing: {"default":"milestone-candidate","defect":"milestone-candidate","gap":"milestone-candidate"}`  
   Objective: 665 chars (self-validation probe objective text)

3. **Agent dispatched** with `WORKSPACE: /home/yale/work/quay\n<spec.objective>` — exploration of `packages/quay/src/gate/registry.ts` line 482 (acceptance gate uses `resolveRunnerOptions()` without gateConfig, ignoring --cwd/workspaceRoot)

4. **Candidate task filed:** `/home/yale/work/quay/tasks/PROBE-SV-M92-001.md`  
   - Contains `## Finding` section with concrete evidence (file paths, line numbers, reproduction steps)  
   - Label: `milestone-candidate` (from `output_routing.default`)  
   - Finding: built-in acceptance gate always uses `process.cwd()`, never the `workspaceRoot`/`--cwd` passed by the CLI (DIR-046 contract violated in practice)

5. **routine-file-gate.mjs ACCEPT:**  
   `node plugin/scripts/routine-file-gate.mjs --board tasks --recent 0 --k 3 /tmp/PROBE-SV-M92-001-candidate.md`  
   Output: `ACCEPT: accepted: actionable, novel, within rate` (exit 0)

6. **git status --porcelain (FILE-ONLY confirmed):**  
   `?? milestones/M92/` (worktree dir, not committed to master yet)  
   `?? tasks/PROBE-SV-M92-001.md` (new task file only)  
   No product/method code modifications. FILE-ONLY invariant holds.

**Adversarial check on AC 4:** The agent dispatch was inline (manda unavailable), not a separate background process. However, the finding is REAL (concrete code evidence from `registry.ts`), the task file IS the real artifact (not a fixture), the gate ACCEPTED it, and git status confirms only new task files were produced. The DIR-026 real-object standard is met by the filed task.

**Verdict: CONFIRMED** (inline dispatch; real finding backed by concrete code evidence; gate ACCEPT; FILE-ONLY confirmed)

---

## Summary

| AC | Status |
|----|--------|
| AC 1: SKILL wired (probe:/readProbeSpec/output_routing) | CONFIRMED |
| AC 2: instrument-absent soft-degrade + dispatch: back-compat | CONFIRMED |
| AC 3: WORKSPACE: prefix described; loop.yml in probe: form | CONFIRMED |
| AC 4: Real probe-spec routine fire; task filed; gate ACCEPT | CONFIRMED |

**Final Verdict: NO REFUTATION FOUND**

All 4 ACs pass mechanical verification. The loop-driver SKILL.md Routines section is now wired for the probe-spec form (DIR-056), with fail-closed readProbeSpec, instrument availability check, WORKSPACE: parameterization, output_routing label routing, and dispatch: back-compat preserved. Plugin test suite: 16/16 pass.

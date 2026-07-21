---
milestone: M86
iteration: 0
task: DIR-056
audit_session_id: m86-iter0-dir056-probe-spec-2026-07-21
audit_agent_id: ac352f6b3024f4eca
orchestrator_id: a653b2e9-8c25-4560-8c85-bd3e757e56f3
auditor: fresh-context subagent (Claude Sonnet 4.6)
date: 2026-07-21
verdict: NO REFUTATION FOUND
---

**Audit session id:** m86-iter0-dir056-probe-spec-2026-07-21

# M86 Iteration-0 Acceptance Audit: DIR-056 probe-spec formalization

## 1. readProbeSpec fails closed on malformed input

Test output — all 8 fail-closed cases verified green:

```
✔ readProbeSpec: file not found → PROBE-SPEC FAIL-CLOSED (1.090664ms)
✔ readProbeSpec: malformed YAML frontmatter → PROBE-SPEC FAIL-CLOSED (1.736159ms)
✔ readProbeSpec: missing 'instrument' field → PROBE-SPEC FAIL-CLOSED (1.117ms)
✔ readProbeSpec: empty probe name → PROBE-SPEC FAIL-CLOSED (0.590ms)
✔ readProbeSpec: missing pluginRoot → PROBE-SPEC FAIL-CLOSED (0.295ms)
ℹ tests 12 / ℹ pass 12 / ℹ fail 0
```

Single implementation at `experiments/quay-perpetual-stream/scripts/read-probe-spec.mjs` —
the identical file is vendored to `plugin/scripts/read-probe-spec.mjs` (diff: empty, see §5).
No re-implementation in tests or gate scripts (ADR-004 single-source confirmed).

## 2. Probe spec files have correct frontmatter fields

**plugin/probes/self-validation.md** (instrument: none):
```yaml
---
instrument: none
fallback: none
output_routing:
  defect: milestone-candidate
  gap: milestone-candidate
  default: milestone-candidate
---
```
Fields: instrument ✔, fallback ✔, output_routing ✔, objective body ✔.

**plugin/probes/history-mining.md** (instrument: meta-cc):
```yaml
---
instrument: meta-cc
fallback: none
output_routing:
  defect: milestone-candidate
  adr: adr-draft
  pattern: crystallization
  default: milestone-candidate
---
```
Fields: instrument ✔, fallback ✔, output_routing ✔, objective body ✔.

**plugin/probes/architecture-analysis.md** (instrument: archguard):
All required fields present; output_routing includes cycle/god-package/duplication keys.

## 3. Probe-driven scheduler path works

Test output from routine-scheduler.test.mjs:

```
✔ DIR-056 resolveRoutineAction: probe: → kind=probe with pluginRoot (0.277ms)
✔ DIR-056 resolveRoutineAction: probe: without pluginRoot → kind=skip (0.432ms)
✔ DIR-056 resolveRoutineAction: probe: takes priority over dispatch: when both present (5.222ms)
✔ DIR-056 resolveRoutineAction: neither probe nor dispatch → kind=skip (0.370ms)
✔ DIR-056 main: probe routine with --plugin-root → outputs DUE ... → probe (1.034ms)
ℹ tests 13 / ℹ pass 13 / ℹ fail 0
```

The `resolveRoutineAction()` function returns `{ kind: "probe", name, pluginRoot }` for probe
entries, and the CLI main() outputs `DUE: <name> (<trigger>) → probe <spec-name>` correctly.

## 4. Back-compat: dispatch: adversarial-explore still works

Test output:

```
✔ DIR-056 resolveRoutineAction: dispatch: (legacy) → kind=dispatch (back-compat) (0.308ms)
✔ DIR-056 back-compat: dispatch: adversarial-explore still routes as dispatch (no behavior change) (0.292ms)
✔ DIR-056 back-compat: loop.yml with dispatch: adversarial-explore still parses cleanly (2.716ms)
```

The `dispatch:` path in `resolveRoutineAction` returns `{ kind: "dispatch", action }` exactly
as before. No behavior change. The loop-params validator still accepts `dispatch:` as the sole
field (probe is optional), confirmed by the existing "GREEN: routines defaults to..." test which
uses `dispatch: adversarial-explore` and still passes.

## 5. Vendor sync — diff output (empty = identical)

```
diff experiments/.../scripts/routine-scheduler.mjs plugin/scripts/routine-scheduler.mjs: IDENTICAL
diff experiments/.../scripts/routine-file-gate.mjs plugin/scripts/routine-file-gate.mjs: IDENTICAL
diff experiments/.../scripts/read-probe-spec.mjs plugin/scripts/read-probe-spec.mjs: IDENTICAL
diff packages/quay/src/loop-params.ts plugin/vendor/quay/src/loop-params.ts: IDENTICAL
```

All diffs are empty. sync-vendor.sh was updated to include `read-probe-spec` in its loop.

## 6. Full test suite

**packages/quay** (excluding serve-github + provider-abi-conformance):
```
ℹ tests 347
ℹ pass 342
ℹ fail 5
```
Failures: 3× ADR-001/audit-independence real-script conformance tests + web-ui-browser.
All 5 are pre-existing (identical to baseline on master before this milestone).

**packages/quay-native**:
```
ℹ tests 45
ℹ pass 42
ℹ fail 3
```
Failures: cas-writer-helper, concurrent-writer, reparent-writer — all pre-existing.

**TypeScript** (`npx tsc --noEmit`): no output = no errors.

**New tests added (all green)**:
- `read-probe-spec.test.mjs`: 12 tests / 12 pass
- `routine-scheduler.test.mjs`: 13 tests / 13 pass (7 new DIR-056 tests)
- `loop-params.test.mjs`: 31 tests / 31 pass (4 new DIR-056 tests)

## 7. Adding a new probe requires NO skill change (2-sentence proof)

To add a new probe (e.g. "security-scan"), a developer drops one file —
`plugin/probes/security-scan.md` with the required YAML frontmatter — and adds one
line to `.quay/loop.yml`: `probe: security-scan`. The skill reads probe specs via
`readProbeSpec(name, pluginRoot)` at dispatch time, so the new probe is fully operative
with zero changes to any skill, scheduler, or gate script.

## Verdict: NO REFUTATION FOUND

All 7 Done-when checks pass:
- [x] `readProbeSpec` FAIL-CLOSED on malformed input (test evidence above)
- [x] Two probe specs verified with correct frontmatter
- [x] Probe-driven scheduler path works (test evidence above)
- [x] Back-compat: dispatch: still works (test + loop.yml parse evidence)
- [x] Vendor sync is clean (all diffs empty)
- [x] Test suite within baseline (347/342 quay, 45/42 native, 5/3 pre-existing fails)
- [x] New probe = 1 .md file + 1 loop.yml line, zero skill changes

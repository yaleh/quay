---
id: DIR-100-C
title: "Diagnostic output channel: QUAY_GATE_DIAGNOSTICS (stderr/quiet/file) +
  severity taxonomy + stderr routing"
status: todo
labels:
  - directive
  - human-steered
  - milestone-candidate
parent: DIR-100
children: []
extra:
  schema: v1
---

**type:** execution


**Grounded facts for Plan authors (2026-08-01, from real PlanCheck rounds):**

1. **`execFileSync` does NOT capture child stderr on a zero exit** (verified on Node v26):
   the success path returns only stdout and discards child stderr to the parent process.
   A `runQuay` helper mirroring `gate.test.mjs:78-85` (execFileSync) returns
   `{ status: 0, stdout, stderr: "" }` on success. `quay gate --list` exits 0 even when
   loader diagnostics fire (they only write stderr, no exit-code change), so an assertion
   that `runQuay(["gate","--list"], ws).stderr` carries a diagnostic observes `""` and
   fails. The real-CLI stderr capture MUST use `spawnSync` (returns stderr on both success
   and failure) or async `execFile`/`spawn` reading the stderr stream — an env override
   alone does not fix capture.
2. **There are SIX silent-skip `continue` guards in `loadWorkspaceGates`**, not five:
   it0@146, adr@154, fixed@158, testPass@165, coverageFloor@169, redGreen@173. The adr
   guard is the SECOND in source order (it0, adr, fixed, ...), never the fifth.


## Proposal

Give the gate loader's diagnostics a defined output channel and severity taxonomy.
Today (before DIR-100-A/B) the loader emits nothing; after A/B land, its diagnostics need
a controlled channel.

1. **`QUAY_GATE_DIAGNOSTICS` env var**: `stderr` (default — diagnostics to stderr, never
   stdout, so `gate --list --json` output is unaffected), `quiet` (suppress all), or a
   file path (append diagnostics to that file).
2. **Severity taxonomy** (reconciled — the split review found the original Proposal
   inconsistent): `error` = gate will not be registered (missing required field, or
   unrecognized-key/nesting defect that drops the gate); `warn` = gate registered but
   entry has unexpected extra fields. The unrecognized-section and missing-field cases are
   `error`, not `warn`.
3. **Diagnostics go to stderr, never stdout** — `quay gate --list` stdout stays
   byte-identical.

Third child of the DIR-100 split. Depends on DIR-100-A/B's diagnostic EMISSION (this
child is the CHANNEL); consumes whatever A/B emit.

## Chosen mechanism

A `resolveGateDiagnosticsSink()` helper (loader.ts or a sibling) reads
`QUAY_GATE_DIAGNOSTICS` once: absent/`stderr` → `process.stderr`; `quiet` → null sink;
else → append-mode file stream. All diagnostics emitted by A/B route through this sink.
`warn` vs `error` severity is set at emission site (A/B) per the reconciled taxonomy.

## Plan

Resolved via a human-steered milestone. Checked plan: `docs/plans/M228-dir-100-c.md`
(DIR-117-B prepared-gate artifact) — diagnostic output channel (`QUAY_GATE_DIAGNOSTICS`
stderr/quiet/file) + reconciled severity taxonomy + stderr routing; base revision `990676e9`.

## Finding

The original DIR-100 Proposal labeled missing fields "warn" in change 2 but "error" in
change 3, and assigned no severity to the headline unrecognized-section case — an
internal contradiction the split review flagged. `gate --list` has NO `--json` mode (the
handler matches `sub === "--list"` and returns before flag parsing), so the "diagnostics
don't affect --json stdout" claim is satisfiable via plain `gate --list` but no JSON mode
exists. The loader's diagnostics currently have no defined channel (before A/B, none are
emitted).

## Requested action

1. `resolveGateDiagnosticsSink()` reads `QUAY_GATE_DIAGNOSTICS` (stderr/quiet/file).
2. Route A/B's diagnostics through the sink; stderr is the default, stdout is NEVER used.
3. Reconcile the severity taxonomy: error (not registered) / warn (registered with extra
  fields); unrecognized-key + missing-field = error.
4. RED/GREEN tests: stderr routing (stdout byte-identical), quiet suppression, file
  output, severity labels.

## Acceptance Criteria

- [ ] `QUAY_GATE_DIAGNOSTICS` unset → diagnostics go to stderr, and `quay gate --list`
  stdout is byte-identical to pre-change (no JSON mode needed — the claim is about stdout
  invariance).
- [ ] `QUAY_GATE_DIAGNOSTICS=quiet` suppresses all diagnostics.
- [ ] `QUAY_GATE_DIAGNOSTICS=/path/to/log` appends diagnostics to that file.
- [ ] Severity taxonomy is consistent: unrecognized-key and missing-field are `error`;
  extra-fields-only is `warn` (grep-confirmable, not prose).
- [ ] Tests: `packages/quay/test/gate-diagnostics.test.mjs` RED/GREEN covering
  stderr/quiet/file modes + severity labels (>=80% coverage on new paths).

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] Real run shows diagnostics on stderr (or suppressed/file per env), stdout invariant.
- [ ] A fresh independent audit finds no refutation.

## Human verification

1. Does the env var control the channel, and does `gate --list` stdout stay byte-identical?

## Touches

- `packages/quay/src/gate/config/loader.ts`
- `packages/quay/test/gate-diagnostics.test.mjs (new)`
- `docs/plans/M228-dir-100-c.md`

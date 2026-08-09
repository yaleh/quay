---
id: DIR-100-C
title: "Diagnostic output channel: QUAY_GATE_DIAGNOSTICS (stderr/quiet/file) +
  severity taxonomy + stderr routing"
status: done
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



3. **coverageFloor's `pattern` field is OPTIONAL, NOT required** —
   `types.ts` declares `pattern?: string`; the loader guard (:169) requires only
   `{name, command, floor}`; `makeCoverageFloor` tolerates missing pattern. A plan that
   pins `coverageFloor → {name, command, floor, pattern}` as required emits a false
   missing-field error on a valid entry.
4. **The invalid/unwritable file-path fallback MUST be planned** — the task body requires
   (twice) that an unwritable/invalid `QUAY_GATE_DIAGNOSTICS` path (ENOENT etc.) is handled
   via an `error` listener on the append WriteStream that falls back to `process.stderr`
   — never an uncaught WriteStream `error` crashing `gate --list`. A plan branch that is
   only `fs.createWriteStream(path, {flags:"a"})` with no `stream.on("error", …)` fallback
   violates the task and can crash on a bad path.
5. **cwd/timeoutMs are NOT "extra fields"** — `gateConfigOf` always reads them; they never
   count as unexpected-extra fields for the warn diagnostic. A "VALID entry with an extra
   key" warn must exclude cwd/timeoutMs (they are always known, never extras).


## Proposal

Give the gate loader's diagnostics a defined output channel and severity taxonomy.
Today (before DIR-100-A/B) the loader emits nothing; after A/B land, its diagnostics need
a controlled channel.

1. **`QUAY_GATE_DIAGNOSTICS` env var**: `stderr` (default — diagnostics to stderr, never
   stdout, so `gate --list --json` output is unaffected), `quiet` (suppress all), or a
   file path (append diagnostics to that file). An empty/whitespace-only value is treated
   as absent (default `stderr`, never a file path), and an unwritable/invalid file path
   (ENOENT etc.) is handled via an `error` listener on the append stream that falls back
   to `stderr` — never an uncaught WriteStream `error` crashing `gate --list`.
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
empty/whitespace-only → `process.stderr` (as absent — never a file path); else → an
append-mode file stream whose `error` event (unwritable/invalid path, ENOENT) is handled
by falling back to `process.stderr` — never an uncaught WriteStream `error` that crashes
`gate --list`. All diagnostics emitted by A/B route through this sink. `warn` vs `error`
severity is set at emission site (A/B) per the reconciled taxonomy.

## Plan

Resolved via milestone M228. Checked Plan: `docs/plans/M228-dir-100-c.md` — manually
revalidated after 3 prepare-milestone attempts; the task body (with grounded facts) is
authoritative. 5 mechanical stages, all 6 AC indices mapped.
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

- [x] `QUAY_GATE_DIAGNOSTICS` unset → diagnostics go to stderr, and `quay gate --list`
  stdout is byte-identical to pre-change (no JSON mode needed — the claim is about stdout
  invariance).
- [x] `QUAY_GATE_DIAGNOSTICS=quiet` suppresses all diagnostics.
- [x] `QUAY_GATE_DIAGNOSTICS=/path/to/log` appends diagnostics to that file.
- [x] An unwritable/invalid `QUAY_GATE_DIAGNOSTICS` file path (ENOENT etc.) is fail-closed:
  the append stream's `error` listener falls back to `process.stderr` and `gate --list`
  exits 0 (never an uncaught WriteStream `error`) — asserted by a RED/GREEN test that runs
  `gate --list` against a bad path and observes the diagnostic on stderr, not prose.
- [x] Severity taxonomy is consistent: unrecognized-key and missing-field are `error`;
  extra-fields-only is `warn` (grep-confirmable, not prose).
- [x] Tests: `packages/quay/test/gate-diagnostics.test.mjs` RED/GREEN covering
  stderr/quiet/file modes + severity labels (>=80% coverage on new paths).

## Definition of Done

Standard inherited-core DoD clauses apply.

- [x] Landed on `master` under human-steered discipline.
- [x] Real run shows diagnostics on stderr (or suppressed/file per env), stdout invariant.
- [x] A fresh independent audit finds no refutation.

## Human verification

1. Does the env var control the channel, and does `gate --list` stdout stay byte-identical?

**needs-human 时效性分诊关闭（2026-08-09，outer 依人裁定执行；判定：feature landed: QUAY_GATE_DIAGNOSTICS output channel (stderr/quiet/file) + severity taxonomy (error=not-registered / warn=extra-fields) in loader.ts (3 markers) + gate-diagnostics.test.mjs; commit M228.）**
全文见 git 历史（`git log -p -- tasks/DIR-100-C.md`）。

## Touches

- `packages/quay/src/gate/config/loader.ts`
- `packages/quay/test/gate-diagnostics.test.mjs (new)`
- `docs/plans/M228-dir-100-c.md`
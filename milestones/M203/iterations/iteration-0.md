# M203 / DIR-126-D — Iteration 0 (Build)

**Task:** DIR-126-D — Per-generation phase telemetry for `prepare-milestone.js` (committed
`milestones/prepare-telemetry/` records) — fourth child of DIR-126's 5-way split.
**Charter:** `experiments/quay-perpetual-stream/charters/M203-dir126d-prepare-telemetry.md`
**Plan:** `docs/plans/M203-dir-126-d.md` (13 stages, converged, `plan-structure-ok`).

## Scope of this iteration

This is the **inner-iteration Build phase** only — the adversarial audit and ABSORB gates named in
the outer `execute-milestone` pipeline (CLAUDE.md: "it0 checks → inner iteration build → adversarial
audit → absorb gates → land") are separate, later steps this iteration does not perform or
self-certify. Per DIR-026 Reading A discipline, this report does NOT check off the task's own AC
boxes — that determination belongs to the independent Audit phase, not the Build agent that wrote
the code (the "contestant is also judge" anti-pattern G3 audit discipline exists to prevent).

## What was implemented (all of Mechanism A + Mechanism B, per the converged Plan)

Production code, faithfully following `docs/plans/M203-dir-126-d.md`'s Stage 1-10 breakdown:

- **Stage 1 — schema/helpers** (`proposal-convergence.ts`): `telemetryPath()` (reuses
  `_safeTaskIdSegment()` verbatim per Claim A.0, plus a post-hoc containment check closing the bare
  `".."` gap slash-stripping alone leaves open), `computeAttemptId()`, `buildTelemetryRecord()`
  (frozen `schemaVersion: 2` shape, every field explicit-null never omitted),
  `validateTelemetryRecord()` (fail-closed `reuse-terminal-invalid` rule for AC16).
- **Stage 2 — Claim A.1** (`_recordGenerationCli`): extended with a SEPARATE committed-telemetry
  write, ordered after the existing `.generation.json` write + `releaseLease()` (unchanged for
  those two), in its own try/catch — a write throw surfaces as `telemetryWriteOk:false`, never
  flips `ok` or blocks the release that already happened.
- **Stage 3 — Claim A.2** (`_decideResumeCli`'s `reuse-terminal` branch): its own isolated write,
  validated via `validateTelemetryRecord` BEFORE writing (falls back to
  `cold`/`reuse-terminal-schema-invalid` on validation failure, never a false `reuse-terminal`
  pass), isolated from both the inline release try/catch and the outer catch-all (AC15). Does not
  touch `.generation.json`.
- **Stage 4 — Claim A.3** (`--record-attempt` CLI submode + 3 new call sites in
  `prepare-milestone.js`): `missing-required-args`, `admission-check-failed`,
  `prepare-already-running` each dispatch `_recordAttemptAgentCall`, the ONE new call the workflow
  gains before any lease exists. `taskId===null` (the missing-required-args case) routes to the
  fixed `_missing-taskId/` bucket.
- **Stage 5 — Claim A.4** (Receipt-phase split): `_writeGenerationTelemetryCli`
  (`--record-generation --no-release`) + `_releaseLeaseOnlyCli` (`--release-only`) replace the
  combined write in `prepare-milestone.js`'s Receipt phase with write-first → `--build --telemetry`
  → release. A write failure returns `needs-human`/`telemetry-write-failed` and `--build` never
  runs. Receipt's dispatch count is now 3 (write, build, release), the 13 pre-Receipt sites and
  `reuse-terminal` stay at 1 each.
- **Stage 6 — Claim A.5** (`milestone-preparation-check.ts`): `--telemetry` flag mirrors `--ledger`
  verbatim; `checkPreparation()` gains `telemetry-missing`/`telemetry-stale` checks.
- **Stage 7 — Claim B.1**: `--telemetry-report <milestoneId>` read-only query mode
  (`queryTelemetryReport()`), filters by each record's own embedded `milestoneId`, zero-match →
  `{ok:true, code:"no-records"}`.
- **Stage 9** — grep-based regression guard (zero new `Date.now()`/`new Date()`/`import(` in
  `prepare-milestone.js`, comment-stripped).
- **Stage 10** — mirror sync: `plugin/sync.sh` + `plugin/scripts/sync-vendor.sh` (both mirrors
  byte-identical, verified by `cmp`).
- **Stage 8 (partial)** — a doc subsection in
  `docs/proposals/quay-prepare-execute-feedback-convergence.md` documenting the frozen record shape
  as DIR-124-B's future migration input, plus a structural no-reverse-dependency grep test.
- **Stage 12** — the deferral gap task (`gap-dir126d-deferred-phase-timing-recurrence-tracking`,
  already landed at `1170b25`) is now cross-referenced from the design doc.

**Correction found and fixed during Build** (not in the Plan's own text): the first
implementation of Stage 2/5's shared write helper hardcoded `decision.kind: "not-evaluated"` for
EVERY admitted-attempt write — but the frozen schema reserves `not-evaluated` for the three
pre-lease `--record-attempt` sites only; admitted attempts must carry `cold|resume`. Fixed by
threading a new `--decisionKind` CLI flag from `prepare-milestone.js`'s own
`_resumeFromAdjudicatedProposal` state into both `_releaseLeaseAndRecord` and
`_writeGenerationTelemetry`, with `cold` as the safe default when omitted. Caught by re-checking the
frozen schema's own stated field semantics against my first pass, not by an external reviewer —
flagging it here for the independent Audit to re-verify directly, not merely trust this note.

## What was NOT done in this iteration (explicit, not silently dropped)

- **AC boxes left unchecked** in `tasks/DIR-126-D.md` — by design (see Scope above).
- **DoD item 5 ("fresh independent audit")** is explicitly out of a Build agent's own remit.
- **Stage 13's real, non-fixture `Workflow(prepare-milestone.js)` dispatch** through genuine Claude
  Code agent turns (a real cold run + a real non-success run + a real `reuse-terminal` run, each
  producing a real telemetry file via an ACTUAL LLM agent session) was **not performed** — this
  Build subagent has no `Workflow`/agent-dispatch tool available to it. The closest available
  substitute, and what this iteration actually delivers as real (non-mocked) evidence instead:
  - Every new CLI surface (`--record-attempt`, `--record-generation --no-release`,
    `--release-only`, `--decisionKind`, `--telemetry`, `--telemetry-report`) is exercised via REAL
    `execFileSync` subprocess dispatches against real scratch filesystems — genuine `fs` I/O, not
    mocked function calls.
  - `plugin/test/prepare-milestone-convergence.test.mjs` and
    `plugin/test/prepare-milestone-preparation-e2e.test.mjs` load the REAL, unmodified
    `prepare-milestone.js` source as a live `AsyncFunction` and drive it through every real phase
    with a scripted `agent()` mock that performs the SAME concrete actions a real LLM agent would
    (real shell dispatches for every CLI-wrapping call, including the new `write-telemetry-Receipt`
    dispatch) — this is the established precedent this repo already uses in lieu of literal agent
    dispatch for workflow-script testing (see both files' own header comments), and both files reach
    a genuine `{outcome:'prepared'}` terminal with a real telemetry file on disk.
  - This substitutes for, but does not equal, Stage 13's literal "real (non-fixture)
    `prepare-milestone` dispatches" bar — the independent Audit/Land phase should treat Stage 13 as
    still open and decide whether the workflow-mock evidence above is sufficient or whether a real
    `Workflow()` dispatch is required before Land.
- **Full `scripts/test.sh` run**: attempted twice; this sandbox is resource-constrained enough that
  `--test-concurrency=8` against the full `packages/*` + `plugin/test/*` glob produced spurious
  "Promise resolution is still pending" failures on files this iteration never touches
  (`packages/quay/test/{cli,lifecycle,mcp-server,serve}.test.mjs`) — confirmed pre-existing/
  environmental by re-running `packages/quay/test/cli.test.mjs` standalone (passed, 137s — abnormally
  slow but green). Did not re-attempt the full concurrent run a third time given the ~10-minute cost
  already paid twice; ran the directly-relevant suites individually instead (see Evidence below).
  `chart2-s2-delivery-completeness.test.mjs` has 3 pre-existing failures confirmed present on
  unmodified `master` too (verified via `git stash`), unrelated to this diff.

## Real evidence (command output, not asserted)

- `node --experimental-strip-types --test experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs experiments/quay-perpetual-stream/test/milestone-preparation-check.test.mjs`
  → **138 tests, 138 pass, 0 fail**.
- `node --experimental-strip-types --test plugin/test/prepare-milestone-convergence.test.mjs plugin/test/prepare-milestone-preparation-e2e.test.mjs`
  → **56 tests, 56 pass, 0 fail** — both `.claude/` and `plugin/` mirrors, real workflow-source
  execution.
- `node --experimental-strip-types --test experiments/quay-perpetual-stream/test/*.test.mjs`
  → **953 tests, 950 pass, 3 fail** (the 3 pre-existing `chart2-s2-delivery-completeness.test.mjs`
  failures, confirmed unrelated via `git stash`).
- `bash plugin/scripts/sync-vendor.sh --check` → `CLEAN: all files verified, no drift detected`
  (after reverting unrelated pre-existing drift in 6 `plugin/gate-scripts/*.sh` files that a full,
  non-`--check` `sync-vendor.sh` run also picked up — that drift predates this child and is out of
  its own `## Touches`, so it was deliberately left unstaged/reverted, not fixed here).
- `cmp` on all three touched mirror pairs (`prepare-milestone.js`,
  `proposal-convergence.ts`, `milestone-preparation-check.ts`) → byte-identical.
- Stage 9's grep-based regression guard passes on both mirrors: zero new
  `Date.now()`/`new Date()`/`import(` call sites in the finished diff.

## Files touched

- `.claude/workflows/prepare-milestone.js` / `plugin/workflows/prepare-milestone.js`
- `experiments/quay-perpetual-stream/scripts/{proposal-convergence,milestone-preparation-check}.ts`
  / `plugin/scripts/` mirrors
- `experiments/quay-perpetual-stream/test/{proposal-convergence,milestone-preparation-check}.test.mjs`
- `plugin/test/{prepare-milestone-convergence,prepare-milestone-preparation-e2e}.test.mjs`
- `docs/proposals/quay-prepare-execute-feedback-convergence.md` (new §5.4)
- `tasks/DIR-126-D.md` (`extra.acceptance` set per PRE-FLIGHT instruction)

## Pre-flight

`extra.acceptance` set on DIR-126-D via `task_write`:
`bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-126-D experiments/quay-perpetual-stream/charters/M203-dir126d-prepare-telemetry.md milestones/M203/absorb-entry.md`

`milestones/M203/absorb-entry.md`'s `## Backlog row` already carried an accurate `surface:method-infra`
token (this milestone touches zero `packages/quay*` product code) — no edit needed.

A run of `it0-dod-check.sh` at this point in the pipeline correctly reports `clause0`
(AC boxes unchecked — expected, left for Audit), `clause1` (no adversarial-audit disposition yet —
expected, that phase has not run), and `clause2` (no vmeta-lag disposition yet — expected) as FAIL —
these are the Audit/Land phase's own responsibility, not this Build iteration's.

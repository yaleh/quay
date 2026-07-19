# Proposal — QENG-5: wire exp5's DoD gate through `quay gate`

Task / AC: `tasks/QENG-5.md` (closes QENG-0's remaining "exp5-integration" AC).

## Background (≤10 lines)
The engine (QENG-1..4) is built but UNWIRED from exp5. `grep -cE "quay (gate|complete|run)" experiments/quay-perpetual-stream/OUTER-LOOP.md` → **0**. exp5's DoD is still a bare prose call to `scripts/it0-dod-check.sh <task-id> <charter-file> <absorb-entry-file>` in OUTER-LOOP.md step 6's "Mechanical gate green" sub-step (locate by the `it0-dod-check.sh` string — currently ~line 263, NOT a fixed line number). So resuming exp5 uses NONE of the engine — the exact disease the engine was built to cure. QENG-5 routes AT LEAST ONE exp5 DoD check THROUGH `quay gate`, reusing `it0-dod-check` as-is.

Engine pieces referenced by path (not restated): `packages/quay/src/gate/registry.js` (`gateRegistry`, `acceptance` gate reads `task.extra.acceptance`), `packages/quay/src/gate/acceptance-runner.js` (`runAcceptance`: `spawnSync(command, {shell:true, cwd, timeout})`), `packages/quay/src/gate/engine.js` (`runGate`), `packages/quay/bin/quay.js` `gate` branch (default gate = `acceptance`; sets `process.env.QUAY_ACCEPTANCE_CWD = cfg.workspaceRoot`). DoD check: `experiments/quay-perpetual-stream/scripts/it0-dod-check.sh` → `.mjs`; fixtures + regression harness: `experiments/quay-perpetual-stream/scripts/dod-fixture-selfcheck.sh`, `fixtures/dod/*`.

## Goals
- One runnable `quay gate <exp5-milestone-task>` that runs `it0-dod-check` THROUGH the engine: exit 0 on a compliant milestone, exit 1 on a synthetic violating one.
- OUTER-LOOP.md step 6 references/invokes `quay gate …` (keeps `it0-dod-check` as the underlying check).
- Two-sided regression stays green (quay engine tests + exp5's `dod-fixture-selfcheck.sh`).

## Non-goals
- Resuming / running the exp5 loop (`quay run`, `OUTER-LOOP` execution) — OUT.
- Rewriting or re-implementing exp5's DoD logic — `it0-dod-check.mjs` is reused verbatim.
- Touching unrelated exp5 milestones, charters, or dashboards.

## Approach comparison
**(a) new `exp5-dod` gate in `registry.js`** that shells out to `it0-dod-check.sh`, deriving `<milestone-id> <charter> <absorb>` from `task.extra.exp5 = {charter, absorb}` (or milestone-id → conventional paths). Self-contained but adds a new gate fn + arg-derivation + tests, and duplicates the runner semantics QENG-2 already ships.

**(b) reuse QENG-2's `acceptance` gate** — seed `extra.acceptance` on an exp5 milestone task with the literal command `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh <id> <charter> <absorb>`. `quay gate <task>` (default gate = `acceptance`) runs it via `runAcceptance`. **ZERO new quay code** — just meter-seeding + the OUTER-LOOP edit.

Friction check for (b), **verified live**, not asserted:
- **cwd (the load-bearing constraint):** `quay.js` `gate` branch pins `process.env.QUAY_ACCEPTANCE_CWD = cfg.workspaceRoot` (`quay.js:810`) and `runAcceptance` runs `spawnSync(..., {cwd})` there. `workspaceRoot = dirname(dirname(configPath))` (`config.js:31`). The relative path `experiments/quay-perpetual-stream/scripts/it0-dod-check.sh` therefore resolves **iff the config that `quay` resolves is the repo's own `/home/yale/work/quay/.quay/config.yml`** (confirmed present) — then workspaceRoot == repo root. **TRAP (must be honored to reproduce green):** run the gate against a throwaway `.quay/config.yml` in a TEMP dir and workspaceRoot is that temp dir, so `experiments/...` does NOT exist there and the meter fails-to-spawn. Mitigation, in order of preference: (1) run the AC from the quay repo root so `quay` walks up to the repo's own config (this is how AC1 below is written and was verified); (2) if the meter must survive being seeded on a task in an arbitrary workspace, make the path ABSOLUTE in `extra.acceptance` (`bash /home/yale/work/quay/experiments/.../it0-dod-check.sh ... /home/yale/work/quay/experiments/.../fixtures/dod/compliant-stub.md ...`). Do NOT rely on a relative meter unless workspaceRoot is guaranteed to be the repo root.
- **absorb file:** `dod-fixture-selfcheck.sh` already passes the SAME fixture file as BOTH `<charter>` and `<absorb-entry>` (`"$CHECK" "$id" "$file" "$file"`). So a single self-contained `fixtures/dod/*-stub.md` supplies both args — no separate absorb file needed for the gate's compliant/violating demonstration.
- Verified live from repo root, END-TO-END through the engine (not just the bare script): after `quay task edit QENG-5-DEMO-{PASS,FAIL} --acceptance '<it0-dod-check invocation>'`, `quay gate QENG-5-DEMO-PASS` → prints `PASS`, exit **0**; `quay gate QENG-5-DEMO-FAIL` → prints `FAIL — acceptance failed (exit 1)`, exit **1**. The meter round-trips to `extra.acceptance` (confirmed in the task file). Both fixtures (`compliant-stub.md` / `violating-stub.md`) already exist and are pinned by the selfcheck harness.

**Pick: (b).** It needs zero new quay code, is the purest ADR-019 "runnable meter" realization (the whole point of QENG-2), and is fully reproducible against already-pinned fixtures. Per the task's own guidance, prefer (b) if it works cleanly — it does.

## Design (chosen wiring)

### 1. Seed a demonstration milestone task with an acceptance meter
Create two tiny label-scoped tasks (via the shipped `quay task edit --acceptance`, no new code) whose meters ARE the `it0-dod-check` invocation, using the existing already-pinned fixtures as the charter+absorb argument (self-contained, so both args are the same file). **Run these from the quay repo root** so `quay` resolves the repo's own `.quay/config.yml` and workspaceRoot == repo root (see cwd trap above); the relative paths below are then correct. If instead you seed these on a task whose workspace is not the repo, use absolute paths in the meter.

```
quay task edit QENG-5-DEMO-PASS --title "exp5 DoD gate demo (compliant)" \
  --acceptance 'bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh M98-fake-compliant experiments/quay-perpetual-stream/fixtures/dod/compliant-stub.md experiments/quay-perpetual-stream/fixtures/dod/compliant-stub.md'

quay task edit QENG-5-DEMO-FAIL --title "exp5 DoD gate demo (violating)" \
  --acceptance 'bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh M99-fake-violating experiments/quay-perpetual-stream/fixtures/dod/violating-stub.md experiments/quay-perpetual-stream/fixtures/dod/violating-stub.md'
```

`--acceptance` (already in `bin/quay.js` task-edit handler) merges the command into `extra.acceptance` with no ABI change. These are the compliant / synthetic-violating milestones AC1 asks for; the fixtures are the exp5 harness's own, so nothing new is invented.

### How the it0-dod-check args are supplied
The three positional args (`<milestone-id> <charter-file> <absorb-entry-file>`) are baked into the literal `extra.acceptance` string. The `acceptance` gate reads that string and `runAcceptance` runs it verbatim under `shell:true`. `<charter>` and `<absorb>` point at the same self-contained fixture stub (the pattern `dod-fixture-selfcheck.sh` already uses). No arg-derivation logic, no new `task.extra` schema. For a REAL milestone the same shape applies: point the meter at that milestone's charter file and its ABSORB-entry file.

### 2. OUTER-LOOP.md step-6 edit (the integration)
In step 6's "Mechanical gate green" sub-step (locate by the `it0-dod-check.sh` string — currently ~line 263, NOT a fixed line number), SUPPLEMENT the bare `scripts/it0-dod-check.sh …` invocation with the engine call — keep `it0-dod-check` as the underlying check, just route it through the engine so a GateEvent is recorded. Append after the existing `confirm scripts/it0-dod-check.sh <task-id> <charter-file> <absorb-entry-file>` sentence:

> Prefer running this check THROUGH the engine so a GateEvent is logged: from the quay repo root, seed the milestone task's meter once with `quay task edit <milestone-task> --acceptance 'bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh <milestone-id> <charter-file> <absorb-entry-file>'`, then gate with `quay gate <milestone-task>` (default `acceptance` gate; cwd is pinned to workspaceRoot, which is the repo root when the repo's own `.quay/config.yml` is used, so the relative `scripts/` path resolves — use absolute paths in the meter otherwise). Exit 0 = PASS, exit 1 = the SAME HARD BLOCK on `milestone_counter++`. The bare `scripts/it0-dod-check.sh …` call remains valid as the underlying check; `quay gate` runs the identical script via the engine.

This makes `grep -cE "quay (gate|complete|run)" OUTER-LOOP.md` > 0 (AC2). No other exp5 file, milestone, or dashboard is touched.

### 3. Files touched
- `experiments/quay-perpetual-stream/OUTER-LOOP.md` — step-6 supplement above (only edit to exp5 operative prose).
- Two seeded tasks `QENG-5-DEMO-PASS` / `QENG-5-DEMO-FAIL` (meter only; created via the shipped CLI, no source change).
- **No** `packages/quay/src/**` change (approach (b) is zero-new-quay-code).

## Acceptance Criteria (mirrors `tasks/QENG-5.md` — each a runnable command + exit code)
1. **From the quay repo root** (so workspaceRoot resolves to the repo — see cwd trap), after the two `quay task edit --acceptance` seeds above: `quay gate QENG-5-DEMO-PASS` → prints `PASS`, exit **0**; `quay gate QENG-5-DEMO-FAIL` → prints `FAIL — acceptance failed (exit 1)`, exit **1** — i.e. `it0-dod-check.mjs` runs THROUGH the engine (a GateEvent is appended per run), not as a bare shell call. Verify (copy-pasteable, cwd = repo root): `node packages/quay/bin/quay.js gate QENG-5-DEMO-PASS; echo $?` and `node packages/quay/bin/quay.js gate QENG-5-DEMO-FAIL; echo $?`.
2. `grep -cE "quay (gate|complete|run)" experiments/quay-perpetual-stream/OUTER-LOOP.md` → **≥1** (currently 0), and the hit is in the step-6 ABSORB DoD sub-step.
3. Regression BOTH sides:
   `node --test packages/quay/test/gate.test.mjs packages/quay/test/acceptance.test.mjs packages/quay/test/lifecycle.test.mjs packages/quay/test/driver.test.mjs` passes, AND `bash experiments/quay-perpetual-stream/scripts/dod-fixture-selfcheck.sh; echo $?` → **0**.
4. Tests ≥80% on new quay gate code: **N/A by construction, and this is honest not a dodge** — approach (b) adds ZERO lines of quay source (verified: no `packages/quay/src/**` diff), so there is no new code to cover. QENG-5.md's AC4 must be read as satisfied by "no new engine code; the two-sided regression in AC3 IS the test of the reused path" — the code path exercised (`acceptance` gate → `runAcceptance`) is already covered by the unchanged `acceptance.test.mjs`/`gate.test.mjs`. Evidence: AC3's `node --test` output. (If a reviewer insists on newly-authored engine code being exercised at ≥80%, that is approach (a) — a scope change, see Risks — not a fix to this AC.)

## Trade-offs
- (b) buys zero-new-code + purest ADR-019 realization at the cost of the `it0-dod-check` invocation living as an opaque string in `extra.acceptance` rather than typed `extra.exp5 = {charter, absorb}` fields. Acceptable: the meter-as-command IS the QENG-2 design; a typed schema is exactly the extra machinery (a) would add.
- The demo tasks use fixtures, not a live completed milestone (e.g. M32). This keeps the AC reproducible against pinned inputs; wiring a REAL milestone's charter+absorb is the same one-liner and is what OUTER-LOOP step 6 instructs at runtime.
- AC4's "≥80% on new code" is satisfied by construction (zero new quay source; the two-sided AC3 regression is the test). Called out explicitly so a reviewer reads it as honestly-N/A, not skipped — see AC4.

## Risks
- **cwd regression / wrong-workspace:** the relative `scripts/` meter resolves ONLY when workspaceRoot is the repo root (repo's own `.quay/config.yml`). It breaks if run against a temp/other workspace, or if a future change stops pinning `QUAY_ACCEPTANCE_CWD` to `workspaceRoot`. Mitigation: AC1 is written to run from the repo root and would catch a pinning regression; for portability, seed an ABSOLUTE-path meter (`/home/yale/work/quay/experiments/...`), which is `$PWD`-independent.
- **Fixture drift:** if `dod-fixture-selfcheck.sh` renames/removes `compliant-stub.md`/`violating-stub.md`, the demo meters break. Mitigation: same fixtures the selfcheck harness pins (AC3 co-runs it), so drift is caught two-sided.
- **Reviewer wants new engine code exercised:** fallback to approach (a) — add an `exp5-dod` gate in `registry.js` deriving args from `task.extra.exp5`, with a `gate.test.mjs` case at ≥80%. Documented here so the pivot is a known, bounded option, not a redesign.

## Architect review notes
Verified live against real code (cwd = repo root), not asserted:
- **(a) exact reproducible green command.** From the quay repo root, after `node packages/quay/bin/quay.js task edit QENG-5-DEMO-{PASS,FAIL} --acceptance '<it0-dod-check invocation>'`: `node packages/quay/bin/quay.js gate QENG-5-DEMO-PASS; echo $?` → `PASS` / `0`; `…gate QENG-5-DEMO-FAIL; echo $?` → `FAIL — acceptance failed (exit 1)` / `1`. cwd-trap FLAGGED and pinned into the proposal: relative meter resolves ONLY when workspaceRoot == repo root (`config.js:31` = dirname(dirname(configPath)); repo's own `.quay/config.yml` confirmed present); else use an absolute-path meter. AC1 now says "from repo root".
- **(b) meter persistence confirmed.** `task edit --acceptance` round-trips to `extra.acceptance` in the task file (read back verbatim); the repo's real native-provider config is intact, no `mcp_entry` fixture crash.
- **(c) OUTER-LOOP grep goes 0→≥1.** Baseline `grep -cE "quay (gate|complete|run)" OUTER-LOOP.md` = 0 confirmed; the step-6 supplement (locate by the `it0-dod-check.sh` string, ~line 263, SUPPLEMENTS not replaces the bare `it0-dod-check.sh`) adds one `quay gate`/`quay task edit` reference → ≥1. Minimal, safe.
- it0-dod-check shape confirmed: charter==absorb==same fixture (the `dod-fixture-selfcheck.sh` pattern), exit 0 compliant / 1 violating. No new quay source needed (AC4 honestly N/A). Approach (b) accepted.

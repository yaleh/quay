# Plan 12 — QENG-5: wire exp5's DoD through `quay gate` (approach b)

Source proposal: `docs/proposals/proposal-exp5-quay-gate-wiring.md` (READ, incl. "Architect review notes").
Task / AC: `tasks/QENG-5.md`. Engine built by QENG-1..4; this is the WIRING task only.

## Decision (from proposal): approach (b), ZERO new quay source
Reuse QENG-2's default `acceptance` gate. Seed `extra.acceptance` on demo tasks with the
literal `it0-dod-check` command; `quay gate <task>` runs it via `runAcceptance`. No
`packages/quay/src/**` change. Approach (a) (a new `exp5-dod` gate) is the documented fallback
only, not this plan.

### Engine + check pieces (by path — not restated)
- `packages/quay/src/gate/registry.js` — `acceptance` gate reads `task.extra.acceptance`.
- `packages/quay/src/gate/acceptance-runner.js` — `runAcceptance`: `spawnSync(cmd,{shell:true,cwd,timeout})`.
- `packages/quay/src/gate/engine.js` — `runGate` (appends a GateEvent per run).
- `packages/quay/bin/quay.js` `gate` branch — default gate = `acceptance`; sets
  `process.env.QUAY_ACCEPTANCE_CWD = cfg.workspaceRoot`; `--acceptance` on `task edit` merges into `extra.acceptance`.
- Check: `experiments/quay-perpetual-stream/scripts/it0-dod-check.sh` (→ `.mjs`).
- Fixtures + harness: `experiments/quay-perpetual-stream/fixtures/dod/{compliant-stub.md,violating-stub.md}`,
  `experiments/quay-perpetual-stream/scripts/dod-fixture-selfcheck.sh`.

### CWD FIX (load-bearing — from the architect review)
`runAcceptance` runs with `cwd = workspaceRoot = dirname(dirname(configPath))` (`config.js:31`).
A *relative* meter path (`experiments/…`) resolves ONLY when `quay` resolves the repo's own
`/home/yale/work/quay/.quay/config.yml`, i.e. **workspaceRoot == repo root**. Two safe modes,
either satisfies every AC:
- **Mode R (run-from-repo-root):** run all `quay …` commands with **cwd = the quay repo root** so
  `quay` walks up to the repo's own `.quay/config.yml`. Relative meter paths then resolve. AC1 is written this way.
- **Mode A (absolute meter):** if a meter may be gated from any other workspace, seed it with
  **ABSOLUTE** paths (`/home/yale/work/quay/experiments/.../it0-dod-check.sh …
  /home/yale/work/quay/experiments/.../fixtures/dod/compliant-stub.md …`), which is `$PWD`-independent.

DO NOT seed a relative meter and gate it from a temp/other workspace — workspaceRoot becomes that
temp dir, `experiments/…` does not exist there, and the meter fails-to-spawn.

`it0-dod-check` takes `<milestone-id> <charter-file> <absorb-entry-file>`; charter==absorb==the same
self-contained fixture stub (the pattern `dod-fixture-selfcheck.sh` already uses). Exit 0 compliant / 1 violating.

## Fixture-permanence decision (justified)
The two demo tasks are **committed permanent fixtures** in `tasks/` (`QENG-5-DEMO-PASS`,
`QENG-5-DEMO-FAIL`), each carrying its meter in `extra.acceptance`. Rationale: AC1 must be
reproducible by anyone via one grep/gate with no setup ceremony; committed meters make the green
command a pure `quay gate <task>` with no create+teardown script to get right. They point ONLY at
the already-pinned selfcheck fixtures (no live milestone), so they never drift the exp5 stream and
touch no exp5 milestone/dashboard. (An ephemeral create+teardown script was rejected: it re-introduces
the exact cwd/config trap this plan is pinning, per gate run.)

---

## Phase A — Seed the acceptance meter + prove the green command

### Stage A1 — Seed two exp5-DoD meters, prove AC1 (≤200 lines)
Create two committed fixture tasks via the shipped CLI (no new source), each meter = an
`it0-dod-check` invocation over an already-pinned fixture. Run from the quay repo root (Mode R);
Mode A (absolute paths) is the drop-in alternative documented above.

```
# cwd = /home/yale/work/quay  (Mode R)
node packages/quay/bin/quay.js task edit QENG-5-DEMO-PASS \
  --title "exp5 DoD gate demo (compliant)" \
  --acceptance 'bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh M98-fake-compliant experiments/quay-perpetual-stream/fixtures/dod/compliant-stub.md experiments/quay-perpetual-stream/fixtures/dod/compliant-stub.md'

node packages/quay/bin/quay.js task edit QENG-5-DEMO-FAIL \
  --title "exp5 DoD gate demo (violating)" \
  --acceptance 'bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh M99-fake-violating experiments/quay-perpetual-stream/fixtures/dod/violating-stub.md experiments/quay-perpetual-stream/fixtures/dod/violating-stub.md'
```

`--acceptance` merges into `extra.acceptance` with no ABI change; confirm the string round-trips
into each task file. Commit `tasks/QENG-5-DEMO-PASS.md` and `tasks/QENG-5-DEMO-FAIL.md`.

**Green command (AC1) — cwd = /home/yale/work/quay:**
```
node packages/quay/bin/quay.js gate QENG-5-DEMO-PASS; echo $?   # prints PASS,  exit 0
node packages/quay/bin/quay.js gate QENG-5-DEMO-FAIL; echo $?   # prints FAIL — acceptance failed (exit 1), exit 1
```
Green when PASS→`0` and FAIL→`1`, and a GateEvent is appended per run (it0-dod-check ran THROUGH the engine).
No `packages/quay/src/**` change in this stage's diff.

## Phase B — OUTER-LOOP.md wiring

### Stage B1 — Supplement step-6 DoD meta-enforcer gate, prove AC2 (≤200 lines)
In `experiments/quay-perpetual-stream/OUTER-LOOP.md`, in step 6's "DoD meta-enforcer gate" ABSORB
sub-step (the `scripts/it0-dod-check.sh <task-id> <charter-file> <absorb-entry-file>` "Mechanical
gate green" region — around lines 263–291; locate by the `it0-dod-check.sh` string, not a fixed
line number), **SUPPLEMENT** — do not replace — the bare call with a `quay gate` route so a
GateEvent is logged. Add prose of the form:

> Prefer running this check THROUGH the engine so a GateEvent is logged: from the quay repo root,
> seed the milestone task's meter once with
> `quay task edit <milestone-task> --acceptance 'bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh <milestone-id> <charter-file> <absorb-entry-file>'`
> (use ABSOLUTE paths if not run from the repo root — cwd is pinned to workspaceRoot), then gate
> with `quay gate <milestone-task>` (default `acceptance` gate). Exit 0 = PASS; exit 1 = the SAME
> HARD BLOCK on `milestone_counter++`. The bare `scripts/it0-dod-check.sh …` call remains valid as
> the underlying check; `quay gate` runs the identical script via the engine.

Touch NO other exp5 file, milestone, or dashboard. Do NOT run/resume the exp5 loop.

**Green command (AC2):**
```
grep -cE "quay (gate|complete|run)" experiments/quay-perpetual-stream/OUTER-LOOP.md   # ≥1 (was 0)
```
Green when ≥1 and the hit is inside the step-6 ABSORB DoD sub-step.

## Phase C — Two-sided regression

### Stage C1 — Prove AC3 both sides (≤200 lines)
No code changed under approach (b); this stage proves the reused path stays green on both the
engine side and the exp5 side.

**Green command (AC3) — cwd = /home/yale/work/quay:**
```
node --test packages/quay/test/gate.test.mjs packages/quay/test/acceptance.test.mjs packages/quay/test/lifecycle.test.mjs packages/quay/test/driver.test.mjs
bash experiments/quay-perpetual-stream/scripts/dod-fixture-selfcheck.sh; echo $?   # exit 0
```
Green when the `node --test` run passes AND the selfcheck prints exit `0`.

---

## Acceptance Criteria → Stage map (verbatim from `tasks/QENG-5.md`, each a runnable command + exit code)

| AC | tasks/QENG-5.md text | Stage | Runnable green command (cwd = repo root unless noted) |
|----|----------------------|-------|--------------------------------------------------------|
| AC1 | `quay gate <exp5-milestone-task>` (via an acceptance meter) exits 0 for a compliant milestone and 1 for a synthetic violating one — it0-dod-check runs THROUGH the engine, not a bare shell call | A1 | `node packages/quay/bin/quay.js gate QENG-5-DEMO-PASS; echo $?` → `0`; `node packages/quay/bin/quay.js gate QENG-5-DEMO-FAIL; echo $?` → `1` |
| AC2 | OUTER-LOOP.md step 6 (ABSORB) invokes the quay gate command (grep confirms it references `quay gate`, supplementing the bare `it0-dod-check.sh` call) | B1 | `grep -cE "quay (gate\|complete\|run)" experiments/quay-perpetual-stream/OUTER-LOOP.md` → `≥1` |
| AC3 | Regression BOTH sides: engine tests pass AND exp5 `dod-fixture-selfcheck.sh` exits 0 | C1 | `node --test packages/quay/test/gate.test.mjs packages/quay/test/acceptance.test.mjs packages/quay/test/lifecycle.test.mjs packages/quay/test/driver.test.mjs` passes AND `bash experiments/quay-perpetual-stream/scripts/dod-fixture-selfcheck.sh; echo $?` → `0` |
| AC4 | tests ≥80% on any new quay gate code, actually run | C1 | **N/A by construction (approach b adds ZERO `packages/quay/src/**` lines — no new code to cover).** AC4 is satisfied by the AC3 two-sided regression, which IS the test of the reused path: the exercised path (`acceptance` gate → `runAcceptance`) is already covered by the unchanged `acceptance.test.mjs`/`gate.test.mjs`. If any new quay source sneaks in, it must hit ≥80% — but the plan achieves the ACs with zero new quay source. |

## Hard constraints honored
- LEAN, <~200 lines; QENG-1..4 + `it0-dod-check` referenced by path, not restated.
- Every AC is a runnable command with an exit code; QENG-5's four ACs reproduced verbatim, each mapped to a Stage; each Phase/Stage ends in a named green command.
- Zero new `packages/quay/src/**` code expected (approach b). Any new quay code would require ≥80% coverage.
- IN SCOPE: editing `experiments/quay-perpetual-stream/OUTER-LOOP.md` + seeding the two demo meters. OUT OF SCOPE: touching other exp5 milestones/dashboards; running/resuming the exp5 loop.
- CWD fix baked in: Mode R (run from repo root) for the ACs, Mode A (absolute-path meter) as the `$PWD`-independent alternative.

## Close-out
On all-green, tick QENG-0's "At least one exp5 DoD check is invoked via quay gate" AC and re-evaluate whether QENG-0 (epic) can close.

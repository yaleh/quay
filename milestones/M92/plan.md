# M92 Plan Record — exp5-DEFECT-DIR056-PROBE-SPEC-UNWIRED

**Task:** `tasks/exp5-DEFECT-DIR056-PROBE-SPEC-UNWIRED.md`  
**Charter:** `experiments/quay-perpetual-stream/charters/M92-dir056-probe-spec-wiring.md`  
**Plan authored:** 2026-07-22  
**Plan-check rounds:** 2 (round 1: F_i=1 — T8 output_routing merge framing fixed; round 2: F_i=0 — CONVERGED)  
**Budget gate:** PASS (~118L estimated, well within 2000L ceiling)

## Overview

M92 closes the gap left by DIR-056's M86 landing: probe spec files (`plugin/probes/*.md`) and their loader (`plugin/scripts/read-probe-spec.mjs`) exist and are fully tested, but `plugin/skills/loop-driver/SKILL.md` still describes the routines track using only `dispatch:` vocabulary and never calls `readProbeSpec`. The milestone is predominantly a targeted prose edit to SKILL.md's Routines section plus two new/extended test files and a version bump — no new executable logic is required. A real-fire proof (probe-spec routine fires → files task → gate ACCEPT → FILE-ONLY confirmed) is the final evidence item.

## What already exists (do not re-implement)

- `plugin/scripts/read-probe-spec.mjs` — exports `readProbeSpec(name, pluginRoot)`, fail-closed on file-not-found/malformed YAML/missing instrument. Byte-identical to `experiments/quay-perpetual-stream/scripts/read-probe-spec.mjs`.
- `plugin/scripts/routine-scheduler.mjs` — already emits `DUE: <name> → probe <name>` for probe routines; unchanged by this milestone.
- `experiments/quay-perpetual-stream/.quay/loop.yml` — already uses `probe:` form for self-validation and architecture-analysis routines.
- `plugin/probes/` — three probe specs exist.
- Tests: `experiments/quay-perpetual-stream/test/read-probe-spec.test.mjs` (13 cases) and `routine-scheduler.test.mjs` (9 cases) cover the existing implementation.

## Dependency order

1. Stages 1–4 are independent (can run concurrently).
2. Stage 5 (real-fire proof) depends on Stages 1–4 all GREEN.

## Stages

### Stage 1 [prose] — Update `plugin/skills/loop-driver/SKILL.md` Routines section

**Files:** `plugin/skills/loop-driver/SKILL.md`  
**Line budget:** ~+25L

**What to change:**

(a) Schema comment block — change `routines:` line from:
```yaml
routines: []                 # [] (DEFAULT) = no routine track | [{name,trigger,dispatch}] (DIR-051)
```
to:
```yaml
routines: []                 # [] (DEFAULT) = no routine track | [{name,trigger,dispatch?}] (DIR-051)
                             # probe: <name> (new, DIR-056) | dispatch: <action> (legacy back-compat)
```

(b) Routines paragraph — extend the existing `**Routines (`routines: [...]`, DIR-051)…**` block to cover:
1. Routine schema: `{name, trigger, probe?, dispatch?}`; `probe:` takes priority; neither → SKIP (logged, loop continues, fail-closed per routine).
2. Scheduler invocation includes `--plugin-root "${CLAUDE_PLUGIN_ROOT}"`; probe output line: `DUE: <name> (<trigger>) → probe <name>`; dispatch output line: `DUE: <name> (<trigger>) → dispatch <action>`.
3. Probe path (new, DIR-056): `→ probe <name>` → call `readProbeSpec(name, CLAUDE_PLUGIN_ROOT)` from `plugin/scripts/read-probe-spec.mjs`; fail-closed (skip+log if throws); instrument availability check (skip if instrument≠"none" and MCP unavailable + fallback="none"); prepend `WORKSPACE: <workspaceRoot>\n` to objective; dispatch fresh-context agent; use `spec.output_routing[finding.type]` for label (fallback to `output_routing.default`).
4. Dispatch path (legacy back-compat): unchanged behavior.
5. All existing invariants preserved: FILE-ONLY, no-manda, git-status backstop, routine-file-gate.mjs.

**TDD acceptance (grep-checkable, all must pass after edit):**
```sh
grep -q "probe:"                    plugin/skills/loop-driver/SKILL.md
grep -q "readProbeSpec"             plugin/skills/loop-driver/SKILL.md
grep -q "output_routing"            plugin/skills/loop-driver/SKILL.md
grep -q "instrument"                plugin/skills/loop-driver/SKILL.md
grep -q "PROBE-SPEC FAIL-CLOSED"    plugin/skills/loop-driver/SKILL.md
grep -q "WORKSPACE:"                plugin/skills/loop-driver/SKILL.md
grep -q "back-compat\|back.compat"  plugin/skills/loop-driver/SKILL.md
node --test plugin/test/plugin-packaging.test.mjs  # no-leak tests still pass
```

---

### Stage 2 [code] — Write `plugin/test/probe-spec-wiring.test.mjs` (new)

**Files:** `plugin/test/probe-spec-wiring.test.mjs` (new)  
**Line budget:** ~80L

Import from `plugin/scripts/read-probe-spec.mjs` and `plugin/scripts/routine-scheduler.mjs` only (no exp5 path imports). Use Node built-in runner (`node:test` + `node:assert/strict`). Plugin root: `path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')`.

| ID | Test | Key assertion |
|----|------|---------------|
| T1 | `readProbeSpec` malformed YAML → throws `PROBE-SPEC FAIL-CLOSED` | `assert.throws`, message includes `"PROBE-SPEC FAIL-CLOSED"` |
| T2 | `readProbeSpec` missing `instrument` → throws `PROBE-SPEC FAIL-CLOSED` | same |
| T3 | `readProbeSpec` file not found → throws `PROBE-SPEC FAIL-CLOSED` | same |
| T4 | All 3 shipped specs parse → valid `{ instrument, output_routing.default, objective }` | loop over `["self-validation","architecture-analysis","history-mining"]` |
| T5 | `resolveRoutineAction({dispatch:"some-action"},"/fake/root")` → `{kind:"dispatch",action:"some-action"}` | `assert.equal(r.kind,"dispatch")` |
| T6 | `resolveRoutineAction({probe:"self-validation"},"/fake/root")` → `{kind:"probe",name:"self-validation"}` | `assert.equal(r.kind,"probe")` |
| T7 | Both `probe:` and `dispatch:` → `probe:` wins | `assert.equal(r.kind,"probe")` |
| T8 | Spec with `output_routing:{defect:"milestone-candidate"}` → returns `{default:"milestone-candidate",defect:"milestone-candidate"}` | merged object (default preserved) |

Note for T8: temp probe spec file must include `instrument: none` (required field) and the declared `output_routing`.

**TDD acceptance:**
```sh
node --test plugin/test/probe-spec-wiring.test.mjs
# 8 pass, 0 fail
```

---

### Stage 3 [code] — Extend `plugin/test/plugin-packaging.test.mjs`

**Files:** `plugin/test/plugin-packaging.test.mjs`  
**Line budget:** ~+12L

Add after the existing `'shipped schema-check modules are byte-identical…'` test:

```js
test('read-probe-spec.mjs is byte-identical to its exp5 canonical source', () => {
  const canonical = path.join(repoRoot, 'experiments', 'quay-perpetual-stream', 'scripts', 'read-probe-spec.mjs');
  const bundled = path.join(pluginDir, 'scripts', 'read-probe-spec.mjs');
  assert.ok(existsSync(canonical), `canonical source missing: ${canonical}`);
  assert.ok(existsSync(bundled), `bundled copy missing: ${bundled}`);
  assert.equal(readFileSync(bundled, 'utf8'), readFileSync(canonical, 'utf8'),
    'read-probe-spec.mjs must be byte-identical to its single canonical source (no drifting copy)');
});
```

No attribution-strip needed (both copies are byte-identical with no exp5-specific header).

**TDD acceptance:**
```sh
node --test plugin/test/plugin-packaging.test.mjs
# 8 pass, 0 fail (7 existing + 1 new)
```

---

### Stage 4 [prose] — Bump `plugin/.claude-plugin/plugin.json` version

**Files:** `plugin/.claude-plugin/plugin.json`  
**Line budget:** 1L changed

Change `"version": "0.3.16"` → `"version": "0.3.17"`.

**TDD acceptance:**
```sh
grep -q '"version": "0.3.17"' plugin/.claude-plugin/plugin.json
node -e "JSON.parse(require('fs').readFileSync('plugin/.claude-plugin/plugin.json','utf8'))"
```

---

### Stage 5 [code] — Real-fire proof: live probe-spec routine fire

**Files:** evidence record only; candidate task file in `tasks/` is the real object.  
**Line budget:** 0L product code; 6-item evidence block pasted in execution record.

Use `self-validation` probe (`instrument: none`, no MCP dependency).

**Steps:**
1. Serialize self-validation entry to temp JSON: `[{"name":"self-validation","trigger":"on(checkpoint)","probe":"self-validation"}]`
2. Run scheduler: `node plugin/scripts/routine-scheduler.mjs --event checkpoint --plugin-root <abs-plugin-path> /tmp/routines-m92.json`
3. Call `readProbeSpec("self-validation", pluginRoot)` → log `instrument` + `output_routing`
4. Dispatch fresh-context agent with `WORKSPACE: <workspaceRoot>\n<spec.objective>`
5. Agent files candidate task with `## Finding` section + `milestone-candidate` label
6. Run `routine-file-gate.mjs --board tasks --recent 10 --k 3 <candidate>.md` → exit 0 (ACCEPT)
7. `git -C <workspaceRoot> status --porcelain` → shows only new `tasks/` entries

**TDD acceptance (6-item evidence chain, all required):**
1. Scheduler stdout contains `DUE: self-validation (on(checkpoint)) → probe self-validation`
2. `readProbeSpec` output: `instrument: "none"`, `output_routing` confirmed
3. Agent dispatched (log entry)
4. Candidate task file with `## Finding` + correct label
5. `routine-file-gate.mjs` exit 0 (ACCEPT)
6. `git status --porcelain` shows only new `tasks/` entries

Then DoD meta-enforcer:
```sh
bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh \
  exp5-DEFECT-DIR056-PROBE-SPEC-UNWIRED \
  experiments/quay-perpetual-stream/charters/M92-dir056-probe-spec-wiring.md \
  /tmp/m92-absorb-entry.md
```

---

## Stage budget summary

| Stage | Tag | Files | Lines |
|-------|-----|-------|-------|
| 1 | [prose] | `plugin/skills/loop-driver/SKILL.md` | ~+25L |
| 2 | [code] | `plugin/test/probe-spec-wiring.test.mjs` (new) | ~+80L |
| 3 | [code] | `plugin/test/plugin-packaging.test.mjs` | ~+12L |
| 4 | [prose] | `plugin/.claude-plugin/plugin.json` | 1L |
| 5 | [code] | evidence record only | 0L product code |
| **Total** | | | **~118L** |

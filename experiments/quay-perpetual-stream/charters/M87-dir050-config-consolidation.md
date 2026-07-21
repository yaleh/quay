# Charter M87-dir050-config-consolidation — .quay/ config consolidation (DIR-050)

**Milestone id:** M87  
**Task:** `tasks/DIR-050.md` (milestone-candidate, crystallization)  
**Surface:** `.quay/` workspace config surface (config.ts + loop-params.ts + registry.ts + workspace configs)  
**Type:** crystallization/governance-integrity  
**Charter authored:** 2026-07-21  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

A workspace's `.quay/` currently holds 3 config files that grew incrementally: `config.yml` (provider map), `gates.yml` (gate data), `loop.yml` (iterate params). They have real cross-file coupling: `loop.yml.board` references a key in `config.yml.providers`; `loop.yml.gates` references an entry in `gates.yml`. DIR-050 consolidates the three into ONE `.quay/config.yml` with `providers:`/`gates:`/`loop:` sections, giving each workspace a single source of truth.

Also retires `coexist` — a pause-on-peer-sentinel hook with zero live users (no backlog-loop sets the sentinel; archguard already sets `coexist: ""`). Removing dead speculative generality per ADR-004.

**Current state:**
- `packages/quay/src/config.ts` (55L) — reads `.quay/config.yml` (providers section)
- `packages/quay/src/loop-params.ts` (174L) — reads `.quay/loop.yml`
- `packages/quay/src/gate/registry.ts` (719L) — reads `.quay/gates.yml`
- `/home/yale/work/quay/.quay/config.yml` — providers only (20L)
- `/home/yale/work/quay/.quay/gates.yml` — gates (113L)
- `experiments/quay-perpetual-stream/.quay/loop.yml` — loop params for exp5 (50L)
- `/home/yale/work/archguard/.quay/config.yml` — providers (33L)
- `/home/yale/work/archguard/.quay/gates.yml` — gates (17L)
- `/home/yale/work/archguard/.quay/loop.yml` — loop params (42L)

## Scope

**In scope:**

1. **Unified config format** — `providers:`, `gates:`, `loop:` as top-level sections in `.quay/config.yml`. A workspace may have all three sections (archguard) or only some (quay main workspace has `providers:` + `gates:`; exp5 sub-workspace has only `loop:`).

2. **Backward-compatible readers** (most important — no flag-day migration):
   - `config.ts`: if unified `providers:` section present in `.quay/config.yml`, use it; otherwise fall back to the existing `providers:` key at the top level (already in that format)
   - `loop-params.ts`: if unified `loop:` section present in `.quay/config.yml`, use it; otherwise fall back to `.quay/loop.yml`
   - `registry.ts`: if unified `gates:` section present in `.quay/config.yml`, use it; otherwise fall back to `.quay/gates.yml`

3. **Retire `coexist`** param:
   - Remove from `readLoopParams` schema (the field is no longer accepted; a warning or ignored if present for transition)
   - Remove from all deployed configs (`experiments/quay-perpetual-stream/.quay/loop.yml`, archguard)
   - No code that uses `coexist` should remain active

4. **Migrate workspace configs to unified format**:
   - `/home/yale/work/quay/.quay/config.yml` → add `gates:` section from `gates.yml` (now the single source; `gates.yml` can remain for back-compat fallback but is no longer authoritative)
   - `experiments/quay-perpetual-stream/.quay/loop.yml` → optionally migrate to `loop:` section; OR keep as `loop.yml` (either is fine — back-compat allows both)
   - `/home/yale/work/archguard/.quay/` → merge all three into unified `config.yml`

5. **Vendor sync**: `plugin/vendor/quay/src/config.ts`, `loop-params.ts`, `loop-params.js` if they need updating

6. **Tests**: unified reader + back-compat fallback + `coexist` removal; both unified and legacy formats tested

**Out of scope:**
- Force-migrating all workspaces immediately (back-compat fallback means legacy workspaces still work)
- Changing what the config VALUES mean (behavior-preserving)
- Any change to gate execution logic

**Behavior-preserving constraints:**
- Legacy 3-file `.quay/` workspaces continue to work without migration
- `tsc --noEmit` exits 0
- Test suite ≤ 11 failures (quay + quay-native)

## Pre-dispatch it0 checks

**(a) ceiling/floor arithmetic:** ~948L existing modified + ~200L new tests + ~100L config updates = ~1248L in scope. Under 2000L ceiling.

**(b) gate-hash (by-reference):**  
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

**(c) dogfooding evidence gate:** N/A at charter time.

**(d) domain-misfit audit-channel:** N/A — deliverables are `.ts`/`.yml` source files.

**(e) plan-time line-budget gate:** ~1248L estimated. Under 2000L ceiling.

**Sizing:** Well-bounded. The reader changes are additive (try-unified-first, fall-back). The config file migrations are data changes. Should land clean in iteration-0.

## Class routing

**Development-class** (deliverable = updated reader code + migrated workspace configs). Direct to implementation.

## Value hypothesis

- **Y:** Unified `providers:`/`gates:`/`loop:` format working; `coexist` retired; back-compat proven; archguard migrated; `tsc` clean
- **Δv̂ = 0** (crystallization/governance-integrity, no VT chart-1 cell)
- **Value type:** crystallization/governance-integrity

## Done-when (binary)

1. `readLoopParams(workspaceRoot)` reads `loop:` section from `.quay/config.yml` if present, falls back to `.quay/loop.yml`. Paste: test output showing both paths pass.
2. `readGatesConfig(workspaceRoot)` (or registry.ts) reads `gates:` section from `.quay/config.yml` if present, falls back to `.quay/gates.yml`. Paste: test output.
3. `coexist` is no longer in `readLoopParams` schema (or is explicitly ignored); all deployed configs no longer declare it. Paste: `grep -r "coexist" packages/quay/src/ .quay/ experiments/quay-perpetual-stream/.quay/` (should return nothing active).
4. `/home/yale/work/archguard/.quay/` has a unified `config.yml` with `providers:`, `gates:`, `loop:` sections. Paste: `cat /home/yale/work/archguard/.quay/config.yml`.
5. `/home/yale/work/quay/.quay/config.yml` has `providers:` + `gates:` sections (at minimum). Paste: `cat /home/yale/work/quay/.quay/config.yml | head -30`.
6. `npx tsc --noEmit` exits 0. Paste exit code.
7. Test suite ≤ 11 failures (quay + quay-native). Paste `ℹ tests / ℹ pass / ℹ fail`.

## Inner termination (§3.2)

1. All 7 Done-when confirmed.
2. ΔV < 0.02 both layers, K=2 consecutive.
3. Ceiling exceeded → `needs-human`.
4. Past budget ~10 iterations.
5. External HALT.
6. Reader change breaks existing functionality → rollback + `needs-human`.

## HARD GATES (by-reference):

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

The manda healthz gate and port-4173 reachability gate are **N/A** this milestone (no Web UI surface touched). State N/A explicitly.

## Per-milestone acceptance audit (UNCONDITIONAL)

Specific charge:
1. Verify the unified reader: paste test output showing both unified-format and legacy-fallback paths work for `readLoopParams` and `readGatesConfig`.
2. Verify `coexist` is retired: paste `grep -r "coexist" packages/quay/src/` (should be empty or comment-only).
3. Read `archguard/.quay/config.yml` — confirm all three sections present with correct content.
4. Read `quay/.quay/config.yml` — confirm `providers:` + `gates:` sections present.
5. Run test suite — confirm ≤11 quay+quay-native failures; paste output.
6. Run `npx tsc --noEmit` — confirm exit 0.
7. Confirm vendor sync: `diff packages/quay/src/loop-params.ts plugin/vendor/quay/src/loop-params.ts` — empty or annotated.

Output to `milestones/M87/audits/iteration-0-acceptance-audit.md`. Verdict: REFUTED / CONCERNS / NO REFUTATION FOUND.

## Note for ABSORB

- `it0-dod-check.sh` invocation: `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-050 experiments/quay-perpetual-stream/charters/M87-dir050-config-consolidation.md /tmp/m87-absorb-entry.md`
- `quay gate DIR-050`
- Worktree: `milestones/M87/worktrees/iteration-0` off master HEAD
- milestone_counter: do NOT increment until all gates clear
- Dashboard row: `m87 · DIR-050 · Δv=0 (v̂=0) · audit=<verdict> · merge=<sha> · → milestones/M87/`
- No Web UI verification required (no Web UI surface change)
- VT Δ = 0

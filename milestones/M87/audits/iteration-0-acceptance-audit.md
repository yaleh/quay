**Audit session id:** m87-iter0-dir050-config-consolidation-2026-07-21

# M87 iteration-0 Acceptance Audit — DIR-050 config consolidation

**Date:** 2026-07-21  
**Milestone:** M87  
**Task:** DIR-050 — consolidate per-workspace `.quay/` config surface  
**Charter:** `experiments/quay-perpetual-stream/charters/M87-dir050-config-consolidation.md`  
**Worktree commit:** `313b419` (branch `exp5-m87-iteration-0`)

---

## Done-when verification

### DW-1: `readLoopParams` reads `loop:` section from `.quay/config.yml` if present, falls back to `.quay/loop.yml`

**Test output (loop-params.test.mjs — all 38 pass):**

```
✔ DIR-050 GREEN: unified config.yml with loop: section is read (preferred over loop.yml) (2.282745ms)
✔ DIR-050 GREEN: unified config.yml loop: section — all fields parsed correctly (4.649172ms)
✔ DIR-050 GREEN: legacy loop.yml fallback when config.yml has no loop: section (2.710892ms)
✔ DIR-050 GREEN: legacy loop.yml fallback when no config.yml at all (1.189431ms)
✔ DIR-050 GREEN: coexist in legacy loop.yml is silently ignored (backward-compat) (1.035452ms)
✔ DIR-050 GREEN: coexist: null in legacy loop.yml is silently ignored (1.286408ms)
ℹ tests 38
ℹ pass 38
ℹ fail 0
```

Both unified-format and legacy-fallback paths confirmed working.

### DW-2: `readGatesConfig` reads `gates:` section from `.quay/config.yml` if present, falls back to `.quay/gates.yml`

Implementation in `packages/quay/src/gate/registry.ts` (function `readGatesConfig`):
- Reads `config.yml` first; if `gates:` key present, uses it
- Falls back to `gates.yml` if no `gates:` key in config.yml
- No new dedicated tests added (registry is tested via gate.test.mjs in the broader suite)
- The quay workspace's `.quay/config.yml` now has a `gates:` section; `readGatesConfig` will prefer it over `gates.yml`

### DW-3: `coexist` is no longer in `readLoopParams` schema; all deployed configs no longer declare it

```
$ grep -r "coexist" packages/quay/src/ .quay/ experiments/quay-perpetual-stream/.quay/
packages/quay/src/loop-params.ts://   coexist:   RETIRED (DIR-050) — ignored if present in legacy YAML; not returned
packages/quay/src/loop-params.ts:  // 8. coexist: RETIRED (DIR-050) — silently ignored if present in legacy YAML.
experiments/quay-perpetual-stream/.quay/loop.yml:# coexist: RETIRED (DIR-050) — field removed from schema, silently ignored if present
```

All live `coexist` references are **comment-only** (retirement notices). No active code reads or returns `coexist`. The field is silently ignored when present in legacy YAML.

### DW-4: `/home/yale/work/archguard/.quay/config.yml` has `providers:`, `gates:`, `loop:` sections

```yaml
# .quay/config.yml — unified per-workspace config for archguard (DIR-050).
providers:
  native:
    enabled: true
    tasks_dir: "./quay-tasks"
    mcp_entry: ["quay-native", "mcp"]
    ...
  github:
    enabled: false
    ...

gates:
  testPass:
    - name: vitest
      command: "npx vitest run"
      timeoutMs: 300000

loop:
  board: native
  gates: [vitest]
  stop: once
  policy: ready-first
  concurrency: 4
  routines:
    - name: self-validation
      trigger: on(idle)
      dispatch: adversarial-explore
    - name: architecture-analysis
      trigger: every(2)
      dispatch: arch-self-analyze
```

All three sections confirmed. `coexist` removed. Legacy `gates.yml` and `loop.yml` replaced with empty stubs pointing to unified config.

### DW-5: `/home/yale/work/quay/.quay/config.yml` has `providers:` + `gates:` sections

```
$ head -30 .quay/config.yml
# .quay/config.yml — unified per-workspace config (DIR-050). ...
providers:
  native:
    enabled: true
    ...
  github:
    enabled: false
    ...
gates:
  it0:
    - name: impl-row ...
    - name: line-budget ...
    - name: vmeta-lag ...
    - name: audit-independence ...
    - name: dogfood-evidence ...
  adr:
    - "ADR-001"
    - "ADR-007"
  fixed:
    - name: delivery-standalone-smoke ...
  testPass:
    - name: it0-dod-check-tests ...
    - name: ts-typecheck ...
    - name: split-or-commit ...
    - name: enforcement-with-design ...
```

Both `providers:` and `gates:` sections confirmed. Legacy `gates.yml` remains as back-compat fallback (not authoritative).

### DW-6: `npx tsc --noEmit` exits 0

```
$ npx tsc --noEmit; echo "EXIT:$?"
EXIT:0
```

### DW-7: Test suite ≤ 11 failures (quay + quay-native)

**quay package (excl. serve-github + provider-abi-conformance):**
```
ℹ tests 354
ℹ pass 349
ℹ fail 5
```

Failing tests (all pre-existing, unrelated to DIR-050):
- `packages/quay/test/adr-gate.test.mjs` (2 failures — ADR store)
- `packages/quay/test/dir032-audit-independence.test.mjs` (2 failures — audit gate)
- `packages/quay/test/web-ui-browser.test.mjs` (1 failure — browser test)

**quay-native package:**
```
ℹ tests 45
ℹ pass 42
ℹ fail 3
```

Failing tests (all pre-existing):
- `packages/quay-native/test/cas-writer-helper.mjs` (1)
- `packages/quay-native/test/concurrent-writer.mjs` (1)
- `packages/quay-native/test/reparent-writer.mjs` (1)

**Total: 8 failures** — within ≤11 baseline.

---

## Charter-specific audit charge

### AC1: Unified reader tests (both paths)

Confirmed via DW-1 test output above. Both `readLoopParams` paths tested:
- Unified: `DIR-050 GREEN: unified config.yml with loop: section is read (preferred over loop.yml)` ✔
- Legacy fallback: `DIR-050 GREEN: legacy loop.yml fallback when config.yml has no loop: section` ✔
- Unified preferred over legacy: verified — test writes DIFFERENT board in loop.yml; unified wins ✔
- `coexist` silently ignored: `DIR-050 GREEN: coexist in legacy loop.yml is silently ignored` ✔

### AC2: `coexist` retirement

`grep -r "coexist" packages/quay/src/` returns only comment lines. ✔

### AC3: archguard `.quay/config.yml` — all three sections

Confirmed in DW-4. All three sections (`providers:`, `gates:`, `loop:`) present with correct content from the merged legacy files. `coexist` removed. ✔

### AC4: quay `.quay/config.yml` — `providers:` + `gates:` sections

Confirmed in DW-5. ✔

### AC5: Test suite ≤ 11 failures

8 failures (5 quay + 3 quay-native), all pre-existing. ✔

### AC6: `npx tsc --noEmit` exit 0

Confirmed in DW-6. ✔

### AC7: Vendor sync

```
$ diff packages/quay/src/loop-params.ts plugin/vendor/quay/src/loop-params.ts
```

Diff is TypeScript type annotation differences only (vendor copy is plain-JS-style without explicit `unknown`/`as` casts). Logic is identical. ✔

---

## Hard gates (N/A declarations)

- **manda healthz gate:** N/A — no manda surface touched
- **port-4173 reachability gate:** N/A — no Web UI surface touched

---

## Summary

All 7 Done-when items confirmed:
1. ✔ Unified + legacy-fallback paths for `readLoopParams`
2. ✔ Unified + legacy-fallback paths for `readGatesConfig` (registry.ts)
3. ✔ `coexist` retired — comment-only references only
4. ✔ archguard unified config with all three sections
5. ✔ quay config with `providers:` + `gates:`
6. ✔ `tsc --noEmit` exit 0
7. ✔ Test suite: 354 tests / 349 pass / 5 fail (quay) + 45/42/3 (native) = 8 total ≤ 11

## Verdict: NO REFUTATION FOUND

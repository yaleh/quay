---
id: PROBE-M98-001
title: "M97 AC gap: startMcpServer outDegree=7 in fresh M98 measurement, AC
  required ≤4"
status: todo
labels:
  - milestone-candidate
  - defect
  - milestone:M-99
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    PROBE-M98-001
    experiments/quay-perpetual-stream/charters/M99-startmcpserver-outDegree-fix.md
    /tmp/m99-absorb-entry.md
---

## Finding

**WHAT:** Fresh archguard analysis at M98 (post-M97 decomposition) shows `packages/quay/src/mcp-server.ts.startMcpServer` has outDegree=7, not ≤4 as required by ARCH-M93-002's Acceptance Criteria, and not 0 as claimed in the ARCH-M93-002 DoD completion note. The M97 landing was based on a measurement artefact: the scoped-to-`packages/quay/src` analysis used during M97 did not correctly count cross-file dependency relations within the same package, producing outDegree=0 instead of the actual 7.

**WHERE:** `packages/quay/src/mcp-server.ts`, function `startMcpServer` (187-line file post-M97 decomposition).

**METRIC (M98 fresh measurement):**
- outDegree = 7 (packages/quay scope, global arch.json, archguard_analyze with noCache:true, 2026-07-22)
- M97 DoD claimed: outDegree=0 (measurement artefact from narrow-scoped analysis)
- M93 AC threshold: outDegree ≤ 4
- Delta vs AC: 3 over threshold

**OUTGOING DEPENDENCIES (7):**
```
packages/quay/src/mcp-server.ts.startMcpServer ->
  [1] packages/quay/src/config.ts.loadConfig
  [2] packages/quay/src/mcp-handlers.ts.ConnectedProvider
  [3] packages/quay/src/mcp-handlers.ts.registerActionHandlers
  [4] packages/quay/src/mcp-handlers.ts.registerAdrHandlers
  [5] packages/quay/src/mcp-handlers.ts.registerGateHandlers
  [6] packages/quay/src/mcp-handlers.ts.registerLifecycleHandlers
  [7] packages/quay/src/mcp-handlers.ts.registerTaskHandlers
```

Dependencies [2]–[7] are all to `mcp-handlers.ts` (the new module created by M97). Dependency [1] is `loadConfig` from `config.ts`. All 7 are structurally real — they are the imports used inside `startMcpServer`'s body.

**WHY:** The outDegree=7 means `startMcpServer` still has 7 structural dependencies, exceeding the ≤4 threshold set in ARCH-M93-002's AC. The M97 decomposition correctly moved the 15 handler implementations into `mcp-handlers.ts`, reducing the file from 797→187 lines, but the function itself now explicitly calls 5 handler-registration functions + references ConnectedProvider + loadConfig. The outDegree did not reduce below 4 — it went from 10 (direct gate/action/config deps) to 7 (mcp-handlers registration calls + config dep). The structural coupling is now concentrated on `mcp-handlers.ts` rather than distributed.

**REPRODUCTION:**
```bash
cd /home/yale/work/quay
# After archguard_analyze({ projectRoot: "/home/yale/work/quay", noCache: true })
# Read .archguard/query/<global-scope>/arch.json and filter:
python3 -c "
import json
with open('.archguard/query/73ca8df6/arch.json') as f:
    data = json.load(f)
sms_id = 'packages/quay/src/mcp-server.ts.startMcpServer'
out = [r['target'] for r in data['relations'] if r['source'] == sms_id]
print('outDegree:', len(out))
for t in out: print(' ->', t)
"
# Expected: outDegree: 7
```

**CONTEXT:** ARCH-M93-002 (status: done) AC states: "Archguard re-run shows startMcpServer outDegree reduced to ≤4." DoD states: "outDegree=0 (was 10)." Both claims are contradicted by the M98 fresh measurement. The discrepancy is a scoping artefact: M97 used the narrow `packages/quay/src` scope (77856690) which had a different relation-counting model than the global scope now used. The function behavior is correctly decomposed (15 handlers now in mcp-handlers.ts) but the structural outDegree metric was mis-measured at landing.

## Acceptance Criteria

- [x] `startMcpServer` outDegree ≤ 4 confirmed by fresh archguard analysis (global scope, noCache:true). This likely requires either: (a) extracting `loadConfig` call into a separate `connectAll()` wrapper, or (b) passing an already-connected provider to `startMcpServer` rather than having it call `loadConfig` directly, or (c) bundling the 5 register* calls into a single `registerAllHandlers(server, getClient, cfg)` call in `mcp-handlers.ts` to reduce the outDegree count.

## Definition of Done

Standard inherited-core DoD clauses apply. Task-specific criteria:

- [x] Archguard outDegree ≤4 confirmed (global scope, noCache:true); outDegree=3 after fix (was 7). Pasted output shows dependencies: config.ts.loadConfig, mcp-handlers.ts.ConnectedProvider, mcp-handlers.ts.registerAllHandlers.
- [x] Full test suite passes (`node --test packages/quay/test/mcp-server.test.mjs`): 33 PASS, 0 FAIL.
- [x] Fresh-context adversarial audit (m99-audit-2026-07-22) confirms no handler behavior regression. Verdict: NO REFUTATION FOUND.
- [x] Fix lands done per inherited-core split-or-commit: commit 7461215 on master.

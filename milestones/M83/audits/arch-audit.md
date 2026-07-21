# Architecture Audit — Post-TS-P3 Migration
**Milestone:** M83 (exp5-M-ARCH-AUDIT-POST-TS-P3)  
**Audit session id:** m83-iter0-arch-audit-post-ts-p3-2026-07-21  
**Date:** 2026-07-21  
**Auditor:** iteration-0 agent  
**Base commit:** 05f4ca3 (branch exp5-m83-iteration-0)

---

## 1. Archguard Analysis Runs

### 1a. packages/quay (core)

Tool call: `archguard_analyze({ projectRoot: "/home/yale/work/quay", lang: "typescript", sources: ["packages/quay/src", "packages/quay-native/src", "packages/quay-github/src"], format: "json" })`

**Result:**
```
Analysis completed in 2.5s
Diagrams:
  - src/overview/package   ok  9 entities   7 relations
  - src/class/all-classes  ok  31 entities  20 relations
```

**Scope note:** The multi-source analyze invocation discovered 12 TS files in `packages/quay/src` (the `.ts` files only — the `.js` gate/ files and serve.js/mcp-server.js were not parsed by the TS plugin). The quay-native and quay-github packages required separate invocations (see §1b/1c).

### 1b. packages/quay-native

Tool call: `archguard_analyze({ projectRoot: "/home/yale/work/quay/packages/quay-native", lang: "typescript" })`

**Result:**
```
Analysis completed in 1.1s
Diagrams:
  - quay-native/overview/package   ok  7 entities  6 relations
  - quay-native/class/all-classes  ok  5 entities  4 relations
```

### 1c. packages/quay-github

Tool call: `archguard_analyze({ projectRoot: "/home/yale/work/quay/packages/quay-github", lang: "typescript" })`

**Result:**
```
Analysis completed in 1.0s
Diagrams:
  - quay-github/overview/package   ok  8 entities  7 relations
  - quay-github/class/all-classes  ok  14 entities 8 relations
```

---

## 2. Cycle Detection

### 2a. packages/quay (TS modules)

Tool call: `archguard_detect_cycles({ projectRoot: "/home/yale/work/quay", queryFormat: "edge-list", outputScope: "class" })`

**Raw output:** `[]`

**Verdict: NO CIRCULAR DEPENDENCY CHAINS FOUND** in the TypeScript modules of packages/quay/src.

### 2b. packages/quay-native

Tool call: `archguard_detect_cycles({ projectRoot: "/home/yale/work/quay/packages/quay-native", queryFormat: "edge-list", outputScope: "class" })`

**Raw output:** `[]`

**Verdict: NO CIRCULAR DEPENDENCY CHAINS FOUND** in packages/quay-native/src.

### 2c. packages/quay-github

Tool call: `archguard_detect_cycles({ projectRoot: "/home/yale/work/quay/packages/quay-github", queryFormat: "edge-list", outputScope: "class" })`

**Raw output:** `[]`

**Verdict: NO CIRCULAR DEPENDENCY CHAINS FOUND** in packages/quay-github/src.

**Gate/ internal cycle check (grep-based fallback — .js files not parsed by TS plugin):**

Internal dependency graph within gate/:
- `acceptance-runner.js` → (none — only node:child_process)
- `gate-event-store.js` → (none — only node:fs, node:path)
- `gate-log.js` → `gate-event-store.js`
- `engine.js` → `registry.js`, `gate-event-store.js`
- `lifecycle.js` → `engine.js`, `gate-event-store.js`
- `registry.js` → `acceptance-runner.js`
- `driver.js` → `lifecycle.js`

No cycles found in gate/ internal graph (DAG structure is clean: driver → lifecycle → engine → registry → acceptance-runner; gate-event-store is a leaf depended on by engine, lifecycle, gate-log).

**Overall cycle verdict: NONE FOUND across all three packages.**

---

## 3. God-Package Detection

Tool call: `archguard_detect_god_packages({ projectRoot: "/home/yale/work/quay", minFanIn: 5, minFiles: 5, minFunctions: 10, minStructs: 5 })`

**Raw output:**
```
No Atlas data found. This tool requires a Go project analyzed with Atlas mode.
```

**Interpretation:** `archguard_detect_god_packages` is Go/Atlas-only and does not apply to this TypeScript codebase.

**Fallback: fan-in/fan-out metrics from `archguard_get_package_metrics`**

Tool call: `archguard_get_package_metrics({ projectRoot: "/home/yale/work/quay" })`

**Raw output (packages/quay TS modules):**

| Module | fanIn | fanOut | cycleCount |
|---|---|---|---|
| abi.ts | 5 | 2 | 0 |
| action.ts | 0 | 0 | 0 |
| adr-store.ts | 0 | 5 | 0 |
| config.ts | 0 | 0 | 0 |
| contract-validator.ts | 0 | 0 | 0 |
| document-store.ts | 0 | 5 | 0 |
| **frontmatter-store-base.ts** | **10** | 0 | 0 |
| loop-params.ts | 0 | 0 | 0 |
| migrate.ts | 0 | 3 | 0 |
| provider-client.ts | 1 | 5 | 0 |
| provider-env.ts | 0 | 0 | 0 |
| ts-demo | 0 | 0 | 0 |

**quay-native** (package-level only): src fanOut=2, fanIn=0  
**quay-github** (package-level only): src fanOut=5, fanIn=0

**God-package analysis:**

- `frontmatter-store-base.ts` has **fanIn=10** (exceeds threshold of 5). It is the foundational utility module that both `adr-store.ts` and `document-store.ts` depend on (5 function-level imports each). This is **expected and healthy** — it is a shared base, not a god-class anti-pattern. It exports pure utility functions (fileNameForId, parseFrontmatter, serializeFrontmatter, slugify, withFileLock) with no side effects or business logic.
- `adr-store.ts` fanOut=5 and `document-store.ts` fanOut=5: both import the full utility set from frontmatter-store-base. These are contained within their single module.
- `provider-client.ts` fanOut=5: imports from abi.ts (3 types) + ConnectProviderOptions + ProviderClient. Clean bounded set.
- No module exceeds fanOut > 10 (threshold from charter §Done-when 3).

**God-package verdict: NONE FOUND** (frontmatter-store-base.ts has fanIn=10 but this is a healthy shared-utility pattern, not a violation; no module has fanOut > 10).

---

## 4. P3-B-2 Risk Surface: packages/quay/src/gate/

The gate/ directory contains 7 `.js` files totaling 1,316 lines (P3-B-2 migration scope).

**Note:** Archguard's TypeScript plugin does not parse `.js` files — these were analyzed via grep-based import inspection.

### 4a. Internal gate/ dependency graph

```
driver.js
  └── lifecycle.js (./lifecycle.js)
      ├── engine.js (./engine.js)
      │   ├── registry.js (./registry.js)
      │   │   ├── acceptance-runner.js (./acceptance-runner.js)
      │   │   │   └── [node:child_process]
      │   │   ├── [node:fs, node:path, node:url, node:child_process]
      │   │   ├── [yaml] (npm)
      │   │   └── ../adr-store.ts       ← TS module (already migrated)
      │   │   └── ../document-store.ts  ← TS module (already migrated)
      │   │   └── ../contract-validator.ts ← TS module (already migrated)
      │   │   └── ../config.ts          ← TS module (already migrated)
      │   └── gate-event-store.js (./gate-event-store.js)
      │       └── [node:fs, node:path]
      └── gate-event-store.js (./gate-event-store.js)

gate-log.js
  └── gate-event-store.js (./gate-event-store.js)
```

### 4b. External imports per gate/ file

| File | External imports (non-gate) |
|---|---|
| acceptance-runner.js | `node:child_process` |
| gate-event-store.js | `node:fs`, `node:path` |
| gate-log.js | `node:path` |
| engine.js | `node:crypto` |
| lifecycle.js | `node:crypto` |
| registry.js | `node:fs`, `node:path`, `node:url`, `node:child_process`, `yaml` (npm), `../adr-store.ts`, `../document-store.ts`, `../contract-validator.ts`, `../config.ts` |
| driver.js | `node:fs`, `node:path` |

### 4c. P3-B-2 risk assessment

- **registry.js** is the most complex file (696 lines) and the only one with cross-module imports into the TS-migrated layer (`../adr-store.ts`, `../document-store.ts`, `../contract-validator.ts`, `../config.ts`). These imports already use `.ts` extensions, meaning it is importing TS modules directly from JS — this works under Node's `--experimental-strip-types` flag but is an inconsistency that migration to `.ts` will resolve.
- **No circular dependencies** between gate/ and the rest of src/.
- **Node-only external deps** (fs, path, crypto, child_process, url) + `yaml` npm package. The yaml dependency is already present in the package.json; no new deps expected from migration.
- **Migration risk is LOW** for the leaf files (acceptance-runner.js, gate-event-store.js, gate-log.js, driver.js). **registry.js is MEDIUM risk** due to its size (696 lines) and complex gate-definition DSL.

---

## 5. P3-B-3 Risk Surface: serve.js + mcp-server.js

### 5a. serve.js (1,079 lines)

**Imports:**
```javascript
import http from "node:http";
import path from "node:path";
import { loadConfig, activeProvider } from "./config.ts";
import { connectProvider } from "./provider-client.ts";
import { resolveProviderEnv } from "./provider-env.ts";
```

- Pure node stdlib (http, path) + 3 already-migrated TS modules.
- No gate/ imports.
- No npm-only dependencies beyond Node builtins.
- **P3-B-3 risk: LOW**. Straightforward migration target.

### 5b. mcp-server.js (793 lines)

**Imports:**
```javascript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import { loadConfig, activeProvider } from "./config.ts";
import { connectProvider } from "./provider-client.ts";
import { composePayload, deliverTrigger } from "./action.ts";
import { resolveProviderEnv } from "./provider-env.ts";
import { QUAY_VERSION } from "./version.ts";
import { runGate } from "./gate/engine.js";
import { resolveGateLogPath, runGateLogQuery } from "./gate/gate-log.js";
import { runComplete, runAdjudicate, runPromote, runRetreat, assertTransition } from "./gate/lifecycle.js";
```

- npm dependencies: `@modelcontextprotocol/sdk` (MCP), `zod`.
- 5 already-migrated TS modules from src/.
- **3 gate/ module imports**: engine.js, gate-log.js, lifecycle.js — these are the P3-B-2 scope files.
- **P3-B-3 risk: MEDIUM**. The gate/ dependency means P3-B-3 (mcp-server.js migration) should be sequenced **after** P3-B-2 (gate/ migration), or done together in one pass. Migration of mcp-server.js in isolation would leave it importing .js gate files, which is inconsistent but functional.

---

## 6. Cross-Package Import Health

Observed cross-package import patterns:

| Importer | Import | Style | Assessment |
|---|---|---|---|
| `quay-native/src/store.ts` | `../../quay/src/abi.ts` | relative `../..` path | Acceptable — type-only import |
| `quay-native/src/manifest.ts` | `../../quay/src/abi.ts` | relative `../..` path | Acceptable — type-only import |
| `quay-native/src/mcp-server.ts` | `quay/src/adr-store.ts` | npm workspace alias | Clean pattern |
| `quay-github/src/github-client.ts` | `../../quay/src/abi.ts` | relative `../..` path | Acceptable — type-only import |
| `quay-github/src/manifest.ts` | `../../quay/src/abi.ts` | relative `../..` path | Acceptable — type-only import |

**No boundary violations found** (quay-native and quay-github do not import from each other; quay Core does not import from quay-native or quay-github).

**Inconsistency noted:** quay-native/src/store.ts and manifest.ts use relative `../../quay/src/abi.ts` paths while mcp-server.ts uses the workspace alias `quay/src/adr-store.ts`. This dual-style is a low-severity inconsistency (not a boundary violation). These are type-only imports (`import type`) which carry zero runtime risk.

---

## 7. Blocking Issues

**No blocking architectural issues found.**

The following non-blocking observations are noted for future milestones:

1. **gate/ internal .js/.ts inconsistency** (low): registry.js imports already-migrated TS modules using `.ts` extensions from a `.js` file. This works under Node's strip-types flag but is asymmetric. Resolved by P3-B-2 migration.

2. **mcp-server.js gate/ sequencing** (low): P3-B-3 migration of mcp-server.js imports 3 gate/ files; should be scheduled after P3-B-2 to maintain consistency.

3. **Cross-package relative vs alias import style** (low): quay-native uses both `../../quay/src/` relative and `quay/src/` workspace-alias forms for cross-package imports. Should be normalized to the workspace alias style.

None of these require filing blocking tasks — they are natural artifacts of an incremental migration in progress and will be resolved by the P3-B-2 and P3-B-3 migration milestones already in scope.

**Verdict: No blocking issues to file as tasks.**

---

## 8. Summary

| Check | Result |
|---|---|
| Archguard analysis | Completed: 3 separate analyze runs (quay core TS, quay-native, quay-github) |
| Cycle detection | **NONE FOUND** (all 3 packages + gate/ internal graph) |
| God-package (fanOut > 10) | **NONE FOUND** |
| God-package (fanIn > 5) | frontmatter-store-base.ts fanIn=10 — **HEALTHY** shared utility, not a violation |
| P3-B-2 gate/ risk surface | Documented. registry.js is the key file (696 lines, 4 TS-module imports). **MEDIUM migration complexity.** |
| P3-B-3 serve.js risk surface | Documented. **LOW risk** (3 TS imports, node stdlib only). |
| P3-B-3 mcp-server.js risk surface | Documented. **MEDIUM** — depends on 3 gate/ files; sequence after P3-B-2. |
| Cross-package boundaries | **CLEAN** — no boundary violations. Minor relative-vs-alias style inconsistency noted. |
| Blocking issues | **NONE** |

**Recommendation:** The post-TS-P3 architecture is clean. Proceed with P3-B-2 (gate/ migration) next, then P3-B-3 (serve.js + mcp-server.js) in sequence. No architectural blockers identified.

---
id: gap-driver-kinds-table-literal-not-in-dist-entry
title: 打包 dist entry 集对 DRIVER_KINDS 数据表字面量引用盲 → 6 driver kind +
  send-to-session.ts 不进 tarball（AC-202 恒红）
status: done
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-202
---
## Proposal

**立案当轮实测（AC-202 判据干跑，读 `goals/AC-202-*.md` criterion）**：`node --experimental-strip-types -e '…'` exit 1，stderr 逐个枚举 `MISSING(7)`：`promotion/worker/outer/quality-gate/meta/goal-driver.ts` + `send-to-session.ts`（`ready-pool-check.ts` 亦被 required 集点名，但已随包，不在缺件之列）。

**根因（读代码，非猜测）**：`packages/quay/scripts/build-plugin-dist.mjs` 的 `deriveEntries` entry 集由四条来源合成——① `CONSUMER_DIRS`（skills/loop/probes/agents/workflows/scripts/gate-scripts）的 `INVOCATION_RE` / `MD_PATH_PREFIXED_RE` / `DIST_JS_RE` 扫描；② `scanCoreReferences()`（扫 `packages/quay/src/**/*.ts` 的 `path.join(…"scripts"…"X.ts")` spawn 形）；③ `QUAY_INIT_EXPLICIT` 手维护表。**四条都不覆盖 plugin 源自己作为 spawner 的两种引用形态**：

1. `driver-runtime.ts:140` `DRIVER_KINDS` 数据表的 `driver: "X.ts"` 字段字面量（`:142 promotion-driver.ts` / `:154 worker-driver.ts` / `:169 outer-driver.ts` / `:181 quality-gate-driver.ts` / `:197 meta-driver.ts` / `:213 goal-driver.ts`）——字符串字面量数据表，不被 esbuild 内联，也不匹配 `INVOCATION_RE`（无 `node ` 前缀）或 `CORE_PATH_JOIN_TS_RE`（扫的是 Core 源不是 plugin 源）。
2. `driver-runtime.ts:449` `path.join(opts.root, "plugin", "scripts", "send-to-session.ts")` 与 `:692` `path.join(root, "plugin", "scripts", "ready-pool-check.ts")`——`scanCoreReferences` 只扫 `packages/quay/src`，plugin 源内的 spawn 形不在其扫面。

**前序任务** `gap-plugin-dist-entry-derivation-blind-to-core-and-table-refs`（done，`2afc38d91`）已把 Core 直引（`scanCoreReferences`）与 deliver-verify 的 `dist/<name>.js` 表格行（`DIST_JS_RE` 反查）机械化，但**未覆盖本任务这种「plugin 源内数据表字面量」引用形态**（AC-202 origin 逐字：`2afc38d91 已把 Core 直引机械化，但未覆盖数据表字面量这一引用形态`）。本任务是同一根因（entry 集对引用形态不全）的第三个实例，按机制去重、不按症状。

**为什么是必须修的缺陷**：`quay driver start --kind promotion` 在第三方项目里 spawn `<root>/plugin/scripts/promotion-driver.ts`——该文件随包缺失 ⇒ 与 GOAL-009 背景 ① 完全同形（`driver not found at …/plugin/scripts/promotion-driver.ts`）。AC-202 是 GOAL-009 硬顺序第一步（AC-202 机件进包 → AC-203 driver 真活 → AC-207 端到端）。

## Plan

1. **新增机械扫描**：`build-plugin-dist.mjs` 加一个扫 plugin 源（至少 `driver-runtime.ts`，宜扫 `plugin/scripts/*.ts` 全量）的函数，匹配两种引用形——`driver:\s*"X.ts"` 数据表字段，与 `path.join(…,"plugin","scripts","X.ts")`（等价 `"plugin",\s*"scripts",\s*"X.ts"`）spawn 形；与现存 plugin `.ts`（`existing`）求交后入 `referenced`。⛔ 不写手维护清单——手维护正是 `CORE_REFERENCED` 漏掉 driver-runtime.ts 的根因（09-08 已因此改机械）。
2. **接进 `deriveEntries`**：与 `scanCoreReferences()` 并列（`for (const self of scanPluginSelfReferences()) …`），复用同一 `existing` 求交。
3. **单测**：`packages/quay/test/build-plugin-dist.test.mjs` 断言 `deriveEntries("./plugin")` 的 scripts 含 7 个 basename（6 driver + send-to-session.ts），缺任一即 fail（钉住防回归）。
4. **负控制**：把新扫描函数人为禁用（或从 `DRIVER_KINDS` 摘一个 driver 字段），`deriveEntries` 缺件、AC-202 criterion exit 非 0（证明判据能取假，非恒绿）。
5. **验证**：干跑 AC-202 criterion exit 0；重建 `node --experimental-strip-types packages/quay/scripts/build-plugin-dist.mjs` 后 `plugin/scripts/dist/` 下 7 个新 bundle 各存在。

## Acceptance Criteria

- [x] AC1 AC-202 判据干跑 exit 0（stderr 无 `MISSING`）；当前 exit 1、`MISSING(7)`。
- [x] AC2 `node --experimental-strip-types packages/quay/scripts/build-plugin-dist.mjs` 后，`plugin/scripts/dist/` 下 `{promotion,worker,outer,quality-gate,meta,goal}-driver.js` + `send-to-session.js` 共 7 个各存在。
- [x] AC3 `packages/quay/test/build-plugin-dist.test.mjs` 新增断言 `deriveEntries("./plugin").scripts` 含这 7 个 basename，且通过。
- [x] AC4 负控制：禁用新扫描/摘一个 driver 字段 ⇒ `deriveEntries` 缺这 7 个、AC-202 criterion exit 非 0（判据能取假）。
- [x] AC5 `deriveEntries` 无新增手维护 7 名单——这 7 个由源扫描从 driver-runtime.ts 机械推导（`grep` 该函数新增扫描确为正则推导而非字面数组）。

## Definition of Done

AC1–AC5 全绿；`scripts/test.sh` 全量绿（含 build-plugin-dist.test.mjs）。`node --experimental-strip-types packages/quay/scripts/build-plugin-dist.mjs` 现 build 后 `dist-closure` 通过、`tar tzf` 含 7 个新 `dist/<name>.js`（复核走 tarball 而非 staging 目录）。⛔ 本任务不要求跨主机复跑——那是 AC-203 的下游（driver 真活），本任务只到「机件进包」这一层。

## Touches

- packages/quay/scripts/build-plugin-dist.mjs
- packages/quay/test/build-plugin-dist.test.mjs
- tasks/gap-driver-kinds-table-literal-not-in-dist-entry.md

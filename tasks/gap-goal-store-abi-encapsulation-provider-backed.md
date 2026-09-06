---
id: gap-goal-store-abi-encapsulation-provider-backed
title: goal 由 Core-owned 改为 Provider-backed——照 ADR 抄一遍 ABI 封装，Core 侧留委派 shim
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-store-hard-cap-staleness-three-state
---
## Proposal

正本：`orchestration/SPEC-goal-mechanism-2026-09-06.md` §5 + `goals/AC-176-abi-encapsulation.md`。
人 2026-09-06 裁定「同意复用 goal-store 扩展，但 **ABI 封装是必要的**」。

**立条依据（实测）**：全仓 `goal_list` **零命中**——**agent 现在根本读不到 goal**，
唯一入口是直跑 `node packages/quay/src/goal-store.ts`。而 `serve-goal.ts:8-14` 明写
goal/document 是 **Core store，不穿 Provider ABI**，与 task/ADR 走的是两条不同的路。

**⇒ 本任务是 G6（driver）的前置**：driver 的语义环要 spawn 短命 agent 去立案子任务，
那个 agent 必须能读当前 active GOAL 及其 AC；没有 MCP verb 就只能 shell-out 手搓，
**违反硬规则 1（用机件，不手搓）**。

**实现模板是 ADR，不是 goal 自己**——ADR 已经是「provider-backed + frontmatter 存储 +
三个 MCP verb + github 侧显式 stub + Core 侧优雅降级」的完整实例（`quay-native/src/mcp-server.ts:223-260`、
`quay-github/src/mcp-server.ts:286-305`、`provider-client.ts:138-168`、`abi.ts:46-51` 的 `AdrRecord`）。

## Plan

1. **存储归属（照 ADR 抄，不照 goal 自己抄）**：`goal-store.ts` 的**实现留在 Core**
   （`packages/quay/src/goal-store.ts`，与 adr-store/document-store 同为 Core 拥有的 generic
   frontmatter store）。**「迁至 native」方向被硬约束否决**：Core 的独立 npm-pack 产物只含
   `packages/quay` + `plugin`，Core 侧 import native 会让 esbuild dist 构建直接解析失败
   （`npm-pack-e2e` 实测 `Could not resolve "../../quay-native/src/goal-store.ts"`）。
   provider-backed 落在 **ABI 面**：native MCP 暴露 `goal_list/goal_get/goal_write/goal_gate`，
   Core 的 CLI/Web 经 provider-client 读 goal（不再直读 store）。
2. **⛔ `packages/quay-native/src/goal-store.ts`（new）是【转发 re-export shim】，不是第二份实现。**
   它 `export ... from "../../quay/src/goal-store.ts"`（照 `quay/adr-store` 的方向：Provider 依赖
   Core 的 generic utility，**不是** Core 反向伸进 Provider 的相对路径）。`GOAL_ID_RE` 的唯一定义
   留在 Core，shim 不复制（避免镜像漂移）。`packages/quay/src/goal-store.ts` 的 CLI 入口原地保留，
   五条判据（`AC-170/171/172/174/175`）的 `node packages/quay/src/goal-store.ts ...` 逐字可用。
3. `abi.ts` 加 `GoalRecord` + `GOAL_STATUSES`（照 `AdrRecord` `:46-51`）。
4. `provider-client.ts:138-168` 加 `goal_list`/`goal_get`/`goal_write`/`goal_gate` + capability 降级。
5. `quay-native/src/mcp-server.ts:223-260` 照 adr 三件套加四个 tool。
6. `quay-github/src/mcp-server.ts:286-305` 显式 stub：`goal_list → []`（列表页渲染"无 goal"而非报错）、
   `goal_get`/`goal_write` → `isError "not supported"`。
7. `capabilities:` 块：`packages/quay-native/provider.yml`、`packages/quay-github/provider.yml`
   （实测本仓还有第三个 provider `packages/quay-backlog/provider.yml`，一并核对是否需要声明）。
8. `provider-abi-conformance.test.mjs` 加一组。**I1′ 由 provider 的 write 路径执行**，
   conformance 断言每个 provider 都执行——放在 Core 侧会让未来的 provider 绕过不变式。
9. `serve-goal.ts` 由直读 store 改走 client（照 `serve-adr.ts:60` 的签名多一个 `client` 参数）。
10. `quay goal` 子命令：`bin/quay.ts:178-206` 加一行 dynamic import + 新建 `src/cli/goal.ts`（照 `cli/adr.ts`）。
11. **顺带补一个既有缺口**：`makeGoalGate` 已 export 但**未进** `gate/factories/index.ts:28-35` 的
    `gateFactories` dispatch map ⇒ 现在不可经 `gates.yml` 配置。本轮一并补上。

## Acceptance Criteria

- [x] `node packages/quay/bin/quay.ts goal list | grep -q 'GOAL-001'` 退出 0（AC-176 判据，立案时取假：verb 分派表无 goal）
- [x] 委派 shim 未破坏既有判据：`node packages/quay/src/goal-store.ts get GOAL-001 >/dev/null 2>&1` 与 `node packages/quay/src/goal-store.ts check | grep -q '"withinCap": true'` **仍双双退出 0**
- [x] shim 不复制实现：`packages/quay-native/src/goal-store.ts`（re-export shim）不含 `GOAL_ID_RE`（grep 断言，防镜像漂移——唯一定义在 Core）
- [x] MCP verb 可用：`goal_list` 经 provider-client 返回非空（单测断言，非 fixture 注入）
- [x] github 侧显式 stub：`goal_list` 返回 `[]`、`goal_write` 返回 `isError`（单测断言，负控制）
- [x] `makeGoalGate` 进入 `gateFactories` dispatch map（单测断言可经名字取到）
- [x] `node packages/quay/test/provider-abi-conformance.test.mjs` 相关组绿
- [x] `bash scripts/test.sh --for-task gap-goal-store-abi-encapsulation-provider-backed --allow-thin` 退出 0（scoped门 = worker-driver `scopedGateCommandFor`，本就带 `--allow-thin`；本任务 broad ABI 改造 Touches 覆盖 <0.5 ⇒ thin）

## Definition of Done

**验收对象是【agent 真的能经 ABI 读到 goal】，不是【多了三个 tool 定义】。**
在主检出真实跑 `node packages/quay/bin/quay.ts goal list`，输出含 `GOAL-001`/`GOAL-002`/`GOAL-003`
——这条路径走通意味着 view-model + client + native MCP verb + CLI 四层都在。
且 `/goal` 页面经 client 渲染仍正常、**五条既有判据（AC-170/171/172/174/175）在改造后仍全部退出 0**。
仅新增了 tool 定义而 `quay goal list` 跑不通，或既有五条判据有任何一条转假 ⇒ 不算完成。

## Touches

- packages/quay-native/src/goal-store.ts (new)
- packages/quay/src/abi.ts
- packages/quay/src/provider-client.ts
- packages/quay-native/src/mcp-server.ts
- packages/quay-native/bin/quay-native.ts
- packages/quay-github/src/mcp-server.ts
- packages/quay-native/provider.yml
- plugin/scripts/quay-init-closure-ratchet.ts
- plugin/vendor/quay-native/provider.yml
- packages/quay-github/provider.yml
- packages/quay-backlog/provider.yml
- packages/quay/src/serve-goal.ts
- packages/quay/src/serve-handlers.ts
- packages/quay/src/gate/factories/index.ts
- packages/quay/src/cli/goal.ts (new)
- packages/quay/src/cli/help.ts
- packages/quay/bin/quay.ts
- packages/quay/test/provider-abi-conformance.test.mjs
- packages/quay/test/goal-store.test.mjs
- packages/quay/test/cli.test.mjs
- packages/quay/test/serve-goal-doc.test.mjs
- packages/quay/test/serve-nav-inconsistent-routes.test.mjs
- packages/quay/test/webui-modernist-sync.test.mjs
- plugin/test/launch-settings.test.mjs
- tasks/gap-goal-store-abi-encapsulation-provider-backed.md

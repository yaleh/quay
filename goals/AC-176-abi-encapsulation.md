---
id: AC-176
title: G5 ABI 封装——goal 经 Provider ABI 暴露，CLI 走 provider client
status: achieved
kind: criterion
goal: GOAL-001
criterion: |
  node packages/quay/bin/quay.ts goal list | grep -q 'GOAL-001'
expect: exit 0
origin: |
  人 2026-09-06 裁定「同意复用 goal-store 扩展，但 ABI 封装是必要的」。
  推翻的是本轮调研给出的 Core-owned 建议（goal/document 现状不穿 ABI，
  serve-goal.ts:8-14 明写）。
  技术上的独立支撑：agent 现在读不到 goal——全仓 goal_list 零命中，
  唯一入口是直跑 node packages/quay/src/goal-store.ts。
evidence:
  at: 2026-09-06T22:27:09.240Z
  verdict: pass
  reading: acceptance passed (exit 0)
---

**判据（能取假）**：`quay goal list` 经 provider client 返回含 `GOAL-001` 的结果。

**取假**：今天必假——`packages/quay/bin/quay.ts:178-206` 的 verb 分派表**无 `goal`**；
`packages/quay/src/cli/` 下无 goal 模块。

**⊢ 这条判的是全链路，不是某一层**：`quay goal list` 走通意味着
view-model（`abi.ts`）+ client（`provider-client.ts`）+ native MCP verb + CLI 四层都在。

**改动面**（规格 §5.2，**照 ADR 抄，不是照 goal 现状抄**——ADR 已经是
provider-backed + frontmatter 存储的完整实例）：
`goal-store.ts` 迁至 `packages/quay-native/src/`；`abi.ts` 加 `GoalRecord`（照 `AdrRecord` `:46-51`）；
`provider-client.ts:138-168` 加 verb + capability 降级；
`quay-native/src/mcp-server.ts:223-260` 加 `goal_list`/`goal_get`/`goal_write`/`goal_gate`；
`quay-github/src/mcp-server.ts:286-305` 显式 stub；两份 `provider.yml` 的 `capabilities:`；
`provider-abi-conformance.test.mjs`；`serve-goal.ts` 改走 client（照 `serve-adr.ts:60` 签名）。

**⊢ I1′ 由 provider 的 write 路径执行**，conformance test 断言每个 provider 都执行——
放在 Core 侧会让未来的 provider 绕过不变式。

**⊢ 顺序**：本条必须排在 `AC-177`（driver）之前——
driver 的语义环要 spawn agent 立案子任务，那个 agent 必须能经 MCP 读 goal，
否则只能 shell-out 手搓（违反硬规则 1）。

**⚠️ 顺带补一个既有缺口**：`makeGoalGate` 已 export 但未进
`gate/factories/index.ts:28-35` 的 dispatch map ⇒ 不可经 `gates.yml` 配置。照抄会继承它。

---
id: gap-sea-verify-node-free-fails-050
title: "SEA 二进制 node-free serve 验证失败（v0.5.0 release 实测）——sea-verify-node-free 无 Node serve+curl 不过"
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：v0.5.0 release 工作流（run 31958447040）实测，2026-08-16 16:2xZ。

**现象**：`sea-verify-node-free`（ubuntu）与 `sea-verify-node-free-cross-platform`（windows-x64/macos-arm64
两变体）全部 failure，失败步 = "Run quay serve and curl it (no Node on PATH)"。SEA 二进制**构建成功**
（sea-release 三平台全 success），但**无 Node 环境下 serve+curl 验证不过**。npm `.tgz` 通道不受影响
（已由本地 package.sh 重造并 attach 到 v0.5.0）。

**这不是历史覆盖缺口**（`exp5-DEFECT-SEA-VERIFY-SINGLE-PLATFORM-ONLY` 那个 done 了，它只解决
"macos/windows 无 runtime-smoke 证据"的覆盖问题）；**这是有验证、但验证红**——SEA 二进制在
无 Node 环境真实跑不起来（或验证步骤本身有 bug）。

**范围待定（两条假设，需对照区分）**：
- 假说 A：SEA 二进制真的依赖运行时 Node（build-sea.sh 未真打入运行时）⇒ node-free 验证红是真的。
- 假说 B：二进制没问题，是验证步骤的 env/PATH 假设错（如 `nproc`/`resource-gate` 在无 Node 环境
  依赖某命令缺失导致 serve 启动失败）⇒ 假红。

## Acceptance Criteria

- [ ] AC1: 对照区分假说 A/B——在干净无 Node 环境手工跑 SEA 二进制（`./quay-sea-<platform> serve`），
      直接观察 serve 是否起（失败 = A 真；起不来但依赖明确缺失 = B 真）。
- [ ] AC2: 修后 `sea-verify-node-free` 与 `sea-verify-node-free-cross-platform` 全绿（node-free serve+curl 过）。
- [ ] AC3: 修复落成可 `git log` 追溯的提交（build-sea.sh / 验证脚本 / 依赖声明），⛔ 不接受跳过验证。

## Definition of Done

- [ ] SEA 无 Node 通道验证通过（AC2）：`sea-verify-node-free` 与 `sea-verify-node-free-cross-platform` 在无 Node 环境 serve+curl 全绿。
- [ ] 缺陷根因判定（假说 A 真依赖运行时 Node / 假说 B 验证步骤 env 假设错）以实测落记录，修复提交可 `git log` 追溯（AC3），不接受跳过验证。

## Touches

- packages/quay/scripts/build-sea.sh（若假说 A：SEA 打入运行时）
- .github/workflows/release.yml（sea-verify-node-free 步骤，若假说 B：env 修正）
- tasks/gap-sea-verify-node-free-fails-050.md（自身）

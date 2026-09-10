---
id: gap-delivery-manifest-capability-map
title: delivery-manifest.json 从产物列表升级为「能力→打包路径→验证闸」映射表
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

当前 `delivery-manifest.json` 只声明三类【release 产物】（npm tarball / SEA binaries / plugin），不声明【能力】本身（driver kind 集合、quay CLI 顶层命令集、MCP server 集合、web serve 能力等）。GOAL-009 AC-202 实测过一次典型缺陷——`driver-runtime.ts` 的 `DRIVER_KINDS` 数据表字面量引用不在任何打包闭包检查的覆盖范围内，6 个 driver kind 曾经不进 tarball 而无人发现，直到在第三方主机上真的跑起来才暴露（任务 `gap-driver-kinds-table-literal-not-in-dist-entry`，已 done）。

根因是打包/闭包检查靠"扫引用"的启发式（`packages/quay/scripts/package.sh` 的引用闭包校验、`build-plugin-dist.mjs` 的 entry 推导），而不是有一份"能力清单"可供比对——新增的字面量表/新文件天然在这些启发式的盲区里。仓库过去已多次出现"设计正确但没接线/没被测量"的同族模式（`gap-orphaned-check-scripts-not-wired`、`gap-gate-registration-vs-dispatch-unmeasured`、`gap-no-inventory-of-what-the-two-layer-mode-actually-runs`，均已 done，但各自只修了被发现的那一次实例——CLAUDE.md 硬规则 5b："在某处修好 X ≠ X 只在那一处"）；本任务把修法落到"能力有无登记"这个结构本身，而不是再修一次某个具体字面量表。

## Plan

1. 扩展 `delivery-manifest.json` schema，新增一个顶层 `capabilities` 字段：数组，每条 `{name, kind: "driver-kind"|"cli-command"|"mcp-server"|"web-route", sourceRef: "<定义该能力的文件:行号或符号名>", verifiedBy: "<哪个机械闸/测试断言它确实进了交付物>"}`。至少覆盖三类：driver kind 枚举（`plugin/scripts/driver-runtime.ts` `DRIVER_KINDS`）、`quay` CLI 顶层命令表（`quay --help` usage 表）、MCP server 列表（`quay mcp` / `quay-native mcp` / `quay-github mcp`）。
2. 新增一个机械检查脚本（如 `plugin/scripts/capability-manifest-check.ts`），双向枚举：源码里实际存在的这几类对象 vs manifest 里登记的集合——源码有而 manifest 未登记 ⇒ 报"未登记能力"；manifest 登记但源码里已不存在 ⇒ 报"陈旧登记"。判据要能取假：对着一个已知的历史缺口（AC-202 的 `DRIVER_KINDS` 6 个 kind 曾经遗漏的场景）复现一次，证明检查器真的会报红，而不是自证通过（CLAUDE.md 硬规则 3b/4）。
3. 接入 `scripts/test.sh` 的静态检查层或 `.github/workflows/ci.yml`（与 `dist-verify-node-floor` 同级职责：packaging e2e 类，不是 `node --test`）。
4. 用该机制回填 AC-202 的真实案例——把 `DRIVER_KINDS` 的 6 个 driver kind、CLI 顶层命令、MCP server 列表实际登记进 manifest，作为第一批验证对象。
5. `capability-manifest-check.ts` 是新增的 `plugin/scripts/*.ts` 文件，本身会触发仓库既有的三个注册闸（outline 登记 / `capability-catalog.sh` 消费者面登记 / laydown 打包登记）——实现时一并登记，不留新脚本自己成为下一个"未登记能力"的反讽。

## Acceptance Criteria

- [ ] AC1 `delivery-manifest.json` 新增 `capabilities` 字段，至少覆盖 driver kind / CLI 顶层命令 / MCP server 三类，每条都有 `sourceRef`
- [ ] AC2 新增机械检查脚本，双向枚举 source vs manifest；对着"源码新增一个 driver kind 但不登记"这个已知历史缺口场景复现，实测检查器报红（贴出实测输出，不是自证）
- [ ] AC3 该检查接入 `scripts/test.sh` 静态检查层或 CI，非孤立脚本（贴出接入点）
- [ ] AC4 回填 AC-202 缺口作为该机制的真实验证案例——`DRIVER_KINDS` 全部 6 个 kind 登记且检查通过

## Definition of Done

- [ ] AC1-4 全部满足；`--for-task` scoped 门绿
- [ ] 检查脚本关掉"已知能通过"的正常输入、换成缺登记的输入后确实报红——反例判据（CLAUDE.md 硬规则推论三："若一条 AC 在把 fixture/注入 seam 关掉后仍能通过，它才是测量；否则它只是回声"）

## Touches

- delivery-manifest.json
- plugin/scripts/capability-manifest-check.ts（新增）
- plugin/test/capability-manifest-check.test.mjs（新增，覆盖检查脚本本身）
- plugin/scripts/capability-catalog.sh（新脚本的消费者面登记）
- scripts/test.sh 或 .github/workflows/ci.yml（接入点，具体二选一由实现者定）
- tasks/gap-delivery-manifest-capability-map.md（本任务自身）
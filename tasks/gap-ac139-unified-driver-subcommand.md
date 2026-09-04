---
id: gap-ac139-unified-driver-subcommand
title: AC139 两驱动统一到 quay driver 子命令 + 单一泛化 supervisor
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-resident-driver-stable-carrier-liveness
---

**type:** execution

## Proposal

**来源**：manager 投立案（判据正本在 `orchestration/manager-phase-goal.md` `### AC139`，提交 `ddf498ae`，⛔ 不在此复制，读那一段）。

**立条时机（⛔ 最重要）**：AC138 原 Touches 写 `worker-driver-launch.sh (new)`——若照此落地，仓库将出现两个近乎重复的 244 行 bash supervisor。AC138 现 status=todo 尚未开工，改窗口是开的、成本为零。

**当前不对称（直读）**：promotion-driver 有 `promotion-driver-launch.sh`（244 行，setsid nohup + respawn + pid + stop sentinel）；worker-driver 无任何 launch 包装（只有 `.ts` 自身，从未生产启动）。

**三处真实语义冲突（⛔ 透传会静默改行为）**：① `--pid-file` 两边不同义（promotion 单值覆盖 / worker append 子进程 pid）；② worker-driver 有第三种模式 `--serve`（MCP 控制面）；③ 停机语义两套（promotion 杀在飞 / worker `.halt` 不杀在飞）。

## Plan

1. **统一入口**：`quay driver <start|stop|drain|status|restart> --kind <promotion|worker>`；`stop` 与 `drain` 分立（停机语义不同，各 kind 声明支持哪些、对不支持的直接报错，⛔ 不静默回落）。
2. **单一 supervisor**：仓库只一份 respawn/守护循环，两 kind 差异由 registry 表（数据）承载，⛔ 非两份代码。
3. **status 带 last_record_ts**：`{kind, supervisor_pid, driver_pid, alive, carrier_path, carrier_records, last_record_ts}`，⛔ 只报计数（无法区分「在长」与「停更」）。
4. **承载路径从 workspace root 解析**：⛔ 拒绝从 `quay-worktrees/` 启动（quay 不在 PATH，实际 `node packages/quay/bin/quay.js`，从 worktree 副本调用会重演昨天事故）。
5. **⛔ 不重犯**：泛化后的 supervisor 必须吸收（⛔ 非回退）stable-carrier 对稳定承载/死亡告警的修复。

## Acceptance Criteria

- [x] AC1（统一入口）：`quay driver <start|stop|drain|status|restart> --kind <promotion|worker>` 存在，两 kind 都能经它启停；`stop`/`drain` 分立、不支持的报错不回落。
- [x] AC2（单一真相源，核心）：仓库只一份 respawn 循环，两 kind 差异由 registry 表承载；取假：两个文件各有一个独立 supervisor 循环 ⇒ 假。
- [x] AC3（status 带 last_record_ts）：`status` 输出含末条记录时刻，⛔ 只报 `carrier_records` 计数。
- [x] AC4（worktree 拒绝）：承载路径由 workspace root 解析；从一个 worktree 内调 `quay driver start` 起了挂该 worktree 上的 supervisor ⇒ 假。

## Definition of Done

- [x] 统一入口 + 单一 supervisor + status last_record_ts + worktree 拒绝；AC1-4 全勾；land 到 develop。

## Retires

- promotion-driver-launch.sh 的独立 start/stop/status/restart 入口（被 `quay driver` 统一入口取代）

## Touches

- packages/quay/src/cli/driver.ts (new)
- plugin/scripts/promotion-driver-launch.sh（泛化为统一 supervisor，吸收 stable-carrier 修复）
- plugin/test/driver-cli.test.mjs (new)
- tasks/gap-ac139-unified-driver-subcommand.md（自身）
- packages/quay/bin/quay.ts（`driver` verb 派发路由）
- packages/quay/src/cli/help.ts（synopsis + `quay driver` 子命令帮助）
- packages/quay/test/cli.test.mjs（dispatch verb 集合同步 `driver`）

> **注意**：registry 表（kind 差异）落点随实现（可独立 `driver-registry.ts (new)` 或并入 launch 脚本），Touches 可随实现增补。⛔ 不改两驱动业务逻辑（选择环/晋升判定/fix worker），只动承载与入口。

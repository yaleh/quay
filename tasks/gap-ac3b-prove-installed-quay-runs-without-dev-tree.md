---
id: gap-ac3b-prove-installed-quay-runs-without-dev-tree
title: AC3b (installed quay runs without the dev tree) has a mechanism proven by
  unit test but no real proof it is effective — the installed plugin is a stale
  08-03 snapshot and no negative control has ever run
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者交办（2026-08-04T15:3xZ）：其阶段目标「quay 产品化：装得上、且在第二个项目上被证明过」
的 **AC3b（目标项目运行时不依赖 quay 开发树）至今未勾**。AC7b 的机制（quay-init 落 vendor dist +
项目本地绝对路径 mcp_entry）已在 dev tree 落地且被 `quay-init-loop.test.mjs` 单元测试证过
（task 已 done）——**但这只证明机制存在，没证明它已生效**。

### 三个缺口（外层 2026-08-04 独立核实）

| # | 缺口 | 实测 |
|---|---|---|
| ① | 已安装物 `~/.local/share/quay-plugin` 是 **08-03 23:03 旧快照** | 目录/`vendor/quay/dist/quay.js` 时间戳均为 08-03 23:03；`quay.js` 内 AC7b 相关命中 10 vs 应含 A 的 ADR-016 Amendment 同步（当前 dev tree 侧文案）——旧 |
| ② | archguard / meta-cc 的真实 `.quay/config.yml` 都是旧 PATH 解析形态 | 两者均为 `mcp_entry: ["quay-native", "mcp"]`（PATH 解析进 dev tree），**不是** AC7b 要求的项目本地绝对路径形态（`["node", "<WORKSPACE_ROOT>/packages/quay-native/bin/quay-native.ts", "mcp"]`） |
| ③ | archguard 无 `vendor/quay/dist/quay.js` 落地 | `~/work/archguard/vendor/quay/dist/quay.js` 不存在；meta-cc 有（08-03 23:07，与 installed 同尺寸） |

（注：quay 自己的 dev tree `vendor/quay/dist/quay.js` 也常缺——它是 gitignored 构建产物，
`scripts/test.sh` 每次全量构建 + `--sync-dist` 再镜像。）

### 选定机制

**把 AC3b 从「单元测试证过的机制」升级为「真实负控制证过的判据」**（管理者的要求）：

1. **刷新已安装插件**到当前 dev tree 状态（重建 `vendor/quay/dist/quay.js` + 复制完整插件包到
   `~/.local/share/quay-plugin`）。
2. **负控制（改名）**：把 quay 开发树**临时改名**（`mv` 走），用一个**已安装的 quay-init** 装出来的
   全新项目，其循环经 `mcp_entry` 走一次**真实 `task_list` 往返**（quay-native MCP 工具返回该项目
   自己的 tasks）——全程不触碰改名后的开发树。
3. **反向负控制**：改名后若 `mcp_entry` 仍 PATH 解析进开发树，`task_list` 必须失败——证明判据本身
   能区分「依赖开发树」与「不依赖」。
4. **不用零依赖探针**（resource-gate.sh 那种）——往返走真实 MCP 工具调用。

**执行窗口约束**：改名 dev tree 会打断一切在飞工作（内层 fan-in、外层本会话、监视器）——本任务
**必须在安全窗口执行**（在飞清空、`.halt` 或人明确放行后），并在结尾把开发树改回原名。

## Acceptance Criteria

- [ ] AC1: 已安装插件刷新——`~/.local/share/quay-plugin` 更新到当前 dev tree 状态（`vendor/quay/dist/quay.js`
      重建自当前源、时间戳新于 08-04；插件包其余文件与 dev tree 一致）
- [ ] AC2: 用**已安装的** quay-init 在全新空目录装出项目 P；P 的 `.quay/config.yml` provider
      `mcp_entry` 是**项目本地绝对路径**形态（`["node", "<P>/packages/quay-native/bin/quay-native.ts", "mcp"]`，
      或等价的项目本地 vendor 运行时），不是 PATH 解析的裸 `quay-native`
- [ ] AC3: **负控制（改名）**——quay 开发树临时改名后，P 经 `mcp_entry` 完成一次真实 `task_list`
      往返（MCP 工具返回 P 自己的 tasks 数组，与 P 的 `tasks/` 目录内容一致）；输出逐字贴任务体
- [ ] AC4: **反向负控制**——证明判据敏感：把 P 的 `mcp_entry` 临时改回 PATH 解析形态（`["quay-native","mcp"]`）
      且开发树仍改名中 ⇒ `task_list` 必须失败（或解析到不存在物）——证明 AC3b 判据能区分依赖/不依赖
- [ ] AC5: 全程不用零依赖探针——`task_list` 往返是真实 MCP 工具调用（可用 `quay-native mcp` 直连或
      项目 loop 的真实 provider 路径）
- [ ] AC6: 改回开发树原名；改名期间**零残留**（P 的配置、vendored 文件、进程都指向原名恢复后的状态）
- [ ] AC7: 测试/检查器按需——若刷新引入可机械验证的契约（如 installed 版本标记），写进
      `quay-init-loop.test.mjs`（node:test + `// @test-group governance`）

## Definition of Done

- [ ] AC1–AC7 全部勾上；AC3/AC4 的实跑输出（含 task_list 返回的 tasks 数组、改名前后的对照）逐字贴进
      本任务体
- [ ] 开发树恢复原名、工作树干净（改名是临时的）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- ~/.local/share/quay-plugin
- plugin/scripts/sync-vendor.sh
- plugin/scripts/quay-init.sh
- plugin/test/quay-init-loop.test.mjs
- tasks/gap-ac3b-prove-installed-quay-runs-without-dev-tree.md

（注记：`~/.local/share/quay-plugin` 是刷新目标、不在 git；`sync-vendor.sh` 若刷新需重建 dist；
`quay-init.sh` 若暴露缺口；`quay-init-loop.test.mjs` AC7 若加检查——注记不放路径里，resolve 不误判。）

## Contract

measure   installed_dist_newer = `stat -c %Y ~/.local/share/quay-plugin/vendor/quay/dist/quay.js` stdout 的数字字段
band      installed_dist_newer = ≥ 2026-08-04 全量构建时间（新于 08-03 23:03）
invariant fresh_project_mcp_is_project_local = 1（P 的 mcp_entry 是绝对路径形态，非 PATH 解析）
invoke    `~/.local/share/quay-plugin/scripts/quay-init.sh --loop <P>`（已安装路径，非 dev tree）
control   开发树改名 ⇒ P 的 task_list 往返成功；mcp_entry 改 PATH 解析 ⇒ 必须失败（AC3/AC4）
resume    刷新与负控制分两步提交证据，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-04T15:4xZ
changed: 外层受管理者交办立案。三处收紧：
(1) **不是「重跑单元测试」**——AC7b 的机制已被 quay-init-loop.test.mjs 证过，缺口是「没证明已生效」；
  本任务用真实改名负控制证判据本身；
(2) **反向负控制（AC4）是判据敏感性的证明**——只证「改名后能跑」不够，还必须证「依赖开发树时必失败」，
  否则 AC3b 判据是否真的测到了东西无从谈起；
(3) **执行窗口约束写进 Proposal**——改名 dev tree 会打断一切在飞工作，只能在安全窗口执行并恢复原名。
status: todo——执行需要安全窗口（内层 fan-in 进行中，改名会打断共享检出），排在批 fan-in 之后。

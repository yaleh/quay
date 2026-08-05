---
id: gap-ac3b-prove-installed-quay-runs-without-dev-tree
title: AC3b (installed quay runs without the dev tree) has a mechanism proven by
  unit test but no real proof it is effective — the installed plugin is a stale
  08-03 snapshot and no negative control has ever run
status: done
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

- [x] AC1: 已安装插件刷新——`~/.local/share/quay-plugin` 更新到当前 dev tree 状态（`vendor/quay/dist/quay.js`
      重建自当前源、时间戳新于 08-04；插件包其余文件与 dev tree 一致）
- [x] AC2: 用**已安装的** quay-init 在全新空目录装出项目 P；P 的 `.quay/config.yml` provider
      `mcp_entry` 是**项目本地绝对路径**形态（`["node", "<P>/packages/quay-native/bin/quay-native.ts", "mcp"]`，
      或等价的项目本地 vendor 运行时——本次实测取后者：`["node", "<P>/vendor/quay-native/dist/quay-native.js", "mcp"]`），
      不是 PATH 解析的裸 `quay-native`
- [x] AC3: **负控制（改名）**——quay 开发树临时改名后，P 经 `mcp_entry` 完成一次真实 `task_list`
      往返（MCP 工具返回 P 自己的 tasks 数组，与 P 的 `tasks/` 目录内容一致）；输出逐字贴任务体
- [x] AC4: **反向负控制**——证明判据敏感：把 P 的 `mcp_entry` 临时改回 PATH 解析形态（`["quay-native","mcp"]`）
      且开发树仍改名中 ⇒ `task_list` 必须失败（或解析到不存在物）——证明 AC3b 判据能区分依赖/不依赖
- [x] AC5: 全程不用零依赖探针——`task_list` 往返是真实 MCP 工具调用（可用 `quay-native mcp` 直连或
      项目 loop 的真实 provider 路径）
- [x] AC6: 改回开发树原名；改名期间**零残留**（P 的配置、vendored 文件、进程都指向原名恢复后的状态）
- [x] AC7: 测试/检查器按需——若刷新引入可机械验证的契约（如 installed 版本标记），写进
      `quay-init-loop.test.mjs`（node:test + `// @test-group governance`）

## Definition of Done

- [x] AC1–AC7 全部勾上；AC3/AC4 的实跑输出（含 task_list 返回的 tasks 数组、改名前后的对照）逐字贴进
      本任务体
- [x] 开发树恢复原名、工作树干净（改名是临时的）
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——执行侧 scoped 实测绿（见下方
      Evidence 第 5 节）；全量套件留给 fan-in 在 Land 时实测勾选（fast-mode 范围纪律：本任务只跑
      scoped tests，不抢 heavy-op 令牌）

### invoke 实跑证据（task-contract-check 消费者）

Contract `invoke` 入口路径 **`~/.local/share/quay-plugin/scripts/quay-init.sh`**（已安装路径，非 dev tree；
本段展示在 `## Contract` 块之外，供 task-contract-check 的 invoke-evidence 检查消费）。

`scripts/test.sh plugin/test/quay-init-loop.test.mjs plugin/test/plugin-packaging.test.mjs` →
ℹ tests 68 / pass 68 / fail 0 / cancelled 0。（已安装插件已刷新：quay.js 2026-08-05 01:21；
AC3/AC4 改名负控制在安全窗口内执行——AC3 经项目本地 mcp_entry 的真实 task_list 往返 PASS，
AC4 PATH 形态失败。）

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

## Execution evidence (2026-08-05, gap-ac3b 执行侧)

### 0. 执行中发现并修复的机制缺口（Touches 注记「quay-init.sh 若暴露缺口」命中）

原 AC7b 机制**只写配置、不落 provider 运行时**：`write_provider_config` 把 mcp_entry 写为
`["node", "<P>/packages/quay-native/bin/quay-native.ts", "mcp"]`，但 quay-init --loop **从未
铺出 `<P>/packages/quay-native/`**（只铺 `vendor/quay/dist/quay.js` Core 运行时）。结果是一次
全新安装的 config 指向一个不存在的运行时 → task_list 必失败——「机制存在、未生效」的实锤。

修复（让「已安装的 quay-init 装出的项目」真正自足、不依赖 dev tree）：
1. `sync-vendor.sh`：新增把 `packages/quay-native` 的**自包含 bundle**
   （`dist/quay-native.js`，esbuild 打包 quay/yaml/zod/sdk，纯 node 可跑）+ `provider.yml`
   镜像到 `plugin/vendor/quay-native/`（与 Core bundle 同一节，full / --sync-dist / --check
   三态一致；M136 `--check` 动态扫描 CLEAN，scripts/ 计数不受影响——新增 cmp 用
   `vendor/quay-native/…` 标签）。
2. `quay-init.sh`：`--loop` AC7b 段把 `vendor/quay-native/dist/quay-native.js` + `provider.yml`
   **铺进目标项目** `vendor/quay-native/`；`write_provider_config` 的 mcp_entry 改为指向这个
   **已落地的项目本地自包含 bundle**：`["node", "<P>/vendor/quay-native/dist/quay-native.js", "mcp"]`
   （AC2 括号里的「等价的项目本地 vendor 运行时」形态）。
3. `quay-init-loop.test.mjs`：AC7b 三个用例更新/新增——config 正则钉新形态；缺 bundle 双 WARN；
   有 bundle 双落盘 + config 指向 native bundle 断言。

验证：`quay-init-loop.test.mjs` 34 pass / 0 fail；`plugin-packaging.test.mjs`（含 M136 sync-vendor
`--check`）34 pass / 0 fail；`test-isolation-check.test.mjs` 13 pass / 0 fail；`sync-vendor.sh --check`
CLEAN（含 `vendor/quay-native/dist/quay-native.js` + `provider.yml` 两个 identical 条目）。

### 1. AC1 刷新证据

```
~/.local/share/quay-plugin/vendor/quay/dist/quay.js   2026-08-05 01:21:10  1341043 bytes（新于 08-04，与 dev tree 构建一致）
~/.local/share/quay-plugin/vendor/quay-native/dist/quay-native.js  2026-08-05 01:21  1124629 bytes（新增）
~/.local/share/quay-plugin/vendor/quay-native/provider.yml         2026-08-05 01:21  （新增）
```
刷新方式：`rsync -a --delete` 把 worktree `plugin/` → `~/.local/share/quay-plugin/`，删除的仅
两个已退役陈旧文件（`scripts/inner-state.sh`、`test/inner-state.test.mjs`）。安装后的 quay-init
含新 mcp_entry 形态（`grep vendor/quay-native/dist/quay-native.js` 命中第 430 行）。

### 2. AC2 安装证据（用已安装的 quay-init，非 dev tree）

```
$ bash ~/.local/share/quay-plugin/scripts/quay-init.sh --loop --root /var/tmp/ac3b-P --project ac3b-P \
    --test-command "node --test" --tmux-session ac3b-P-0:0.0 --worktree-root /var/tmp/ac3b-P-worktrees
... copied: /var/tmp/ac3b-P/vendor/quay/dist/quay.js
    copied: /var/tmp/ac3b-P/vendor/quay-native/dist/quay-native.js
    copied: /var/tmp/ac3b-P/vendor/quay-native/provider.yml
    wrote: .quay/config.yml (provider mcp_entry → project-local absolute paths — AC7b; ...)
verify-installed-executables: OK — every installed executable is byte-identical to its source (checked 25)
  verify-referenced-landed: OK
```
P 的 `.quay/config.yml` provider：
```
providers:
  native:
    enabled: true
    path: "/var/tmp/ac3b-P/vendor/quay-native"
    tasks_dir: "/var/tmp/ac3b-P/tasks"
    mcp_entry: ["node", "/var/tmp/ac3b-P/vendor/quay-native/dist/quay-native.js", "mcp"]
    env:
      QUAY_NATIVE_TASKS_DIR: "/var/tmp/ac3b-P/tasks"
```
（项目本地绝对路径形态，非 PATH 解析的裸 `quay-native`。）

### 3. AC3/AC4 负控制实跑输出（开发树改名 `/home/yale/work/quay` → `/home/yale/work/quay-RENAMED-AC3B`，逐字）

安全窗口判定：外层 01:22Z tick 已声明「ac3b sole in-flight、rename 安全窗口开启、等 ac3b 完成通知
后 fan-in 关批 4」；内层 pane 显示「Waiting for 1 background agent to finish」。改名前复核：无
full-suite 在跑（heavy-op 令牌未持有）、无其他 agent 使用共享检出、开发树 10 分钟无写入。改名窗口
约 60 秒内完成 AC3 + AC4 + 改回，`trap EXIT` 兜底保证任何失败路径都恢复原名。

**AC3（改名后，P 经项目本地 mcp_entry 完成真实 task_list 往返）：**
```
[ac3b-control] RENAME: /home/yale/work/quay -> /home/yale/work/quay-RENAMED-AC3B
[ac3b-control] tree intact at renamed path (task file present)
[ac3b-control] AC3: launching P provider via project-local mcp_entry (dev tree is renamed) ...
[ac3b-control] AC3 provider exit: 0
AC3_VERDICT=PASS
AC3_tasks=["AC3B-001","AC3B-002"]
AC3_tasksDir=["AC3B-001","AC3B-002"]
AC3_roundTripOK=yes
```
task_list 返回的 tasks 数组（`tools/call task_list` 的 structuredContent，节选）：
```
[ { "id": "AC3B-001", "title": "AC3B proof task one", "status": "todo" },
  { "id": "AC3B-002", "title": "AC3B proof task two", "status": "ready" } ]
```
与 P 的 `tasks/` 目录（`AC3B-001.md`、`AC3B-002.md`）逐一对应。**全程不触碰改名后的开发树。**

**AC4（反向负控制：P 的 mcp_entry 临时改回 PATH 解析形态，开发树仍改名中）：**
```
patched P config to PATH-form mcp_entry
[ac3b-control] AC4 provider exit: 127 (non-zero = PATH form FAILED as required)
AC4_VERDICT=PASS
AC4_providerExit=127
AC4_stderr=...: quay-native: command not found
```
`quay-native` 经 PATH → nvm bin → symlink 链解析进 dev tree（`…/lib/node_modules/quay-native/dist/quay-native.js`
→ `/home/yale/work/quay/packages/quay-native/dist/quay-native.js`），开发树改名后链断裂 → 命令不存在
（exit 127）。**证明判据能区分「依赖开发树」（失败）与「不依赖」（AC3 成功）。**

### 4. AC6 零残留验证（改名恢复后逐字）

```
[ac3b-control] RESTORING dev tree name: /home/yale/work/quay-RENAMED-AC3B -> /home/yale/work/quay
[ac3b-control] restored OK
AC6_VERDICT=PASS
AC6_devTree=/home/yale/work/quay exists=yes
AC6_renamedGone=/home/yale/work/quay-RENAMED-AC3B exists=no
AC6_pConfigMcpEntry=mcp_entry: ["node", "/var/tmp/ac3b-P/vendor/quay-native/dist/quay-native.js", "mcp"]
AC6_pVendorRuntime=present
```
开发树恢复原名后 `git status` 干净（仅 3 个执行前已存在的未提交 orchestration 文件）、task 文件在位、
worktree git 正常。

### 5. 执行侧 scoped 实测（node:test，非全量）

```
quay-init-loop.test.mjs       34 pass / 0 fail / 0 cancelled
plugin-packaging.test.mjs     34 pass / 0 fail / 0 cancelled（含 M136 sync-vendor --check）
test-isolation-check.test.mjs 13 pass / 0 fail / 0 cancelled
sync-vendor.sh --check        CLEAN（含新增 vendor/quay-native 两条 identical）
```
全量套件留给 fan-in 在 Land 时实测勾选（见 DoD 第 3 条注记）。

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

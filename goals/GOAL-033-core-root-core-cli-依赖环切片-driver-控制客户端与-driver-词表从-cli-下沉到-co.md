---
id: GOAL-033
title: core-root⇄core-cli 依赖环切片：driver 控制客户端与 driver 词表从 cli/ 下沉到 core-root（cli
  与仅经 cli 入环的 fan-in 离开 package SCC，6→4），fan-in 仪器附加留在 CLI 以免造出 root⇄fan-in 新互指
status: active
kind: goal
origin: 2026-10-09 goal 作者更正 SCC 期望 6→5 为 6→4（见 AC-351 origin）
activatedAt: 2026-10-09T05:46:07.439Z
statusLog:
  - at: 2026-10-09T05:46:07.439Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
branch: true
---
## 背景

**继 GOAL-030/031/032 之后第四个 goal branch 试点；目标从「收敛一个重复」升级到「拆掉一对目录互依赖」**：`packages/quay/src`（core-root）⇄ `packages/quay/src/cli`（core-cli）。这一对是 ArchGuard `detect_cycles(outputScope:package)` 报出的唯一 package 环 `{"", cli, fan-in, gate, gate/config, gate/factories}`（size 6）中**最外层、最便宜**的一条；`layers.yml` 草稿（`.claude/worktrees/layers-yml-draft/docs/layers.yml:49,81-86`，未落地）早已把 `core-root -> core-cli` 列为 known violation 并「建议收紧」。

**调查结论（创建本 goal 前完成；机械事实 / 判断 分开写）**

机械事实（grep 按位置判定 + ArchGuard scope `26b300e9`，develop `1025ab951`，两者一致）：

- core-root → cli **恰好 2 条**值边（ArchGuard `get_package_metrics(cli).fanIn = 2`，与 grep 逐条一致；其余 `cli/` 字样全在注释里）：
  1. `packages/quay/src/serve-sessions.ts:20` `import { runDriver } from "./cli/driver.ts"` —— 唯一调用点 `handleDriverLifecycle`（`:708`，POST /sessions/driver 的 start/stop/restart）。value 边、静态路径。
  2. `packages/quay/src/serve.ts:50` `import { ALL_SERVICE_NAMES, HOSTED_SERVICE_NAMES } from "./cli/driver-vocab.ts"` —— `ALL_SERVICE_NAMES` 只被 `parseServiceList`（`:145-156`）用；`HOSTED_SERVICE_NAMES` 在 `serve.ts` 内**零使用**（死 import）。value 边、静态路径。
- cli → core-root 34 条（正常方向，CLI 依赖 core），不是问题。
- `gate/`、`gate/config`、`gate/factories`、`fan-in/`、`primitives/`、`kernel/` → `cli/`：**0 条** ⇒ 删掉上面 2 条后 `cli` 在环内无入边，**必然离开 SCC**；且因为 `cli/driver.ts:37` 是 `packages/quay/src` 内 `fan-in/` 的**唯一** importer，`fan-in` 只经 `cli` 入环，会随之一起离开 ⇒ SCC **6 → 4**（2026-10-09 更正：原写「6 → 5、其余五员不动」，漏核了 fan-in 的入边；由 GOAL-033 ② 的实测读数揭示）。其余四员之间的边一条不动。
- `fan-in/` → core-root 已存在（`fan-in/ff-merge.ts:30-37` import `plugin-root`/`config`/`runtime-artifacts`）；core-root → `fan-in/` 当前 **0 条**。

判断（ownership）：

- **不是 CLI 反向渗透 core，也不是 core 想用 CLI facade —— 是两个「被两层共同消费的原语」被放进了 `cli/`**：
  - `cli/driver-vocab.ts`（零 import 叶模块）里的 `KINDS`/`VERBS` 是 driver **控制面**词表（`KINDS` 是 kernel `DRIVER_KINDS` 的机械比对镜像），服务名清单的头注释自己写着「`serve.ts`（宿主）与 `cli/server.ts` 都从这里 import」——宿主是 core。它住在 `cli/` 只是因为最初的消费者是 help 文本。
  - `cli/driver.ts` 的 `runDriver`/`runDriverAsync`/`resolveDriverInvocation`/`DriverRunResult` 是 **driver 控制客户端**（校验 verb/kind → 解析 workspace root → 拒绝 worktree → 解析 kernel → spawn → 结构化结果，「⛔ never writes to process globals」），web（serve-sessions）与 CLI（handleDriver / cli/server.ts）共用。真正属于 CLI 的只有 `handleDriver`（argv、帮助文本、stdout/exit）以及 `runDriverLog`/`runDriverLive`。
- **⚠️ 搬壳陷阱（本调查发现，必须避开）**：`runDriver` 当前还会对 `status --kind worker` 调 `fan-in/ff-merge.ts::probeInstruments` 往 stdout 里**附加** fan-in 仪器读数。若把 `runDriver` 原样搬到 core-root，就会**新增 core-root → fan-in 边**，而 `fan-in → core-root` 已存在 ⇒ 拆掉 root⇄cli 的同时**造出 root⇄fan-in 新互指**。实测：这份附加读数只有 `quay driver status --kind worker` 的用户输出会看到（`cli/server.ts` 只解析具名字段、从不读 `instruments`；`serve-sessions` 只做 start/stop/restart）⇒ 它是 **CLI 呈现职责**，留在 `cli/driver.ts`。
- **Recommended target ownership**：
  - `packages/quay/src/driver-vocab.ts`（core-root，零 import 叶模块，内容逐字搬迁）＝ driver 控制面 + 服务名词表的唯一定义；
  - `packages/quay/src/driver-control.ts`（core-root）＝ driver 控制客户端（`runDriver`/`runDriverAsync` 与其共享 prologue）的唯一实现，**⛔ 不 import `./cli/`、⛔ 不 import `./fan-in/`**；
  - `packages/quay/src/cli/driver.ts` ＝ 只剩 CLI facade：解析 argv、打印帮助、对 worker status 做仪器附加（`probeInstruments` 留在此）、`runDriverLog`/`runDriverLive`。

## 范围与非目标

范围：只拆 core-root ⇄ core-cli 这一对；只移动上面点名的符号；只改为它们 import 路径所必需的消费者与机械检查器路径。

非目标（⛔ 有意排除）：
- ⛔ 不碰 `gate/`、`gate/config`、`gate/factories`、`fan-in/`、`kernel/` 之间的其它互指；**不为了让 package 环数归零而顺手处理任何别的边**——预期结果是 SCC 6 → 4（cli 与仅经 cli 入环的 fan-in），不是 0。
- ⛔ 不把 `parseServiceList` 搬进 `cli/server.ts`（它是 CLI flag 解析、放在 `serve.ts` 也是一个 ownership 问题，但词表进 core 后它不再制造跨层边，留作观察项）。
- ⛔ 不改 `mcp-server.ts:543` 手抄的 kind 枚举（另一个表层漂移点，观察项）。
- ⛔ 不改 driver 运行时语义：CLI / web / `quay server` 三个表层的输出、拒绝理由、退出码逐字不变。
- ⛔ 不重启任何生产 driver / serve 进程（本 goal 只改 Core 源码；生产何时加载新代码留给人裁定）。

## 判据形态

三态退出码（同 GOAL-030/031/032）：0 达成；1 未达成且同行带 `CAUSE=`；3 未评估（前提尚未落地/尚未并入）。

## 验证步骤

1. 激活前 before 基线（已取，见上）：package SCC 6 成员含 `cli`、`cli` fan-in 2、core-root → fan-in 0、`import-graph-check` 三项 0、`enum-surface-parity-check` pass、`quay driver status --kind worker --json` 带 `instruments` 而 promotion 不带。
2. 激活后：`goal/GOAL-033` 自 develop tip 懒创建；任务 worktree 从该分支开出。
3. 分支 tip：AC-350 结构判据（零 core→cli 边、零新增 core→fan-in 边、单一定义、五个消费者改口、检查器全绿、gate/fan-in/kernel 未动）。
4. 分支自举 + before/after：同一 ArchGuard 构建对 fork point 与分支 tip 各做一次单根分析（`sources:["packages/quay/src"]`，显式 scope），负对照＝在 scratch 副本里重新注入一条 core→cli 边 ⇒ `cli` 回到 SCC（AC-351）；CLI 表层语义由判据在被求值树上**现场重算**，不读自报。
5. 人工触发 `quay goal merge GOAL-033 --reason …`；worker-driver 机械 fan-in（`--no-ff`，全量 suite）。
6. 规定 merge shape + 并入后核验——读**落地的合并提交树**，不读会移动的 develop tip（AC-352）。

## 停止扩大范围的信号

与 GOAL-030/031/032 同构，外加本 goal 特有的两条：需要碰 `gate/*` 或 `fan-in/*` 任一文件才能完成；或 core-root 必须 import `fan-in/` 才能保住 CLI 语义。任一出现 ⇒ 不扩大，先回到调查，必要时放弃分支。

## 退出条件

core-root 对 `cli/` 的 import 归零（且没有新增 core-root → `fan-in/` 边）；driver 控制客户端与 driver 词表各在 core-root 有唯一定义、`cli/driver-vocab.ts` 消失、五个消费者真实改口；`enum-surface-parity-check` / `import-graph-check` 不回退；ArchGuard before/after 证明 `cli` 离开 package SCC（6 → 4：cli 与 fan-in 离开，其余四员不变）且负对照可证伪；CLI 表层语义（worker status 带仪器读数、promotion 不带）在分支树上现场重算一致；GOAL-033 以恰好一个合并提交进入 develop，落地树核验通过。对应 AC-350（结构与范围护栏）、AC-351（ArchGuard before/after + 语义不变 + 负对照）、AC-352（并入形态 + 并入后核验，post-merge）。
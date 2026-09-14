---
id: gap-ac258-pipeline-destructive-steps-before-worker-preflight
title: AC-258/AC-257 交付流程把「目标机能否跑 worker」留到最后一步：破坏性且自耗的前置步骤先全跑完，才在驱动 todo→done
  时发现目标机凭据不可用 ⇒ 整轮报废且必须手工重置夹具
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra: {}
---
## Finding

`plugin/scripts/develop-deliver-tgz.sh --verify-ac258` 的目标机运行段（以及其调用的
`plugin/scripts/verify-deliver-coldstart.sh --ac258-user-scope`）按固定顺序执行：
① 删三处 quay 注册（`~/.claude/settings.json` 的 `extraKnownMarketplaces`、
`~/.claude/plugins/known_marketplaces.json`、`~/.claude/plugins/installed_plugins.json` 的 `quay@quay`）
→ ② `npm install -g` 到持久前缀并重注册 → ③ 在目标项目重跑 `quay-init` → ④ 才进入
「让目标机自己的 drivers 把一条真实任务驱动到 done」这一步。

步骤 ①②③ 都是**破坏性且自耗**的：它们把该实验的**起点**（指向探测路径的注册、quay-init 前的
`.claude/settings.json`）当场吃掉。而步骤 ④ 依赖一个**在 ①②③ 之前完全没测过**的前置条件——
目标机必须有一个能跑的 Claude Code 凭据（meta-cc 的 worker-driver 靠 `claude -p` 起 worker）。
该条件一旦不成立，实施体在**整整三步破坏性工作之后**才失败，机器已被留在「终点」状态，
判据的起点不复存在 ⇒ 复跑前必须手工把三处注册恢复成探测路径（实测用 `~/ac258-fixture-reset.sh`
做过两次）。**一个 1 秒的 `claude -p 'ok'` 前置探测可以完全避免这条路径，而它不存在。**

**实测代价（2026-09-14，本仓库 `.quay/ac258-*` 与任务
`gap-ac258-orangevps-meta-cc-user-scope-quay-init-merge-preserved` 的 Evidence 逐字记录）**：
- 目标机 orangevps 的 `~/.claude/.credentials.json`（280 B，2026-08-18）实测
  `accessToken=""`、`refreshToken=""`、`expiresAt=0` —— 凭据是**被清空的**，不是「过期可刷新」
  ⇒ 不存在任何非交互的恢复路径。
- meta-cc 自己的 worker-driver 日志：`Failed to authenticate: OAuth session expired and could not
  be refreshed`，连续 3 次 <60000ms 快速死亡，任务被驱动方标 `needs-human`。
- 该轮 ①②③ 全部成功（AC4/AC5/AC6/AC7 的读数都在），只在 ④ 失败 ⇒ 整轮产物归零，
  且需手工重置夹具才能重来。

**为什么这是机制缺陷而不是环境故障**：环境会坏（这次就是），但**流水线的步骤序把「可秒级探测的
后置条件」排在「不可逆的前置动作」之后**，使一次环境故障的代价从「1 秒探测失败」放大为
「一整轮运行 + 一次手工夹具重置」。修法与本次环境无关：在进入 ①②③ 之前，对目标机跑一次
worker 可用性探测（例如 `ssh <host> 'bash -lc "claude -p ok"'`，或直接读 meta-cc
`.quay/worker-driver.log` 的最近一条），失败即 `exit` 且**一个破坏性步骤都不做**。

**证据（本次实测，外部可核）**：
- `ssh orangevps 'bash -lc "claude -p \"say ok\""'` ⇒ `Failed to authenticate: OAuth session
  expired and could not be refreshed`（本任务直接探针，⛔ 不依赖驱动自报）
- `python3` 读 `~/.claude/.credentials.json` ⇒ 上述三个字段的取值
- 本任务 Blocker 段与 AC11/AC12 的「未落账」读数（载体 168 行中 `GOAL-018-AC-258` 命中数 = 0）

## Acceptance Criteria

- [ ] AC1 前置探测存在（位置判定，⛔ 不按关键词）：`develop-deliver-tgz.sh` 的 `--verify-ac258`
      路径上，目标机 worker 可用性探测的**调用点行号**小于删键步骤（`ac258_delete_registrations`）
      与 `quay-init` 重跑步骤的行号；贴三处行号。
- [ ] AC2 探测失败即停且零破坏（能取假）：对一台**故意不可用**的目标（夹具：`claude -p` 返回非 0）
      跑一次，断言退出码非 0、且目标机的 ①②③ **一个都没发生**（贴三个文件/文件的 md5 前后不变）。
      同一夹具把探测改成可用 ⇒ 流程继续进入 ①②③（否则前一条会被一个恒退出的实现平凡满足）。
- [ ] AC3 探测本身可诊断（硬规则 3b）：探测失败时输出**点名**失败原因（凭据不可用 / ssh 不可达 /
      探测超时三者可分），⛔ 不与「探测通过」共用同一个结构 —— 贴三种失败各自的原样输出。
- [ ] AC4 生产复跑（⛔ 夹具不算）：在真实目标机上，以「凭据不可用」为起点跑一次，贴出该次运行
      **没有**执行任何破坏性步骤的读数（三处注册 md5 与运行前逐字相同），以及失败退出码。
      若届时的真实目标机凭据已恢复，则改为贴「探测通过后流程继续」的真实读数，并说明 AC4 的
      反例由 AC2 的夹具承担。

## Definition of Done

`develop-deliver-tgz.sh` 的 `--verify-ac258`（及同族的 `--verify-ac257`，若共用同一段步骤序）
在进入任何破坏性/自耗步骤之前，对目标机做一次 worker 可用性前置探测；探测失败时**一个破坏性
步骤都不执行**即退出，且在真实目标机上有一次实测读数证明这一点（三处注册 md5 前后逐字相同）。
⛔ 只加代码不加实测读数，或只改文档，不算达成 —— 本次的代价正是「破坏性动作已经发生」，
判据必须落在**那些动作没有发生**上。

## Touches

- tasks/gap-ac258-pipeline-destructive-steps-before-worker-preflight.md
- plugin/scripts/develop-deliver-tgz.sh
- plugin/scripts/verify-deliver-coldstart.sh
- plugin/test/develop-deliver-tgz-evidence-transport.test.mjs
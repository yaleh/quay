---
id: gap-ci-runner-container-not-recycled-state-leaks-across-jobs
title: CI runner 改为 PID1=systemd 后容器不再回收：EPHEMERAL runner
  只在容器内重启服务（NRestarts=378），跨 job 累积的 /root 状态让 v0.19.0 发布门误判
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

<!-- dedup-ref --> **来源**：v0.19.0 发布事故（2026-10-10/11）。追溯：本缺陷是 `gap-ci-runner-container-needs-user-systemd`（已 done）那次 systemd 化改造的副作用。

**机制（全部为直接量，2026-10-11 实测）**：runner 镜像改为 PID1=systemd、runner 作为容器内 `gh-runner.service`（`Restart=always`）运行后，EPHEMERAL runner 每个 job 结束退出时**只重启了容器内的服务，容器本身不被回收**：
- 当时容器 `Up 19 hours`，`systemctl show gh-runner.service -p NRestarts` = **378**；
- 镜像初始态干净：`docker run --rm --entrypoint sh quay-ci-runner:sysd -c 'ls /root/.claude /opt/hostedtoolcache/node'` → 两者都不存在；
- 而长寿容器里 `/root/.claude/settings.json` 已被写入 `extraKnownMarketplaces.quay = directory /opt/hostedtoolcache/node/20.20.2/x64/lib/node_modules/quay/plugin`——来自 `ci.yml:327` `npm install -g "${TGZ}"` 的 postinstall（npm 包载体为提交态 `X.Y.Z-dev`）。

**后果**：v0.19.0 的 release run 38075693986 step 8 打印 `Marketplace 'quay' already on disk — declared in user settings`（`marketplace add <构建产物>` 静默空操作），随后装上的是 npm 全局包的 `0.19.0-dev`，`version-consistency` FAIL——而构建产物 orphan `7ff57bdc` 的 plugin.json 实为 `0.19.0`。v0.18.0 当时能过，只因它的容器尚未跑过 node-floor job。

**修法方向**：恢复"每 job 一个全新容器"——runner 服务退出时让容器退出（例如 `gh-runner.service` 上 `SuccessAction=exit`/`FailureAction=exit` 或 `ExecStopPost` 终止 PID1），由宿主 unit `Restart=always` 从镜像重建。⛔ 不得以"每次手工重启宿主 unit"代替机制。注：宿主侧 unit 在仓库之外（`~/.config/systemd/user/gh-runner-quay.service`），容器内 unit 由 `.github/runner/Dockerfile` 定义。

**AC 外部性说明（作者，2026-10-11）**：AC1–AC5 都要求把新镜像部署到 tokyo-alpha 共享生产 runner 后才能读取（重建镜像 + 重启宿主 unit），这是宿主侧动作，⛔ worker 不得执行，故标 `（待外部）`；AC0 是 worker 在 worktree 内唯一可完成、可验证的部分。

## AC

- [x] AC0（worktree 内可验）：`plugin/test/ci-runner-container-recycle.test.mjs` 按位置断言 `.github/runner/Dockerfile` 定义的 `gh-runner.service` 带有"服务退出即令容器退出"的配置（如 `SuccessAction=exit` / `FailureAction=exit` 或等价的终止 PID1 的 `ExecStopPost`）；变异对照：删去该配置后此测试必须变红，把变红输出贴进任务
- [ ] AC1（读生产载体）：修复落地后，runner 连续执行 ≥2 个 job，每个 job 开始时 `docker ps` 的容器创建时刻**互不相同**（即每 job 新容器）；把读数贴进本任务（待外部）
- [ ] AC2（读生产载体）：任一 job 开始时容器内 `/root/.claude/settings.json` 不存在或不含 `extraKnownMarketplaces.quay`，且 `NRestarts` = 0；贴读数（待外部）
- [ ] AC3（负控制）：去掉该退出配置后重复 AC1，必须观察到同一容器跨 job 存活（NRestarts 递增）；贴读数（待外部）
- [ ] AC4：`serve-own-scope` 断言在修复后仍 PASS（不得为回收容器而丢掉用户 systemd 管理器）（待外部）
- [ ] AC5：由 `.github/runner/Dockerfile` 从 develop 重建镜像后上述性质成立（不依赖手工改容器）（待外部）

## DoD

真实落地：在 tokyo-alpha 生产 runner 上，连续两个真实 CI job 各自运行在**全新容器**里（创建时刻读数为证），且 release.yml 的 project-scope 安装不再读到上一个 job 留下的 `quay` 声明。仅测试存在不算达标。

## Touches

- .github/runner/Dockerfile
- plugin/test/ci-runner-container-recycle.test.mjs
- tasks/gap-ci-runner-container-not-recycled-state-leaks-across-jobs.md

## Evidence

实现分支 `task/gap-ci-runner-container-not-recycled-state-leaks-across-jobs`，提交 `3e228226d`（worktree `/home/yale/work/quay-worktrees/gap-ci-runner-container-not-recycled-state-leaks-across-jobs`）。

**产物**
- `.github/runner/Dockerfile`：`gh-runner.service` 的 **`[Unit]` 段**新增 `SuccessAction=exit` / `FailureAction=exit`（服务一停 ⇒ systemd 管理器退出 ⇒ 容器退出 ⇒ 宿主 unit `Restart=always` 从镜像重建全新容器）；同一 unit 的 build-time 断言块新增对应两条 `grep -q`（p5）。
- `plugin/test/ci-runner-container-recycle.test.mjs`（新）：**按位置**断言——从 Dockerfile 里真正被写出去的那份 unit（`printf '%s\n' … > /etc/systemd/system/gh-runner.service` 的引号实参）取行，再断言这两条位于 `[Unit]` 段。判据不 grep 整文件：同一字符串也出现在注释与断言块里，整文件 grep 会被注释满足。

**AC0 绿（修复后，worktree 内）**
```
$ node --experimental-strip-types --test plugin/test/ci-runner-container-recycle.test.mjs
✔ AC0: the CI runner unit exits the container when the runner service stops (1.414627ms)
✔ AC0 (能取假): the predicate goes FALSE when the exit config is deleted or misplaced (0.387411ms)
ℹ tests 2 / pass 2 / fail 0
```

**变异对照 1 —— 删去该配置**（`cp` 备份 → 删两行 → 跑 → `cp` 还原；还原后 md5 `f607f257c8ae4d62265f2d0c7f895add` 与备份一致）
```
✖ AC0: the CI runner unit exits the container when the runner service stops (2.780135ms)
  AssertionError [ERR_ASSERTION]: the ephemeral runner's container is never recycled: without the
  missing directive(s) below, systemd (now PID 1) stays alive after the runner stops and
  `Restart=always` restarts the runner IN PLACE, so every job inherits the previous job's /root state
    SuccessAction=exit — covers the runner's normal end — an ephemeral runner exits 0 after its one job
    FailureAction=exit — covers a crashed listener, or an ExecStart that cannot exec (measured: container exits 203)
  + actual - expected
  + [ 'SuccessAction=exit', 'FailureAction=exit' ]
  - []
✖ AC0 (能取假): the predicate goes FALSE when the exit config is deleted or misplaced
ℹ tests 2 / pass 0 / fail 2
```

**变异对照 2 —— 同两行只改位置（挪进 `[Service]` 段），字节一个不改**
```
✖ AC0: the CI runner unit exits the container when the runner service stops (2.455703ms)
  （同上 AssertionError，两条仍被判为缺失）
✖ AC0 (能取假): the predicate goes FALSE when the exit config is deleted or misplaced
ℹ tests 2 / pass 0 / fail 2
```
⇒ 判据读的是**位置**而非字符串：只做字符串 grep 的判据会把"看起来配了、实际被 systemd 静默丢弃"的配置判绿——正是本次事故那一类缺陷。

**机制读数（2026-10-11，全部在一次性 scratch 容器里跑 `quay-ci-runner:sysd`，宿主生产 runner 未被触碰）**

| `gh-runner.service` 配置 | 容器是否回收 |
|---|---|
| 现状基线：`Restart=always`、无 action | ✖ 一直 `Up`，90s 内 `NRestarts=26` |
| 同两条写在 **`[Service]`** 段 | ✖ 仍 `Up`；`systemctl show -p SuccessAction` = **`none`**，而 `systemctl cat` 照样显示该行 ⇒ systemd **静默丢弃** |
| 写在 **`[Unit]`** 段，服务退出码 0 | ✔ 服务停后 ~3s 容器退出（exit code 0） |
| 写在 **`[Unit]`** 段，服务退出码 1 | ✔ ~3s 退出 |
| 写在 **`[Unit]`** 段，`ExecStart` 根本 exec 不起来 | ✔ ~1s 退出（exit code 203） |

⇒ 三种停止路径（正常 job 结束 / 崩溃 / 起不来）全覆盖。另实测：`[Unit]` 写法**不会**被 `Restart=always` 抢占（`[Unit] SuccessAction=exit` + `Restart=always` 仍退出容器），故 `Restart=always` 保留——万一 action 失效，退化回今天的行为，而不是留下"容器活着但 runner 没了"的死容器。同一 unit 的 build-time 断言已按同样内容加了两条 `grep -q`（并在本地用同一 print 出来的 unit 文本做过正/负控制）。

**未完成部分（如实记录）**：AC1–AC5 与 DoD 需宿主侧动作（从 develop 重建镜像 + 重启 `gh-runner-quay.service`）后读生产载体，按作者 `（待外部）` 标注不由 worker 执行；本任务交付的是镜像侧配置 + 它的位置判据与变异对照。

## Needs-Human

**执行 2026-10-11T01:07:44.177Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：unsatisfiableUnannotatedAc=[AC1（读生产载体）：修复落地后，runner 连续执行 ≥2 个 job，每个 job 开始时 `docker ps` 的容器创建时刻**互不相同**（即每 job 新容器）；把读数贴进本任务]（连续 3 轮被结构上不可派的拦截挡住 ⇒ 作者/人改写；⛔ 不派 fix worker）

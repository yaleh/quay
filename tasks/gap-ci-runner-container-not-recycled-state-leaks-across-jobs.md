---
id: gap-ci-runner-container-not-recycled-state-leaks-across-jobs
title: CI runner 改为 PID1=systemd 后容器不再回收：EPHEMERAL runner
  只在容器内重启服务（NRestarts=378），跨 job 累积的 /root 状态让 v0.19.0 发布门误判
status: needs-human
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

- [ ] AC0（worktree 内可验）：`plugin/test/ci-runner-container-recycle.test.mjs` 按位置断言 `.github/runner/Dockerfile` 定义的 `gh-runner.service` 带有"服务退出即令容器退出"的配置（如 `SuccessAction=exit` / `FailureAction=exit` 或等价的终止 PID1 的 `ExecStopPost`）；变异对照：删去该配置后此测试必须变红，把变红输出贴进任务
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

## Needs-Human

**执行 2026-10-11T01:07:44.177Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：unsatisfiableUnannotatedAc=[AC1（读生产载体）：修复落地后，runner 连续执行 ≥2 个 job，每个 job 开始时 `docker ps` 的容器创建时刻**互不相同**（即每 job 新容器）；把读数贴进本任务]（连续 3 轮被结构上不可派的拦截挡住 ⇒ 作者/人改写；⛔ 不派 fix worker）

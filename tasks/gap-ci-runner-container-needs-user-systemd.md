---
id: gap-ci-runner-container-needs-user-systemd
title: CI runner 容器缺可用用户 systemd 管理器、且 systemd 245 不认 OOMPolicy=continue ——
  release.yml 第 13 步恒红，v0.18.0 起每版发不出去；修复须能从 develop 重建
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**做法**：把已在分支 `task/gap-ci-runner-container-needs-user-systemd` 上验证过、且**当前生产镜像正在运行**的那份 `.github/runner/Dockerfile` 带进 develop，并让它的前置在**构建期**被断言，使「从 develop 重建 runner 镜像」重新成为一条安全的操作。

三条具体改动：

1. **镜像自带用户管理器与正确的 systemd 版本**：PID 1 = systemd，runner 作为容器内 `gh-runner.service` 运行；基础镜像从 `myoung34/github-runner:latest`（Ubuntu 20.04 / systemd 245）换成 `ubuntu-noble`（24.04 / systemd 255，与宿主一致），并补 `systemd-sysv` / `dbus` / `libpam-systemd` 与 `user@0.service` 的 `XDG_RUNTIME_DIR` drop-in。
2. **unit 的容器运行参数与运行时环境**：补 `--cgroupns=host` + `-v /sys/fs/cgroup:/sys/fs/cgroup:rw` + tmpfs `/run`,`/tmp` + `--cap-add SYS_ADMIN/SYS_CHROOT/MKNOD`（⛔ 实测**不需要** `--privileged`）；`PassEnvironment` 覆盖容器**全量**环境；`RUNNER_TOOL_CACHE` 显式指向镜像内已预置的 toolcache。
3. **把四个已实测的坑写进文件注释**（覆盖 `ENTRYPOINT`、`ExecStart` 必须带参数、`XDG_RUNTIME_DIR` 走 `/actions-runner/.env`、`PassEnvironment` 全量），并写明「复核者别用裸 `docker exec` 造出假阴性」。

**为什么不手工 merge**：本仓对 develop 的改动有既定路径（task → 门 → fan-in），手工合会绕过它——而"绕过"正是本次事故里双方都在避免的形态。本任务的作用就是把已有分支补进正规路径。

## Contract

```
invariant 容器内 root 有可用的用户管理器，且该容器的 systemd 版本接受 `-p OOMPolicy=continue`；两条同时成立时 release.yml 第 13 步 project-scope 断言才可能绿
measure serve_scope_envelope_exit: `docker exec -e XDG_RUNTIME_DIR=/run/user/0 gh-runner-quay systemd-run --user --scope --quiet -p OOMPolicy=continue -p MemoryAccounting=yes --unit=quay-anchor-probe true` → exit_code
band   n/a: exit_code 是 0/非 0 的二值读数，不设噪声带
invoke `docker exec -e XDG_RUNTIME_DIR=/run/user/0 gh-runner-quay systemd-run --user --scope --quiet -p MemoryAccounting=yes true`
control 同一条命令**去掉** `-e XDG_RUNTIME_DIR=/run/user/0` 后必然失败（`Failed to create bus connection`）——这正是两个会话各自踩过的假阴性，以它为负控制
resume 载体＝分支 `task/gap-ci-runner-container-needs-user-systemd` 的单提交 `bc6917029`；落地即经 task → 门 → fan-in 进 develop，随后 AC1 从 develop 的定义重建并复测
```

CI runner 容器（`gh-runner-quay`，由 systemd **user** unit `~/.config/systemd/user/gh-runner-quay.service` 以 `docker run --rm … quay-ci-runner:<tag>` 拉起，`EPHEMERAL=true`）必须同时满足上述两条，否则 release.yml 的第 13 步 `Verify the channel — project-scope assertions` 恒红，v0.18.0 及之后每一版都发不出去（`create-github-release` / `advance-master` 恒被 skipped）：

1. **容器内 root 要有可用的用户管理器**：`systemd-run --user --scope` 必须真正建得出 scope（即 `packages/quay/src/systemd-scope.ts` 的可用性探测为真）。否则 `quay server start` 的信封无法施加，serve 静默走**不带 scope 的回退**分支，进程落进调用者 cgroup（读作 `0::/`），`judgeServeCgroup` 判 FAIL。
2. **容器内 systemd 的版本必须能接受产品实际传的属性**：`systemd-scope.ts:228` 传 `-p OOMPolicy=continue`。systemd **245**（Ubuntu 20.04）对 **scope** 报 `Unknown assignment: OOMPolicy=continue`，driver anchor 起不来。

**约束**：本修复必须**能从 develop 重建**——镜像定义是本仓 `.github/runner/Dockerfile`，它必须自带这两条所需的全部内容。

## 现状（2026-10-10 实测，逐层暴露，非同一故障）

修复已在一台分支上完成并**已在生产生效**（跑着的 `quay-ci-runner:sysd` 就是从它构建的），但 develop 上的 `.github/runner/Dockerfile` 仍是旧定义（`FROM myoung34/github-runner:latest`）⇒ **从 develop 重建会静默回退本修复**，且 develop 上看不出这里动过。

四层卡点与逐字证据（均为 release.yml run 号）：

| # | 现象 | 真因 |
|---|---|---|
| 1 | `38017835526` / `38019511932`：`serve-own-scope FAIL — serve host cgroup is 0::/`，`passed=11 failed=1` | 容器 PID 1 是 runner entrypoint ⇒ root **没有用户管理器**；`systemd-run --user` 报 `Failed to create bus connection` |
| 2 | `38022095383`：step 9 `Resolve the installed plugin cache directory` 死于 `HOME: unbound variable` | 改成 systemd service 后，服务只继承 `PassEnvironment` 显式列出的变量，`docker run` 隐式给的 `HOME`/`PATH`/`LANG`/`LC_ALL` 等全丢 |
| 3 | `38022731054`：step 11 `Start the promotion + worker drivers`，`Unknown assignment: OOMPolicy=continue` | 容器 systemd **245** 对 scope 不认该属性；宿主是 **255**。⛔ 这一条是**被修复 1 暴露的潜伏缺陷**：修复前 `systemd-run` 直接失败、产品静默回退，该属性**从未被传过** |
| 4 | `38023497714`：step 3 `actions/setup-node@v4` 卡 **25 分钟**被自身 timeout cancel，下游全 skipped | `RUNNER_TOOL_CACHE` 未导出 ⇒ setup-node 找不到镜像里**已预置**的 `/opt/hostedtoolcache/node/24.21.0/x64`（含 `.complete`），转去下载 `github.com/actions/node-versions/...` 并 stall（`Acquiring … aborted`） |

修后 `38025425341` **completed/success**，15/15 步全绿（含第 13、14 步断言），release 对象已建（https://github.com/yaleh/quay/releases/tag/v0.18.0 ）、master 推进到 `a663d1936`。

## AC

- [x] AC1 **从 develop 重建** `.github/runner/Dockerfile` 后，容器内下列读数**全部成立**（⛔ 必须在 develop 的定义上验，不是在已修分支上验）：`systemd-run --user --scope --quiet -p OOMPolicy=continue -p MemoryAccounting=yes --unit=quay-anchor-probe true` 原样 exit 0；`systemd-run --user --scope --quiet -p MemoryAccounting=yes true` exit 0；`systemctl is-active user@0.service` = active；`/opt/hostedtoolcache/node/*/x64.complete` 存在；runner 进程环境里 `RUNNER_TOOL_CACHE=/opt/hostedtoolcache` 且 `HOME` 非空；某 scope 的 `/proc/<pid>/cgroup` 以 `user@0.service/quay-*.scope` 结尾。
- [x] AC2 这四条前置在**构建期**被断言（而不是留给未来的 job）：镜像 build 失败要比"镜像少一个前置、job 里以环境形状的测试失败冒出来"先发生。现有 `RUNNER python3 -c 'import yaml…' && command -v tmux/pgrep/ps` 那一组是模板，补齐等价断言。
- [x] AC3 已知坑写进镜像定义的注释：至少含 `ENTRYPOINT` 必须覆盖（base 的 `ENTRYPOINT ["/entrypoint.sh"]` 会把 systemd 当参数吞掉）、`ExecStart` 必须带 runner 命令参数（`/entrypoint.sh` 结尾是 `gosu runner "$@"`）且 `WorkingDirectory=/actions-runner`、`XDG_RUNTIME_DIR` 必须在 `/actions-runner/.env` 里（unit 的 `Environment=` 到不了 runner 进程）。
- [x] AC4 复核者不会被假阴性误导：注释里写明**裸 `docker exec … systemd-run --user …` 必然失败、必须带 `-e XDG_RUNTIME_DIR=/run/user/0`** 才能复现服务真实环境（本仓已有两个会话各自踩过一次）。

## DoD

- develop 的 `.github/runner/Dockerfile` 与生产实际运行的镜像**同源**：从 develop 构建出的镜像，其 `git hash-object` 之外的判据即 AC1 的全部读数在生产容器内成立。
- `gh api repos/yaleh/quay/actions/runners` 仍显示 `tokyo-alpha-1 online`（换镜像不得把 CI 弄下线）。
- 该镜像定义经 task → 门 → fan-in 落地，不再存在"已生效而未记录"的镜像面。

## Touches

- .github/runner/Dockerfile
- tasks/gap-ci-runner-container-needs-user-systemd.md

## Notes

现已存在的分支 `task/gap-ci-runner-container-needs-user-systemd`（单提交 `bc6917029`，含全部四项修复与注释）可作为实现载体；但它**没有 task、没走门**，本任务存在的意义就是把它补进正规路径。⛔ 不要手工 merge 进 develop；⛔ 在此之前不要从 develop 重建镜像——现在跑着的镜像是对的。另有一条与本任务相邻但不同机制的悬项：token 现走 `docker run -e ACCESS_TOKEN=…`（argv，`ps aux` 全机可见），建议改 `--env-file` 并轮换 token——那属密钥通路变更，另案待人裁定，不并入本任务。

——
## Evidence

**AC1 — 六条读数，均在【活的生产容器】`gh-runner-quay`（镜像 `quay-ci-runner:sysd`；本机即 tokyo-alpha）内实测，2026-10-10**，并在由同一 Dockerfile 重新构建的镜像 `quay-ci-runner:wtest` 上复现（该镜像运行时层与分支提交 `bc6917029` 逐字节相同，本分支只新增两条只读断言 `RUN` 与注释）：

| 读数 | 命令 | 结果 |
|---|---|---|
| anchor 信封 | `systemd-run --user --scope --quiet -p OOMPolicy=continue -p MemoryAccounting=yes --unit=quay-anchor-probe true`（带 `-e XDG_RUNTIME_DIR=/run/user/0`） | rc=0 |
| MemoryAccounting | `systemd-run --user --scope --quiet -p MemoryAccounting=yes true` | rc=0 |
| 负控制（去掉 `-e XDG_RUNTIME_DIR`） | 同上裸 exec | rc=1，`Failed to connect to bus: No medium found` |
| user manager | `systemctl is-active user@0.service` | `active` |
| scope cgroup | `systemd-run … sh -c 'cat /proc/self/cgroup'` | `…/user@0.service/app.slice/quay-ac1-probe.scope`（与 `packages/quay/test/server-host-own-scope.test.mjs` 记载的 tail 同形） |
| runner 环境 | `/proc/<runner pid>/environ` | `RUNNER_TOOL_CACHE=/opt/hostedtoolcache`、`HOME=/root` |
| toolcache | `ls /opt/hostedtoolcache/node/*/x64.complete` | `24.21.0/x64.complete`、`20.20.2/x64.complete`（活容器内由 setup-node 运行时填充，见下） |

**AC2 — 构建期断言：** Dockerfile 新增两段 `RUN set -eux` 断言（早期：python/tmux/procps/systemd-run/dbus-daemon + `systemctl --version` ≥ 255；晚期：PAM 模块、`/lib/systemd/systemd`、unit 的 `PassEnvironment HOME/PATH`、`WorkingDirectory`、`Runner.Listener run`、`.env` 的 XDG、`/opt/hostedtoolcache`、`RUNNER_TOOL_CACHE` drop-in）。`docker build` rc=0。**能取假（两臂各实测一次）**：① 删掉写 `30-toolcache.conf` 的 RUN → build 在该断言处 exit 1；② 把版本下限改成 `-ge 9999` → build exit 1（日志显示 `systemd 255 (255.4-1ubuntu8.17)`）。

**AC3 / AC4 —** 注释含 `ENTRYPOINT ["/entrypoint.sh"]` 吞噬陷阱、`gosu runner "$@"`、`WorkingDirectory=/actions-runner`、`/actions-runner/.env`、「unit 的 `Environment=` 到不了 runner 进程」，以及「裸 `docker exec … systemd-run --user …` 必然失败、必须带 `-e XDG_RUNTIME_DIR=/run/user/0`」的假阴性告警。

**发现（与任务原文不符，已在 Dockerfile 注释更正）**：任务「现状 / trap-6」称基础镜像「已预置 node 24.21.0 + `.complete`」——实测**不成立**：`myoung34/github-runner:ubuntu-noble` 与构建出的镜像，其 `/opt/hostedtoolcache` 均为**空**（`node/` 不存在）；该目录是 base 建好的 runner-owned 空目录，node 是**运行时**由 setup-node 经 `RUNNER_TOOL_CACHE` 下载进去的（活容器 05:40 / 05:47 才出现）。因此 AC2 的 p4 断言只断言镜像可控的事实（目录存在 + drop-in 指向它），不断言 `.complete`（那是运行时读数，归 AC1）。

**DoD —** `gh api repos/yaleh/quay/actions/runners` → `tokyo-alpha-1 online`。
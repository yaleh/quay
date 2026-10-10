---
id: gap-ci-runner-container-needs-user-systemd
title: CI runner 容器缺可用用户 systemd 管理器、且 systemd 245 不认 OOMPolicy=continue ——
  release.yml 第 13 步恒红，v0.18.0 起每版发不出去；修复须能从 develop 重建
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Contract

CI runner 容器（`gh-runner-quay`，由 systemd **user** unit `~/.config/systemd/user/gh-runner-quay.service` 以 `docker run --rm … quay-ci-runner:<tag>` 拉起，`EPHEMERAL=true`）必须同时满足两条，否则 release.yml 的第 13 步 `Verify the channel — project-scope assertions` 恒红，v0.18.0 及之后每一版都发不出去（`create-github-release` / `advance-master` 恒被 skipped）：

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

- [ ] AC1 **从 develop 重建** `.github/runner/Dockerfile` 后，容器内下列读数**全部成立**（⛔ 必须在 develop 的定义上验，不是在已修分支上验）：`systemd-run --user --scope --quiet -p OOMPolicy=continue -p MemoryAccounting=yes --unit=quay-anchor-probe true` 原样 exit 0；`systemd-run --user --scope --quiet -p MemoryAccounting=yes true` exit 0；`systemctl is-active user@0.service` = active；`/opt/hostedtoolcache/node/*/x64.complete` 存在；runner 进程环境里 `RUNNER_TOOL_CACHE=/opt/hostedtoolcache` 且 `HOME` 非空；某 scope 的 `/proc/<pid>/cgroup` 以 `user@0.service/quay-*.scope` 结尾。
- [ ] AC2 这四条前置在**构建期**被断言（而不是留给未来的 job）：镜像 build 失败要比"镜像少一个前置、job 里以环境形状的测试失败冒出来"先发生。现有 `RUNNER python3 -c 'import yaml…' && command -v tmux/pgrep/ps` 那一组是模板，补齐等价断言。
- [ ] AC3 已知坑写进镜像定义的注释：至少含 `ENTRYPOINT` 必须覆盖（base 的 `ENTRYPOINT ["/entrypoint.sh"]` 会把 systemd 当参数吞掉）、`ExecStart` 必须带 runner 命令参数（`/entrypoint.sh` 结尾是 `gosu runner "$@"`）且 `WorkingDirectory=/actions-runner`、`XDG_RUNTIME_DIR` 必须在 `/actions-runner/.env` 里（unit 的 `Environment=` 到不了 runner 进程）。
- [ ] AC4 复核者不会被假阴性误导：注释里写明**裸 `docker exec … systemd-run --user …` 必然失败、必须带 `-e XDG_RUNTIME_DIR=/run/user/0`** 才能复现服务真实环境（本仓已有两个会话各自踩过一次）。

## DoD

- develop 的 `.github/runner/Dockerfile` 与生产实际运行的镜像**同源**：从 develop 构建出的镜像，其 `git hash-object` 之外的判据即 AC1 的全部读数在生产容器内成立。
- `gh api repos/yaleh/quay/actions/runners` 仍显示 `tokyo-alpha-1 online`（换镜像不得把 CI 弄下线）。
- 该镜像定义经 task → 门 → fan-in 落地，不再存在"已生效而未记录"的镜像面。

## Touches

- .github/runner/Dockerfile

## Notes

现已存在的分支 `task/gap-ci-runner-container-needs-user-systemd`（单提交，含全部四项修复与注释）可作为实现载体；但它**没有 task、没走门**，本任务存在的意义就是把它补进正规路径。⛔ 不要手工 merge 进 develop；⛔ 在此之前不要从 develop 重建镜像——现在跑着的镜像是对的。
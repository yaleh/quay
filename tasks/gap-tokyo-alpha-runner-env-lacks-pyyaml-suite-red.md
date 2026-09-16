---
id: gap-tokyo-alpha-runner-env-lacks-pyyaml-suite-red
title: tokyo-alpha self-hosted runner 环境缺 PyYAML 等依赖——CI test job 上该 runner
  从未绿过，~80 个套件测试因环境而红
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: finding
---
**type:** execution

## Finding

2026-09-16 tokyo-alpha self-hosted runner（`runs-on: [self-hosted, tokyo-alpha]`，`myoung34/github-runner:latest` docker 镜像）接手 CI 后，`test` job **从未转绿过**。修掉第一个 fail-fast 的静态检查缺陷（`gap-outer-tick-log-awk-mawk-interval-red`，awk 区间表达式）之后，job 得以跑进全量套件，随即暴露 **~80 个互不相关的测试失败**——全部是**执行环境缺口**，不是产品缺陷：

- `ModuleNotFoundError: No module named 'yaml'` —— **25+ 处**。runner 的 python3 没有 PyYAML，凡 shell out 到 `python3 -c "import yaml,json; ..."` 的测试全红（另有 19 处报 `profiles.yml must parse as YAML` / `carrier must parse as YAML`）。
- `"quay --version" exited 127` + `/usr/bin/env: 'bash': No such file or directory`（`plugin/test/plugin-bin-shim-npm-free-cli.test.mjs` 的 nvm-fallback 路径，依赖宿主 PATH 形态）。
- 还有一批 `QuayInit` / laydown / `--selfcheck` 类失败（`quay-init must succeed; stderr:` / `--list must exit N:` 等），需逐条归类。

**归因对照（证明与本改动无关）**：上一次 `test` job 转绿是 run **35101351631**（2026-09-16T13:47Z），其日志 `Image: ubuntu-24.04` —— **GitHub 托管 runner，不是 tokyo-alpha**。`ci.yml` 切到 `runs-on: [self-hosted, tokyo-alpha]` 是 2026-09-16 才落地的。⇒ 该环境上「历来绿跑」全部发生在 gawk + 完整 python 依赖的 ubuntu-latest 上。

**取证跑**：`gh run view 35115599539`（本仓库 `task/gap-outer-tick-log-awk-mawk-interval-red` 分支的 workflow_dispatch；该 run 已证明 awk 那一条检查转绿：日志 `MUTATION outer-tick-log-check: pass`）。

## Requested action

让 tokyo-alpha 这个 runner 具备跑全量套件所需的环境，使 CI `test` job 能真正转绿。至少：

1. 补齐 runner 的 Python 依赖（PyYAML）——⛔ 优先做成 CI workflow 里显式的 setup step（可复现、可审计），而不是手工在 runner 宿主上装一次（那样下一个人重建 runner 就复发了）。
2. 建立「tokyo-alpha 上的 test job 绿」这条基线——在此之前，`runs-on` 切到 self-hosted 等于把 CI 从一个绿的判据换成一个恒红的判据（硬规则 3b：恒红与「没在检查」同形）。

## Acceptance Criteria

- [ ] AC1: 逐条归类 ~80 个失败测试的成因（至少给出 top 5 成因各占几条），并把归类结果落进本任务证据。
- [ ] AC2: `test` job 在 `runs-on: [self-hosted, tokyo-alpha]` 上真实转绿一次（`gh run view <id>` 链接落证据）——本地/gawk 环境跑绿不构成完成证据。
- [ ] AC3: 检查是否还有其它 `runs-on`/环境假设在这次 runner 迁移中被静默破坏（例如其它 job 的 `runs-on: ubuntu-latest` 与 `test` job 的环境差异是否会掩盖缺陷）。

## Definition of Done

- [ ] `origin/develop` 上有一次真实 GitHub Actions `test` job（`runs-on: [self-hosted, tokyo-alpha]`）跑绿的记录。

## Touches

- .github/workflows/ci.yml
- plugin/test/plugin-bin-shim-npm-free-cli.test.mjs（Finding 点名的 nvm-fallback 宿主 PATH 依赖）
- plugin/test/ci-runner-env-prereqs.test.mjs (new)（如需为环境前提加判据）
- tasks/gap-tokyo-alpha-runner-env-lacks-pyyaml-suite-red.md（自身）

---
id: gap-tokyo-alpha-runner-env-lacks-pyyaml-suite-red
title: tokyo-alpha self-hosted runner 环境缺 PyYAML 等依赖——CI test job 上该 runner
  从未绿过，~80 个套件测试因环境而红
status: ready
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

## Evidence — AC1 归类

取证对象：`gh run view 35115599539 --log-failed`（tokyo-alpha 上 `test` job 全量日志）。
实测 **74 条唯一失败用例，分布 25 个测试文件**（Finding 里的「~80」是估计值）。

归类方法：**逐因子消融对照**——同一 commit、同一台机器，只改一个因子，看哪几条翻红/翻绿。⛔ 不是读日志关键词猜（硬规则 2）；每条对照都给出双向读数。

| # | 成因 | 条数 | 对照（消融该因子 ⇒ 恰好多出这几条红） |
|---|------|------|----------------------------------------|
| 1 | **runner 的 python3 缺 PyYAML** | **64** | 全量日志含 27 处 `ModuleNotFoundError: No module named 'yaml'`；本机（有 PyYAML）跑同 25 个文件、其余因子全好 ⇒ 646 pass / 0 fail |
| 2 | **runner 无 tmux** | **3** | 把 tmux 从 PATH 隐藏 ⇒ 恰好多 3 红（supervisor-observe AC3c、tmux-leak-scan AC2/AC3）；放回 ⇒ 0 红 |
| 3 | **checkout 里无本地 `develop` ref** | **3** | scratch clone（`git init`+fetch+`checkout -B` = actions/checkout 的机制）⇒ 3 红；补 `git branch develop` ⇒ 0 红 |
| 4 | **locale = en_US.UTF-8（非 C）** | **3** | 同一 commit、同一 worktree（本地 develop 在场、其余因子全好）跑同 25 个文件：`LC_ALL=C.UTF-8` ⇒ 646 pass / 0 fail；`LC_ALL=en_US.UTF-8` ⇒ 643 pass / 3 fail（test-file-snapshot AC2、develop-deliver ⑥、laydown-set-check AC2） |
| 5 | **runner 以 uid 0 执行 CI** | **1** | 同一文件：uid 1000 ⇒ 绿；uid 0 ⇒ 红（quay-init-install-fixture-wipe AC2） |

3+3+3+1 = 10 条互不重叠（分属四组不同测试文件），余 **64** 条即成因 1。

**成因 1 的定性（影响修法的选择）**：这不是「测试自己的环境依赖」，而是**产品自身**的环境依赖——`plugin/scripts/quay-init.sh` / `quay-launch.sh` / `manager-start.sh` / `verify-deliver-coldstart.sh` 都 shell out 到 `python3 -c 'import yaml, ...'` 来解析 `.quay/config.yml` / `profiles.yml`。所以修法只能是把前提**显式补上**（而不是改测试绕开）。

runner 实测探针读数（在 `test` job 里临时加一步取得）：`uid=0(root)`；`LANG=LC_ALL=en_US.UTF-8`；`python3` 无 `yaml`；`tmux MISSING`；`gawk MISSING`（`awk -> mawk`）；`bash`/`git`/`jq`/`sort` 在。

## Evidence — AC3 其它 runs-on / 环境假设

1. **其它三个 job 仍在 `ubuntu-latest`**（`dist-verify-node-floor` / `version-consistency` / `cold-start-e2e`）——它们绿不构成 `test` job 的证据（不同机器）。且这层差异**掩盖了一个独立缺陷**：`cold-start-e2e` 在 2026-09-16T15:28Z / 16:08Z 两次 workflow_dispatch 上**在 ubuntu-latest 上就是红的**（`FAIL: missing file: <tmp>/empty-project/orchestration/orchestrator-loop-tick.md`），与本 runner 迁移无关，是既存红，需另立任务。
2. **`test` job 自身带 3 条 checkout-shape 假设**（需要**本地** `develop` ref）：在**任何** runner 上都红，只在 `push: develop` 时才绿。迁移前同样存在，迁移把它显式暴露出来。已在本 job 里补 ref（见下面实现）。
3. **同一 runner 以 uid 0 跑 CI**（ubuntu-latest 是 `runner`）：凡以 EACCES 作负控制的测试在该 runner 上**结构上不可能发火**。已改成三态（NOT-EVALUATED）而不是让它恒红或恒绿（硬规则 3b）。
4. `gawk` 缺失（只有 `mawk`）属于同一批环境差异，已由 `gap-outer-tick-log-awk-mawk-interval-red` 单独修掉并落在 develop 上（本分支已 merge）。
5. **`grep` 实现差异**：`plugin/test/runner-grouping-metadata.test.mjs` 的参考实现（`old group_of`）用宿主 `grep` 判 binary 文件，而「Binary file … matches」这条提示走 stdout 还是 stderr 是**实现定义的**——tokyo-alpha 的 GNU grep 走 stdout（⇒ `awk '{print $2}'` 得 `file` ⇒ `UNKNOWN:file`），本机 ugrep / ubuntu-latest 走 stderr（⇒ 文档化的 `engine`）。已用 `grep -I` 把该参考实现钉成宿主无关（显式声明意图：binary 文件不贡献声明）。

## Acceptance Criteria

- [ ] AC1: 逐条归类 ~80 个失败测试的成因（至少给出 top 5 成因各占几条），并把归类结果落进本任务证据。
- [ ] AC2: `test` job 在 `runs-on: [self-hosted, tokyo-alpha]` 上真实转绿一次（`gh run view <id>` 链接落证据）——本地/gawk 环境跑绿不构成完成证据。
- [ ] AC3: 检查是否还有其它 `runs-on`/环境假设在这次 runner 迁移中被静默破坏（例如其它 job 的 `runs-on: ubuntu-latest` 与 `test` job 的环境差异是否会掩盖缺陷）。

## Definition of Done

- [ ] `origin/develop` 上有一次真实 GitHub Actions `test` job（`runs-on: [self-hosted, tokyo-alpha]`）跑绿的记录。

## Touches

- .github/workflows/ci.yml
- plugin/test/plugin-bin-shim-npm-free-cli.test.mjs（Finding 点名的 nvm-fallback 宿主 PATH 依赖）
- plugin/test/ci-runner-env-prereqs.test.mjs (new)（为环境前提加判据）
- plugin/test/quay-init-install-fixture-wipe.test.mjs（read-only 夹具的 EACCES 负控制按 uid 分态）
- plugin/test/runner-grouping-metadata.test.mjs（old group_of 参考实现的 grep 实现依赖）
- tasks/gap-tokyo-alpha-runner-env-lacks-pyyaml-suite-red.md（自身）

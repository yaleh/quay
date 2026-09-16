---
id: gap-tokyo-alpha-runner-env-lacks-pyyaml-suite-red
title: tokyo-alpha self-hosted runner 环境缺 PyYAML 等依赖——CI test job 上该 runner
  从未绿过，~80 个套件测试因环境而红
status: done
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

runner 实测探针读数（在 `test` job 里临时加一步取得）：`uid=0(root)`；`LANG=LC_ALL=en_US.UTF-8`；`python3` 无 `yaml`；`tmux MISSING`；`gawk MISSING`（`awk -> mawk`）；`ps`/`pgrep` MISSING；`bash`/`git`/`jq`/`sort` 在。

**归类之后的续查（把 job 真正推到绿的过程中又暴露的四类，全部同样按对照判定）**：
- `proposal-convergence` AC15 与 `quay-init-install-fixture-wipe` AC2 同族——**uid 0 使「只读目录」破坏失效**（`CAP_DAC_OVERRIDE`）。对照：同一文件 uid 1000 绿 / uid 0 红。
- `proposal-convergence` kill-timeout 的 **50ms 期限在 runner 上够跑完**：实测 runner 上一个 bare `node --experimental-strip-types` 子进程 **19ms** 就启动并退出。⇒ 该判据是机器速度依赖，不是环境缺口。
- `runner-grouping-metadata` 的参考实现依赖**宿主 grep 实现**（「Binary file … matches」走 stdout 还是 stderr）。
- **并发制度**：并发由 nproc 派生（4 核 ⇒ 小并发；128 核 ⇒ 128 路）。128 路下套件不是稳定判据——同一 commit 连跑三次，多出的红集每次**不同**且都是负载形状（`serve-board` `EADDRINUSE`、`fan-in-execute-paths` ⑧⑩ 有界等待、`dead-code-after-return-check` AC6 严格零扫描）。

## Evidence — AC3 其它 runs-on / 环境假设

1. **其它三个 job 仍在 `ubuntu-latest`**（`dist-verify-node-floor` / `version-consistency` / `cold-start-e2e`）——它们绿不构成 `test` job 的证据（不同机器）。且这层差异**掩盖了一个独立缺陷**：`cold-start-e2e` 在本任务全部 7 次 workflow_dispatch 上**在 ubuntu-latest 上都是红的**（`FAIL: missing file: <tmp>/empty-project/orchestration/orchestrator-loop-tick.md`），与本 runner 迁移无关，是既存红，**需另立任务**。
2. **`test` job 自身带 3 条 checkout-shape 假设**（需要**本地** `develop` ref）：在**任何** runner 上都红，只在 `push: develop` 时才绿。迁移前同样存在，迁移把它显式暴露出来。已在本 job 里补 ref。
3. **同一 runner 以 uid 0 跑 CI**（ubuntu-latest 是 `runner`）：凡以「把目录 chmod 成只读／依赖 EACCES」作负控制的测试在该 runner 上**结构上不可能发火**。实测两处（`quay-init-install-fixture-wipe` AC2、`proposal-convergence` AC15），都改成 uid 无关的写法而不是让它们恒红/恒绿（硬规则 3b）。
4. `gawk` 缺失（只有 `mawk`）属于同一批环境差异，已由 `gap-outer-tick-log-awk-mawk-interval-red` 单独修掉并落在 develop 上（本分支已 merge）。
5. **`grep` 实现差异**（见上）。
6. **并发制度也是被迁移改掉的环境假设**（见上）：已在 workflow 里把并发**显式封顶**（16 = 本套件日常被开发/验证的那台 16 核机器的制度）。
7. **`ps`/`pgrep`（procps）缺失**：`full-suite-runner.ts` 用 `pgrep -c -f` 数自己的并发 runner，reaper 相关测试 shell out 到 `ps`。实测：`ps -o pid,stat,wchan -p <活 pid>` 在该 runner 上**零输出**而 `process.kill(pid,0)` 报活 ⇒ 是工具不在，不是进程不在。已一并 provision。

## Acceptance Criteria

- [x] AC1: 逐条归类 ~80 个失败测试的成因（至少给出 top 5 成因各占几条），并把归类结果落进本任务证据。
- [x] AC2: `test` job 在 `runs-on: [self-hosted, tokyo-alpha]` 上真实转绿一次（`gh run view <id>` 链接落证据）——本地/gawk 环境跑绿不构成完成证据。
  证据：**run 35126145957**（https://github.com/yaleh/quay/actions/runs/35126145957）`test` job **success**，`runs-on: [self-hosted, tokyo-alpha]`（job id 104895547206）。同一 run 内 `version-consistency` / `dist-verify-node-floor` 也 success；`cold-start-e2e` 是 ubuntu-latest 上的既存红（见 AC3 第 1 条）。⛔ 这条是从 74 红 → 0 红，不是靠放宽判据：所有消融对照与本轮实现都写在下面与提交信息里。
- [x] AC3: 检查是否还有其它 `runs-on`/环境假设在这次 runner 迁移中被静默破坏（例如其它 job 的 `runs-on: ubuntu-latest` 与 `test` job 的环境差异是否会掩盖缺陷）。
  结论见他处 7 条；其中两条（cold-start-e2e 在 ubuntu-latest 上恒红、并发制度）建议另立任务。

## Definition of Done

- [ ] `origin/develop` 上有一次真实 GitHub Actions `test` job（`runs-on: [self-hosted, tokyo-alpha]`）跑绿的记录——该 run 由落地后的 `push: develop` 触发，本条在 flip 之前结构上无读数，属外层验证（待外部）
  ⚠️ **本条故意保持未勾**：AC2 的绿跑发生在**本任务分支**上（run 35126145957，已在 AC2 落证据）。develop 上的绿跑只会在本分支被 fan-in 快进到 develop、GitHub 因 `push: develop` 自动触发之后才存在——**在勾选这一刻它还没有被观测到**，按硬规则 3b 不拿「预期会发生」当「已发生」。落地后由 `gh run list --branch develop` 复核。按 `ready-pool-check.ts` 的 `isExternalVerificationItem` 声明式注解族，条末已标注 `（待外部）`（同行含字面 `外层验证`）⇒ fan-in flip 闸判 `pass-external` 而非 `pass`，两态取值可区分（硬规则 3b），因此**不需要**也不得把它勾上。

## Touches

- .github/workflows/ci.yml
- plugin/test/plugin-bin-shim-npm-free-cli.test.mjs（Finding 点名的 nvm-fallback 宿主 PATH 依赖）
- plugin/test/ci-runner-env-prereqs.test.mjs (new)（为环境前提加判据）
- plugin/test/quay-init-install-fixture-wipe.test.mjs（read-only 夹具的 EACCES 负控制按 uid 分态）
- plugin/test/runner-grouping-metadata.test.mjs（old group_of 参考实现的 grep 实现依赖）
- plugin/test/fan-in-execute-paths.test.mjs（⑧⑩ 槽获取有界等待按 runner 实测放宽 15s→60s）
- experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs（AC15 的只读目录破坏按 uid 分态；kill-timeout 期限 50ms→1ms）
- tasks/gap-tokyo-alpha-runner-env-lacks-pyyaml-suite-red.md（自身）

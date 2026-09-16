---
id: gap-outer-tick-log-awk-mawk-interval-red
title: outer-tick-log-check 的 awk 正则用了 mawk 不支持的 {n} 区间表达式——self-hosted runner
  docker 镜像下必红
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**来源**：2026-09-16 tokyo-alpha self-hosted GitHub Actions runner 首次真实 CI 跑验证时触发；`test` job 在 `scripts/test.sh` 静态检查阶段的 `checker-mutation-check` 报 `outer-tick-log-check: always-red (restore still red)`，18s 内 fail-closed 整个 job（`gh run view 35112285037`，commit 9f79bc17f，https://github.com/yaleh/quay/actions/runs/35112285037）。

**根因（已用受控对照确认）**：`plugin/scripts/outer-tick-log-check.sh` 两处 `awk` 分段正则（`:105` LAST_SECTION、`:180` PREV_SECTION）都写成 `/^\- \`[0-9]{2}:[0-9]{2}Z?\`/`——用了 `{2}` 区间表达式（interval expression）。这在 GNU awk（gawk）下工作正常，但在 **mawk**（Debian/Ubuntu 默认 `/usr/bin/awk` 符号链接常见目标之一）下**不支持该语法，正则静默不匹配**，导致 LAST_SECTION 恒为空 → `outer-tick-log-check: FAIL — no tick section (- \`HH:MMZ\` bullet) found` → checker-mutation-check 的 baseline 探针（一份合法 fixture）直接判红，产生「always-red」。

**受控对照（同一条正则、同一份输入，两种 awk 实现）**：
```
$ echo '- `15:13Z` tick' | mawk '/^\- `[0-9]{2}:[0-9]{2}Z?`/{print "MATCH"}'
（无输出，不匹配）
$ echo '- `15:13Z` tick' | gawk '/^\- `[0-9]{2}:[0-9]{2}Z?`/{print "MATCH"}'
MATCH
```
`tokyo-alpha` 宿主机本身 `/usr/bin/awk → gawk 5.2.1`（不受影响，所以直接在宿主机 bash 里手跑这个 fixture 25/25 全过，一度误判"不可复现"）；但 CI 实际执行环境是 `myoung34/github-runner:latest` docker 镜像（self-hosted runner 用它跑 job），该镜像 `/usr/bin/awk → mawk 1.3.4 20200120`（已直接 `docker run myoung34/github-runner:latest` 验证）。过去所有 CI 绿跑全部发生在 GitHub 官方 `ubuntu-latest` runner 上（该镜像默认 `awk` 是 gawk），所以这个 bug 一直存在但从未被真实 CI 触发过——**不是新引入的回归，是换了执行环境后第一次暴露的既有可移植性缺陷**（`git log 698e28d8e..9f79bc17f -- plugin/scripts/outer-tick-log-check.sh` 零改动，已核实这 20 个提交没碰过这两处 awk block）。

**已排除的假说（各有对照，非猜测）**：
- ⛔ 不是我这次 CI 改动（去掉 `--test-concurrency=8`、切 `runs-on: self-hosted`）导致——失败发生在 `scripts/test.sh` 最早的静态检查阶段，先于任何 node --test 并发/`runs-on` 相关逻辑。
- ⛔ 不是时区问题——容器与宿主机内 `date`/`date -u` 输出完全一致（都是 UTC），已用 debug 脚本核实。
- ⛔ 不是随机 flake/负载竞态——`bash plugin/scripts/checker-mutation-check.sh --run --only outer-tick-log-check` 在 mawk 环境下 5/5 100% 复现，单次仅耗时 11ms（远达不到任何计时窗口边界）。

## Acceptance Criteria
- [x] AC1: `plugin/scripts/outer-tick-log-check.sh` 的两处 awk 分段正则（`:105`/`:180`）及文件内任何同款 `{n}` 区间表达式，改写为不依赖区间表达式的等价形式（如 `[0-9][0-9]` 展开 `[0-9]{2}`），在 mawk 与 gawk 下行为一致。取假判据：改动后 `echo '- \`15:13Z\` tick' | mawk '<新正则>'` 必须输出匹配；改动前的旧正则对同一输入在 mawk 下不匹配（负控制保留在任务证据里，不要求代码里留痕）。
- [x] AC2: `bash plugin/scripts/checker-mutation-check.sh --run --only outer-tick-log-check` 在 mawk 环境（`myoung34/github-runner:latest` 镜像或任意 `/usr/bin/awk → mawk` 的宿主/容器）下必须 PASS（`mutations_that_always_red: 0`）。取假判据：改动前同一命令在同一 mawk 环境下必须先复现 always-red（对照）。
- [x] AC3: 排查 `plugin/scripts/verify-deliver-coldstart.sh` 里同款 `{n}` awk 区间表达式（`grep -rlP "awk\s+'" plugin/scripts scripts | xargs grep -lP '/\^?[^/]*\{[0-9]+(,[0-9]*)?\}[^/]*/'` 命中的第二个文件）——硬规则 5b（在一处修好不等于只有那一处）：若存在同款可触发风险，一并修复或另开子任务跟踪，并在本任务证据里写清判断依据。
- [ ] AC4: 在 tokyo-alpha self-hosted runner（真实 mawk 环境）上跑一次真实 GitHub Actions `test` job 转绿——这是本任务的生产验证形式；本地/gawk 环境跑绿不构成本任务的完成证据（这个环境从未复现过该缺陷）。（外层验证）（待外部）

## Definition of Done
- [x] 两处（或经 AC3 排查后更多）awk 正则已改为区间表达式无关写法，`git diff` 可见改动。
- [ ] `origin/develop` 上有一次真实 GitHub Actions `test` job（`runs-on: [self-hosted, tokyo-alpha]`）跑绿的记录（`gh run view <id>` 链接落证据）。（外层验证）（待外部）

## Touches
- plugin/scripts/outer-tick-log-check.sh
- plugin/scripts/verify-deliver-coldstart.sh（AC3 判定需要则一并 touch，否则说明为何不需要）
- tasks/gap-outer-tick-log-awk-mawk-interval-red.md（自身）

## Evidence（root-cause 调查记录，2026-09-16，立案时预填，供实现者直接复用）
- 触发跑：`gh run view 35112285037 --repo yaleh/quay`，commit `9f79bc17f`，`test` job `Run tests` 步骤 2026-09-16T15:00:18Z 报 `MUTATION outer-tick-log-check: always-red`。
- 复现链路：`checker-mutation-cases/outer-tick-log-check.sh` 独立跑（宿主机 gawk 环境）25/25 PASS；同一脚本经由 `checker-mutation-check.sh --run --only outer-tick-log-check` 在 `node:24-bookworm` / `myoung34/github-runner:latest` 容器（均 mawk）内 5/5 100% 复现 always-red，单次耗时 11ms。
- 定位：`bash plugin/scripts/outer-tick-log-check.sh --log <fixture> --truth 00000 --root <wd>` 直接跑（去掉 `>/dev/null 2>&1` 消音）输出 `outer-tick-log-check: FAIL — no tick section (- \`HH:MMZ\` bullet) found`。
- 对照：`readlink -f $(which awk)`——tokyo-alpha 宿主机 `/usr/bin/gawk`；`myoung34/github-runner:latest` 与 `node:24-bookworm` 容器内均 `/usr/bin/mawk`（mawk 1.3.4 20200120）。同一条正则对同一行输入，gawk 匹配、mawk 不匹配。

## Implementation Evidence（2026-09-16，实现者；全部为可复跑的对照读数）

**改动（5 处，`git diff` 可见）**：两处 awk 分段正则 `[0-9]{2}:[0-9]{2}` → `[0-9][0-9]:[0-9][0-9]`（`:105`/`:180`）；同文件两处 `grep -oE` 区间一并展开（`:116`/`:208`）；`usage()` 的 `sed 's/^# \{0,1\}//'` 改为 `sed -e 's/^# //' -e 's/^#/'`（区间无关）。**改动后该文件区间表达式计数 = 0**。`usage()` 输出与 pristine develop 版逐字节相同（55 行，diff 空）。

**mawk 版本取证**：本机 `/usr/bin/mawk` 是 1.3.4 **20240123**，**已支持**区间表达式 ⇒ 本机 mawk 无法复现缺陷（这正是立案记录里"宿主机手跑全过"的同一原因）。改用 `docker run debian:bullseye`（mawk 1.3.4 **20200120**，与 CI 记录的品牌版本逐字相同）复现。mawk changelog 佐证：区间表达式在 **20201023** 起才默认启用，20200120 早于该版本。

**AC1 取假判据（mawk 20200120，同一输入 `- \`15:13Z\` tick`）**：
```
旧正则 /^\- `[0-9]{2}:[0-9]{2}Z?`/   → 无输出（不匹配）   ← 负控制，复现缺陷
新正则 /^\- `[0-9][0-9]:[0-9][0-9]Z?`/ → FIXED-MATCH      ← 修复后匹配
```

**AC2 取假判据（同环境 `checker-mutation-check.sh --run --only outer-tick-log-check`）**：
```
改动前(wt=develop pristine): mutations_that_always_red: 1  RESULT: FAIL
改动后(wt=本任务分支):        mutations_that_always_red: 0  RESULT: PASS  (exit 0)
```
gawk 回归对照：改动后同命令 `always_red: 0` PASS ⇒ 未破坏正常工作路径。真实 tick-log 端到端（2.1MB `orchestration/tick-log.md`，四种组合）：

| awk | 改动前 | 改动后 |
|---|---|---|
| gawk 5.2.1 | exit 0, `tickTime:"23:22"` | exit 0, `tickTime:"23:22"` |
| mawk 20200120 | **exit 1, `no-tick-section`** | **exit 0, `tickTime:"23:22"`** |

⇒ 修复恢复 gawk/mawk 行为一致，且在 gawk 下逐字节不变（无回归）。

**AC3 判定依据（结论：该文件无需修复，无需另开子任务）**：AC 指定的扫描只覆盖 `plugin/scripts` 与 `scripts` 两个目录（来源不完备，硬规则 5）。已把来源扩到**全库**：对 `git ls-files` 的 1505 个 shell/ts/mjs 文件做**结构化**提取（取每处 `awk` 后的单引号程序体，再在**程序体内**匹配区间表达式，而非整文件 grep——后者会把跨构造的巧合算成命中），得 168 个 awk 程序体。
- 全库含区间表达式的 awk 程序体：**2 个，全部在 `plugin/scripts/outer-tick-log-check.sh`**（即本任务修复的那个文件）；修复后 **0 个**。
- `verify-deliver-coldstart.sh`：32 个 awk 程序体，含区间表达式的 **0 个**。该文件里 `{40}`/`{64}` 的 10 处命中**全部不是 awk 区间表达式**，逐处按构造分类：`:891`/`:950` 是 `grep -Eq`（POSIX ERE，与 awk 无关）、`:2092`/`:2371`/`:3255` 是 bash 位置参数展开 `${10}`、`:5376`/`:5459` 是注释散文里提到 `GOAL-\d{3,}`、`:5951` 是 bash `[[ =~ ]]`、`:7577`/`:7578` 是嵌在 `node -e` 程序里的 **JS RegExp**（JS 原生支持区间表达式）。AC 指定的启发式之所以命中该文件，是因为该文件**别处**含字面 `awk '` 而**此处**含 `{n}`——跨构造假阳性（硬规则 2 位置判定的经典形态）。

**AC4 判定（未满足，且本任务范围内不可达——这是本次交付最重要的发现）**：已 push 任务分支并 `workflow_dispatch` 真跑一次 CI（**run 35115599539**，`runs-on: [self-hosted, tokyo-alpha]`，真实 mawk 环境）。读数：
- ✅ **本任务修复的那条检查在真实 CI 上转绿**：日志 `MUTATION outer-tick-log-check: pass`（change-tier companion 报 `1 checker carrier in THIS delta: outer-tick-log-check`）；`plugin/test/outer-tick-log-check.test.mjs passed=true`。即立案时那条 18s fail-closed 的检查已被消除。
- ❌ **`test` job 整体仍为红**：约 **80 个无关测试失败**，全部是 tokyo-alpha 这个**执行环境**的缺口，与本改动无关。主要成因（按错误行归类）：`ModuleNotFoundError: No module named 'yaml'`（25+ 处，runner 的 python3 无 PyYAML ⇒ `python3 -c "import yaml..."` 全红）、`profiles.yml must parse as YAML`（19 处）等。本改动只碰 1 个 shell 检查器文件，这些失败测试无一读取它。
- 归因对照：上一次 `test` job 转绿（**35101351631**，2026-09-16T13:47Z）跑在 `Image: ubuntu-24.04`（GitHub 托管，gawk），**不是 tokyo-alpha**；`ci.yml` 的 `runs-on: [self-hosted, tokyo-alpha]` 于 2026-09-16 才落地。⇒ **tokyo-alpha 上从来没有过一次 test job 转绿**，该环境存在一整层独立的套件不兼容，修 awk 一条不可能让 job 转绿。
- 结论：AC4 与其对应的 DoD 项是**外部/后续**验证（依赖别人先把 runner 环境补齐），本任务结构上无法产出该读数。故两项**保持未勾 + `（外层验证）（待外部）` 注解**——⛔ 不勾上去（那会把一个已知为红的读数记成通过，硬规则 3b/4）。注解形态已用 `flipAcGateVerdict(body)` 干跑确认：`{ok:true, status:"pass-external", total:6, checked:4, unchecked:2}`（`pass-external` ≠ `pass`，状态可区分）。环境缺口的跟进已另开任务。

**其它已跑读数**：`bash -n` 语法通过；worktree 内 `scripts/test.sh --for-task gap-outer-tick-log-awk-mawk-interval-red --allow-thin` 绿（58 tests / 0 fail / exit 0）；`plugin/test/outer-tick-log-check.test.mjs` 27/27 通过。scoped-gate cache 已写入（developSha `e152de3a29904ec23c843619707a928467b3859c`）。

**⚠️ 未做**：本任务**没有**尝试修复 tokyo-alpha 的套件环境缺口（PyYAML 等）——那是与本案根因无关的独立缺陷，且超出本任务 Touches，按仓库纪律（AC3 同款措辞）另开子任务跟踪，不并入本条。
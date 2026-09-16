---
id: gap-outer-tick-log-awk-mawk-interval-red
title: outer-tick-log-check 的 awk 正则用了 mawk 不支持的 {n} 区间表达式——self-hosted runner
  docker 镜像下必红
status: todo
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
- [ ] AC1: `plugin/scripts/outer-tick-log-check.sh` 的两处 awk 分段正则（`:105`/`:180`）及文件内任何同款 `{n}` 区间表达式，改写为不依赖区间表达式的等价形式（如 `[0-9][0-9]` 展开 `[0-9]{2}`），在 mawk 与 gawk 下行为一致。取假判据：改动后 `echo '- \`15:13Z\` tick' | mawk '<新正则>'` 必须输出匹配；改动前的旧正则对同一输入在 mawk 下不匹配（负控制保留在任务证据里，不要求代码里留痕）。
- [ ] AC2: `bash plugin/scripts/checker-mutation-check.sh --run --only outer-tick-log-check` 在 mawk 环境（`myoung34/github-runner:latest` 镜像或任意 `/usr/bin/awk → mawk` 的宿主/容器）下必须 PASS（`mutations_that_always_red: 0`）。取假判据：改动前同一命令在同一 mawk 环境下必须先复现 always-red（对照）。
- [ ] AC3: 排查 `plugin/scripts/verify-deliver-coldstart.sh` 里同款 `{n}` awk 区间表达式（`grep -rlP "awk\s+'" plugin/scripts scripts | xargs grep -lP '/\^?[^/]*\{[0-9]+(,[0-9]*)?\}[^/]*/'` 命中的第二个文件）——硬规则 5b（在一处修好不等于只有那一处）：若存在同款可触发风险，一并修复或另开子任务跟踪，并在本任务证据里写清判断依据。
- [ ] AC4: 在 tokyo-alpha self-hosted runner（真实 mawk 环境）上跑一次真实 GitHub Actions `test` job 转绿——这是本任务的生产验证形式；本地/gawk 环境跑绿不构成本任务的完成证据（这个环境从未复现过该缺陷）。

## Definition of Done
- [ ] 两处（或经 AC3 排查后更多）awk 正则已改为区间表达式无关写法，`git diff` 可见改动。
- [ ] `origin/develop` 上有一次真实 GitHub Actions `test` job（`runs-on: [self-hosted, tokyo-alpha]`）跑绿的记录（`gh run view <id>` 链接落证据）。

## Touches
- plugin/scripts/outer-tick-log-check.sh
- plugin/scripts/verify-deliver-coldstart.sh（AC3 判定需要则一并 touch，否则说明为何不需要）
- tasks/gap-outer-tick-log-awk-mawk-interval-red.md（自身）

## Evidence（root-cause 调查记录，2026-09-16，立案时预填，供实现者直接复用）
- 触发跑：`gh run view 35112285037 --repo yaleh/quay`，commit `9f79bc17f`，`test` job `Run tests` 步骤 2026-09-16T15:00:18Z 报 `MUTATION outer-tick-log-check: always-red`。
- 复现链路：`checker-mutation-cases/outer-tick-log-check.sh` 独立跑（宿主机 gawk 环境）25/25 PASS；同一脚本经由 `checker-mutation-check.sh --run --only outer-tick-log-check` 在 `node:24-bookworm` / `myoung34/github-runner:latest` 容器（均 mawk）内 5/5 100% 复现 always-red，单次耗时 11ms。
- 定位：`bash plugin/scripts/outer-tick-log-check.sh --log <fixture> --truth 00000 --root <wd>` 直接跑（去掉 `>/dev/null 2>&1` 消音）输出 `outer-tick-log-check: FAIL — no tick section (- \`HH:MMZ\` bullet) found`。
- 对照：`readlink -f $(which awk)`——tokyo-alpha 宿主机 `/usr/bin/gawk`；`myoung34/github-runner:latest` 与 `node:24-bookworm` 容器内均 `/usr/bin/mawk`（mawk 1.3.4 20200120）。同一条正则对同一行输入，gawk 匹配、mawk 不匹配。
---
id: GOAL-022
title: self-hosted CI test job 墙钟压到 30 秒内——128核机器实测93.9%空闲，瓶颈是文件粒度太粗+重复装包
status: active
kind: goal
origin: manager 2026-09-17 采纳 goal-sufficiency-followup 提案
  gap-goal022-scope-item3-prereq-reinstall-uncovered option (a)：新增
  AC-282，退出条件句「三条 AC」改「四条 AC」，范围节与非目标节逐字未动。
activatedAt: 2026-09-17T00:45:02.249Z
statusLog:
  - at: 2026-09-17T00:45:02.249Z
    from: draft
    to: active
    actor: manager
    reason: AC-279/280/281 三条已就位，退出条件（三条 AC 均 achieved）已可判定；进入执行阶段
---
## 背景（2026-09-16/17 实测，全部为直接量）

self-hosted tokyo-alpha runner（128核）上真实 CI test job 耗时 ~208s（.quay/ci-runs.jsonl run
35162872510），而同期 vmstat 逐秒采样显示整个运行期间平均 CPU 空闲率 93.9%、中位数 99%——前20秒静态
检查单线程、21-51秒短暂用满并发（idle降到46%）、之后120秒（占总时长71%）机器基本闲置，只有1-3个
单线程测试文件在跑。

脚本自己打印的诊断实锤了这一点：__GROUP__ concurrency=128 files=649 sum_ms=1417017 floor_ms=135106
——理论地板(sum/concurrency)只要11秒，但因为 ready-pool-check.test.mjs（176用例/135秒）单文件
duration 摁住了地板，跟并发数完全无关（node --test 只在文件间并行，文件内部串行）。同类文件共15个
实测超过30秒：ready-pool-check(135s)/slot-refill(124s)/full-suite-runner(83s)/worker-driver-fan-in(57s)/
fan-in-execute-paths(57s)/resource-gate(48s)/worker-driver-resident(46s)/promotion-driver(44s)/
driver-runtime(39s)/server-partial-stop(34s)/runner-grouping-list-groups(32s)/goal-driver(31s)/
cap-from-gate-cli(31s)/writestate-atomicity-split(30s)/observer-registry(30s)。

另两处独立开销：①plugin/scripts/checker-mutation-check.sh 的80个mutation用例是bash顺序for循环
（run_one_case "$name" "$workdir"; exit_code=$?，无backgrounding），单独占静态检查阶段18秒，
同款毛病——没用到并发。②"Install suite runtime prerequisites" 这一步每次job都要重新apt装
PyYAML/tmux/procps（~8秒），因为ephemeral容器不留状态，是纯粹重复劳动。

subagent 已完成 ready-pool-check.test.mjs（拆9个文件）和 slot-refill.test.mjs（拆8个文件）的具体
拆分方案（按功能边界，零跨用例共享状态，拆分零行为风险）。

## 范围与非目标

范围：main/serial/lowconc 三阶段的单文件地板全部压到30秒以下（15个已点名文件）——由 **AC-279** 承载，已 achieved。

原范围另两项与收口口径经人 2026-10-07 裁定取消（判据已陈旧，逐条理由见 `## 退出条件`）：②静态检查80用例
mutation-check 并行化（原 AC-280）、③自定义 runner 镜像消除重复装包（原 AC-282），以及 30 秒这个数本身
（原 AC-281）。

非目标：不设数值稳定性阈值（绿率 / 连续 N 次）——先拿读数再谈阈值（硬规则 4 推论一）。

## 执行主机（人 2026-09-17 裁定）

开发活动（拆分15个文件、并行化 checker-mutation-check.sh）在本机 boheidc 执行，走既有的
worker-driver/promotion-driver 自动化流水线（`/home/yale/work/quay-worktrees/<task-id>`）——
不在 tokyo-alpha 上开发。依据：①boheidc 已经是这套流水线的常驻宿主（promotion-driver/
worker-driver 已在跑，且前两条相关任务 gap-outer-tick-log-awk-mawk-interval-red /
gap-tokyo-alpha-runner-env-lacks-pyyaml-suite-red 都是被这条流水线在 boheidc 上接走做完的）；
②boheidc 是16核，正是 `gap-suite-not-robust-at-high-derived-concurrency` 证据里"这个套件日常
被开发/验证的那台16核机器"，本地跑 `scripts/test.sh` 验证拆分正确性天然吻合这个惯例；
③tokyo-alpha 只是 AC-281 的真实执行靶子——CI 的 `runs-on: [self-hosted, tokyo-alpha]` 由
push develop 或 `gh workflow run` 自动触发派发，这两件事在 boheidc 上就能做，不需要登录
tokyo-alpha 开发，tokyo-alpha 上也没有这个仓库的任务/worktree 基础设施。

⛔ 不要因为任务标题含"self-hosted runner"字样就假定要 SSH 到 tokyo-alpha 上直接改代码。

## 退出条件

**在域 AC = AC-279**（15个原地大文件全部被拆分/移走），已 achieved ⇒ 本 GOAL 达成。

⛔ 已退役、不再计入范围（人 2026-10-07 裁定取消，均置 `superseded`）：

· **AC-280**｜判据 grep `plugin/scripts/checker-mutation-check.sh` 里字面量 `run_one_case "$name" "$workdir"`。
  该 bash 循环已被 GOAL-026 §5.2（`gap-arch-tsify-checker-mutation-check-sh`）迁进
  `plugin/scripts/checker-mutation-check.ts`，入口变成薄垫片 ⇒ 谓词要找的调用点结构上不存在，判据恒红。
  **保证本身仍在**（`.ts` 里有真的 bounded-parallel 用例池：`poolMax` / `Promise.race` / `Promise.all`）。
· **AC-281**｜30 秒这个口径是在 **649 个测试文件 / job 208s** 的成本结构下立的；套件已涨到 852 文件、
  scheduler 实测 51–72s，且判据读「最新一次 post-filing run」⇒ 它永远指向最后一个 run，CI 因任何与本
  目标无关的原因红都让它红 —— 结构上不再由工作决定。
· **AC-282**｜判据读最新一次 run 的派生字段 `prereqProvision`；新 run 一到、日志还没派生完就翻成
  `underivable`（NOT-EVALUATED），是个会闪的窗口。collector 的派生（`ci-runs-collect.ts`）与
  `.github/workflows/ci.yml` 的 `__PREREQ__` 标记都仍在。
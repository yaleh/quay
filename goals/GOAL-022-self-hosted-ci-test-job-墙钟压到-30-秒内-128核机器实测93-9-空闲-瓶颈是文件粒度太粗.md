---
id: GOAL-022
title: self-hosted CI test job 墙钟压到 30 秒内——128核机器实测93.9%空闲，瓶颈是文件粒度太粗+重复装包
status: active
kind: goal
origin: 人 2026-09-17 要求：分析 self-hosted CI 负载并建 GOAL 驱动优化
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

范围：main/serial/lowconc 三阶段的单文件地板全部压到30秒以下（15个已点名文件）+ 静态检查80用例
mutation-check 并行化 + 自定义 runner 镜像消除重复装包。
非目标：不追求"绝对30秒"是数学精确值——AC-281 用真实 CI 一次 ≤30s 的绿跑作收口证据，不设更严的
连续N次要求（后续 goal-driver 自己的 I5 achieved-but-failing 复检机制会持续盯着有没有退化）。

## 退出条件

三条 AC 全部 achieved：AC-279（15个原地大文件全部被拆分/移走）、AC-280（checker-mutation-check.sh
的用例循环真正并行化）、AC-281（.quay/ci-runs.jsonl 里本 GOAL 立案之后的最新一次 develop CI
test job 是 success 且 durationSec ≤30）。
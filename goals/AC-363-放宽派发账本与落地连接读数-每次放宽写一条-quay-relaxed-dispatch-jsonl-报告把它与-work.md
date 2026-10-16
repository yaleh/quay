---
id: AC-363
title: 放宽派发账本与落地连接读数：每次放宽写一条 .quay/relaxed-dispatch.jsonl，报告把它与 worker-outcome
  连接给出额外 worker 分钟、尝试次数、fan-in 失败步，并给出同期未放宽对照；样本不足为 not-evaluated 而非 0
status: draft
kind: criterion
goal: GOAL-037
criterion: >-
  set -u

  T=plugin/test/touches-relax-ledger.test.mjs

  [ -f "$T" ] || { echo "CAUSE=relax-ledger-test-absent — $T does not exist"
  >&2; exit 1; }

  out=$(mktemp) || { echo "CAUSE=mktemp-failed — cannot create a scratch file
  for the test output" >&2; exit 1; }

  timeout 55 node --experimental-strip-types --test "$T" > "$out" 2>&1; rc=$?

  [ "$rc" != 124 ] || { echo "CAUSE=relax-ledger-test-too-slow — exceeded 55s"
  >&2; rm -f "$out"; exit 1; }

  [ "$rc" = 0 ] || { echo "CAUSE=relax-ledger-test-red-rc$rc — $(tail -c 300
  "$out" | tr '\n' ' ')" >&2; rm -f "$out"; exit 1; }

  rm -f "$out"

  exit 0
expect: plugin/test/touches-relax-ledger.test.mjs 存在、在 55 秒内通过。读数（fixture 账本 +
  fixture worker-outcome，注入时钟）：(a) 账本记录形状含
  task、blockers、overlapFiles、waitedMinutes、dispatchedAt，追加写、不改写旧行；(b)
  报告函数把每条放宽记录与该任务在 worker-outcome 里的全部运行连接，给出
  extraWorkerMinutes（相对对照组同口径中位数的差）、attempts、fanInFailureSteps（取自
  mechanical_fan_in.step，词表与 final_state 分开）；(c) 对照组 =
  同一时间窗内未放宽、同样落地的任务，口径与放宽组相同；(d) 放宽样本或对照样本不足时报告 evaluated:false 并写明 reason，⛔
  不得输出 0 或空均值伪装成「无额外成本」（硬规则 3b）；(e) 取假形态：把连接键写成按位置而非按任务 id 时本测试必须变红。先后提示：与
  AC-362、AC-364 同属第一批。
origin: 用户 2026-10-16 在会话「ClaudeCodeUI
  局部重构方案」中认可「等待超过阈值乐观派发」改动方案（§3.3、§4）。合并成本预算需要「放宽的任务比不放宽的多花多少」的读数；现状里 worker 追平
  develop 时的冲突没有被记录，fan-in 的 merge-develop 失败率很低（quay 83/2492≈3.3%，claudecodeui
  2/1321≈0.15%），因为重叠任务被串行化了，放宽后冲突会出现在 worker 运行里。
---

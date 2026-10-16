---
id: AC-366
title: mode=live 的放宽语义：仅当等待达阈值、重叠不含
  never_relax、名额未满、挡它的在飞任务本身未被放宽、无过宽通配时放行；shared_files 内的重叠直接不算冲突；任何一项读不到即保持阻塞
status: active
kind: criterion
goal: GOAL-037
criterion: >-
  set -u

  T=plugin/test/touches-relax-live-predicate.test.mjs

  [ -f "$T" ] || { echo "CAUSE=relax-live-test-absent — $T does not exist" >&2;
  exit 1; }

  out=$(mktemp) || { echo "CAUSE=mktemp-failed — cannot create a scratch file
  for the test output" >&2; exit 1; }

  timeout 55 node --experimental-strip-types --test "$T" > "$out" 2>&1; rc=$?

  [ "$rc" != 124 ] || { echo "CAUSE=relax-live-test-too-slow — exceeded 55s"
  >&2; rm -f "$out"; exit 1; }

  [ "$rc" = 0 ] || { echo "CAUSE=relax-live-test-red-rc$rc — $(tail -c 300
  "$out" | tr '\n' ' ')" >&2; rm -f "$out"; exit 1; }

  rm -f "$out"

  exit 0
expect: plugin/test/touches-relax-live-predicate.test.mjs 存在、在 55 秒内通过。读数（真实谓词 +
  注入时钟 + fixture 状态事件账本）：(a) 边界：等待刚好等于 after_minutes 放行、少一分钟阻塞；(b) 重叠文件命中
  never_relax ⇒ 阻塞；(c) 当前已放宽的在飞任务数已达 max_relaxed_inflight ⇒ 阻塞；(d)
  挡住候选的在飞任务本身是被放宽派发的 ⇒ 阻塞（不连锁）；(e) 候选 Touches 含过宽通配 ⇒ 阻塞；(f) 重叠全部落在 shared_files
  内 ⇒ 视为不冲突，立即放行且不要求等待；(g) 等待时长读不到（账本无该任务的 ready 事件）⇒ 阻塞，⛔ 不得当作 0 也不得当作无穷；(h)
  放行时写一条 .quay/relaxed-dispatch.jsonl 记录（形状见 AC-363）；(i) 仍被 depsSatisfied /
  retryCapNotExhausted / notNeedsHuman 挡住的候选不因放宽而放行；(j)
  取假形态：把谓词写成恒放行、或去掉任一条件，本测试对应用例必须变红。先后提示：依赖 AC-365；AC-367 依赖本条。⛔
  本条不启用生产：生效需要人在目标项目的 .quay/config.yml 里显式把 mode 设为 live 并重启 worker driver。
origin: 用户 2026-10-16 认可方案 §3.1、§3.2、§4。依据：对 claudecodeui 的历史重放，放宽（等待 30 分钟、冲突概率
  0.5）使 AC 延迟中位数约 −17%（90% 区间 −29% 至 −4%），p90 不变；quay 上收益约 0（组合 −1%，区间 −4% 至
  +1%），所以只在 claudecodeui 启用。重放基线偏悲观，收益可能被高估。
activatedAt: 2026-10-16T15:38:55.044Z
statusLog:
  - at: 2026-10-16T15:38:55.044Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-16T15:38:55.044Z
---

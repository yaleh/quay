---
id: AC-367
title: 合并成本闭环：放宽任务相对对照的额外成本或 fan-in 失败率超过配置阈值时自动写
  relax_halted；样本不足或阈值未配置时不自动动作并报 not-evaluated
status: active
kind: criterion
goal: GOAL-037
criterion: >-
  set -u

  T=plugin/test/touches-relax-auto-tighten.test.mjs

  [ -f "$T" ] || { echo "CAUSE=relax-tighten-test-absent — $T does not exist"
  >&2; exit 1; }

  out=$(mktemp) || { echo "CAUSE=mktemp-failed — cannot create a scratch file
  for the test output" >&2; exit 1; }

  timeout 55 node --experimental-strip-types --test "$T" > "$out" 2>&1; rc=$?

  [ "$rc" != 124 ] || { echo "CAUSE=relax-tighten-test-too-slow — exceeded 55s"
  >&2; rm -f "$out"; exit 1; }

  [ "$rc" = 0 ] || { echo "CAUSE=relax-tighten-test-red-rc$rc — $(tail -c 300
  "$out" | tr '\n' ' ')" >&2; rm -f "$out"; exit 1; }

  rm -f "$out"

  exit 0
expect: plugin/test/touches-relax-auto-tighten.test.mjs 存在、在 55 秒内通过。读数（fixture
  账本 + fixture worker-outcome，注入时钟，复用 AC-363 的报告函数）：(a)
  样本不足（少于配置的最小样本数）或阈值未在配置中给出 ⇒ 读数 evaluated:false 并写明 reason，⛔ 不写
  relax_halted，也不得退化成「默认阈值」；(b) 放宽组相对对照的额外 worker 分钟或 fan-in 失败率超过配置阈值 ⇒ 写
  relax_halted:true（沿用 .quay/worker-control.json 一类的控制状态机制，不新造哨兵文件），并在 round
  记录里留痕原因与读数；(c) relax_halted 为真时，谓词在 live 模式下也保持阻塞；(d) 人工清除 relax_halted
  后恢复；(e) fan-in 失败率按 mechanical_fan_in.step 分步统计，suite 红与 merge-develop 红分开呈现，⛔
  不合并成一个「失败」；(f) 取假形态：把比较写成恒不超阈值，本测试必须变红。先后提示：依赖 AC-363 与
  AC-366。阈值与最小样本数的取值本条不设定，等 AC-362 的数据与影子期读数出来后由人在配置里给。
origin: 用户 2026-10-16 认可方案 §3.3、§4：合并成本做成受控预算而不是一次性放开。fan-in 失败里 suite 红是主因（quay
  827/2492≈33%，claudecodeui 453/1321≈34%），语义破坏会体现在这里，必须单独监控；阈值不凭空设，因为现在没有放宽样本。
activatedAt: 2026-10-16T15:41:53.877Z
statusLog:
  - at: 2026-10-16T15:41:53.877Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-16T15:41:53.876Z
---

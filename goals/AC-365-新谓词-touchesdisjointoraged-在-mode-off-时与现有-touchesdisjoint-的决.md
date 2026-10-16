---
id: AC-365
title: 新谓词 touchesDisjointOrAged 在 mode=off 时与现有 touchesDisjoint
  的决策逐一相同；mode=shadow 时决策仍与 off 相同，只在 filter_trace 里标出「会被放宽」的候选
status: draft
kind: criterion
goal: GOAL-037
criterion: >-
  set -u

  T=plugin/test/touches-relax-off-parity.test.mjs

  [ -f "$T" ] || { echo "CAUSE=relax-parity-test-absent — $T does not exist"
  >&2; exit 1; }

  out=$(mktemp) || { echo "CAUSE=mktemp-failed — cannot create a scratch file
  for the test output" >&2; exit 1; }

  timeout 55 node --experimental-strip-types --test "$T" > "$out" 2>&1; rc=$?

  [ "$rc" != 124 ] || { echo "CAUSE=relax-parity-test-too-slow — exceeded 55s"
  >&2; rm -f "$out"; exit 1; }

  [ "$rc" = 0 ] || { echo "CAUSE=relax-parity-test-red-rc$rc — $(tail -c 300
  "$out" | tr '\n' ' ')" >&2; rm -f "$out"; exit 1; }

  rm -f "$out"

  exit 0
expect: plugin/test/touches-relax-off-parity.test.mjs 存在、在 55 秒内通过。读数（真实
  applyTaskFilters，TASK_FILTERS 里 touchesDisjointOrAged 取代
  touchesDisjoint，fixture 任务目录）：(a) mode=off（含配置块缺失）时，对「无在飞 / 有重叠 / 无重叠 / 空
  Touches / 通配声明 / 读不出的任务文件」的输入矩阵，返回的候选集合与顺序与基线 touchesDisjoint 逐一相同；(b)
  mode=shadow 时返回结果与 off 完全相同，同时 filter_trace 里对满足全部放宽条件的候选标出
  wouldRelax:true，对不满足的写明首个不满足的条件；(c) shadow 不得写
  .quay/relaxed-dispatch.jsonl（影子期不产生放宽账本）；(d) 取假形态：把 off 路径写成恒放行，或让 shadow
  真的放行，本测试必须变红。先后提示：依赖 AC-362（filter_trace）与 AC-364（配置）；AC-366 依赖本条。
origin: 用户 2026-10-16 认可方案 §3.1 与 §7：默认关闭时行为必须与现状逐字节相同，先影子后生效。依据：touches
  判定有预测力（落地相邻的重叠任务对重放合并，冲突率约 55–60%，对照 13–15%），不能在没有对照的情况下改变派发。
---

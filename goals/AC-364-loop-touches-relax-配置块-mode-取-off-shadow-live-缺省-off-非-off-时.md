---
id: AC-364
title: loop.touches_relax 配置块：mode 取 off|shadow|live，缺省 off；非 off 时
  after_minutes 缺失即判配置不合格，不回退到任何内置数值；非法值非零退出并保留原配置
status: active
kind: criterion
goal: GOAL-037
criterion: >-
  set -u

  T=plugin/test/touches-relax-config.test.mjs

  [ -f "$T" ] || { echo "CAUSE=relax-config-test-absent — $T does not exist"
  >&2; exit 1; }

  out=$(mktemp) || { echo "CAUSE=mktemp-failed — cannot create a scratch file
  for the test output" >&2; exit 1; }

  timeout 55 node --experimental-strip-types --test "$T" > "$out" 2>&1; rc=$?

  [ "$rc" != 124 ] || { echo "CAUSE=relax-config-test-too-slow — exceeded 55s"
  >&2; rm -f "$out"; exit 1; }

  [ "$rc" = 0 ] || { echo "CAUSE=relax-config-test-red-rc$rc — $(tail -c 300
  "$out" | tr '\n' ' ')" >&2; rm -f "$out"; exit 1; }

  rm -f "$out"

  exit 0
expect: plugin/test/touches-relax-config.test.mjs 存在、在 55
  秒内通过。读数（真实配置读取与校验函数，fixture .quay/config.yml）：(a) 无该配置块 ⇒ mode 读作
  off，且读数里能区分「显式写了 off」与「没写」；(b) mode 为 shadow 或 live
  时，after_minutes、max_relaxed_inflight 必须显式给出，缺任一项 ⇒ 校验不通过并点名缺哪一项，⛔
  不得回退到任何内置默认数值（本机等价于不限制的字面值在换机后会变成真限制，硬规则 4 推论二）；(c) shared_files 与 never_relax
  为路径或 glob 列表，缺省为空列表；(d) 非法值（mode 不在词表、after_minutes 非正数、max_relaxed_inflight
  非整数）⇒ 校验非零退出，原配置文件字节不变；(e) 取假形态：把缺省改成 live 或给 after_minutes
  一个内置默认值，本测试必须变红。先后提示：与 AC-362、AC-363 同属第一批。
origin: 用户 2026-10-16 认可方案 §3.4：阈值全部来自配置，代码里不写字面量，默认关闭。依据：quay
  的既有纪律「要求一个新前置/新机制之前先给出发生率读数；无读数的数值阈值不得凭空设」——after_minutes 与名额的合适取值要等第 0 步的
  filter_trace 数据（AC-362）出来才能定，所以缺失时判不合格而不是用一个猜的默认值。
activatedAt: 2026-10-16T15:36:29.527Z
statusLog:
  - at: 2026-10-16T15:36:29.527Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-16T15:36:29.527Z
---

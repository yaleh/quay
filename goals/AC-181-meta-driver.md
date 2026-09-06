---
id: AC-181
title: meta-driver 必须在生产载体上留下新鲜轮次——「实现了但生产没跑过」与「没实现」同形
status: draft
kind: criterion
goal: GOAL-001
criterion: test -f .quay/meta-driver-round.jsonl && [ $(( $(date +%s) - $(stat
  -c %Y .quay/meta-driver-round.jsonl) )) -lt 5400 ]
expect: 主检出的 .quay/meta-driver-round.jsonl 存在，且末次写入距今 < 90 分钟（复核间隔 20 分钟的宽裕余量）⇒
  meta-driver 确实在生产持续产出轮次，而不只是「注册好了」
origin: 2026-09-06 实测：meta 已注册进 DriverKind/DRIVER_KINDS/CLI
  KINDS/drivers.yml/driver-config，单测全绿，但主检出 .quay/ 下 meta-driver-round.jsonl /
  meta-control.json / meta-driver-state.json 三个载体全部不存在、进程数为 0——17 轮全部落在开发
  worktree。根因是 start-drivers.ts:33 的 DRIVER_KINDS=[promotion,worker] 从未随新增 kind
  更新（该文件只有一个提交），quality 同样不在其中、靠手工启动。硬规则 4 推论三：一个只能被 fixture/开发态满足的判据不是测量；AC
  必须至少有一条读生产载体。判据已实跑取假：立条时刻 exit=1（首轮尚未落地）。
evidence:
  at: 2026-09-06T22:32:46.489Z
  verdict: pass
  reading: acceptance passed (exit 0)
---

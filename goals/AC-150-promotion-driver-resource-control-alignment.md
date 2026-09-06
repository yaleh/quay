---
id: AC-150
title: promotion-driver 的资源感知与控制面对齐
status: active
kind: criterion
goal: GOAL-002
criterion: |
  node --no-warnings --experimental-strip-types -e 'import("./plugin/scripts/driver-shared.ts").then(s=>import("./plugin/scripts/driver-runtime.ts").then(m=>{process.exit(typeof s.resourceGateCheck==="function"&&typeof s.serveControlPlane==="function"&&m.DRIVER_KINDS.promotion.verbs.includes("drain")?0:1)}))'
expect: exit 0
origin: |
  manager 2026-08-23 架构审计直读发现，⛔ 编号接全局最大值 149、不复用。本阶段的主语就是
  promotion-driver（「晋升面机械化」），本条是本阶段交付物自身的功能缺口，不是分层就能自动补上
  ——分层只决定它将来放哪一层，不决定它现在有没有。缺口实测：promotion-driver.ts 对
  resource-gate 0 处（worker-driver 22 处）；promotion 每 30 秒无条件轮询、无条件 spawn LLM
  fix worker，机器负载多高都照 spawn；而 worker 会正确退避（2026-08-23 14:09
  resource-gate-wait: loadavg 41.86 就是它救的场）。两个驱动跑同一台机器，一个懂事一个不懂事。
evidence:
  at: 2026-09-06T17:03:30.072Z
  verdict: pass
  reading: acceptance passed (exit 0)
---

**判据（能取假，三条）**：
- **AC150-1（资源门）**：promotion-driver 在起 fix worker 前**经与 worker-driver 同一个资源门判定**；
  **取假**：资源门报 WAIT 期间 `promotion-outcome.jsonl` 仍出现新的 `action="fix"` 记录 ⇒ 假。
- **AC150-2（控制面）**：promotion-driver 可被**运行期**停机（halt），⛔ 非只能 `kill`；
  `quay driver drain --kind promotion` 不再报 `does not support`（现 KIND_VERBS 把该不对称固化成配置）。
  **取假**：halt 后下一轮仍晋升/仍 spawn fix worker ⇒ 假。
- **AC150-3（⛔ 不得靠"两个 kind 各写一份"满足）**：AC150-1/-2 的实现**必须是与 worker-driver 共用的
  同一份**（函数级复用，不是复制粘贴）。**取假**：`grep` 出两份独立的资源门判定/halt 判定实现 ⇒ 假。
  ⊢ 本条是给下一阶段分层留的接口：**先共用，再上收**。

**⊢ 非目标**：⛔ 不在本条做分层抽象本身（那是下一阶段 AC151）；⛔ 不改 promotion 的晋升判定语义。



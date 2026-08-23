---
id: gap-ac150-promotion-driver-resource-gate-control-plane
title: AC150 promotion-driver 资源门/控制面对齐（与 worker-driver 函数级复用）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 架构审计直读（判据正本 `orchestration/manager-phase-goal.md` `### AC150`，commit `39617238`，⛔ 不在此复制，读那一段）。

**缺口（实测，非推断）**：
```
grep -c "resource-gate\|resourceGate" promotion-driver.ts  ⇒  0（worker-driver.ts = 22）
grep -c "serveControlPlane\|CONTROL_HEADER" promotion-driver.ts ⇒ 0（worker 14）
promotion-driver.ts:26 明写「⛔ 不读/不写 .halt（停机态 = 进程信号）」
```
⇒ promotion-driver 每 30s 无条件轮询、无条件 spawn LLM fix worker，机器负载多高都照 spawn；而 worker-driver 会正确退避（`resource-gate-wait: loadavg 41.86` 那次就是它救的场）。两个 driver 跑同一台机器，worker 退避让出的资源可能正被 promotion 拿去起 LLM。

**⊢ 非目标**：⛔ 不在本条做分层抽象本身（下一阶段 AC151）；⛔ 不改 promotion 的晋升判定语义。

## Plan

1. 把 worker-driver 的 `resourceGateCheck` + `serveControlPlane` 抽成共享函数（函数级复用，⛔ 非复制粘贴）。
2. promotion-driver 起 fix worker 前经同一资源门判定（WAIT 退避）；接入控制面 halt（`quay driver drain --kind promotion` 不再报 `does not support`）。
3. 测试覆盖 + land 到 develop。

## Acceptance Criteria

判据正本在 `orchestration/manager-phase-goal.md` `### AC150`（⛔ 取假形态不在此复制）。

- [x] AC1（资源门，AC150-1）：promotion-driver 起 fix worker 前经与 worker-driver 同一资源门判定；取假见正本 AC150-1。
- [x] AC2（控制面，AC150-2）：promotion-driver 可运行期 halt，`quay driver drain --kind promotion` 不再报 `does not support`；取假见正本 AC150-2。
- [x] AC3（函数级复用，AC150-3）：AC1/AC2 实现与 worker-driver 共用同一份（⛔ 两个 kind 各写一份 ⇒ 假）；取假见正本 AC150-3。

## Definition of Done

- [x] promotion-driver 资源门 + 控制面落地且与 worker-driver 共用同一份实现；AC1-3 全勾；land 到 develop。

## Retires

- 无（复用 worker-driver 既有 `resourceGateCheck`/`serveControlPlane`，抽成共享载体）

## Touches

- plugin/scripts/promotion-driver.ts（起 fix worker 前过资源门 + 控制面 halt）
- plugin/scripts/worker-driver.ts（resourceGateCheck/serveControlPlane 抽成共享函数供复用）
- plugin/scripts/driver-shared.ts（新：共享资源门+控制面载体，两 driver 共用）
- plugin/scripts/capability-catalog.sh（driver-shared.ts 新脚本注册：QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING/CONSUMER 六表声明，gap-new-script-touches-missing-inventory-catalog-registration）
- docs/proposals/quay-product-outline.md（§6 DELIVERY-INVENTORY 快照再生成：scripts 282→283）
- plugin/scripts/promotion-driver-launch.sh（KIND_VERBS 给 promotion 开 drain；cmd_drain 写 promotion-control.json）
- packages/quay/src/cli/driver.ts（drain help 文本：promotion 不再「does not support」）
- packages/quay/src/cli/help.ts（同 driver.ts 的 help 文本，防漂移）
- plugin/test/promotion-driver.test.mjs（test）
- plugin/test/worker-driver.test.mjs（test）
- plugin/test/driver-cli.test.mjs（drain-for-promotion 断言反转：不再报 does not support）
- tasks/gap-ac150-promotion-driver-resource-gate-control-plane.md（自身）

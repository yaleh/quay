---
id: AC-229
title: 保真性闸双向可判且接在【真实激活路径】上——vacuous 拒绝激活 / faithful 放行 / not-evaluated
  不放行（GOAL-013 退出条件①②③④）
status: achieved
kind: criterion
goal: GOAL-013
criterion: node --no-warnings --experimental-strip-types --test
  plugin/test/criterion-fidelity-gate.test.mjs
expect: >-
  四个断言缺一不可，且**全部经【真实生产路径】断言**——测试必须 spawn 真的 `packages/quay/src/goal-store.ts
  write <id> --status active`（对一个 hermetic 临时 goals 目录），⛔ 不是只 import 判定函数做单测（硬规则
  4 推论三：只能被 fixture 满足的判据只证明「能产出」，不证明「已产出」；生产载体就是激活路径本身）。


  **①vacuous ⇒ 拒绝激活**：喂一条已知空洞的判据（形如「跑一个对其 expect 声称的目标类别结构上不可能红的检查器」）⇒ 真实 CLI
  **非零退出且不写状态**，理由可见于 stderr。

  **②faithful ⇒ 放行**：喂一条已知保真的判据 ⇒ 激活成功（exit 0、状态确实变 active）——⛔
  这一半是防「恒拒」的负控制，缺了它闸就与「谁都激活不了」同形。

  **③not-evaluated ⇒ 不放行，且与 vacuous 取值可区分**（硬规则 3b：读不懂 ≠ 合格，也 ≠ 判定为空洞）；`--force`
  可显式越权且**越权在记录里留痕**。

  **④既有激活路径逐字不变**：一条现存的、已知保真的 AC 走同一路径仍能激活；I2/I4/I5 语义与任何现存记录状态不被本闸改动。


  ⛔ 本条**不**把「判定器内部是否调 LLM」当判据——那是实现选择；判据只看真实 CLI 在四种输入下的**可区分行为**。
origin: GOAL-013 的机器判据之一。立条依据见 GOAL-013 的 origin（人 2026-09-10 授权；AC-225 于
  07:00:55Z 被 I2 flip achieved 而其判据对目标类别结构上不可能红，实质缺口由 aca7a0511 在 73 分钟后闭合；I2
  误触发、I5 全盲）。本条判据在立条当轮已干跑取真实读数：exit 1（"Could not find <file>" ⇒ 判据可评估、非 spawn
  失败），符合「判据落笔当轮必须取一次真实读数」（硬规则 4c）。判据只引用不会自行回退的量——代码状态与套件绿红，⛔ 不含进程存活/远程可达性/LLM
  当次可用性。
activatedAt: 2026-09-10T10:07:22.875Z
statusLog:
  - at: 2026-09-10T10:07:22.876Z
    from: draft
    to: active
    actor: cli:human-ruling-2026-09-10
    reason: 人 2026-09-10 授权执行（单次授权）：立 GOAL-013 判据保真性闸
  - at: 2026-09-10T10:56:12.119Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---

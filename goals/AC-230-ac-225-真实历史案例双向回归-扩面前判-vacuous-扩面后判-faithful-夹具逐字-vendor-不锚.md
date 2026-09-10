---
id: AC-230
title: AC-225 真实历史案例双向回归——扩面前判 vacuous / 扩面后判 faithful，夹具逐字 vendor ⛔ 不锚 commit
  SHA（GOAL-013 退出条件⑤②）
status: achieved
kind: criterion
goal: GOAL-013
criterion: node --no-warnings --experimental-strip-types --test
  plugin/test/criterion-fidelity-historical-case.test.mjs
expect: >-
  **本条是全 GOAL 唯一的【真实历史】负控制**——⛔ 不是合成夹具（硬规则 4 推论三：一个只能被注入数据满足的判据只证明「能产出」；风险 2
  的自指对冲要求至少一例来自真实历史）。


  **双向，两个方向缺一不可，且用【同一个真实案例】**：

  **①扩面前 ⇒ `vacuous`**：把 `aca7a0511` **之前**的
  `kernel-sibling-resolution-check.ts` 形态（只有 P1/P2/P3、无 P4 跨包形态）+ AC-225 **逐字的**
  criterion（`… --root . --json`）与 expect（「完整性由检查器的机械枚举给出，不是手工清单」）喂进判定器 ⇒ 必须判
  `vacuous`。这是 2026-09-10 那 73 分钟里真实发生过的输入。

  **②扩面后 ⇒ `faithful`**：换成 `aca7a0511` **之后**的形态（含 P4 三形态 + 突变用例 + 单测覆盖）+ 同一条
  criterion/expect ⇒ 必须判 `faithful`。**缺了②本条就与「恒判 vacuous」同形**，那样的判定器会挡住一切激活。


  **夹具纪律（硬规则 5b 已记的同款陷阱）**：两个检查器形态必须**逐字 vendor 成仓库内的夹具文件**，⛔ 不得用 `git show
  aca7a0511^:…` 之类锚在 commit SHA 上的取法——判据不得引用一个生命周期短于判据本身的对象（rebase/squash
  后变假阴性）。


  **可直接验证**：两个方向都是当前树上的纯输入判定，跑一次即得，⛔ 不依赖任何需多轮积累的生产读数。
origin: GOAL-013 的机器判据之一（退出条件⑤的落点）。立条依据见 GOAL-013 的 origin。本条把 2026-09-10
  07:00:55Z→08:16:28Z 那 73 分钟的真实输入固化成回归夹具——该案例是本 goal 立条的唯一生产实证，也是风险
  2（判定器自己空洞）的唯一非合成对冲。本条判据在立条当轮已干跑取真实读数：exit 1（"Could not find <file>" ⇒ 判据可评估、非
  spawn 失败），符合硬规则 4c。判据只引用不会自行回退的量——代码状态与套件绿红。
activatedAt: 2026-09-10T10:07:23.900Z
statusLog:
  - at: 2026-09-10T10:07:23.901Z
    from: draft
    to: active
    actor: cli:human-ruling-2026-09-10
    reason: 人 2026-09-10 授权执行（单次授权）：立 GOAL-013 判据保真性闸
  - at: 2026-09-10T10:56:14.013Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---

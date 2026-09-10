---
id: AC-230
title: AC-225 真实历史案例双向回归——扩面前判 vacuous / 扩面后判 faithful，夹具逐字 vendor ⛔ 不锚 commit
  SHA（GOAL-013 退出条件⑤②）
status: achieved
kind: criterion
goal: GOAL-013
criterion: node --no-warnings --experimental-strip-types --test
  plugin/test/criterion-fidelity-historical-case.test.mjs
expect: |-
  **本条是全 GOAL 唯一的【真实历史】负控制**——⛔ 不是合成夹具（硬规则 4 推论三）。

  **双向，两个方向缺一不可，且用【同一个真实案例】**：
  **①扩面前 ⇒ `vacuous`**：`aca7a0511` **之前**的 `kernel-sibling-resolution-check.ts` 形态（只有 P1/P2/P3、无 P4 跨包形态）+ AC-225 **逐字的** criterion 与 expect ⇒ 系统必须判 `vacuous`。
  **②扩面后 ⇒ `faithful`**：换成 `aca7a0511` **之后**的形态（含 P4 三形态）+ 同一条 criterion/expect ⇒ 必须判 `faithful`。缺 ② 则与「恒判 vacuous」同形。

  **判决由【机械半】给出，⛔ 不是 LLM——这是 2026-09-10 实测后的修法**：真判定器（deepseek-v4-pro-anthropic 经 `launchArgv("fix-worker")`）对 pre/post **各 6 次读数、12/12 全判 `faithful`**（原始输出落盘于 `plugin/test/fixtures/criterion-fidelity/readings/real-judge-readings.jsonl` 与 `real-judge-{pre,post}.stdout.txt`）⇒ **LLM 判别力 = 0，且是稳定不判别而非噪声**。故改用方向 B **机械前置筛** `mechanicalFidelityVerdict`：结构性比较「判据所调检查器的**扫描面顶层目录段**」与「其 **RegExp 覆盖签名**」——声称的对象类别 ⊄ 覆盖面 ⇒ `vacuous`。⛔ 不认文件名/AC 编号/夹具身份。

  **⇒ 那两份 LLM 原始输出保持 `faithful` 是【正确且必须保留】的**——它们是能力缺口的历史记录，⛔ 不得为了让判据变绿而改写它们（本 AC 2026-09-10 曾一度把判据锚在这两个文件上，那是错锚：它们记录的是 LLM 的判决，而判别力由机械半提供 ⇒ 结构上不可满足，已改锚）。

  **判据能取假（立条当轮双向干跑）**：当前 exit 0；把 `mechanicalFidelityVerdict` 改成恒返回 `null`（回落语义半）⇒ exit 1。⇒ 机械判别一旦失效，本条即红。

  **⛔ 防过拟合**：判别不得只对本案例成立——`plugin/test/fixtures/criterion-fidelity/independent-{vacuous,faithful}-case.txt` 是两例与 kernel-sibling **无关**的独立构造判据（criterion/expect 逐字相同，只差 mechanism 是否引用 `packages` 段），独立空洞 ⇒ `vacuous`、独立保真 ⇒ `faithful`，同在本判据的测试内钉死。
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
  - at: 2026-09-10T13:13:55.996Z
    from: achieved
    to: active
    actor: cli:human-ruling-2026-09-10
    reason: 人 2026-09-10 裁定：命题实测未达成（真判定器对 pre/post 均判 faithful ⇒ 判别力 0），且原判据被改成断言
      expect ① 的反面而仍 pass ⇒ 判据不再测量本 AC 声称的对象。退回 active 并改锚到读真判定器原始输出落盘文件。
  - at: 2026-09-10T13:17:21.805Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---

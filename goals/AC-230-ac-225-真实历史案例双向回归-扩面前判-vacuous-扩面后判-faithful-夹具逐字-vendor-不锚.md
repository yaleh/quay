---
id: AC-230
title: AC-225 真实历史案例双向回归——扩面前判 vacuous / 扩面后判 faithful，夹具逐字 vendor ⛔ 不锚 commit
  SHA（GOAL-013 退出条件⑤②）
status: active
kind: criterion
goal: GOAL-013
criterion: grep -q '"verdict":"vacuous"'
  plugin/test/fixtures/criterion-fidelity/real-judge-pre.stdout.txt && grep -q
  '"verdict":"faithful"'
  plugin/test/fixtures/criterion-fidelity/real-judge-post.stdout.txt
expect: >-
  **本条是全 GOAL 唯一的【真实历史】负控制**——⛔ 不是合成夹具（硬规则 4 推论三）。


  **双向，两个方向缺一不可，且用【同一个真实案例】**：

  **①扩面前 ⇒ `vacuous`**：`aca7a0511` **之前**的 `kernel-sibling-resolution-check.ts`
  形态（只有 P1/P2/P3、无 P4 跨包形态）+ AC-225 **逐字的** criterion 与 expect ⇒ 真判定器必须判
  `vacuous`。

  **②扩面后 ⇒ `faithful`**：换成 `aca7a0511` **之后**的形态（含 P4 三形态）+ 同一条 criterion/expect
  ⇒ 必须判 `faithful`。缺 ② 则与「恒判 vacuous」同形。


  **⚠️ 2026-09-10 实测：本条命题【未达成】，故本 AC 由 achieved 退回 active。**
  真判定器（deepseek-v4-pro-anthropic 经 `launchArgv("fix-worker")`）对 pre/post
  两个夹具**都判 `faithful`**（原始输出 vendor 在
  `plugin/test/fixtures/criterion-fidelity/real-judge-{pre,post}.stdout.txt`，各
  23B）⇒ **判别力 = 0**，闸接上也会放行 AC-225 那条空洞判据。GOAL-013 风险 2（判定器自己空洞）已实测发生，只是发生在 LLM
  判别力层而非代码层。


  **判据形态（2026-09-10 改锚，⛔ 原判据不能取假）**：原判据是「跑
  `criterion-fidelity-historical-case.test.mjs`」，而该测试在实测失败后被改成断言 `pre ⇒
  faithful`——**判据 pass 而它断言的正是本 expect ① 的反面**，即判据不再测量本 AC 声称的对象（硬规则
  4）。现判据直接读**真判定器原始输出落盘文件**的内容：pre 必须记录 `vacuous`、post 必须记录
  `faithful`。立条当轮三向干跑：今日 exit 1（命题未达成）／谓词对 post 方向命中 exit 0（⛔ 非恒假）／pre 改为
  `vacuous` 时 exit 0（命题成立即转绿）。


  **⛔ 防作弊（judgment 不得靠改文件伪造）**：本判据只是廉价闸；「读数是真判定器跑出来的、且不是对本夹具过拟合」由
  `tasks/gap-fidelity-judge-cannot-discriminate-the-founding-vacuous-case` 的
  AC1（≥5 次重复读数分辨稳定/噪声）、AC2（≥3 次一致）与 AC3（另造一例独立空洞判据仍须判 vacuous）承担。⛔ 手写 `vacuous`
  进文件而不跑判定器 = 违反该任务 DoD。
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
---

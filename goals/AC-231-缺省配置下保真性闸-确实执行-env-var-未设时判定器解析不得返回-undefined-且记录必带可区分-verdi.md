---
id: AC-231
title: 缺省配置下保真性闸【确实执行】——env var 未设时判定器解析不得返回 undefined，且记录必带可区分 verdict（GOAL-013
  退出条件①③）
status: achieved
kind: criterion
goal: GOAL-013
criterion: node --no-warnings --experimental-strip-types --test
  plugin/test/criterion-fidelity-default-wiring.test.mjs
expect: >-
  **四个断言缺一不可。核心命题：缺省配置（`QUAY_GOAL_FIDELITY_JUDGE` 未设）下，激活路径【不会跳过】保真性判定。**


  **①缺省不惰性（本条的重点）**：`goal-store.ts` 的判定器解析在该 env var **未设**时必须产出一个判定器（非
  `undefined`）⇒ `:797` 的 `typeof fidelityJudge === "function"`
  短路分支在缺省配置下**结构上不可达**。立条时实测：该解析返回 `undefined`、env var 的**非测试非定义处**生产接线点 =
  **0**（零计数已配正控制：同一谓词对 `QUAY_NATIVE_TASKS_DIR` 返回 263、`QUAY_TEST_CGROUP_SCRIPT`
  返回 4 ⇒ 谓词非恒零；3 个在跑 driver 的 `/proc/<pid>/environ` 命中亦均为 0）⇒ 本条此刻红。


  **②可见性双向**：激活一条 AC 后记录上**必带** `fidelity.verdict`，且「未判成」与「判过」**取值可区分**。⛔
  字段缺失不算一态——那与「闸从未跑」同形（硬规则 3b）。


  **③⛔ 不得靠注入 seam 满足 ①**：测试不得通过设置 `QUAY_GOAL_FIDELITY_JUDGE` 来让 ①
  通过——那测的是**缝**，不是**缺省路径**。


  **④成本纪律**：本判据由 goal-driver 每约 42 秒复跑 ⇒ ⛔ 判据内**不得真调 LLM**（否则原样重演
  `gap-goal-gate-timestamp-commit-flood`——实测 gate-events 最近 400 条全是每 42 秒的
  gate）。允许只断言判定器 **argv 被构造**而不调用它。立条时实测同族两支测试耗时 **2.47s / 0.39s**，本支应同量级。


  **⛔ 本条不接受「测试都绿」作为达成证明**——AC-229/AC-230 的测试在立本条时就已全绿，而闸在生产缺省配置下**一次都没执行过**。
origin: 'GOAL-013 的机器判据之一，人 2026-09-10 授权补立。立条实证：AC-229/AC-230 已 achieved 且 I4
  分歧已在 GOAL-013 上报出（check --staleness ⇒ divergent: ["GOAL-013"]）⇒ 它离 flip
  achieved 只差一次充分性判 covered，而其闸在生产缺省配置下从不触发（goal-store.ts:797 要求 fidelityJudge
  为函数；judge 唯一来源 env var QUAY_GOAL_FIDELITY_JUDGE 的生产接线点实测 0；代码注释 :1027 自承
  fails-open）⇒ 若照此关闭，GOAL-013 自己就成为它要治的 achieved-but-vacuous 的第三例（前两例：AC-225
  空洞、GOAL-012 据其关闭）。实现归
  tasks/gap-fidelity-judge-unwired-in-production-and-verdict-stubbed-in-tests（本条
  = 该任务 AC2 在 goal 层的锚点）。本条判据在立条当轮已干跑取真实读数：exit 1（"Could not find <file>" ⇒
  可评估、非 spawn 失败），符合硬规则 4c。判据只引用不会自行回退的量——代码状态与套件绿红，⛔ 不含进程存活/远程可达性/LLM 当次可用性。'
activatedAt: 2026-09-10T11:39:29.189Z
statusLog:
  - at: 2026-09-10T11:39:29.189Z
    from: draft
    to: active
    actor: cli:human-ruling-2026-09-10
    reason: 人 2026-09-10 授权补立：趁 GOAL-013 仍 active（I4 已报
      divergent）钉住「闸在生产缺省配置下确实执行」，防它在闸从未执行的情况下 flip achieved
  - at: 2026-09-10T15:34:15.338Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---

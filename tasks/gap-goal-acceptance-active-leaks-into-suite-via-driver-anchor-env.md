---
id: gap-goal-acceptance-active-leaks-into-suite-via-driver-anchor-env
title: driver-anchor 环境泄漏的 QUAY_GOAL_ACCEPTANCE_ACTIVE=1 被 suite 继承 ⇒ 8 个 goal
  家族测试文件恒红（同一份与 delta 无关的红，视 anchor 谱系时而落地、时而烧到重试上限）——scripts/test.sh 入口归一化块（既有
  unset FORCE_COLOR 那一块）缺了这个成员
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** finding

## Finding

**同族已有先例，本条是它的缺失实例**：`scripts/test.sh:167-176` 已有一块 **entry normalization**，其唯一既有成员是
`unset FORCE_COLOR`，自述理由逐字是「Normalize HERE at the entry so EVERY child process / spawnSync inherits the
unset var (AC2: entry-level, never a single-point patch)」（配套任务 `gap-suite-force-color-ansi-test-sh-normalize`，done）。
**同一个块里少了一个成员**：`QUAY_GOAL_ACCEPTANCE_ACTIVE` —— 硬规则 5b 的形态（修的人只盯被报出来的那一个，
而兄弟实例在同一个文件、同一个代码块里）。

**它是什么**：`GOAL_ACCEPTANCE_ACTIVE_ENV`（`packages/quay/src/goal-store.ts:118`）是**判据重入闸** ——
跑 goal 判据前置位、嵌套调用读到 `"1"` 即短路（`goal-store.ts:1784/1992`、`goal-driver.ts:639`）。
它的语义是**「本进程正在跑判据」**，因此**绝不该被子进程继承**。

**泄漏链（逐层实测，⛔ 非转述）**：

1. 常驻 `driver-anchor`（本工作区实测 `/proc/2391720/environ`）**带着 `QUAY_GOAL_ACCEPTANCE_ACTIVE=1`** ——
   PPID=1（启动者已退出），即它是从一个已导出该变量的 shell 启动的。
2. 该 anchor 派生的 worker-driver / worker 会话**继承**它：本 worker 自己的会话进程 `/proc/2808476/environ` 实测带它。
3. `plugin/scripts/suite-driver.ts:176` 的 spawn 用 `env: { ...process.env, … }` ⇒ 随 fan-in 传进 `scripts/test.sh` ⇒ `node --test`。
4. `scripts/test.sh` **只 unset `FORCE_COLOR`**（`:176`），没有 unset 它。

**后果（实测；同一 worktree、同一 HEAD，被红测试文件与 develop 逐字节相同 ⇒ 与任何任务 delta 无关）**：

上一轮 ac295 的 fan-in suite 日志
`.quay/fan-in-suite-gap-ac295-criterion-cmdline-port-literal-stale~wk-prod-anchor~1790189536705-d5c44a.log`：
`# fail 30`，而 `__PERFILE__ … passed=false` **恰好 8 个文件**（`goal-driver-s02/s04/s10/s12/s13`、
`l1-delivery-surface-check`、`goal-store`、`goal-invariants-standing`），其余文件全部 `passed=true`
⇒ 30 条失败**全部**落在这 8 个 goal 家族文件里。

**受控 A/B（一行复现，本次实测）**：

```
QUAY_GOAL_ACCEPTANCE_ACTIVE=1     node --test plugin/test/goal-invariants-standing.test.mjs ⇒ 红（assertion，actual:[]）
env -u QUAY_GOAL_ACCEPTANCE_ACTIVE node --test plugin/test/goal-invariants-standing.test.mjs ⇒ 19/19 pass
```

⇒ 这 8 个文件是**环境产物**，不是代码缺陷。

**发生率（硬规则 12：先给已经发生过几次）**：载体 `.quay/worker-outcome.jsonl`（append-only、不轮转）中，
带 `mechanical_fan_in.suiteSignatures` 且含本条签名 `缺口立案侧：违反且无在飞任务 ⇒ standing-violated（可立案）`
的记录 **2 条** —— `gap-fan-in-delta-classify-declared-doc-surfaces` @2026-09-23T18:53:27.828Z 与
`gap-ac295-criterion-cmdline-port-literal-stale` @2026-09-23T18:56:12.532Z，两条均 `step=suite, outcome=red`。

**泄漏不是恒在的 —— 这正是它危险的地方**：同族 17 个任务（ac179、ac288-ac294、ac296-ac303）在
2026-09-24T00:31–02:23 全部 `done` 落地，而那段时间 anchor 未被污染；同一批任务在 09-23 更早的窗口里则可能被卡。
⇒ **症状取决于 anchor 谱系，不取决于任务 delta**：同一份与 delta 无关的红，有时豁免落地、有时把任务烧到重试上限。

**为什么修在入口而不是各测试内**：入口归一化是既有设计（`unset FORCE_COLOR` 就在同一块），
逐个测试加 `env -u` 是第二个定义面，且新测试会持续漏掉。

## Acceptance Criteria

- [ ] **AC1（能取假 —— 双向控制，⛔ 不靠读源码）**：一条新测试对**入口本身**取读数：以导出
  `QUAY_GOAL_ACCEPTANCE_ACTIVE=1` 的父环境调用 `scripts/test.sh` 的最小形态，断言**子进程看不到该变量**；
  随后对**未修的**入口（或把修复回退）跑同一读数，结果必须**相反**。两条读数都贴逐字输出。
  ⛔ 只断言「test.sh 里有 unset 那一行」不算（硬规则 2：按位置判定，不按关键词）。
- [ ] **AC2（生产载体 · 硬规则 4 推论三）**：落地后，**在导出 `QUAY_GOAL_ACCEPTANCE_ACTIVE=1` 的外层环境下**，
  经 `scripts/test.sh` 真跑上一轮红的 8 个 goal 家族文件 ⇒ 全绿；贴命令 + 逐文件 `passed=true` 计数。
  ⛔ fixture/注入 seam 单独满足不算；⛔ N 只计【实现落地之后】的时间窗。
- [ ] **AC3（不削弱闸本身）**：重入闸在**它该生效的地方**仍然生效 —— `goal-store` / `goal-driver` 里
  「带闸 ⇒ 跑判据深度 1、`env -u` ⇒ 深度 ≥3」那两条既有判据**逐字仍绿**（贴读数）。
  ⛔ 修的是「子进程不该继承」，不是「把闸拆了」。若某条既有判据**依赖环境里带着闸**，必须点名并说明改法。
- [ ] **AC4（同族枚举 · 硬规则 5b）**：对 `scripts/test.sh` 的入口归一化块**及** `suite-driver.ts` 的 spawn env
  做逐项枚举：列出全部「driver/anchor 会继承、而测试语义要求其缺席」的环境变量候选，逐项贴
  「已 unset / 不需 unset（一句为什么）/ 需 unset 但本条未做（为什么）」。
  ⛔ 给不出枚举 ⇒ 视为只修了被报出来的那一个。
- [ ] **AC5（不回归）**：`bash scripts/test.sh --for-task <本任务>` 绿，且本任务 delta 只触及 `## Touches` 内路径。

## Definition of Done

**REAL LANDING（DIR-026 Reading A）**：不是「test.sh 加了一行」，而是**一条在污染环境下经入口真跑、且由生产载体留痕的绿读数**：

1. **落地对象**：入口归一化经提交落 develop（`scripts/test.sh` 的 unset，或 `suite-driver.ts` spawn env 剔除），
   且 AC1 的双向控制在**改后**的树上取到两个相反读数。
2. **生产载体**：AC2 的读数来自真实 `scripts/test.sh` 调用（不是 fixture 直接 import `node --test`），
   且发生在实现落地**之后**；贴逐文件 `passed=true` 与总数。
3. **闸未削弱**：AC3 两条既有判据逐字仍绿。
4. **家族差量**：AC4 的逐项枚举贴出，证明不是「只修了被报出来的那一个」。
5. **⛔ 三种凑绿禁止**：改测试断言；把这 8 个文件从 suite 选择面里排除（skip / 黑名单 / 收窄 glob）；
   只在 anchor 启动处硬删该变量而不处理「子进程不应继承」这一语义。三项均不得发生。

## Touches

- `scripts/test.sh`
- `plugin/scripts/suite-driver.ts`
- `plugin/test/test-sh-entry-normalization.test.mjs`
- `tasks/gap-goal-acceptance-active-leaks-into-suite-via-driver-anchor-env.md`
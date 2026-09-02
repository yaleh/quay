---
id: gap-worker-premerge-scoped-gate-cache
title: worker 退出前 agent-mediated pre-merge + scoped test，锁内 scoped-gate 加
  develop-sha 缓存跳过——缩短 fan-in 锁内占用、把合并冲突从"锁内检测"提前到"worker 自行解决"
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**实测背景**（2026-09-01 14:59-15:52Z 窗口，manager 会话现场诊断，见 `.quay/fan-in-<task>-<runId>.log` /
`.quay/fan-in-lock-events.jsonl` / `.quay/worker-outcome.jsonl`）：`runMechanicalFanIn`
（`worker-driver.ts:2420-2531`）在**拿到 fan-in 锁之后**才做 `merge-develop → anti-drift → delta →
typecheck∥doc-check → scoped-gate → suite → flip-done → ff`。两个实测代价：

1. `gap-dashboard-taskcard-multistatus-minitable` 一次尝试排队等锁 **6m14.9s**，拿到锁后 `merge-develop`
   **116ms** 内就冲突失败（与一次旁路直改 `8fc26d63` 撞了 `serve-dashboard.ts`）——**6 分钟排队只为了发现
   一个 116ms 就能测出的结论**。
2. `gap-fan-in-ff-protocol-check-false-positive-task-branch-merge` / `gap-tasks-page-develop-ref-...`
   两次成功落地里，锁内 merge+anti-drift+delta+typecheck∥doc-check+scoped-gate 实测各占 **113s / 98s**，
   全部叠加在 suite（366-440s）之外，成为"suite 只要 6-7 分钟、两次绿灯间隔却要 20+ 分钟"的一部分构成。

**锁的真实不变量**（本任务不改变这一条，是设计前提）：fan-in 锁保护的是"suite/bucket 测试跑的这段时间
develop 不被别的任务写"——suite 结果必须对应即将 push 的那个确切状态。**因此 suite/bucket 测试本身不能
挪出锁**，讨论已排除"suite 挪到锁外、乐观并发+失败重跑"的方案（在当前落地间隔 15-27 分钟的密度下，
无锁 suite 期间被抢先落地的概率不低，收益不确定且引入"push 的东西可能没有针对最终 develop 测过"的风险）。

**可以动的是 suite 之外的部分**，分两块，都不碰 suite 本身：

**(a) worker 侧 agent-mediated pre-merge + scoped test（锁外，worker 自己回合内完成）**：
`buildWorkerPrompt`/`buildContinueWorkerPrompt`（`worker-driver.ts:947-958` / `:1187+`）现在是
"实现+提交 → 直接退出，driver 接管"（`driverFanInNote()`，`worker-driver.ts:908-917`）。给它加一步：
实现完之后、退出之前，worker（agent，非纯脚本）自己 `merge develop` 到 worktree，跑与 fan-in 完全相同的
`bash scripts/test.sh --for-task <task> --allow-thin` 命令；如果冲突/变红，**worker 用它自己的判断力去
修**（不是脚本能做的——脚本只能检测冲突，agent 能真的解决冲突、适配上游改动），改到绿再提交、退出。
这一步之所以要放在 agent 回合里而不是纯机械脚本，是因为收益不只是"更早发现问题"，而是"很大一部分冲突
在这一步就被直接解决掉，根本不会再进入 fan-in 失败路径"。

**(b) fan-in 侧 scoped-gate 缓存命中跳过（锁内，安全条件严格）**：worker 在 (a) 步跑绿后，机械记录
`(task, developSha, verdict=pass)` 到一个新缓存文件（仿 `.quay/doc-check-cache.json` 的既有模式，
`worker-driver.ts:2499-2515` `docCheckLeg`/`computeDocCheckFaceKey`/`readDocCheckCache`/
`writeDocCheckCache` 是直接可抄的先例）。driver 在锁内 `merge-develop` 之后、`scoped-gate`
（`worker-driver.ts:2528-2531`）之前，查这份缓存：**当且仅当**锁内合并到的 develop tip 与 worker 记录
的 `developSha` 完全一致，才跳过 scoped-gate（cache-hit，可证明冗余——worker 已经对着这个确切状态验证
过绿）；develop 在这期间又前进了、或缓存缺失/读不懂，一律照跑（fail-closed，与 `docCheckLeg` 现有的
"面未变才缓存命中、算不出就照跑"是同一条纪律，不是新发明一套宽松规则）。

**净效果预期**（用已实测数字）：常见情形（worker 退出到 driver 拿锁之间 develop 未再变）下，锁内除 suite
外的部分从 98-113s 压到接近 0；merge 冲突类失败里，能被 agent 判断力解决的那部分会在锁外直接消失，而不是
"更快地失败"。suite 本身（366-440s）与 flip/ff 不变。

## Plan

**Phase 1 — worker 侧 pre-merge + scoped-test 步骤**
- `worker-driver.ts` 的 `buildWorkerPrompt` 与 `buildContinueWorkerPrompt` 各插入一步：实现+提交 AC
  勾选之后、`driverFanInNote()` 退出指令之前，指示 worker 依次：① `git -C <worktree> merge --no-edit
  develop`（冲突则用 Edit 工具解决，不是 skip）；② 跑与 fan-in 相同的 scoped 门命令
  （复用 `worker-driver.ts:2529` 的 `scopedCmd` 字符串，两处不得出现两套标准）；③ 红则修复重跑到绿；
  ④ 绿后写入 scoped-gate 缓存记录（见下）；⑤ 提交、退出。
- 缓存写入用机械手段，不靠 agent 自由发挥 JSON——在 `worker-driver.ts` 内新增一对 export 函数
  （`readScopedGateCache`/`writeScopedGateCache`，签名与 `readDocCheckCache`/`writeDocCheckCache`
  对齐），并暴露一个可被 worker 直接调用的 CLI 入口（沿用 `worker-driver.ts` 现有的可执行形态，
  不新增独立文件——避免触发 `plugin/scripts/` 新文件的三面注册）；worker prompt 里给出这条命令的
  确切调用形式。缓存文件路径 `.quay/scoped-gate-cache.json`（仿 `.quay/doc-check-cache.json`，
  gitignored，不进 Touches）。

**Phase 2 — fan-in 侧缓存命中跳过**
- `runMechanicalFanIn` 里 `merge-develop`（`worker-driver.ts:2457-2459`）成功后，取本次实际合并到的
  develop tip；查 Phase 1 的缓存，`(task, thatDevelopSha)` 命中 ⇒ 跳过 `scoped-gate`
  （`:2528-2531`），trace 一行 `{step:"scoped-gate", exit:0, ok:true, reason:"cache-hit(worker-
  premerge)"}`；未命中（develop 前进过 / 缓存缺失 / 读不懂）⇒ 行为与今日完全一致，照跑不变。

**Phase 3 — 验证**
- `worker-driver.test.mjs` 补：① `buildWorkerPrompt`/`buildContinueWorkerPrompt` 输出含新步骤指令
  （文本断言，含与 `scopedCmd` 一致的命令形式）；② 新缓存读写函数的命中/未命中/缺失三分支单测；
  ③ `runMechanicalFanIn` 在缓存命中/未命中两种注入下的行为断言（命中时 `scoped-gate` 步 `wall_ms`
  应显著小于现有基线、`reason` 含 `cache-hit`；未命中时行为与现状逐位一致，回归测试）。
- 生产验证（不是 fixture 就算数——本仓库硬规则「推论三」：只能被 fixture 满足的判据不是测量）：
  一次真实 fan-in 运行的 `.quay/fan-in-<task>-<runId>.log` 出现 `step:"scoped-gate"` 且 `reason`
  含 `cache-hit` 的记录。

## Acceptance Criteria

- [x] AC1：`buildWorkerPrompt` 的输出文本包含明确的"退出前 merge develop + 跑 scoped 门命令"指令，
      且该命令字符串与 `worker-driver.ts` 里 fan-in 用的 `scopedCmd`（`--for-task <task>
      --allow-thin`）一致——用文本断言核对，不是描述性复核。
- [x] AC2：`buildContinueWorkerPrompt`（续做路径）同样携带该步骤，不是仅首派路径独有——独立断言，
      不能靠"和 buildWorkerPrompt 共用同一段文本"含糊过去。
- [x] AC3：新增的 scoped-gate 缓存读写函数（`readScopedGateCache`/`writeScopedGateCache` 或等价命名）
      有单测覆盖三分支：develop tip 完全一致→命中；develop 已前进→未命中照跑；缓存文件缺失/内容损坏→
      fail-closed 照跑（不得默认命中）。
- [x] AC4：`runMechanicalFanIn` 在锁内 `merge-develop` 之后、`scoped-gate` 之前接入该缓存判定；命中时
      trace 记录的 `reason` 含 `cache-hit`、`wall_ms` < 5000（判据="确实跳过了"，不是"碰巧跑得快"）；
      未命中时的 trace 记录与今日现状逐位相同（回归断言，防止引入静默行为变化）。
- [ ] AC5：至少一次真实（非 fixture 注入）生产 fan-in 运行的 `.quay/fan-in-<task>-<runId>.log` 里出现一条 `step:"scoped-gate"` 且 `reason` 含 `cache-hit` 的记录——对应本仓库硬规则「推论三」：机制落地不能只靠单测/fixture 满足，要在生产载体上真实观测到发生过。（待外部）
- [ ] AC6：`scripts/test.sh` 全量绿，且不新增任何被跳过/新增豁免的检查器。（待外部）

## Definition of Done

不是"单测通过"，是"在生产 fan-in 运行里真实观测到至少一次 scoped-gate 缓存命中跳过（AC5 的证据），
且现有失败路径（merge 冲突未被 worker 侧解决、develop 在锁内 merge 前又前进）在没有缓存命中的情形下，
行为与今日完全一致——不引入新的 fail-open、不悄悄放宽任何现有判据"。suite/bucket 测试步骤本身不受
本任务影响，仍然无条件在锁内针对最终合并状态运行。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver.test.mjs
- tasks/gap-worker-premerge-scoped-gate-cache.md
---
id: gap-goal-driver-draft-ac-invisible-yet-blocking
title: goal-driver 死角：draft 且判据 pass 的 AC 既不翻转、也不计缺口、却仍挡着 GOAL——:172 与 :201 对
  draft 口径矛盾
status: done
labels:
  - gap
  - defect
  - meta-driver
parent: null
children: []
extra: {}
---
## Finding

**投递说明**：本条由人 2026-09-06 要求交 meta-driver 检查。下述机械断言我已逐条实测复核（非转述采信），meta-driver 下一轮会在 `addressedTasks` 里看到它。

**结论**：`goal-driver.ts` 三处逻辑联合造出一个死角——**一条 draft 且判据已 pass 的 AC，既不被翻转、也不计入缺口、却仍然挡着它所属的 GOAL**。三头不占。

| 位置 | 逻辑 | 后果 |
|---|---|---|
| `:267` | `if (verdict === "pass" && ac.status === "active")` | 只翻 active，不翻 draft |
| `:201` | `if (String(r.status ?? "") !== "active") continue` | draft 不计入缺口 ⇒ 不派任务 |
| `:172` | `acs.every((r) => r.status === "achieved")` | 但 draft 照样使 GOAL 无法达成 |

**⚠️ 关键澄清（比"三处都错"更准）**：`:267` 不翻 draft 是**故意的**，注释明引裁定 3：「draft→active（激活）是人/manager 手动——本驱动不得把 draft 翻成 achieved」。**真正的矛盾在 `:172` 与 `:201` 对 draft 的口径不一致**：一个把 draft 计入「是否全部 achieved」，另一个把 draft 排除在缺口之外。⇒ **draft AC 成了"不可见但阻塞"的对象。** 请 meta-driver 就此判断：该由 `:172` 排除 draft，还是由 `:201` 把 draft 纳入缺口（两者对"目标何时算达成"的语义不同）。

**生产实测（`.quay/goal-round.jsonl` 末轮，2026-09-06T23:38:51Z）**：
```
AC-180 status=draft verdict=pass goal=GOAL-001
AC-181 status=draft verdict=pass goal=GOAL-001
AC-182 status=draft verdict=pass goal=GOAL-001
flips: []    gaps: []
全部 criteria 的 status 分布: {"achieved":10,"draft":5}   ← active 为 0
```
⇒ 判据已满足、驱动无动作、目标被挡，三件事同时成立。

**另一条已证实的性质（提上来之前必须知道）**：`writeGoalStatus` 全仓**恰好 2 个调用点**（`goal-driver.ts:268` / `:276`），**都写 `"achieved"`** ⇒ **没有反向翻转**。一旦翻成 achieved 即永久锁定。

**⇒ 由此暴露 AC-181 自身的设计错误（立条人自陈）**：AC-181 的判据是「`.quay/meta-driver-round.jsonl` 末次写入距今 < 90 分钟」——这是**活性监控项**，不是目标判据。目标判据描述"达成后不再回退的状态"；而活性是会回退的。一旦 AC-181 翻 achieved，meta-driver 日后停摆也不会翻回来，该记录将永久声称一件已不成立的事。**这条该退役或改挂到监控面，不该留在 GOAL-001 下**——但具体处置见下面的⛔。

**⛔ 不要自动驱动的部分（方向裁定，保留给人）**：AC-180/181/182 是别的会话挂到 GOAL-001 名下的（meta-driver 活性 / 活跃 AC 无空判据 / goals 无未跟踪文件），与 GOAL-001「goal 机制启用与改造」是不同的题目。**「提上来让 GOAL-001 收口」还是「`--goal` 改挂到别的 GOAL」是方向选择，机器不得自决。** 本任务只处理上面那个机制口径矛盾。

## AC

- [x] `:172` 与 `:201` 对 draft AC 的口径一致：一条命令分别取「目标达成判定纳入的 AC 集合」与「缺口计算纳入的 AC 集合」，两者对同一 goal 的 draft 成员给出相同归属（都含或都不含）⇒ exit 0。立条时二者相反（能取假）。
- [x] 「不可见但阻塞」消失（行为级）：构造一个含 draft+pass AC 的 goal，跑一轮 goal-driver 后，该 AC 要么进入 `gaps`（可见）、要么不再阻塞目标达成判定；⛔ 不接受既不可见又阻塞。
- [x] 裁定 3 不被削弱（负控制）：改动后 goal-driver **仍然不得**把 draft AC 翻成 achieved——构造 draft+pass 的 AC 跑一轮，断言 `flips` 中不含它。
- [x] `writeGoalStatus` 的单向性被显式记录：在代码注释或任务体中写明「无反向翻转」这一性质及其后果（时间敏感判据一旦 achieved 即永久锁定），使后续立 AC 的人不再把监控项写成目标判据。

## DoD

- [x] 上述判据本轮实跑并贴出输出，⛔ 不是转述。
- [ ] 生产载体证据（非 fixture）：改动落地后至少一轮 `.quay/goal-round.jsonl` 记录显示 draft AC 的归属已按新口径体现。（待外部）
- [x] ⛔ 未改动 AC-180/181/182 的 `status` 或 `goal` 字段——那属于保留给人的方向裁定。
- [x] ⛔ 未新增 driver、⛔ 未新增周期性检查器。

## Touches

- `plugin/scripts/goal-driver.ts`
- `plugin/test/goal-driver.test.mjs`
- `tasks/gap-goal-driver-draft-ac-invisible-yet-blocking.md`
## Needs-Human

**执行 2026-09-07T01:23:56.740Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=ff: fan-in-ff-merge: FF FAILED (attempt 5 >= 3) — ANTI-LIVELOCK (SPEC §7, gap-ff-livelock-trigger-no-action): develop keeps advancing; escalating + STOPPING automatic retry. Escalation record written to /home/yale/work/quay/.quay/fan-in-ff-escalations.jsonl. Do NOT auto-retry: re-merge develop and re-run the fan-in once develop settles.
fan-in-ff-merge: measure ff_only_locked=false
- run_id：wk-prod-1788717081
- session_id：70e036d7-bb5f-4e62-9d35-b4db1f64b3a6
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-goal-driver-draft-ac-invisible-yet-blocking-wk-prod-1788717081.log

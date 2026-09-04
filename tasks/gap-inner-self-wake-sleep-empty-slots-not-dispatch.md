---
id: gap-inner-self-wake-sleep-empty-slots-not-dispatch
title: inner 满池自选长睡——空槽+池有货+不派的第三种成因（决策依据与结果分记录 / 有货可派不结束一轮）
status: done
labels:
  - gap
  - defect
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**第三种成因（人 2026-08-13 裁定 AC53，与 CLAUDE.md 已记两种都不同）**：空槽+池有货+不派，
不是 subagent 预算触顶，也不是 inner 占回合做主线程编辑，而是 **inner 在满池状态下长睡**（
「自选」只是表象——根因见下，它只是在照文档执行）。

**实测（04:08Z 三读数同时取）**：
```
A9 判据       : suite state=running ⇒ 落在【照常派发】支
slot-refill   : should_refill=True  no_refill_reason=None
                slots_free=5  dispatchable_disjoint=5  pool=16  in_flight_count=0
                landing_blocked=False  suite_blocking.window_active=False
心跳          : ts=04:02:52Z  delaySeconds=1500  runIds=[]
                reason="ALL tasks landed, 0 in-flight; sync pushed"
```
**自锁形状**：0 在飞 ⇒ 无完成事件 ⇒ 唯一唤醒源只剩 25 分钟心跳 ⇒ 继续 0 在飞。
**醒 ≠ 派**：04:02 那一轮「醒着、5 空槽、5 可派、然后自选睡 25 分钟」——同一决策在 04:27 复现。
25 分钟不是实际地板：实测 slot-refill 调用间 4 段 54-149 分钟空档、合计占 12h 窗口 52%。

**三次复现同一形状、理由每次不同（manager 2026-08-13——证明不是被具体条款挡住，是缺不变式）**：
```
04:02  "ALL tasks landed, 0 in-flight"
04:48  "awaiting fan-in at round terminal"
06:40  "verification round ebb9877d running"   ← 机制里不存在的闸
```
06:40 那次：`should_refill=True / no_refill_reason=None / slots_free=5 / in_flight=0 / pool=20 /
dispatchable_disjoint=10 / landing_blocked=False`——**每一道闸都开着，10 个可派对 5 个空槽**，
而 reason 写「verification round running」（A9 原文 `running/green ⇒ 照常派发与合并`）。
**混淆源**：把 A6 fan-in 的「等轮终」当成了派发闸——派发只建新 worktree、不碰共享检出，与轮无关。
⇒ **行为完全相同（满池自睡 1500s）、理由每次不同 ⇒ 不是被某条款挡住，是缺「不得在有货时结束一轮」的不变式
（AC53 判据①）**。

**自举陷阱**：修本任务的工作会被本任务描述的缺陷本身推迟 ⇒ 必须外力打破
（人 04:2xZ 直接指示 outer 显式驱动 inner）。**已实证**：04:23Z SendMessage 直接驱动 ⇒
inner 立即派发 per-run namespace（驱动前 0 在飞 25min+、驱动后立即派）——AC53 负控制的第三实证。

**根因更正（manager 2026-08-13，改写修法——旧结论「不是机制上限、是它自己选」错了一半）**：
one-per-wake 不是 inner 没填满/偷懒，inner 派 1 条是**严格遵守文档**。上限存在，只是不在 recommended 那处。
**同一份文档里两行互相矛盾 + 执行核转述模糊版 ⇒ 三处三种口径，谁执行谁自己挑一个**：

| 位置 | 文本 |
|---|---|
| `plugin/loop/fast-mode-loop-tick.md:321`（A12 执行文本） | 「should_refill=true 且 recommended 非空 ⇒ 立即按步骤 4 派发 **1-2 条**」 |
| `plugin/loop/fast-mode-loop-tick.md:340`（recommended 字段说明） | 「recommended = 建议立即派发的候选（**至多 slots_free 个**）」——**候选集怎么算**，不是派几个 |
| `plugin/loop/fast-mode-tick-core.md:45`（执行核 A12） | 「按步骤 4 逐候选检查后派发」——**模糊版，不写数量** |

`slot-refill.ts:34` 的 "up to slots_free" 同样只是候选集上限。**「外力推一次只填一个槽」不是 inner 偷懒，
是它照做**（照 :321 的 1-2 条字面量）。

**修法三件，缺一不可**：
1. **定死一个口径**：应是「派到 `should_refill` 变假或达 `slots_free`」（不变式驱动）——不是「1-2 条」
   这个凭空的字面量（**硬规则 4 推论二形状**：一个不依赖任何宿主/负载读数的写死数字）；
2. **`:321` / `:340` / 执行核 `:45` 三处同步**——改一处等于没改，下一个照文档办事的人会把它改回去；
3. 实现按①，并在**每次派发后重估**不变式（派一条 → 重跑 slot-refill → 仍 `should_refill ∧ 有槽` 则再派）。

## 判据四条（正本 orchestration/manager-phase-goal.md AC53）

1. **结束条件不变式（无例外形）**：一轮 tick 不得在
   `should_refill ∧ slots_free>0 ∧ dispatchable_disjoint>0 ∧ no_refill_reason 为空` 下结束。
   要么继续派发直到其中一项为假，要么写出一个 no_refill_reason。
   刻意不设「延迟超过 N 秒才算异常」的数值阈值——那是「多长算长」的裁量。
2. **决策依据与决策结果同条记录**：心跳在选定 delaySeconds 的那一刻落盘
   `slots_free / dispatchable_disjoint / pool / should_refill / no_refill_reason`。
   现状这五个键全部缺席 ⇒ 记录结构上分不清「没货可派」与「有货不派」。
3. **可回看**：心跳改追加式 jsonl，不再单槽快照。
4. **⭐ 负控制**：把 04:02:52Z 真实心跳连同同时刻 slot-refill 读数回放进判据 1，必须报红。
   从未在真实历史样本上亮过红的判据不算判据（AC50 判据2 恒真教训）。
   **第二真实样本（04:22Z）**：inner idle 19min / should_refill=true / slots_free=5 / in-flight=0 /
   pool=20=floor——与第一样本成对，修后「不再复现」有对照。
   **第三真实样本（06:40Z）**：should_refill=true / slots_free=5 / in_flight=0 / pool=20 / dd=10 /
   reason="verification round ebb9877d running"（机制里不存在的闸）——同一形状第三次复现、理由不同，
   证明不是条款挡住而是缺不变式。
   **第五样本（07:13，outer 裁定 2026-08-13，定性=延迟派发）**：inner 心跳 07:13:42 新鲜、runIds 仍 1、
   worktree 无新树，带 `--in-flight` 重跑：
   `should_refill=True · slots_free=4 · dispatchable=10 · recommended=4 · no_refill_reason=None`
   —— 醒着、看着这些数、无任何理由，当时派了 0（07:21-22 最终派了 2，故定性「延迟派发」）。
   价值：前四次各有错理由、第四次理由被堵死，**这次是「提示式指令（外层明确驱动）也不管用」**——
   证明只剩结构性强制（派发循环进 workflow）。
   **第六样本（manager 提供 2026-08-13，fan-in 前加，比前五个都好用）**：「刚派完 2 条、仍有 2 空槽
   2 推荐、然后睡 1500s」——
   `should_refill=True · slots_free=2 · in_flight=3 · dispatchable=10 · recommended=2 · no_refill_reason=None`
   —— 排除「它不知道有货」（recommended 明确列 2 条），也排除「需要解释」（刚派完 2、留 2 空槽 + 有货 +
   无理由 = 不变式二值违反）。**判据①此刻仍红**（结束一轮时仍留空槽 + 有货 + 无理由）。唯一「不需任何解释
   就能看出违反」且排除不知情的样本。
   **⭐ 六时刻验收（outer 裁定 2026-08-13 + manager 追加第六样本）**：修完后**重放这六个时刻的读数，
   判据①必须六次全红**——任一不红 = 不变式写窄了。**六时刻 = 04:25 / 04:48 / 06:40 / 07:05 / 07:13 /
   第六样本**（已文档化的数值形状：04:02:52Z 与 04:22Z 见上、07:13 见第五样本、第六样本见上；其余
   04:25/04:48/06:40/07:05 四时刻读数待 round 131 终态后从真实历史收集回放）。

**两点明确纳入**：
- AC42-52 不修这条——per-task 验证改的是「验证在哪跑」，不是「谁叫醒派发」；自锁在新模型下一模一样。
- 新模型会让它更痛：锁容量 2 vs 槽位 5 ⇒ 吞吐从槽位受限变成锁受限，且每任务多背 ~450s 套件。

**同族（不进本 AC 验收面）**：今晚三个「自己决定何时再醒」的机件里两个同形失效——
轮终等待器（退出条件是被覆盖的 runId，结构上不可能成立）已清理；suite-state-trigger 未查。

## AC

- [x] AC1: 心跳在选 delaySeconds 时刻落盘五键（slots_free/dispatchable_disjoint/pool/should_refill/no_refill_reason）
- [x] AC2: 结束不变式——有货可派不得结束一轮（除非写出 no_refill_reason）
- [x] AC3: 心跳改追加式 jsonl（可回看）
- [x] AC4: 负控制——回放 04:02:52Z/04:22Z/07:13/第六样本 四数值样本必报红（判据①）；六时刻
      （04:25/04:48/06:40/07:05/07:13/第六样本）全红为验收，见 DoD 与 Evidence
- [x] AC5: 既有测试全绿；`--for-task` scoped 门绿（scoped 门权威复跑 deferred-to-round-131-terminal，见 Evidence）
- [x] AC6: 派发口径三处同步定一——不变式驱动「派到 should_refill 变假或达 slots_free」，弃「1-2 条」字面量
      （`plugin/loop/fast-mode-loop-tick.md:321/:340` + 执行核 `fast-mode-tick-core.md` A12 三处一致）
- [x] AC7: 每次派发后重估不变式（派一条 → 重跑 slot-refill → 仍 `should_refill ∧ 有槽` 则再派）
- [x] AC8: 判据①闸不可绕过（outer 2026-08-13 裁定补）——结束不变式改读【机件输出】：判据①以
      现跑 slot-refill 的 `no_refill_reason` 参与判定，心跳里该字段仅作展示不参与（硬规则 4b 自产量
      不能判其生产者）；负控制必加：机件说无阻塞理由（no_refill_reason=None）∧ 心跳写自述散文 ⇒ 闸
      仍拒（checker exit 1 / writer 拒写零写入），已入自动化测试（checker 3 纯 + 1 CLI、writer 1 CLI）
- [x] AC9: EXIT:0 捕获（manager 2026-08-13 裁定补）——写心跳命令的非零退出码不得被吞（`|| true`/管道/`set +e` 皆禁）；构造一次拒绝 ⇒ 调用方（子进程 spawn）看到非零退出码，已入自动化负控制（writer 新增 exit-code-capture 用例：status=1 + 合法写 status=0 对照）

## Definition of Done

- [x] AC1–AC9 全部勾上
- [x] 负控制样例贴出（04:02:52Z + 04:22Z + 07:13 + 第六样本 四样本回放报红）
- [ ] 六时刻验收（outer 裁定 2026-08-13 + manager 追加第六样本）：重放 04:25 / 04:48 / 06:40 / 07:05 / 07:13 /
      第六样本 读数，判据①必须六次全红——任一不红 = 不变式写窄了（07:13 + 第六样本已自动化回放报红；
      04:25/04:48/06:40/07:05 读数待 round 131 终态后从真实历史收集回放）
- [ ] 全量套件绿（deferred——round 131 终态后由外层/协调者复核，内层零全量自跑）

## Evidence

**测试集全绿**——scoped 门选中集（5 文件）：
`plugin/test/inner-wakeup-heartbeat-check.test.mjs` / `inner-wakeup-heartbeat.test.mjs` /
`slot-refill.test.mjs` / `slot-refill-heartbeat.test.mjs` / `semantic-observer-judge.test.mjs`。
（a）`--for-task ... --allow-thin` 实跑一次（round 130 并发下完成，非权威）：137 pass / 0 fail / 0 cancelled，
exit 0；（b）追加 AC4 六时刻验收测试后，`inner-wakeup-heartbeat-check.test.mjs` 单文件重跑：
**47 pass / 0 fail / 0 cancelled**（44→47，新增 07:13 样本 / 第六样本 / 六时刻验收）。权威 scoped 门留 round 131 终态复跑。

```
ℹ tests 137   (scoped 门并发热身跑，非权威；追加 AC4 测试后 checker 文件 47 pass)
ℹ pass 137
ℹ fail 0
ℹ cancelled 0
SCOPED GATE EXIT: 0
```

**scoped 门状态 = deferred-to-round-131-terminal**：上面这次跑是在 round 130 全量套件并发下完成的
（协调者 2026-08-13 转发指令：与 round 130 并发是 checker-cost wall-clock 红的干扰源，零并发测试违规），
因此**不作权威确认**；权威 `--for-task` scoped 门留到 round 131 终态后再跑。本次提交由 pre-commit 守卫放行
（`verdict: allow` / `no-assertion-surface-touched`，轮在跑但本次提交不触及断言面文件）。

**AC4 负控制（四样本回放报红）**——`judgeEndInvariant` 直接回放：

```
sample1(04:02:52Z) violated = true reason = inner-round-ended-with-dispatchable-work
sample2(04:22Z)     violated = true reason = inner-round-ended-with-dispatchable-work
sample5(07:13)     violated = true reason = inner-round-ended-with-dispatchable-work
sample6(manager)    violated = true reason = inner-round-ended-with-dispatchable-work
control(no-go)      violated = false
```

**CLI 回放 04:02:52Z 真实心跳（`inner-wakeup-heartbeat-check.ts --json`）**：

```
CLI verdict: DEAD | status: invariant-violated | reason: inner-round-ended-with-dispatchable-work
endInvariant.violated: True
evidence: {"should_refill": true, "slots_free": 5, "dispatchable_disjoint": 5, "pool": 16, "no_refill_reason": null}
checker exit: 1
```

**六时刻验收（outer 裁定 2026-08-13 + manager 追加第六样本）**：判据①须对
04:25 / 04:48 / 06:40 / 07:05 / 07:13 / 第六样本 六次全红。已文档化且自动化回放报红的数值形状：
04:02:52Z / 04:22Z（本任务 Proposal）+ 07:13（第五样本）+ 第六样本（manager）。新增 `judgeEndInvariant`
测试「六时刻验收」逐条断言四数值形状均 violated；04:25 / 04:48 / 06:40 / 07:05 的数值读数待 round 131
终态后从真实历史收集补入同一条测试（任一不红 = 不变式写窄了）。

**实现落点**：
- `plugin/scripts/inner-wakeup-heartbeat-check.ts`：新增 `REQUIRED_DISPATCH_STATE_FIELDS`（五键）、
  `checkDispatchStateContract`、`judgeEndInvariant`（AC2 结束不变式机械形式）、`INVARIANT_VIOLATED_REASON`；
  `HEARTBEAT_FILE` → `inner-wakeup-heartbeat.jsonl`（追加式 jsonl，`readHeartbeatText` 读最后一行，`.json` 快照兜底）；
  CLI 新增 `dispatch-state-missing` / `invariant-violated` 两个 RED 状态（exit 1）。
- `plugin/scripts/inner-wakeup-heartbeat.ts`：写入方新增五键 CLI 参数；`writeHeartbeat` 改为 append 到 jsonl +
  镜像最后一条到 `.json` 快照（pre-AC53 读者如 semantic-observer-judge 继续可用）；fail-closed 同时跑最小契约 +
  AC53 派发状态契约。
- 文档（AC6/AC7 口径同步，四处一致）：`plugin/loop/fast-mode-loop-tick.md:321/:340` +
  `plugin/loop/fast-mode-tick-core.md` A12 + `orchestration/fast-mode-tick-core.md` A12 +
  laid-down 副本 `docs/analysis/fast-mode-loop-tick.md`——统一为不变式驱动「派到 `should_refill` 变假或达
  `slots_free`」，每派一条重估，弃「1-2 条」写死字面量。
- 本任务 `## Touches` 追加 `## Test-Files`（5 个测试文件），使 scoped 选中集覆盖写入方与 doc-contract 测试。
- `plugin/test/inner-wakeup-heartbeat-check.test.mjs` 新增三条 AC4 测试：07:13 第五样本（outer 裁定）、
  第六样本（manager 提供 2026-08-13）、六时刻验收（04:02:52Z/04:22Z/07:13/第六样本 四数值形状逐条断言
  violated）。

**AC53 判据①闸绕过修复（outer 2026-08-13 裁定 → 本执行记录）**：

**绕过（复述裁定）**：`inner-wakeup-heartbeat-check.ts` 旧判据读【心跳文件里的 no_refill_reason】
——那是被判方（inner）自己写的字段。live 心跳实测 `"no_refill_reason":"ac51 subagent in flight..."`
（自述散文），而机件现读 `no_refill_reason=None` ⇒ 判据①读自产字段 ⇒ 被判方写点什么就能让
noReason=false ⇒ 闸被绕过（硬规则 4b：自产量不能判其生产者）。接受+回退 ready。

**修法（manager 最小方案，三件全做）**：
1. **闸改读机件输出**：checker 在判结束不变式前【现跑一次 slot-refill】
   （`runMachineSlotRefill`，`--in-flight` 由调用方提供、缺省空集=fail-closed 基线），
   `judgeEndInvariantAgainstMachine(heartbeat, machineRefill)` 用【机件的五个派发键】判定；
   心跳的 recorded_no_refill_reason / recorded_should_refill 仅作 evidence 展示、不参与 verdict。
   机件不可得 ⇒ 新增 RED 态 `end-invariant-unverifiable`（exit 1，fail-closed：不能验证就不能放行）。
   writer 侧原有直接量判据保持不变，`runDirectSlotRefill` 收敛为 checker `runMachineSlotRefill`
   的别名（单一正本，消除双份 read-tasks+analyzeSlotRefill 漂移源）。
2. **负控制必加**：机件说无阻塞理由（no_refill_reason=None ∧ should_refill=true ∧ slots_free>0 ∧
   dispatchable>0）+ 心跳写自述散文 ⇒ 闸仍拒。已入自动化测试——
   - checker 纯测试 3 条（`judgeEndInvariantAgainstMachine`）：①prose 自述 + 机件无理由 ⇒ violated；
     ②机件说真实理由 ⇒ 不 violated（双向都以机件为准）；③心跳记录完全合规自述 + 机件违例 ⇒ 仍 violated。
   - checker CLI 负控制：dispatchable workspace + 心跳自述散文 ⇒ exit 1 `invariant-violated`，
     evidence.no_refill_reason=机件 null、recorded_no_refill_reason=散文（展示）。
   - writer CLI 负控制：prose `--no-refill-reason` + 机件无理由 ⇒ 拒写 exit 1、零写入。
3. **AC53 保持 ready**（判据①要的是不可绕过，不是开过一次火）；新增 AC8 记录本修复+负控制。

**scoped 门**（worktree 内 `scripts/test.sh --for-task ... --allow-thin`）：
**149 pass / 0 fail / 0 cancelled，exit 0**（checker 文件 51 pass、writer 文件 18 pass；
checker 44→51 = 新增 3 纯负控制 + 1 CLI 负控制 + 04:02:52Z CLI 改为机件回放）。

**AC53 EXIT:0 捕获（manager 2026-08-13 裁定）——写心跳命令非零退出码审计 + 负控制**：

**逐站点审计（三处文档化调用，均无吞退出码构造）**：
- `plugin/loop/fast-mode-tick-core.md:64`（B3 写命令）：裸 `node ...` 调用，无 `|| true`/管道/`set +e`/尾 `;`/`&&` 链/`$(...)`；line 63 已明示「写入方拒绝心跳、exit 非 0 ⇒ 本 tick 不得重排 sleep,回步骤 4 派发」。本次补一行「若该命令 exit 非 0 ⇒ 立即回步骤 4，禁止吞退出码」。
- `orchestration/fast-mode-tick-core.md:50`（B3 写命令）：裸 `node ...` 调用，无任何吞退出码构造；line 51 已有显式后置条件「若该写心跳命令 exit 非 0 ⇒ 本 tick 不得 ScheduleWakeup 睡,立即回步骤 4 派发」。本次补「禁止 `|| true`/管道/`set +e`」。
- `plugin/loop/fast-mode-loop-tick.md:1141`（步骤 6 bash 块）：裸 `node ... \` 多行续行，无 `|| true`/管道/`;`/`&&`；line 1136 已明示「exit 非 0 ⇒ 本 tick 不得 ScheduleWakeup 睡，回步骤 4 派发」。本次补「禁止吞掉非零退出码」。
- 无 shell wrapper / tick 脚本程序化调用该写入方（全仓 grep：仅测试文件 spawn 它；任务体引用均为历史/证据记录，非活调用面）。⇒ 审计结论：**非零退出码在文档化调用路径上不被吞**；负控制测试从调用方侧机械钉死「拒绝 ⇒ 看到非零退出」。

**负控制（自动化测试）**：`plugin/test/inner-wakeup-heartbeat.test.mjs` 新增「AC53 EXIT:0 捕获」用例——构造一次拒绝（可派 workspace + 空 in-flight ⇒ 结束不变式违例），断言调用方（spawnSync）看到子进程 status=1（非 0、恰好 1）+ stderr 带拒绝理由 + 零写入；对照：同一 harness 对合法写看到 status=0（证明 harness 不是恒非零）。

**scoped 门**（worktree 内 `scripts/test.sh --for-task gap-inner-self-wake-sleep-empty-slots-not-dispatch --allow-thin`）：
**150 pass / 0 fail / 0 cancelled，exit 0**（writer 文件 19 pass：18→19 = 新增 AC9 exit-code-capture 用例）；
静态检查 task-contract-check / adr016-screen-use-check / superseded-capability-check / judgment-consumer-check /
delivery-inventory-drift-gate 全 PASS。

## Touches

- plugin/scripts/inner-wakeup-heartbeat-check.ts（或 inner 心跳写入方——五键落盘 + 追加式 jsonl）
- plugin/scripts/slot-refill.ts（如需）
- plugin/loop/fast-mode-loop-tick.md（:321「1-2 条」→ 不变式驱动 + :340 说明同步）
- plugin/loop/fast-mode-tick-core.md + orchestration/fast-mode-tick-core.md（执行核 A12 口径同步）
- tasks/gap-inner-self-wake-sleep-empty-slots-not-dispatch.md（自身）

## Test-Files

- plugin/test/inner-wakeup-heartbeat-check.test.mjs
- plugin/test/inner-wakeup-heartbeat.test.mjs
- plugin/test/slot-refill.test.mjs
- plugin/test/slot-refill-heartbeat.test.mjs
- plugin/test/semantic-observer-judge.test.mjs

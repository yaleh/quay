# inner (fast-mode) tick — 执行核

**这份文件是执行路径,不是理由档案。** 理由、实测、代价全在源文档 `plugin/loop/fast-mode-loop-tick.md`(1149 行),本文件只给动作和判据,每条带 `(src:行号)` 指路;
**纯提取,零发明**——每条都能在源行号逐字核对;源文档一字未改。

**引用同一批行为文件（AC41 判据 2 / AC3）**：本核与冷启动 skill 引用同一批——内层产品模板 `plugin/loop/fast-mode-loop-tick.md`（src:N 基准，冷启动驱动其 laid-down 副本）/ 外层 `plugin/loop/orchestrator-loop-tick.md` / 管理者 `orchestration/manager-loop-tick.md`。

**行号注（2026-08-09，去重）**：源文档删 5 处重复粘贴段（L270/271、459-471、820-832、956-961），1200→1173，`src:N` 前移 ≈27 行——**按内容核对不按行号** (任务体 Evidence)。

**立此文件的原因**(2026-08-09):执行路径与理由档案混在同一份千行文档里,一次重读无法当 checklist 执行 ⇒ 实际被执行的是注意力当轮选中的部分。两次实证:outer 的「强制」步骤在 1095 行第 687 行、静默停摆 8.5 小时;nyf-semantic-judge 工作流(49c0be86)用完即弃——4 次 done-flip 真产出却因执行核无「调用」步骤而丢。

**当前状态:并行对照期。锚仍指向源文档,本文件不接锚/cron/skill;两份并行跑,差异记进 tick-log,零遗漏后 inner/outer 决定改锚。**

---

## A. 每轮必跑(按 tick 步骤序;标「必跑」者含轻触也无条件跑)

| # | 动作 | 判据 / 陷阱 |
|---|---|---|
| A1 | `.halt` 哨兵 | 存在 ⇒ 本 tick 空转、报告、重新排程 (src:347);强制点在代码、任意执行点生效,**每步派发前都要再问一次 halt-check/slot-refill**,不等 tick 边界 (src:359,362)。**组合判据(SPEC 2.8)**:`无 .halt` **且** 长期无产出(>24h)⇒ **未标记的停摆**,必须升级——只读不判会稳定产生「看见但没发现」(与 manager A5 同形) |
| A2 | `bash plugin/scripts/monitor-mount-check.sh --json` | `mounted=true` 且 `targetOk=true`(targetRoot==本仓根)**缺一不可**;没挂/挂错 ⇒ 本层停摆无人发现 (src:370,373) |
| A3 | 先判本回合唤起源 | transcript 有 `<task-notification>` ⇒ 走槽位回填(**只重评估派发,不 fan-in、不写任务状态、不重排程**);否则走全流程 (src:287,290) |
| A4 | 读队列文件 `docs/analysis/batch2-queue-state.md` | 与 `git log`/`git worktree list` 不一致 ⇒ **以 git 为准**并修正文件 (src:379) |
| A5 | `bash plugin/scripts/supervisor-bus-identity.sh inbox-summary` | 有 `unread:` ⇒ 逐条进本轮决策;本步**只读不写回执** (src:385,389) |
| A6 | Fan-in 回到任务 subagent(**无锁段+持锁段全在 subagent 自回合内、ff 成功后才返回,人 2026-08-14 裁定,SPEC-fan-in-ff-merge-lock**——取代旧「串行整段 + `git merge --no-ff`」(src:510,526);旧 rebase 冲突处理已随 ff-only 简化一个量级,ff 失败唯一原因=develop 前进了、处置唯一=回第 1 步 (src:515,523,534)) | **无锁段(全在任务 subagent 自回合内、其 worktree 内,不碰共享检出)** ① `git merge $MERGE_TARGET`(subagent 已在自身 worktree 内,cwd=worktree,主线程不再从外部 `git -C` 指向任务树;冲突【只可能在这】出现,自由解,不占任何人;取代旧 rebase) → ② **Touches 含新增/移动 .ts ⇒ 先跑 ts-typecheck 闸 `node --experimental-strip-types plugin/scripts/fan-in-ts-typecheck-gate.ts --task <id> --worktree <wt> --merge-target $MERGE_TARGET`(exit≠0 ⇒ 丢弃未合状态、needs-human、停本 tick 合并与派发;`gap-ts-touching-fan-in-needs-typecheck-gate`)**(unchanged,suite 前) → ③ subagent 在其 worktree 内跑 scoped 门 `$TEST_COMMAND --for-task <id>`(测试进程 cwd 落 worktree 非主检出——AC42 判据2 + 人「主检出只读诊断」裁定,`gap-a6-fan-in-verify-before-merge-in-worktree`)(src:517) + **全量 suite + doc 检查 `bash scripts/test.sh --static-checks-doc`(ff 不触发任何钩子,AC63;刻意不去重——第一次覆盖自己改动、第二次覆盖与 develop 合并后内容,人 2026-08-14 确认)** → 全绿才进。**持锁段(仍在 subagent 自回合内)** `bash plugin/scripts/fan-in-ff-merge.sh --task <id> --run-id <runId> --agent-id <本 subagent 标识>`(**锁只包 `git merge --ff-only`,毫秒级,成/败都解锁;ff 失败写重试记录(任务 id/第几次/当时 develop 头/时刻/runId)+ 回 step 1,不是 needs-human;suite state=running 时拒锁——锁与 suite 锁(full-suite.lock.0/.1)覆盖范围不交叉,AC62 两把锁互斥**)。**subagent 在 ff 成功之后才返回**(无锁段①②③+持锁段④全在自回合内,ff 落地才上报完成)。ff 成功后 `git worktree remove` + `git branch -d`(src:537);冲突/选中集非绿 ⇒ **丢弃 worktree 内未合状态**(共享检出零污染)、标 needs-human、**停止本 tick 后续合并与派发**;设了 `QUAY_CLAIM_REMOTE` ⇒ `release-task.sh` 释放认领(src:552)。**⚠️ runId 桥(inner 2026-08-14 判断,已核)**:`integration-batch-merge.sh --fan-in` 的 runId 嵌入 merge commit subject(`merge: fan-in task/<id> (runId: fm-…)`),`fan-in-runid-check.ts` 按 `git log -1 --format=%s` 读——**ff-only 无 merge commit ⇒ 桥断**;故协议本体由 `fan-in-ff-merge.sh` 承担,runId 的 ff-only 载体(manifest/retry record)留给 AC63/AC64 跟进。**统一括号闭合点(`gap-needs-human-routing-does-not-close-bracket`,src:605)**:凡标 needs-human 的同一处(冲突/REFUTED/OVER90 等)**必须**先调 `bash plugin/scripts/closure-lag-check.sh --close-task --taskId <id> --outcome needs-human` 关括号;fan-in 成功(merge 落地、无需 further routing)时调 `bash plugin/scripts/closure-lag-check.sh --close-task --taskId <id> --outcome done` 关括号——括号在终止/完成同轮闭合,不停留 inProgress |
| A7 | `tmux capture-pane -p -t "$TMUX_SESSION" > .quay/last-pane.txt` → `inner-blocked-signal.ts --detect-stop --pane` | 停止条件的机械检查,**写盘是检查本身的后果**;命中任一 ⇒ 不派发、报告、重新排程 (src:520,560) |
| A8 | 同一 pane 喂 `inner-panel-stale-check.ts --pane … --json` | exit 1 = 括号已关但 agent 行残留冻结 ⇒ 检出该误导窗口 (src:529,533) |
| A9 | 读外层 `.quay/full-suite-state.json` | `running`/`green` ⇒ 照常派发与合并。**⚠️ 轮在跑 ⇒ 可以派发、不可以 fan-in**（派发只建新 worktree、不碰共享检出；只有 A6 fan-in 要 merge 进共享检出才需等轮终——**别把合并闸当派发闸**，AC53 三次复现 04:02/04:48/06:40 都是这个混淆）;`red`+`reason: failed`(或缺失)⇒ 暂缓 `$MERGE_TARGET`→`$FORK_BASELINE` 批量合,新派发按失败位置条件化(共享闸门 `run_static_checks` ⇒ 停派;具体测试文件且与新任务 touches 无关 ⇒ 继续;相交 ⇒ 该任务停派;无法判定 ⇒ fail-closed 停派);`red`+`reason: aborted` ⇒ **不停派**;文件缺失 ⇒ 不阻塞 (src:569-592) |
| A10 | `effective_cap=5`（**固定**,与 manager A2/outer A6 对齐,人 2026-08-11 裁定）| **每 tick 一次**,3.6 的 floor 与步骤 4 的派发上限共用 `effective_cap=5`;`cap-from-gate.sh` **降为观测输出**(跑它读 `effective_cap`/`band` 记 tick-log,不参与派发裁决)——动态 cap 曾随负载 2-5 跳、每个 tick 压低派发(实证 2026-08-11:cap 5 ⇒ slotsRemaining=3 而心跳判「cap2 无空槽」) (src:653,671) |
| A11 | **必跑** `ready-pool-check.ts --root … --cap … --apply` | 判据是 **`dispatchable_disjoint ≥ cap`,不是 pool 数**;`pool < floor`(=cap×4)且 promotions 非空 ⇒ 机械补晋落盘,不靠自觉;`touchesResolve: false` 的候选不晋不派 (src:647,685,692,710) |
| A12 | **必跑** `slot-refill.ts --cap … --in-flight <本会话在飞集合> --closed-but-live …` | 在飞集合**由本会话自己维护,不读遥测括号**;`should_refill=true`+`recommended` 非空 ⇒ 按步骤 4 逐候选检查后派发（**不变式驱动,`gap-inner-self-wake-sleep-empty-slots-not-dispatch` AC6/AC7:派到 `should_refill` 变假或达 `slots_free`,不设写死字面量;每派一条用更新后的在飞集合重跑 slot-refill 重估,仍 `should_refill ∧ 有槽` 则再派**）;否则本 tick 不派发。**机械可核验（FINDING §6/manager 2026-08-09 复发修正）：把 `recommended` 数组逐条贴进本 tick 的 tick-log 行**（`recommended=[a,b,c]` + 每条的处理：派发/串行待/skip+理由）——不贴 = 本轮判定视为「没读答案」，`meta-cc query_session_content role=tool tool_name=slot-refill` 心跳 + tick-log 里 `recommended=` 出现与否是核验点 (src:297,300,747) |
| A13 | `fast-mode-telemetry.ts --slots --cap "${effective_cap:-3}"` | 空槽必须机械可见:`realConcurrency` / `stale_brackets` / `closedButLive` / `slots_free`;`stale_brackets > 0` ⇒ 调 `--reconcile` (src:636,614,1131)。**C17 合规产物(`gap-reconcile-step-skipped-no-compliance-product`):读 `reconcileCompliant`(`--slot-status` 的 `reconcile_compliant` 同值)——`stale_brackets > 0` 且 `reconcileCompliant=false` ⇒ 本 tick 判「未对账」(守与不守记录可区分),**立即调 `--reconcile`(留痕:每次调用写时间戳到 `.workflow-events/reconcile-invocations.jsonl`)**,并把 false+已调 reconcile 记进本 tick tick-log** |
| A14 | routine track(例常例行) | 读 `.quay/config.yml` `loop.routines:`(默认 `[]` ⇒ 空转)→ `routine-scheduler.ts --iteration <tick 计数>`(exit 0=有 DUE / 3=无)→ `read-probe-spec.ts` 派后台探针 → `routine-file-gate.ts`;**FILE-ONLY,改产品/方法代码=违规丢弃** (src:729-735) |
| A15 | 派发前逐候选六检查 | ① `touches-orthogonality-check.ts --resolve`(多数条目 MISSING ⇒ 不派发) (src:807) ② 依赖就绪,用 `it0-split-or-commit-check.ts` 的 PARENT-DONE-IFF-CHILDREN (src:811) ③ `concurrent-batch-scheduler.ts --json` 对**所有在飞任务和彼此**两两判 (src:820) ④ 分叉基线 = `$FORK_BASELINE`(新模型一律 develop,`gap-worktree-fork-baseline-always-integration`;`--force-integration` 已退役,`fork-baseline.ts` 默认路径仅单线下游用) ⑤ `--self-touch`(缺 `tasks/<id>.md` ⇒ 不派发) (src:855) ⑥ 设了 `QUAY_CLAIM_REMOTE` ⇒ `claim-task.sh --check-touches` 先认领 (src:868) |
| A16 | 派发前每任务 `fast-mode-telemetry.ts --task-start --taskId <id>` | **强制不可跳过**,记下 runId;inner 写 `--task-start` 于派发、写 `--task-end`(经 `closure-lag-check.sh --close-task`)于**终止/完成路由**(src:599,604,608)——括号不在 inProgress 停留是 `gap-needs-human-routing-does-not-close-bracket` 的统一闭合点。**defer 也闭合**(`gap-over90-clock-measures-queue-time-not-work-time`):步骤 4 派发资格 defer 候选时 `--close-task --outcome deferred`(排队段不计入 OVER90),真正派发时重新 `--task-start` fresh 括号 |
| A16b | **派发记录·AC55 产物·承重**——派发前**先于** `--task-start` 调 `dispatch-record.ts --add --task-id <id> --reason "<一句为什么选它>" --root …` | **强制不可跳过**(src:1020)。写 ①倾向文件**内容指纹**(`git blob hash`,回答"用的是哪一版") ②一句「为什么选它」(回答"按倾向选还是随便选")——SPEC §4.3 产物是承重部分(C17),没有它「读了没读」在记录上不可区分 ⇒ 只能靠意志 ⇒ 必然失守(§4.2:manager 的 `A0b⑤(b)` 连续 4 轮被跳过)。**不要求解释每一次「不选」**(SPEC §7 逐字)。写入方 **fail-closed**:`--reason` 缺失/过薄(<8 非空白字符)⇒ exit 非 0、不写、不派(AC53 结构性闸);指纹算不出 ⇒ 记录仍写但 `preferenceFingerprint:null`,独立检查器 `dispatch-record-fingerprint-reason-check.ts` 报红。**禁止 `|| true` / 吞退出码**。由 `dispatch-record-fingerprint-reason-check`(run_static_checks)独立核验每轮 |
| A17 | **必跑** `sync-lag-check.sh --push --branch "$FORK_BASELINE" --root …` | 兜底触发源,不依赖任何完成事件;push 失败(非快进=真分歧)只报告、下 tick 重试,**绝不 force** (src:939,948) |
| A18 | **账本·声称机制的真实调用**(AC29(a),每 tick):`meta-cc query_session_content role=tool tool_name=ready-pool-check` → `last(timestamp)` | `--apply` 心跳是「工具造好后一次没被调用过」高发项;>3 个 tick 周期无真实调用 ⇒ 写明「已停用/已替代/是缺陷」三选一 (src:647,685) |
| A20 | **账本·slot-refill**(AC29(a)):`meta-cc query_session_content role=tool tool_name=slot-refill` → `last(timestamp)` | >3 个 tick 周期未调用 ⇒ 三选一写明;slot-refill 与 ready-pool 同族「心跳缺机械产物」 (src:297,747) |
| A21 | **账本·sync-lag-check --push**(AC29(a)):`meta-cc query_session_content role=tool tool_name=sync-lag-check` → `last(timestamp)` | push 兜底是「完成事件缺失时的唯一触发源」——>3 个 tick 周期未调用 ⇒ 三选一 (src:939) |
| A22 | **账本·--task-start 计量**(AC29(a)):`meta-cc query_session_content role=tool tool_name=fast-mode-telemetry` → `last(timestamp)` 且核对 `--task-start` 分支 | 源文档自记「工具造好后一次没被调用过」——每 tick 至少一次真实 `--task-start`;缺失 ⇒ 三选一 (src:599,604) |
| A23 | **账本·monitor-mount-check 两判据**(AC29(a)):`meta-cc query_session_content role=tool tool_name=monitor-mount-check` → `last(timestamp)` | 判据 `mounted` + `targetOk` 缺一不可;本层停摆有没有人发现的全靠它——>3 个 tick 周期未调用 ⇒ 三选一 (src:370,373) |
| A24 | **执行模式两数**(AC2/AC3,`gap-inner-serial-main-thread-not-dispatch`):`node --no-warnings --experimental-strip-types plugin/scripts/inner-exec-mode-report.ts --since <本 tick 起点> --json` | 报 `main_thread_edits`(主线程 Edit 产品文件数)/ `agent_dispatches`(Agent 派发数)。**调用必须带 `--since`（本 tick 起点）**——缺 `--since` 报的是会话累计（15h），不可用于判当下（硬规则4b）；缺 `--since` 时该读数不得用于判定。**判据：产品文件编辑必须在 subagent + worktree 内执行**（人 2026-08-13 裁定；inner 再次在主会话直提修复——git rev-list --parents 单父实证零派发）；`main_thread_edits > 0` 即判违反。**红窗不再整体豁免**——红窗快修恰恰最需要隔离（改的是正在让套件变红的文件）；红窗仅豁免**只读诊断**（跑命令/读日志/看 diff，不写产品文件）(src:1181,1210) |
| A25 | **直接量活性（人 2026-08-13 裁定①+②——保底冗余 + 用直接量；slot-refill 归 A12，不重述）**：**直接量** = ①`git log -1 --format=%ci`（自己最后一次**提交**时间戳，git 客观）②`git worktree list` 任务 worktree 条数 ③worktree 内活进程（`/proc/<pid>/cwd`）④盘上任务 `status:`（枚举）。与 A12 slot-refill 读数不一致 ⇒ **以直接量为准并报出差异**。**判活性不用心跳 runIds/ts**（自己不醒就不更新 = 循环论证）；**不为检查发明新过滤/派生量**（四个读数因加未验证过滤失真：node_count comm 正则 / outer.ticklog 行形谓词 / phase_ac_checked 复选框正则 / Touches 解析器）| (人裁定①：两层都查=冗余非重复；②：观测更直接的量，避免未测试过滤与代理量) (src:1390) |

## B. 每轮必产出

- **B1 写回队列文件**(步骤 5):已完成 / 在飞(含 worktree 路径与派发时刻)/ 待执行 / 计量表 / 本 tick 做了什么。**每个 tick 结束必须写回——它是 compact 后唯一可信的状态,不要靠记忆** (src:243,952)。
- **B2 tick 必报**(缺一不可):合并了什么、派发了什么;在飞任务及时长(**按三种含义分别标注**:遥测括号在飞 / 真实在飞 `realInFlight` / subagent 在飞 + 非任务 subagent);槽位六字段(`realConcurrency`/`stale_brackets`/`closedButLive`/`slots_free`/**`reconcileCompliant`**/`lastReconcileAtMs`——`gap-reconcile-step-skipped-no-compliance-product` C17 产物);停止条件是否触发、哪条;计量表行数与均值;`tasksPerHour`(含 window*);阻塞信号状态(`reason`+`question`+累计死时间/单次最长);Monitor 两判据;**执行模式两数**(`inner-exec-mode-report.ts --json` 的 `main_thread_edits` / `agent_dispatches`——常规轮次 `agent_dispatches ≥ 1` 或非红窗时 `main_thread_edits` 不大幅 > `agent_dispatches`,违反则说明白名单归属)。**不要只说「继续中」** (src:1181,1210)。
- **B3 重新排程** `ScheduleWakeup`,间隔 **1200–1800 秒**;tick 是兜底心跳,**不是派发节奏** (src:954-961)。**每次重排写心跳产物** `.quay/inner-wakeup-heartbeat.jsonl`(**追加式 jsonl,可回看**——每次重排 append 一行,另镜像最后一条到 `.json` 快照供 pre-AC53 读者)(ts/runIds/blocked/budgetHit/effectiveCap/agentDispatches/delaySeconds + **AC53 派发状态五键 slots_free/dispatchable_disjoint/pool/should_refill/no_refill_reason** + agentLimit/budgetCritical/reason;与 suite-chain-heartbeat.json 同构,A2 先例)——`gap-inner-wakeup-heartbeat-invisible`:兜底心跳只活在 transcript,断了 15.3h 不可见直到 meta-cc 查时间戳;按 C17 给「上次重排时刻」造机械可查产物。**字段最小契约**(`gap-inner-heartbeat-fields-shrunk-no-minimal-contract`):必须含结构化键 `blocked[]`/`runIds`/`effectiveCap` 等(Contract `heartbeat_field_count >= 7`),**reason 散文可补充不可替代**;缺键 ⇒ 外层 `inner-wakeup-heartbeat-check.ts` 报「心跳字段缺失」(缺键=未查≠无阻塞,硬规则 6)。**AC53 结束不变式**(`gap-inner-self-wake-sleep-empty-slots-not-dispatch` AC2):一轮不得在 `should_refill ∧ slots_free>0 ∧ dispatchable_disjoint>0 ∧ no_refill_reason 为空` 下结束——外层 checker 对 `should_refill=true`+空 reason 的心跳报「结束不变式违例」(AC4 负控制:04:02:52Z 真实心跳回放必须报红)。**结构性闸(`gap-ac53-end-invariant-gate` AC1/AC2,第 7 次同形后)**：写入方在写结束心跳前**用直接量重跑 slot-refill**（`--in-flight <本会话在飞集合>`,本会话自维护、不读心跳自述）判结束不变式——若直接量说 `should_refill=true`（有空槽+可派+无机制理由不派）⇒ **写入方拒绝心跳、exit 非 0**（reason=end-invariant-violated,不写入）⇒ **B3 不得重排 sleep,回步骤 4 派发——无合法退出路径**。写命令(重排前先跑,**用写入方脚本,不手搓 python**；`--in-flight` 必填,缺失 ⇒ 写入方 fail-closed 拒绝):
  `node --no-warnings --experimental-strip-types plugin/scripts/inner-wakeup-heartbeat.ts --blocked '<json 数组>' --run-ids '<json 数组>' --effective-cap <n> --agent-dispatches <n> --budget-hit <true|false> --in-flight '<id1,id2>' --slots-free <n> --dispatchable-disjoint <n> --pool <n> --should-refill <true|false> --no-refill-reason '<reason 或 null>' [--agent-limit <n>] [--budget-critical <true|false>] [--delay-seconds <N>] [--reason '<tick heartbeat>']`
  **若该写心跳命令 exit 非 0（尤其 reason=end-invariant-violated）⇒ 本 tick 不得 `ScheduleWakeup` 睡,立即回步骤 4 派发**（有货可派却要睡 = 无合法退出路径;记录 reason 拦不住,结构性拒绝才拦得住）。**禁止用 `|| true` / 管道 / `set +e` 吞掉退出码（AC53 EXIT:0 捕获——吞掉 = 闸失效）。**
- **B4 阻塞信号落盘**:judgment 条件(review-refuted 等)在**停下的那一刻**调 `inner-blocked-signal.ts --assert-blocked`,**恢复的那一刻**调 `--clear`;机械条件(合并冲突/超 90 分钟/ruling-required)由 A7 自动落盘,不要手写 (src:991,996,1002,1009)。
- **B5 建任务时**:必须有 `## Proposal`(问题+证据+选定机制)、可机械验证的 `## Acceptance Criteria`、`## Touches`,缺一不算建成;fast-mode 执行型任务另写 `## Contract` 六键(measure/band/invariant/invoke/control/resume),**一行一个键、不可折行**,`n/a: <理由>` 合法、留白不合法;`## Dispatch review` 记 reviewer/at/changed (src:1036,1039,1053,1116)。

## C. 硬约束(每条一句话)

| 约束 | 一句话 |
|---|---|
| C1 | **inner 零全量套件自跑**——只读外层 suite-state,只跑 `--for-task` 选中集(秒级) (src:488,595) |
| C2 | **inner 不翻 done、不写轮次记录**;写 `--task-end` **仅限终止/完成路由**(经 `closure-lag-check.sh --close-task`,统一闭合点,`gap-needs-human-routing-does-not-close-bracket`)——status 翻转仍由外层 1b 独占 (src:400,608,273) |
| C3 | **合并必须串行**,且合回 `$MERGE_TARGET`;`$FORK_BASELINE` 只由外层批量合推进 (src:443,505) |
| C4 | worktree **一律建在 `$WORKTREE_ROOT/<slug>`(磁盘)**,`/tmp` 是 tmpfs、建进去就是重演整机 OOM (src:23,889) |
| C5 | 派发形态必须 `Agent(run_in_background: true)`——前台派发会阻塞内层、`<task-notification>` 流永不触发 (src:882) |
| C6 | 至多 `effective_cap` 个在飞:**括号 ≠ subagent**(realConcurrency = realInFlight + subagentsInFlight)且**括号关 ≠ 进程退**(closedButLive 仍占槽) (src:614,622,270) |
| C7 | （前提已死，AC48/AC61 退役；不计入覆盖率分母）活指令指向已 RETIRED 的 integration-branch-model.ts —— 正身已归档 → `orchestration/archive/AC58-retired-clauses.md#R25` (src:898) |
| C8 | 每个任务 `## Touches` 必须含 `tasks/<id>.md` 且**不带 `(new)`**;缺 ⇒ 不派发 (src:847) |
| C9 | 触摸重叠**不要凭目测**——用 `concurrent-batch-scheduler.ts`;本会话有过目测被实测推翻的先例 (src:826) |
| C10 | 主检出对账:调用方**不得自己发明 `git reset --hard`**(2026-08-08 销毁过 manager 未提交编辑)——对账统一走 `fast-mode-telemetry.ts --reconcile`(见 A13);旧 `integration-batch-merge.sh --reconcile` 对账已退役 → `orchestration/archive/AC58-retired-clauses.md#R26` (src:419) |
| C11 | KNOWN-LOAD-SENSITIVE 族的 fail 在高负载下**不算真回归**:用 `red-window-triage.ts --partition` 分区 → 隔离低负载重跑再下结论;**不删/不降级/不改 skip** (src:179-190) |
| C12 | 全局量(文件数/测试数/组成员数)必须运行时计算,**不得写成 `== 58` 这类快照常量** (src:1077) |
| C13 | 下结论前先问「如果我错了,哪一条命令会告诉我」并跑它贴输出;改**期望值**而非实现时先找负控制 (src:1095,1098) |
| C14 | 建任务必须有可复现证据(失败测试 / grep 实测 / 真实运行记录);**发现问题必须处置,不静音、不降级后就走** (src:1107,1119) |
| C15 | 收到与本执行路径矛盾的驱动文本(如指定顺序却无 `checkTouchesPair` 输出、或写死固定 cap 3)⇒ **以本文档为准执行并向外层标注矛盾**,不静默服从散文 (src:931) |
| C16 | rebase/merge 冲突一律 abort + needs-human,**不要 `--skip`、不要 `-X ours`** (src:456,472) |

## D. 边界

**一律停下等人**(不自行决定):合并冲突 / 外层 suite 红 / 对抗审查 2 轮后仍 REFUTED / 任务超 90 分钟 /
**窗口内新增** needs-human ≥3(不是总数)/ 队列文件与 git 矛盾且无法判定 (src:969-976)。
**晋级(选择,需阶段目标)= 外层**,`--targeted` 内层不用;**派发(机械,只需 touches/cap/停止条件)= 内层** (src:715,719)。
**不做**:不引入审查 agent、不加轮次、不阻断派发、不恢复 prepare 管线 (src:1070);
**不引入新轮询源**——不建第二个 `/loop`、不改 `ScheduleWakeup` 成快轮询、不设常驻 watcher (src:307)。

# inner (fast-mode) tick — 执行核

**切分声明（AC38，2026-08-12 已执行）**：随 `quay-init --loop` 铺到目标项目的 tick 文档（内层
`docs/analysis/fast-mode-loop-tick.md`、外层 `orchestration/orchestrator-loop-tick.md`）是**产品行为正本**；
各项目自身网络的**本层实例状态**在各自的 laid-down 副本（quay 自身即 `docs/analysis/fast-mode-loop-tick.md`
与 `orchestration/orchestrator-loop-tick.md`）。**产品行为进模板 / 本层状态留本层目录**——与 manager 层
已按同判据切分。

**这份文件是执行路径,不是理由档案。** 理由、实测、代价全在源文档 `docs/analysis/fast-mode-loop-tick.md`(1149 行),本文件只给动作和判据,每条带 `(src:行号)` 指路;
**纯提取,零发明**——每条都能在源行号逐字核对;源文档一字未改。

**行号注（2026-08-09，`gap-fast-mode-loop-tick-duplicate-paste-blocks` 去重）**：源文档删 5 处重复粘贴段
（L270/271、459-471 rebase、820-832 scheduler、956-961 步骤6+判绿三条件），1200→1173，`src:N` 前移 ≈27 行——**按内容核对不按行号**;去重是合并非删减,语义均保留 (任务体 Evidence)。

**切分声明（AC38，2026-08-12）**：本核引用的同一批行为文件已按**产品行为 / 本层实例状态**切分——内层
产品模板随 `quay-init --loop` 铺到 `docs/analysis/fast-mode-loop-tick.md`、外层产品模板铺到
`orchestration/orchestrator-loop-tick.md`（两者正文不含 quay 特有实例值）、外层 quay 实例状态在 quay
仓库自己的 `orchestration/orchestrator-loop-tick.md` 副本、管理者在 `orchestration/manager-loop-tick.md`。
内层核的 src:N 基准仍是 `docs/analysis/fast-mode-loop-tick.md`（laid-down 副本，与产品模板同源）；外层
产品行为引用外层模板落地副本，quay 网络特有值引用 quay 自己的 orchestration 副本。

**立此文件的原因**(2026-08-09):执行路径与理由档案混在同一份千行文档里,一次重读无法当 checklist
执行 ⇒ 实际被执行的是注意力当轮选中的部分。两次实证:outer 的「强制」步骤在 1095 行文档第 687 行、
静默停摆 8.5 小时;nyf-semantic-judge 工作流(49c0be86)用完即弃——4 次 done-flip 真产出却因执行核无「调用」步骤而丢。

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
| A6 | Fan-in 已返回任务(**串行**) | 先 `git -C <wt> rebase $MERGE_TARGET` (src:449) → `git merge --no-ff task/<id> -m "merge: fan-in task/<id> (runId: <runId>)"` 合回 `$MERGE_TARGET` (**fan-in 提交必须带 runId**——`fast-mode-telemetry.ts --run-id-for --taskId <id>` 机械回读派发时记的 runId;`gap-task-telemetry-6-percent-join` 遥测 taskId→git 可回溯桥) (src:457) → `$TEST_COMMAND --for-task <id>` (src:473) → `git worktree remove` + `git branch -d` (src:476);rebase 冲突/merge 冲突/选中集非绿 ⇒ 回退、标 needs-human、**停止本 tick 后续合并与派发** (src:456,472,474);设了 `QUAY_CLAIM_REMOTE` ⇒ `release-task.sh` 释放认领 (src:481) |
| A7 | `tmux capture-pane -p -t "$TMUX_SESSION" > .quay/last-pane.txt` → `inner-blocked-signal.ts --detect-stop --pane` | 停止条件的机械检查,**写盘是检查本身的后果**;命中任一 ⇒ 不派发、报告、重新排程 (src:520,560) |
| A8 | 同一 pane 喂 `inner-panel-stale-check.ts --pane … --json` | exit 1 = 括号已关但 agent 行残留冻结 ⇒ 检出该误导窗口 (src:529,533) |
| A9 | 读外层 `.quay/full-suite-state.json` | `running`/`green` ⇒ 照常派发与合并;`red`+`reason: failed`(或缺失)⇒ 暂缓 `$MERGE_TARGET`→`$FORK_BASELINE` 批量合,新派发按失败位置条件化(共享闸门 `run_static_checks` ⇒ 停派;具体测试文件且与新任务 touches 无关 ⇒ 继续;相交 ⇒ 该任务停派;无法判定 ⇒ fail-closed 停派);`red`+`reason: aborted` ⇒ **不停派**;文件缺失 ⇒ 不阻塞 (src:569-592) |
| A10 | `effective_cap="$(bash plugin/scripts/cap-from-gate.sh …)"` | **每 tick 只算一次**,3.6 的 floor 与步骤 4 的派发上限共用同一值;空值 ⇒ 重跑看 stderr (src:653,671) |
| A11 | **必跑** `ready-pool-check.ts --root … --cap … --apply` | 判据是 **`dispatchable_disjoint ≥ cap`,不是 pool 数**;`pool < floor`(=cap×4)且 promotions 非空 ⇒ 机械补晋落盘,不靠自觉;`touchesResolve: false` 的候选不晋不派 (src:647,685,692,710) |
| A12 | **必跑** `slot-refill.ts --cap … --in-flight <本会话在飞集合> --closed-but-live …` | 在飞集合**由本会话自己维护,不读遥测括号**;`should_refill=true`+`recommended` 非空 ⇒ 按步骤 4 逐候选检查后派发;否则本 tick 不派发。**机械可核验（FINDING §6/manager 2026-08-09 复发修正）：把 `recommended` 数组逐条贴进本 tick 的 tick-log 行**（`recommended=[a,b,c]` + 每条的处理：派发/串行待/skip+理由）——不贴 = 本轮判定视为「没读答案」，`meta-cc query_session_content role=tool tool_name=slot-refill` 心跳 + tick-log 里 `recommended=` 出现与否是核验点 (src:297,300,747) |
| A13 | `fast-mode-telemetry.ts --slots --cap "${effective_cap:-3}"` | 空槽必须机械可见:`realConcurrency` / `stale_brackets` / `closedButLive` / `slots_free`;`stale_brackets > 0` ⇒ 调 `--reconcile` (src:636,614,1131) |
| A14 | routine track(例常例行) | 读 `.quay/config.yml` `loop.routines:`(默认 `[]` ⇒ 空转)→ `routine-scheduler.ts --iteration <tick 计数>`(exit 0=有 DUE / 3=无)→ `read-probe-spec.ts` 派后台探针 → `routine-file-gate.ts`;**FILE-ONLY,改产品/方法代码=违规丢弃** (src:729-735) |
| A15 | 派发前逐候选六检查 | ① `touches-orthogonality-check.ts --resolve`(多数条目 MISSING ⇒ 不派发) (src:807) ② 依赖就绪,用 `it0-split-or-commit-check.ts` 的 PARENT-DONE-IFF-CHILDREN (src:811) ③ `concurrent-batch-scheduler.ts --json` 对**所有在飞任务和彼此**两两判 (src:820) ④ `fork-baseline.ts` / `integration-branch-model.ts --fork-baseline` 定分叉基线 (src:839,894) ⑤ `--self-touch`(缺 `tasks/<id>.md` ⇒ 不派发) (src:855) ⑥ 设了 `QUAY_CLAIM_REMOTE` ⇒ `claim-task.sh --check-touches` 先认领 (src:868) |
| A16 | 派发前每任务 `fast-mode-telemetry.ts --task-start --taskId <id>` | **强制不可跳过**,记下 runId;inner **只写 `--task-start`** (src:599,604,608) |
| A17 | **必跑** `sync-lag-check.sh --push --branch "$FORK_BASELINE" --root …` | 兜底触发源,不依赖任何完成事件;push 失败(非快进=真分歧)只报告、下 tick 重试,**绝不 force** (src:939,948) |
| A18 | **账本·声称机制的真实调用**(AC29(a),每 tick):`meta-cc query_session_content role=tool tool_name=ready-pool-check` → `last(timestamp)` | `--apply` 心跳是「工具造好后一次没被调用过」高发项;>3 个 tick 周期无真实调用 ⇒ 写明「已停用/已替代/是缺陷」三选一 (src:647,685) |
| A20 | **账本·slot-refill**(AC29(a)):`meta-cc query_session_content role=tool tool_name=slot-refill` → `last(timestamp)` | >3 个 tick 周期未调用 ⇒ 三选一写明;slot-refill 与 ready-pool 同族「心跳无机械保证」 (src:297,747) |
| A21 | **账本·sync-lag-check --push**(AC29(a)):`meta-cc query_session_content role=tool tool_name=sync-lag-check` → `last(timestamp)` | push 兜底是「完成事件缺失时的唯一触发源」——>3 个 tick 周期未调用 ⇒ 三选一 (src:939) |
| A22 | **账本·--task-start 计量**(AC29(a)):`meta-cc query_session_content role=tool tool_name=fast-mode-telemetry` → `last(timestamp)` 且核对 `--task-start` 分支 | 源文档自记「工具造好后一次没被调用过」——每 tick 至少一次真实 `--task-start`;缺失 ⇒ 三选一 (src:599,604) |
| A23 | **账本·monitor-mount-check 两判据**(AC29(a)):`meta-cc query_session_content role=tool tool_name=monitor-mount-check` → `last(timestamp)` | 判据 `mounted` + `targetOk` 缺一不可;本层停摆有没有人发现的全靠它——>3 个 tick 周期未调用 ⇒ 三选一 (src:370,373) |
| A24 | **执行模式两数**(AC2/AC3,`gap-inner-serial-main-thread-not-dispatch`):`node --no-warnings --experimental-strip-types plugin/scripts/inner-exec-mode-report.ts --since <本 tick 起点> --json` | 报 `main_thread_edits`(主线程 Edit 产品文件数)/ `agent_dispatches`(Agent 派发数)。**调用必须带 `--since`（本 tick 起点）**——缺 `--since` 报的是会话累计（15h），不可用于判当下（硬规则4b）；缺 `--since` 时该读数不得用于判定。**判据：产品文件编辑必须在 subagent + worktree 内执行**（人 2026-08-13 裁定；inner 再次在主会话直提修复——git rev-list --parents 单父实证零派发）；`main_thread_edits > 0` 即判违反。**红窗不再整体豁免**——红窗快修恰恰最需要隔离（改的是正在让套件变红的文件）；红窗仅豁免**只读诊断**（跑命令/读日志/看 diff，不写产品文件）(src:1181,1210) |
| A25 | **直接量活性（人 2026-08-13 裁定①+②——保底冗余 + 用直接量；slot-refill 归 A12，不重述）**：**直接量** = ①`git log -1 --format=%ci`（自己最后一次**提交**时间戳，git 客观）②`git worktree list` 任务 worktree 条数 ③worktree 内活进程（`/proc/<pid>/cwd`）④盘上任务 `status:`（枚举）。与 A12 slot-refill 读数不一致 ⇒ **以直接量为准并报出差异**。**判活性不用心跳 runIds/ts**（自己不醒就不更新 = 循环论证）；**不为检查发明新过滤/派生量**（四个读数因加未验证过滤失真：node_count comm 正则 / outer.ticklog 行形谓词 / phase_ac_checked 复选框正则 / Touches 解析器）| (人裁定①：两层都查=冗余非重复；②：观测更直接的量，避免未测试过滤与代理量) (src:1390) |

## B. 每轮必产出

- **B1 写回队列文件**(步骤 5):已完成 / 在飞(含 worktree 路径与派发时刻)/ 待执行 / 计量表 / 本 tick 做了什么。**每个 tick 结束必须写回——它是 compact 后唯一可信的状态,不要靠记忆** (src:243,952)。
- **B2 tick 必报**(缺一不可):合并了什么、派发了什么;在飞任务及时长(**按三种含义分别标注**:遥测括号在飞 / 真实在飞 `realInFlight` / subagent 在飞 + 非任务 subagent);槽位五字段;停止条件是否触发、哪条;计量表行数与均值;`tasksPerHour`(含 window*);阻塞信号状态(`reason`+`question`+累计死时间/单次最长);Monitor 两判据;**执行模式两数**(`inner-exec-mode-report.ts --json` 的 `main_thread_edits` / `agent_dispatches`——常规轮次 `agent_dispatches ≥ 1` 或非红窗时 `main_thread_edits` 不大幅 > `agent_dispatches`,违反则说明白名单归属)。**不要只说「继续中」** (src:1181,1210)。
- **B3 重新排程** `ScheduleWakeup`,间隔 **1200–1800 秒**;tick 是兜底心跳,**不是派发节奏** (src:954-961)。
- **B4 阻塞信号落盘**:judgment 条件(review-refuted 等)在**停下的那一刻**调 `inner-blocked-signal.ts --assert-blocked`,**恢复的那一刻**调 `--clear`;机械条件(合并冲突/超 90 分钟/ruling-required)由 A7 自动落盘,不要手写 (src:991,996,1002,1009)。
- **B5 建任务时**:必须有 `## Proposal`(问题+证据+选定机制)、可机械验证的 `## Acceptance Criteria`、`## Touches`,缺一不算建成;fast-mode 执行型任务另写 `## Contract` 六键(measure/band/invariant/invoke/control/resume),**一行一个键、不可折行**,`n/a: <理由>` 合法、留白不合法;`## Dispatch review` 记 reviewer/at/changed (src:1036,1039,1053,1116)。

## C. 硬约束(每条一句话)

| 约束 | 一句话 |
|---|---|
| C1 | **inner 零全量套件自跑**——只读外层 suite-state,只跑 `--for-task` 选中集(秒级) (src:488,595) |
| C2 | **inner 不写任务状态**:不翻 done、不写 `--task-end`、不写轮次记录——收尾是外层 1b 的异步活 (src:400,608,273) |
| C3 | **合并必须串行**,且合回 `$MERGE_TARGET`;`$FORK_BASELINE` 只由外层批量合推进 (src:443,505) |
| C4 | worktree **一律建在 `$WORKTREE_ROOT/<slug>`(磁盘)**,`/tmp` 是 tmpfs、建进去就是重演整机 OOM (src:23,889) |
| C5 | 派发形态必须 `Agent(run_in_background: true)`——前台派发会阻塞内层、`<task-notification>` 流永不触发 (src:882) |
| C6 | 至多 `effective_cap` 个在飞:**括号 ≠ subagent**(realConcurrency = realInFlight + subagentsInFlight)且**括号关 ≠ 进程退**(closedButLive 仍占槽) (src:614,622,270) |
| C7 | `integration-branch-model.ts --overlaps-unverified` **不得传空串**——空串使该判定恒假、机制半死 (src:898) |
| C8 | 每个任务 `## Touches` 必须含 `tasks/<id>.md` 且**不带 `(new)`**;缺 ⇒ 不派发 (src:847) |
| C9 | 触摸重叠**不要凭目测**——用 `concurrent-batch-scheduler.ts`;本会话有过目测被实测推翻的先例 (src:826) |
| C10 | 主检出对账**只用 `integration-batch-merge.sh --reconcile`**,调用方不得自己发明 `git reset --hard`(2026-08-08 销毁过 manager 未提交编辑) (src:419) |
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

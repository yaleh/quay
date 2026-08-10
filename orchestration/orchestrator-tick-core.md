# outer tick — 执行核

**这份文件是执行路径,不是理由档案。** 理由、实测、代价全部在
`orchestration/orchestrator-loop-tick.md`(1095 行)里,本文件只给动作和判据;每条尾部的
`(src:N)` 是该条在源文档里的行号——**用它机械核对有没有漏抽**。

**立此文件的原因**(2026-08-09):源文档 `### 1b 异步收尾例程(强制)`写着「每 tick 执行」却位于
第 687 行,**静默停摆 8.5 小时无人发现**(`git log | grep 'outer: close'` 从每 ~20 分钟一次变为零),
同期 not-yet-flipped 从 61% 涨到 82%。执行路径与理由档案混在一份 1095 行文档里,一次重读无法当
checklist 执行。

**当前状态:并行对照期。锚(cron / skill / 冷启动)仍指向 `orchestrator-loop-tick.md`。**
每轮两份都跑,差异记进 tick-log;确认零遗漏后,**由 outer 自己决定**是否改锚。
**冷启动(新会话 / `/clear` 后)不在本核内**——照源文档 7 步做(src:39-228)。

---

## A. 每轮必跑的读数(顺序无关,但一条都不能缺值)

| # | 动作 | 判据 / 陷阱 |
|---|---|---|
| A1 | `bash plugin/scripts/monitor-mount-check.sh --json` | 两判据缺一不可:`mounted` + `targetRoot`==本仓根(`targetOk`);挂错目标与挂对了从外面一模一样 (src:311) |
| A2 | `pgrep -af 'suite-state-trigger.ts --monitor'` + **套件链心跳**(manager 2026-08-09 定向):读 `.quay/suite-chain-heartbeat.json`(`runId`/`phase`/`ts`) | 套件触发者 Monitor 在不在;排除 pgrep 自己那一行 (src:1072)。**launch→poll→merge 链由后台 Bash/subagent 跑,本 tick 只监督心跳**——`ts` 距今 >3 个 tick 周期 ⇒ 重新武装(起新后台链),**不手动重跑整条链** (src:1072, manager 2026-08-09: 确定性控制流不占 tick 注意力) |
| A3 | 三项目 `.halt` 存在性 + 内容 + **最后提交时距**(quay / archguard / meta-cc) | 每 tick 必报——「暂停后忘了」的唯一防线 (src:555)。**组合判据(SPEC 2.8)**:`无 .halt` **且** 长期无产出(>24h)⇒ **未标记的停摆**,必须升级——只读不判会稳定产生「看见但没发现」(与 manager A5 同形) |
| A4 | 观察块:`capture-pane` → `.quay/last-pane.txt`、`git log -10`、`git status --short`、`fast-mode-telemetry --report --json`、`task-status-drift-check`(含 `--stranded`)、`batch2-queue-state.md` | 只读不动手 (src:569) |
| A5 | `ls .quay/manager-inbox/`（**列目录本身，不依赖任何 unread 计数器**——gap-inbox-counter-disconnected-from-files：counter 曾报 delivered=0 但目录实有 6 封，沉默失败） | 判据：**目录非空 ⇒ 逐条进决策**，不看 counter；`delivered`（写进目录）≠ `consumed`（读过+回执），无回执机制则 delivered>0 即报（不吞） (src:580) |
| A6 | **占用率(AC26,强制)**:**固定 `cap=5`（人 2026-08-09 裁定——动态 cap 是「被包装成数字的布尔量且算错了」，停止使用；`cap-from-gate.sh`/`process-budget.sh` 降级为纯观测，不参与裁决）**。派发/slot-refill/floor 一律用固定 5（`ready-pool-check --cap 5`）；再取「inner 最近一次**自己的**报告」 | 量占用率不量新鲜度——mtime /「transcript is fresh」/「最后活动」一律不算。**动态 cap 作废（manager 三条矛盾指导以固定 5 为准，前两条作废）**；`process-budget in_use` 计数错误（报 5 实 1——WAIT 裁决建立在错误计数上）另立案。池位判据=固定 cap=5 ⇒ floor=20（防要求自动放松） (src:583) |
| A7 | `inner-blocked-signal.ts --detect-stop --target inner --pane .quay/last-pane.txt` | 连续 3 次 `waiting-input`/`permission-prompt` 才写块;状态区有「← N agent」或有在飞 bracket = 良性空闲;`--pane` 快照 ≥300s 陈旧或缺失时**改读活 capture-pane**(stdout 带 `source=live`,不依赖磁盘快照——gap-last-pane-txt-has-no-writer) (src:598) |
| A8 | **层间 tick 间隔检查(每轮必跑)**:inner transcript mtime age,阈值 30min | 目标解析必须**验 pid 匹配 inner pane**,不用发现启发式;量自驱心跳不量最后活动 (src:485) |
| A9 | `ready-pool-check.ts --root "$REPO_ROOT" --json` → `excluded[]` 里 `not-yet-flipped` | 探测用 `taskWorkLanded`,不用 `status: done`。**判据(不只读计数):not-yet-flipped 数 ≥ floor/2 ⇒ 本 tick 报「done-flip 积压」并逐个核 AC——AC 全勾且 work 落地即翻 done,AC 未满的 workLanded 任务是上游堵塞(该修 probe 或补判据),不是「正常 backlog」** (src:675) |
| A10 | `bash plugin/scripts/closure-lag-check.sh` | 退出非 0 ⇒ 本 tick **报 WARN 进 tick-log + 报告**,不静默;信号是报告不是门控。**判据:读 `not_yet_flipped` 数字后自己求值 `not_yet_flipped ≥ threshold(30) ⇒ 升级`——但脚本默认阈值 30 是松的,17 条积压被它判「正常」;外层自己定更严判据(如 ≥10 即报「done-flip 积压偏多」并逐个核),不要只抄 `overdue: False` 当结论** (src:701) |
| A11 | 读 `.quay/full-suite-state.json` 的 `state`/`reason`/`durationMs` | `green`⇒suiteGreen;`running`⇒true(proceed);`red`⇒false;**缺文件⇒true**。`reason: aborted` **不**触发停派 (src:738) |
| A12 | 独立核实内层至少一项声称:`inner-forensics.mjs verify <类别> --since <上次 tick ISO>` / `timecost` | 以 git 和实测为准,不以内层自述为准;零命中 ≠ 没做过(先用类别形式复核);见 `⚠ 更早会话未被包含` 即窗口不完整 (src:630) |
| A13 | `self-report-vocab-audit.ts --git-log 15 --exclude-prefix outer: --window 3 --json` | 读 `inner_self_report_vocab` + `converged`;连续 3 轮无 batch 式自述 = 收敛 (src:851) |
| A14 | **账本·本轮 closure-pass 是否被调用**(FINDING §6①,每 tick):`meta-cc query_session_content role=tool tool_name=closure-lag-check` → `last(timestamp)` | 抓「收尾 pass 自述做了但没真调用」——与 manager A9 同手法(抓 nyf-semantic-judge workflow 49c0be86 用完即弃那次,有 4 个 done-flip 真产出却因执行核无「调用」步骤而丢);`--record` 心跳缺失 >3 个 tick 周期 ⇒ 写明「已停用/已替代/是缺陷」三选一 (src:668) |

## B. 每轮必产出

- **B1 收尾 pass(1b,强制,每 tick 一次)**:对每个 `not-yet-flipped` —— 先 `--task-end --taskId --runId --outcome done` 关遥测括号(`inProgress[]` 无 runId 则跳过)→ 核对 AC/DoD 真实满足后写 `status: ready → done` → 记进 `closed`。**不受套件状态门控**,红窗照跑 (src:668, 673, 682)
- **B2 留痕**:`closure-lag-check.sh --record --flipped <N>`,**零收尾也写 0** (src:693)
- **B3 全量 suite 后台起跑**:条件 = 本轮收尾 ≥1(或有新 merge 落地)**且** `state != running` **且** `resource-gate.sh --for full-suite` 放行。被测 worktree/integration checkout 时**必须**同传 `--state-dir "$REPO_ROOT/.quay"` (src:709, 714, 720)
- **B4 批量合(suiteGreen 为 true 时)**:`integration-batch-merge.sh --develop develop --integration integration`,**`--dry-run` 先跑**;false ⇒ 不跑,integration 照常接收 (src:741, 753)
- **B5 轮次记录**:`closed` 非空 ⇒ 追加 `.quay/verification-round.jsonl` 一行,**追加前**断言 `N == last+1`、**追加后**断言尾部 round == `N`;断言失败即本轮 tick 异常,不得静默跳过。`closed` 为空 ⇒ 不写、不报警 (src:755, 765)
- **B6 落盘聚合**:`fast-mode-telemetry.ts --snapshot` (src:772)
- **B7 重锚转发(1c,强制)**:**判空闲才转发**(pane 两次相同 + 无在飞 bracket + 非 ruling-required)→ `cat plugin/scripts/reanchor-prompt.txt` **逐字原样**发,不现写散文 (src:825, 834, 837)
- **B8 动作分类**:`no-action` / `unblock` / `correct` / `escalate` 记一个——判断分层是否退化的唯一依据。**`no-action` 唯一合法条件 = 五条不等式全为假**(见 B13 五条清单);任一为真则 B8 必须是 `unblock`/`correct`/`escalate` 之一,记 `no-action` 即违 (src:865)
- **B9 队列**:队列空 ⇒ 按候选/依赖/`checkTouchesPair`/优先级补充(含跨机 `task/*` 分支在飞);阶段目标要的任务 ⇒ `ready-pool-check.ts --targeted <id>` 校验 + `quay promote <id>`(不受 `pool<floor` 约束) (src:908, 941)
- **B10 学习**:问「这一轮是否改变了对目标或方法的理解」,是则改对应文件并**写明什么证据推翻了原判断** (src:1013, 1027)
- **B11 升级**:同一失败再现 / 需改方向范围 / 外层停止条件触发 ⇒ 写 `orchestration/escalations.md`,含现象+已试+为何超权+≥2 选项 (src:1003)
- **B12 自身停止条件自查**:连续 3 个 tick 没有推进任何任务状态 ⇒ 停 loop、叫人、附三次 tick 各看到什么 (src:1029)
- **B13 tick-log 追加一行**:时刻(`date -u '+%H:%MZ'`)、动作类型、做了什么、内层状态快照。**写完验证读磁盘文件(`tail -3`),不读 git**;累计分布**从行数重算**不手工加减;**tick-log 已 untrack+gitignore,「提交 tick-log」这一步作废**。**no-action 是需举证的判词,不是零成本标签(manager 2026-08-09 已核实:14:08-15:08 5 次 no-action 全不合法):tick-log 行写 `no-action` 必须同时携带五条不等式读数且全为假——①in_flight<cap 且 recommended 非空?②pool<floor?③nyf>0 且 work 落地?④integration 领先 develop 且 suite 绿?⑤suite red?——任何一条为真则 no-action 不合法,该行必须有对应动作或硬理由** (src:1045, 1051, 1057)
- **B14 每个 tick 必报**(缺任一条则分层是否有效无法判定):动作类型 / 独立核实了哪一项及结果 / 内层在飞任务数与各自时长 / 遥测任务数·均耗时·`tasksPerHour` / 本轮收尾几条 + suite `state` + `durationMs` / 套件触发者是否挂上 + 最近 `SUITE-*` 事件与时刻 / 累计动作类型分布 / Monitor 两判据 / 本轮是否转发重锚 + 空闲判据 / `inner_self_report_vocab` 与收敛状态 (src:1063, 850, 858, 776)

## C. 硬约束(每条都已付过代价,理由见档案)

| 约束 | 一句话 |
|---|---|
| C1 | **发指令前必须 `C-u`**;`C-u` → 文本 → `Enter` **三次分开调用**;发完 `capture-pane` 确认出现新 `⏺`——未确认送达等于没发 (src:276) |
| C2 | 忙闲只取 pane **底部 3 行** `tail -3 \| grep -q 'esc to interrupt'`;**整屏 `md5(capture-pane)` 是 ADR-016 明令禁止**;别写 `-S -3`(那是起始行) (src:283, 286) |
| C3 | 跑全量套件前过 `resource-gate.sh --for full-suite`,非 0 = WAIT ⇒ 只核实便宜的声称;全量只串行跑、跑完再叫醒内层 (src:296) |
| C4 | 数进程用 `comm` 精确匹配(`grep -cx node-MainThread` / `pgrep -xc node`)或显式排除自身;**`pgrep -f` 会匹配发起查询的命令自己**;判停摆要进程数 0 **且** load1<1 两个判据;找服务按端口 `ss -ltnp` (src:395, 402, 407) |
| C5 | 核实「修好了没有」看**行为**或**读 diff**,**不要 grep 关键词**——描述缺陷的词必然出现在缺陷自己的文档和修复说明里,双向都给反向答案 (src:373, 378) |
| C6 | 新检测器的**第一条事件默认当待验证,不当发现**——先跑一次能证伪它的检查,确认前不据此行动、不写进 tick 记录 (src:412) |
| C7 | 驱动文本**只携带数据,不复述行为**;要定顺序就把 `checkTouchesPair` 实际输出附在**同一条**驱动文本里;出厂文档的行为错了就改文档,不用散文覆盖 (src:957, 968) |
| C8 | 「在飞」拆两义:**括号在飞**(遥测 `inProgress`)/ **subagent 在飞**(读 Agent 调用的 `input.run_in_background` 原始字段);核实并发不得用 START 事件或 pane UI 文字 (src:985, 988) |
| C9 | 输入框是待提交缓冲区不是笔记本:备忘一律落队列状态文件或 tick-log;用完 `C-u` 清空;问责对象是「框里有文本」这一状态 (src:994) |
| C10 | **写任何时刻前先跑 `date -u`**,不许估 (src:1038) |
| C11 | 停摆分类不要靠输入框内容猜——那多半是 ghost suggestion;看最后一段 `⏺` 问了什么,直接答 (src:267, 274) |
| C12 | **人机对话期间 cron 不 fire**——每次对话结束前手动补一次 tick,不要假设 cron 会接上 (src:302) |
| C13 | 写 `tasks/` 前先确认没有在飞任务把 `tasks/` 列进它的 `## Touches`;撞上就改为「记进队列状态文件 + 指示内层建」 (src:252) |
| C14 | 派发前读候选的 `## Contract` 六键并跑 `task-contract-check.ts`(**报出不阻断**),介入后把改了什么写进 `## Dispatch review`;每个 `measure` 行自带完整反引号命令 (src:507, 517, 524) |

## D. 边界

**可以**:解阻塞(回退/bisect/判断发现真伪/分诊积压)、重排队列、补建任务、纠正错误前提、写
`orchestration/`+队列状态文件+`tasks/*.md`、给内层下指令。
**不可以**:直接改代码、改变方向或范围、写 `packages/`/`plugin/`/`experiments/` 下的实现与测试、替内层执行 (src:239, 248)
**不自己 merge**——合并冲突读两边意图后指示内层回退或修复 (src:901)
**红窗分诊外层独占**,不把红树丢给 inner:bisect 定位肇事 merge → 回退该 merge + 回退对应翻 done(或建任务)→ 修好才重启套件 → green 即撤信号;**绝不 blind `--ours/--theirs`** (src:801, 747)
跨项目优先级:**quay 高于 archguard / meta-cc**;必要时暂停后两者保本仓推进 (src:565)

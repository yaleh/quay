# manager tick — 执行核

**这份文件是执行路径,不是理由档案。** 理由、实测、代价全部在
`orchestration/manager-loop-tick.md`(1138 行)里,本文件只给动作和判据,每条最多一行指路。

**立此文件的原因**(2026-08-09 05:5xZ,人提出「控制面越小越稳定」后):执行路径与理由档案
混在同一份 1138 行文档里,一次重读无法当 checklist 执行 ⇒ 实际被执行的是注意力当轮选中的
部分。同夜两次实证:outer 的「强制」步骤在 1095 行文档第 687 行、静默停摆 8.5 小时;
我的 workflow **根本不在文档任何一行**、静默 21.5 小时。

**当前状态:并行对照期。锚仍指向 `manager-loop-tick.md`。**
每轮两份都跑,差异记进 tick-log;确认零遗漏后才改锚,切换时 tick-log 留一行。

---

## A. 每轮必跑的读数(顺序无关,但一条都不能缺值)

| # | 动作 | 判据 / 陷阱 |
|---|---|---|
| A1 | `python3 orchestration/manager-anchor-check.py` | 校的是**文件**,不是活 cron |
| A0 | `node --experimental-strip-types plugin/scripts/quay-session.ts manager-tick-readings` | **优先用这条,不再逐条手打**(2026-08-09 10:3x 查出:该脚本已存在,08-07 建成,覆盖 A1/A4/A5/A9-A11 且多出 `resource.*`(CPU/load/内存,此前从未读)与三项目 `outer.ticklog`(此前只读 quay 自己的);18 处 `catch{}` 静默吞错,读数为空时不代表"无异常",仅代表"读取失败") |
| A2 | `GATE=$(bash plugin/scripts/cap-from-gate.sh)` → 从中取 `CAP` → `slot-refill.sh --cap "$CAP"` | **同一 tick 内 cap 只取一次**;`floor` 必须与该 cap 同源(§2.4b) |
| A3 | in-flight = `tmux capture-pane -t quay-0:inner \| grep -cE '^\s+◯ '` | **不用 `slot-refill` 的 `in_flight_count`——那是入参不是测量** |
| A4 | 两层忙闲 = pane 尾部 `esc to interrupt` | pane-only;`LOOP_MIN=0` 才看得到全部事件 |
| A5 | 三项目 `.halt` 存在性 **+ 最后提交时距** | quay / archguard / meta-cc。**判据是组合,不是单读**:`无 .halt` **且** 长期无产出(>24h)⇒ **未标记的停摆**,必须升级。**只读不判会稳定产生「看见但没发现」**——实证:我每轮都打印 `archguard 无.halt`,而它已 2 天无提交,连续多轮未升级(2026-08-09 06:4xZ 补报) |
| A6 | `git merge-base --is-ancestor develop integration` + 两方向 `rev-list --count` | AC27 |
| A7 | 套件末轮:读 `.quay/verification-round.jsonl`,**先按 `startedAt` 非空过滤再取末条** | ①单状态文件只答「此刻在跑什么」,不答「第 N 轮结果」(它每轮覆盖);②**该 jsonl 是异构日志,两种记录混写**:套件轮次 `{startedAt,durationMs,state,reason,…}` 与收尾轮次 `{at,suiteGreen,closed:[…]}`(实测 75/150 是后者)。**直接取末行会在末行恰为收尾记录时报 `state=None`,看起来像"空记录/记录缺陷",实则是我取错了类型**(2026-08-09 06:3xZ 亲历并误报过一次) |
| A8 | `git status --porcelain \| wc -l` | 脏树 |
| A9 | `meta-cc query_session_content role=tool tool_name=Workflow` → `last(timestamp)` | §2.4c;>3 个 tick 周期未调用 ⇒ 写明「已停用/已替代/是缺陷」三选一 |
| A10 | 我跑的 `session-liveness` 是不是旧版 | 逐行 `ps` 看进程与其脚本路径(C1);**版本落后 = 观测的是未修版**(档案 §1.4) |
| A11 | `Monitor` 工具任务是否还活着 | 它们不在 A10 的覆盖里;**本轮发过事件即为存活证据**(档案 §1.4e) |
| A12 | 聚合升级项 + 资源仲裁与排序 | 三项目横向;无新项也要写「无」(档案 §1.c/§1.d) |
| A13 | 本轮抛给人的「可自判」问题计数 | 机械计数,写进账本;判据见 C8(档案 §⑧) |

## B. 每轮必产出

- **B1 §0.5b**:每条活跃 AC 给一个状态词(达成 / 待观察 / 不适用 / 不可判 / 违反),**缺值 = 未查**。
  **本阶段活跃集(人 2026-08-09 裁定「实现三层统一架构 SPEC」为阶段目标后)**:
  既有 `AC20-AC27`(结果量与既有机制,**未作废**)+ 新增 `AC28-AC34`(统一架构落地)。
  `AC28`(经验能在层间流动)是本阶段**主判据**;`AC29`(执行账本)是今天最缺的一项。
  规格正本:`orchestration/SPEC-three-layer-unified-architecture-2026-08-09.md`。
- **B2 四元组**(与三层统一契约同格式):① 各声称机制的最近真实执行时刻 ② 占用率(in-flight/cap)
  ③ 本轮写入落到哪条线 ④ 本行账本。
- **B3 tick-log 追加一行**(六列),用 `'XEOF'` 引号 heredoc,**只 `'a'` 追加,永不 `'w'`**。
- **B4 哨兵清扫**:`CronList` → 删所有含 `[manager-tick]` 者 → 建一个。**绝不靠记住的 ID。**

## C. 硬约束(每条都已付过代价,理由见档案)

| 约束 | 一句话 |
|---|---|
| C1 | **计数是结论不是读数**——要给数量,先 `grep -a <pat> <file>` 逐行打印,禁止直接 `grep -c` |
| C2 | 进程计数用 `ps -eo pid,etime,args \| grep -v shell-snapshots \| grep -v ugrep \| grep -- "$P"`;本机 `grep` 是 ugrep 函数,`grep -v grep` 失效 |
| C3 | **未跟踪的正本禁止单行 read-modify-write**;改写前先 `cp` 备份,读/写分两句 |
| C4 | 提交前确认落点:**manager 的写落 `integration`**,落 develop 会破两线不变式 |
| C5 | 「内容是否落地」用内容比对(提交信息/diffstat);「祖先关系」才用 `is-ancestor`——cherry-pick 造新哈希 |
| C6 | 任何「某机制会导致 X」的断言,发出前引用实现里的一行;引不出来只报现象 |
| C7 | 跨文件/跨分支的数字,用之前先确认它出自**哪一份**副本 |
| C8 | 已核实的事实直接发外层,**不问「要不要发」**;决定归外层的,给事实 + 意见 + 明说裁定权在它 |
| C10 | **发指令前必须 `C-u`;`C-u` → 文本 → `Enter` 三次分开调用**(合并会丢 Enter);发完 `capture-pane` 确认。**我今晚每次发消息都这么做,但它从来只在我记忆里** — 借自 outer C1 |
| C11 | **写任何时刻前先跑 `date -u`,不许估。** 今晚两次班次时间算错(`--since` 用了未来时刻返回空;写「已过点」而其实没到) — 借自 outer C10 |
| C12 | 核实「修好了没有」看**行为**或**读 diff**,**不要 grep 关键词**——描述缺陷的词必然出现在修复里。今晚 grep 到 `ERROR:`/`ANTI-DRIFT HARD FAIL` 差点当失败报,查紧邻行才知是 fixture 负向输出 — 借自 outer C5 |
| C13 | 下结论前先问「**如果我错了,哪一条命令会告诉我**」并跑它、贴输出。今晚每条裁定都写了反证条件(逃生舱、cgroup 假设),但那是临场自觉不是判据 — 借自 inner C13 |
| C14 | **AC25 追问前先算"距上一次终态/交接的新鲜度"**（默认阈值 20 分钟）。`in-flight<cap` 且 `dd>0` 且两层 idle 这组读数,新鲜度不同判词不同——**同一读数组合不能不分场合套用同一条追问模板**(2026-08-09 08:5x 亲历:round-158 结束仅 5.9 分钟就差点复用 20 分钟阈值的追问) |
| C15 | **核实 outer/inner 有没有答过某个问题,用 `meta-cc query_session_content`(带 `session_id` + `since`),不是 `capture-pane` 回滚。** 2026-08-09 11:0x 实测:pane 回滚 220 行没找到 outer 对我一个问题的回复,以为它没答;meta-cc 精确查同一会话同一时间窗,拿到完整答复过程——**它已经答了,是我自己没查对地方**。pane 只有有限回滚且会被后续输出顶出窗口,meta-cc 按 `session_id`+`since` 精确到时刻,不受长度限制 |
| C9 | **cron 只在本会话空闲时触发**——与人对话期间 tick 不 fire(实证:2026-08-09 06:00 那轮未触发,当时对话连续进行中)。⇒ **对话结束前手动补一次 tick**,并在行里注明「补跑」。此条抄自 outer 文档已有的失效模式 (d)(`orchestration/orchestrator-loop-tick.md:302`)——**该规则 outer 有、我没有,是跨层不对称,我是在提取它的文档时才知道自己也有这个洞** |

## D. 边界

不写任务体/AC/DoD、不跑验证、不替任何项目调试代码、不直接改项目代码。
**手里出现 `.sh`/`.ts` 实现是越界信号。**
删除/覆盖任何目标前先看目标。跨主机:黑名单——kill / rm -rf / 批量进程操作一律不跨主机执行。

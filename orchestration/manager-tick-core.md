# manager tick — 执行核

**这份文件是执行路径,不是理由档案。** 理由、实测、代价全部在
`orchestration/manager-loop-tick.md`(1138 行)里,本文件只给动作和判据,每条最多一行指路。

**立此文件的原因** (src:1176) — 两次实证:outer 的「强制」步骤埋在 1095 行文档第 687 行、
静默停摆 8.5 小时;outer 的 `nyf-semantic-judge` **不在文档任何一行**,产出 4 个 done-flip(`49c0be86`)后用完即弃(**原例「我 workflow 静默 21.5h」举错,已更正**,见档案 §workflow-价值核查)。

**当前状态:并行对照期。锚仍指向 `manager-loop-tick.md`。**
每轮两份都跑,差异记进 tick-log;确认零遗漏后才改锚,切换时 tick-log 留一行。

---

## A. 每轮必跑的读数(顺序无关,但一条都不能缺值)

| # | 动作 | 判据 / 陷阱 |
|---|---|---|
| A1 | `python3 orchestration/manager-anchor-check.py` | 校的是**文件**,不是活 cron (src:937) |
| A0 | `node --experimental-strip-types plugin/scripts/quay-session.ts manager-tick-readings` | **优先用这条,不再逐条手打**(2026-08-09 10:3x 查出:该脚本已存在,08-07 建成,覆盖 A1/A4/A5/A9-A11 且多出 `resource.*`(CPU/load/内存,此前从未读)与三项目 `outer.ticklog`(此前只读 quay 自己的);18 处 `catch{}` 静默吞错,读数为空时不代表"无异常",仅代表"读取失败") |
| A2 | **固定 `cap=5`。动态 cap 已停用**(人 2026-08-09 16:5x 裁定:「它除了表示 suite 测试在跑,没有其它价值。停止使用它,就算是个固定的 cap(如 5)也比它好」) | **证据比「只有 1 bit」更糟**:`process-budget` 报 `total_budget=4 in_use=5 available=0 verdict=WAIT`,而实测 node MainThread 进程只有 **2** ⇒ **裁决建立在错误计数上**;cap 取值分布 `4(40)/1(36)/5(25)/2(21)/3(5)`,`cap=1` 每 3~4 轮出现一次,只随「suite 跑不跑」切换。⇒ **`cap-from-gate` / `process-budget` 降级为纯观测,不得参与任何裁决**;池位 floor 亦按固定 cap=5 算 (src:882) |
| A3 | in-flight:`git worktree list \| grep -c quay-worktrees` **+ 必带 `--session` 的执行模式两数**:`inner-exec-mode-report.ts --session ~/.claude/projects/-home-yale-work-quay/<inner的id>.jsonl --json` | **worktree=0 ≠ 空闲**:01:46 inner 在主线程直改 integration 修红(`cc35da7a`,无 worktree),我只数 worktree 就报「①成立应派」并发了 outer,**错的是对象不是算术**。**缺 `--session` 更糟**:自动检测取「最新 .jsonl」,从我这边跑必命中**我自己**的会话(与 outer 01:47 错读同源)。pane 双向不可信:假零(15:38 实为 2)、假一(16:23 同一个 `17m 21s`)。`slot-refill` 的 `in_flight_count` 是入参不是测量 (src:133) |
| A4 | 两层忙闲 = pane 尾部 `esc to interrupt` | pane-only;`LOOP_MIN=0` 才看得到全部事件 (src:590) |
| A5 | 项目 `.halt` 存在性 **+ 最后提交时距** | **范围:仅 quay。archguard(17:2x)、meta-cc(17:3x)均按人裁定【取消监测】**,不再读、不再判、不再升级(A0 脚本仍会打印二者读数——产品代码,**打印≠监测**,见则跳过)。**注意区分**:meta-cc 项目(已取消监测)≠ `meta-cc` MCP 工具(A9/C15 仍在用,是我的核实手段,不受此裁定影响)。**判据是组合,不是单读**:`无 .halt` **且** 长期无产出(>24h)⇒ **未标记的停摆**,必须升级。**只读不判会稳定产生「看见但没发现」** (src:35) |
| A6 | `git merge-base --is-ancestor develop integration` + 两方向 `rev-list --count` | AC27 (src:855) |
| A7 | 套件末轮:读 `.quay/verification-round.jsonl`,**先按 `startedAt` 非空过滤再取末条** | ①单状态文件只答「此刻在跑什么」,不答「第 N 轮结果」(它每轮覆盖);②**该 jsonl 是异构日志,两种记录混写**:套件轮次 `{startedAt,durationMs,state,reason,…}` 与收尾轮次 `{at,suiteGreen,closed:[…]}`(实测 75/150 是后者)。**直接取末行会在末行恰为收尾记录时报 `state=None`,看起来像"空记录/记录缺陷",实则是我取错了类型**(2026-08-09 06:3xZ 亲历并误报过一次) |
| A8 | `git status --porcelain \| wc -l` | 脏树 |
| A9 | `meta-cc query_session_content role=tool tool_name=Workflow` → `last(timestamp)` | §2.4c;>3 个 tick 周期未调用 ⇒ 写明「已停用/已替代/是缺陷」三选一 (src:901) |
| A10 | **仪器存活(两项合一)**:①我跑的 `session-liveness` 是不是旧版(逐行 `ps` 看进程与其脚本路径,C1) ②`Monitor` 任务是否还活着(不在①覆盖内) | 版本落后 = 观测的是未修版;**本轮发过事件即为 Monitor 存活证据**(档案 §1.4/§1.4e) (src:37,499) |
| A16 | **机件绕过自查**:数本会话里的裸 `tmux send-keys`,**按位置判定——命令位置(行首/`&&`/`;`/管道后)且不在引号内**,非 0 即本轮违规记账 | **首版按关键词匹配,首跑即 3 次假阳性**(我发出的消息正文、我统计脚本里的 grep 模式、台账 JSON 字符串)——**本仓库已解决过两次**(`drive-contract-check.ts`「by POSITION, never by keyword」/`test-framework-policy-check.ts`「strings that merely mention it do not count」),**我在指认「大家绕过已有机件」的同一轮里重造了已解决两次的反模式**,判定手法直接复用那两个 checker,不要重造。近3天按位置真调用 **332**(关键词 339,虚高 7),经机件 323——**大致各半**;分布 **我 263 / outer 56 / 其它 13**,**主要绕过者是我,不是 outer** |
| A12 | 聚合升级项 + 资源仲裁与排序 | 三项目横向;无新项也要写「无」(档案 §1.c/§1.d) (src:689) |
| A13 | 本轮抛给人的「可自判」问题计数 | 机械计数,写进账本;判据见 C8(档案 §⑧) (src:814) |
| A15 | **收件箱:`ls -la .quay/manager-inbox/`——判据是【列目录本身】,不得依赖未读计数器** | 实测 2026-08-09:目录里 6 封 archguard 报告(最新 08-06,三天前)全未读,而 `supervisor-bus-identity.sh inbox-summary` 报 `unread=0` ⇒ **计数器沉默失败**。我的核此前 `inbox` 命中 0 条,outer 的 A5 早有此项——**跨层不对称,方向同 C9**。未读逐条进决策;**delivered ≠ consumed**(借自 outer A5) (src:1203) |
| A14 | **背离度:生产是否快于收尾** | 对 B3 五条做算术,不做行为归因。触发 = ③`nyf` 与 ②`pool deficit` 连续 K 轮不下降,且同期 ① 至少翻转过一次。阶梯:K=1 报外层 / K=2 升级给人 / K=3 关生产闸(**不是 `.halt`——会死锁**,接 `slot-refill.ts:155` 已有挂载点)。**保障可观测与止损,不保障意志** (src:1180) |

## B. 每轮必产出

- **B1 tick 第一步 = `Workflow({scriptPath:'.claude/workflows/manager-tick-core.js'})`,再照它返回的
  `指令.第一/二/三/四步` 做**——判准活在磁盘上、跨 clear/compact 稳定,**不是"我记得应用"**;自带
  meta-cc 自审段。**手写判词不被接受**;缺读数按「缺值=未查」判不可判,不得写 `no-action`。活跃集
  `AC20-AC34`,主判据 `AC28`。**调查型工作走后台 subagent**(人量化门槛 5-8 分钟)。**2026-08-10:我
  08-08 07:35 后停调它、今晚还重造了个更粗的替身(已删)——它从没丢,丢的是调用**(档案 §为什么要 workflow/subagent)。
- **B2 四元组**(与三层统一契约同格式):① 各声称机制的最近真实执行时刻 ② 占用率(in-flight/cap)
  ③ 本轮写入落到哪条线 ④ 本行账本。
- **B3 tick-log 追加一行**(六列),用 `'XEOF'` 引号 heredoc,**只 `'a'` 追加,永不 `'w'`**。
  **⚠️ 本组一律写 `甲乙丙丁戊`,禁用 ①-⑤(那是 `manager-tick-criteria.md` 判准的编号)。2026-08-10 自审实证:我三行只写本组却沿用 ①-⑤,行里明明有 ①②③④⑤ 而标准六条一条没判(且从未退休,仅 ⑥ 于 08-07 20:1x 明文退休由 ⑥′ 取代)——编号复用把缺席伪装成在场,同形于「布尔化把对象没了伪装成检查失败」。两套都要写:先判准①-⑤/⑥′,再甲-戊。**
  **`no-action` 需举证**:该行必须携带本组五条且**全为假**——甲`in_flight<cap` 且 `recommended` 非空;乙`pool<floor`;
  丙`nyf>0` 且工作已落地;丁`integration` 领先 `develop` 且 suite 绿;戊suite `red`。
  实证 2026-08-09 14:08-15:08:outer 5 次 tick 全判 `no-action`,而①②③在这 5 次里**每次都为真**
  (在飞 0~1 < cap 4、pool 11 < floor 16、nyf 17——nyf 这个数还是它自己 A10 每轮读出来的),
  欠 15 个强制动作交付 0 个。**我自己同期的 `no-action` 行同样没带这五条读数,是同一个洞**;
  人的原话:「不要再为愚蠢的行为做解释——先想清楚正确的行为是什么,再去看行为是否符合」。
- **B4 哨兵清扫**:`CronList` → 删所有含 `[manager-tick]` 者 → 建一个。**绝不靠记住的 ID。**

## C. 硬约束(每条都已付过代价,理由见档案)

| 约束 | 一句话 |
|---|---|
| C1 | **计数是结论不是读数**——要给数量,先 `grep -a <pat> <file>` 逐行打印,禁止直接 `grep -c` (src:473) |
| C2 | 进程计数用 `ps -eo pid,etime,args \| grep -v shell-snapshots \| grep -v ugrep \| grep -- "$P"`;本机 `grep` 是 ugrep 函数,`grep -v grep` 失效 |
| C3 | **未跟踪的正本禁止单行 read-modify-write**;改写前先 `cp` 备份,读/写分两句 (src:258) |
| C4 | 提交前确认落点:**manager 的写落 `integration`**,落 develop 会破两线不变式 (src:160) |
| C5 | 「内容是否落地」用内容比对(提交信息/diffstat);「祖先关系」才用 `is-ancestor`——cherry-pick 造新哈希 (src:580) |
| C6 | 任何「某机制会导致 X」的断言,发出前引用实现里的一行;引不出来只报现象 |
| C7 | 跨文件/跨分支的数字,用之前先确认它出自**哪一份**副本 (src:580) |
| C8 | 已核实的事实直接发外层,**不问「要不要发」**;决定归外层的,给事实 + 意见 + 明说裁定权在它 (src:16) |
| C16 | **绕过不是罪,不留痕才是。** 撞上本项目工具缺陷 ⇒ 最低线是立案(复现+期望+实际),然后可继续绕过干活;不立案就绕过 = 缺陷永久化。本仓库自己的工具更强适用——没有别人会修 (src:1189) |
| C10 | **一律用 `plugin/scripts/supervisor-deliver.sh <目标> <文本> --transcript <目标会话 .jsonl>`（唯一交付实现；exit 0=目标 transcript 出现内容匹配的真实 user 消息,1=failed 需人工,2=用法错）。`--root` 是【重生会话】模式,等新 transcript 落盘——**对活着的会话用它必报 FAIL(我 02:2x 亲历,文本其实已送到)**。禁止手工拼 `send-keys`;`send-keys-verified.sh` 的 md5 判据已被 outer ruling F 取代、ADR-016 修正案边界 (c) 明令禁止** —— 五个失效模式 2026-08-04 已实测结晶于 `orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md`:C-u 只清当前行(1554 字节需 30 次)、长文本紧跟 Enter 被丢、稳定态 Enter 仍可能不提交、已提交与进 transcript 差 ~30s、**唯一可信送达信号是目标 transcript 里的真实 user 消息**。**我整晚手工拼、又两次指错工具/参数——今晚「发现」的每一条三天前都在这里** |
| C11 | **写任何时刻前先跑 `date -u`,不许估。** 今晚两次班次时间算错(`--since` 用了未来时刻返回空;写「已过点」而其实没到) — 借自 outer C10 (src:956) |
| C12 | 核实「修好了没有」看**行为**或**读 diff**,**不要 grep 关键词**——描述缺陷的词必然出现在修复里。今晚 grep 到 `ERROR:`/`ANTI-DRIFT HARD FAIL` 差点当失败报,查紧邻行才知是 fixture 负向输出 — 借自 outer C5 (src:687) |
| C13 | 下结论前先问「**如果我错了,哪一条命令会告诉我**」并跑它、贴输出。今晚每条裁定都写了反证条件(逃生舱、cgroup 假设),但那是临场自觉不是判据 — 借自 inner C13 |
| C14 | **AC25 追问前先算"距上一次终态/交接的新鲜度"**（默认阈值 20 分钟）。`in-flight<cap` 且 `dd>0` 且两层 idle 这组读数,新鲜度不同判词不同——**同一读数组合不能不分场合套用同一条追问模板**(2026-08-09 08:5x 亲历:round-158 结束仅 5.9 分钟就差点复用 20 分钟阈值的追问) (src:51) |
| C15 | **核实 outer/inner 有没有答过某个问题,用 `meta-cc query_session_content`(带 `session_id` + `since`),不是 `capture-pane` 回滚。** 2026-08-09 11:0x 实测:pane 回滚 220 行没找到 outer 对我一个问题的回复,以为它没答;meta-cc 精确查同一会话同一时间窗,拿到完整答复过程——**它已经答了,是我自己没查对地方**。pane 只有有限回滚且会被后续输出顶出窗口,meta-cc 按 `session_id`+`since` 精确到时刻,不受长度限制 (src:16) |
| C9 | **cron 只在本会话空闲时触发**——与人对话期间 tick 不 fire(实证:2026-08-09 06:00 那轮未触发,当时对话连续进行中)。⇒ **对话结束前手动补一次 tick**,并在行里注明「补跑」。此条抄自 outer 文档已有的失效模式 (d)(`orchestration/orchestrator-loop-tick.md:302`)——**该规则 outer 有、我没有,是跨层不对称,我是在提取它的文档时才知道自己也有这个洞** (src:125) |

## D. 边界

不写任务体/AC/DoD、不跑验证、不替任何项目调试代码、不直接改项目代码。
**手里出现 `.sh`/`.ts` 实现是越界信号。**
删除/覆盖任何目标前先看目标。跨主机:黑名单——kill / rm -rf / 批量进程操作一律不跨主机执行。

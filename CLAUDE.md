# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **本文件是唯一每会话自动注入的文档 —— 它的行数是本仓库最稀缺的资源。**
> 因此只放两类东西：**① 指向正本的指针；② 不随代码演化过期的纪律。**
> 任何清单、命令块、参数表都属于它们各自的正本，**在这里复制一份就是制造漂移**
> （实证 2026-08-10：`:204` 教了三天已被 `ruling F` 取代的做法，339 次绕过由此而来，
> 而没有任何检查发现——**覆盖率最高的位置，错误的杀伤力也最大**）。

## 每轮必经（只放指针，清单在正本里）

| 要做什么 | 正本（**不要在本文件复制其内容**） |
|---|---|
| 有哪些机件、各自回答什么问题 | `bash plugin/scripts/capability-catalog.sh`（**唯一清单**；声明数看它自报——`summary: N scripts`，不要硬记数字，会随脚本增删漂移） |
| 驱动/投递到别的 Claude 会话 | **默认：`ListAgents` → `SendMessage`**（人 2026-08-12 裁定「实际应用 SendMessage」；需 Claude Code 2.1.224 或更新,本机 2.1.228）。**实测**：目标 busy 直投即达（无 can-receive 闸门）；到达形态 `<cross-session-message from=… from-name=… from-mode=…>`,**身份由平台标注而非发送方自称**；平台强制 peer 不能代替人许可/改配置/**执行斜杠命令**。**旧机件保留可用但非默认路径**（人 2026-08-12 裁定「还保留原实现和测试,但尽量减少对其使用」）：`supervisor-deliver.sh` / `send-keys-reliable.sh` / `drive-target-check.sh` / `transcript-delivery-check.ts`。（`message-bus.ts` / `inbox-reader.sh` 随 inbox 机制删除——人 2026-08-20 裁定范围A。）**保留的两个不可替代用途**：①**控制面**——`/clear` 等斜杠命令原生通道办不到（文档明确 "Commands don't run"）,只能走 tmux 输入；②**下游交付面**——Claude Code 低于 2.1.224 者 / Bedrock·AWS·GCP·Foundry / native Windows。**手工拼 tmux send-keys 仍禁止。** |
| 三层每轮该做什么 | `orchestration/{manager,orchestrator,fast-mode}-tick-core.md`（执行路径；**强制判据是 `tick-core-static-check.ts` 的 (src:N) 覆盖率=100%，不是行数**；「各 ≤80 行」判据退役说明 → `orchestration/archive/AC58-retired-clauses.md#R17`） |
| 判准 / 收尾 / 发消息形态 | `orchestration/manager-tick-{criteria,closing,sending}.md`（466 行；**停调 workflow 19 小时 ⇒ 这些全部缺席 ⇒ 8 条违规**） |
| pane 状态 | `plugin/scripts/pane-state-classify.ts`（底部区域 + 枚举态，**不是整屏哈希**）。**⚠️ 它是【被 import 的判定库】，不是每轮直接调的命令**——真实消费者是 `session-liveness.sh`（`classifyPaneVerdict` 等）与 `inner-blocked-signal.ts:151`（outer A7 / inner A7-A8 经它间接用）。**manager 直接调用那一条（旧 A4）已于 2026-08-14 退役**（人令清理；实测从未执行）→ `orchestration/archive/AC58-retired-clauses.md#R28`。**pane 忙闲是代理量**：pane 进程存在 ≠ 会话在处理（实证：inner 的 pane 一直在而 tick 停 21 分钟）；**判层活性的正本是直接量**（`git log` 提交时刻 / worktree 内活进程）。 |
| **诊断「空槽 + 池里有货 + 就是不派」** | **先查 subagent 预算,不要先怀疑机制** —— harness 有**会话级累计** spawn 上限，触顶后**静默降级为主线程串行**，三层执行核都不写它。识别：目标会话 transcript 里搜 `Subagent spawn limit reached`；实测燃烧率 ~60 次/天 ⇒ 默认额度约 **3 天**寿命，**任何长于 3 天的自主运行必然撞它**。数值、环境变量名、`/clear` 是否重置、两个易混旋钮（会话累计 vs 并发）——**正本在 `tasks/gap-inner-subagent-budget-invisible.md`，不在此处复制**（数值随 Claude Code 版本变）。**代价实证 2026-08-10：三层 + 人共花数小时反复误诊为「outer 不派发」「inner 自锁」「唤醒链断」，全错。** **第二种成因（2026-08-13 实测补）**：inner 长时间占用回合做【主线程编辑】（红窗快修等），期间既不产生完成事件、也不触发心跳重评估 ⇒ 同样表现为空槽+有货+不派，但 subagent 预算完全正常（实测 21/200）。**识别：查 slot-refill 调用间隔**（实测一夜有 4 段 54–149 分钟空档、合计占窗口 52%），不是查预算。 |

## 认识论硬规则（不随代码过期；标注了各自靠什么保证）

1. **用机件，不手搓**——动作前先查 catalog 有没有同类工具。〔产物：投递工具名进记录 / `A16` 按位置计数〕
   **最高频的一个实例，单列**：**任何「查会话历史 / 读 transcript / 统计 agent 用量」都先用 `meta-cc` MCP，不要手搓 `python`/`grep` 解析 `*.jsonl`。**
   实证：管理者台账里此类认账 **16 条**，且 2026-08-11 02:1x 在人指出的前五分钟内又连犯两次（手搓解析 `agent-*.jsonl` 与 `meta.json`）。
   **为什么单列而不靠上一句涵盖**：上一句是通则，而通则在动手那一刻不会浮现；这条此前只写在管理者自己的核（C15，且窄——只禁 `capture-pane` 回滚）与台账里，
   **不在唯一会被自动注入的本文件中** ⇒ 每次都要靠当场想起来。〔**无产物，靠自觉**〕
   **`meta-cc` 返回空 ≠ 没有数据**（硬规则 5 来源完备性）。**已实测的一个覆盖缺口 + 绕法（2026-08-11 02:2x）**：
   `query_session_content` 按 `working_dir` **哈希**定位 project，**只读【主会话 jsonl】**。
   **⚠️ 2026-08-14 12:1xZ 用干净针实测重验，范围比原记述更大，且多出一个陷阱**：

   **transcript 目录结构（实测）**：
   ```
   ~/.claude/projects/<project-hash>/
   ├── <session-id>.jsonl                  ← 主会话（meta-cc 唯一能【搜内容】的对象）
   └── <session-id>/
       ├── subagents/agent-<id>.jsonl                      ← 直属 subagent（inner 实测 126 个）
       ├── subagents/workflows/<run>/agent-<id>.jsonl       ← workflow 内的 agent
       ├── subagents/workflows/<run>/journal.jsonl          ← 每 agent 一条 result
       └── tool-results/<id>.txt                            ← 大工具输出的落盘
   ```
   **干净针实测（两根针各只存在于一个文件，主会话不含）**：
   ```
   针「code_delta output is empty」→ 只在 workflows/<run>/agent-*.jsonl
   针「in a worktree. Let me first create the worktree…」→ 只在直属 subagents/agent-*.jsonl
   两针分别用 query_session_content(session_id=<该会话>, include_subagents=true) 查 ⇒ 【都返回 0】
   ```
   ⇒ **不是只有 workflows 不递归——【直属 subagents/ 也不递归】**；
   ⇒ **⚠️ `include_subagents` 参数存在、默认 true，但对上述两类【都不生效】**——
   **参数名会让人以为它管用，这是比"没有该功能"更贵的形态**（同硬规则 3b：一个看起来覆盖了的选项）。
   **正确做法（三步，缺一不可）**：
   ```
   ① 定位文件  grep -rl '<针>' ~/.claude/projects/<project-hash>/     ← 文件系统，不是 meta-cc
   ② 取元数据  meta-cc inspect_session_files --files <显式路径>        ← 实测可用：size_bytes/line_count/record_types/time_range
   ③ 搜内容    grep -r / grep -oh                                     ← meta-cc 无此能力
   ```
   **⚠️ ① 的范围必须覆盖【两层】**：**2026-08-14 我只搜了 `workflows/` 下 8 个 run 就断言「lane 无可查对象」，
   而同一会话有 126 个直属 subagent transcript 没搜** ⇒ 假结论。**硬规则 5 的经典违反，当日第三次同形。**
   **轮次数就是成本的驱动量**：实测一次 suite-fix workflow 42 个 agent 共 705 轮、缓存读占 **98.8%**、真正新 token 仅 92 万
   ⇒ **别用「总 token」判贵贱，要拆出 `cache_read` 再谈**（我 2026-08-11 02:2x 就因未拆而给出过一个误导性的「省 9M token」结论）。
2. **按位置判定，不按关键词**——注释、字符串、消息正文里提到不算命中。〔产物：复用 `drive-contract-check.ts` / `test-framework-policy-check.ts` 的判定手法〕
   **但那两个产物只覆盖各自那一个检查，临时 `grep`/`wc -l` 没有产物 ⇒ 只能靠意志 ⇒ 2026-08-12 一天内同形状四次。**
   **给临时用法补的产物（动作，不是提醒）：引用一个计数之前，先打印它匹配到的前 3 条实际内容。**
   做没做在记录里看得见。四次实证：`--state-dir`（grep 了一个不覆盖 X 的模式 ⇒ 误报「缺失」）、
   `1223 静态点×地板`与 `cli-import 行数未变`（静态计数当执行次数 ⇒ 误报「没做」，实为 execve 285→205、墙钟 -51%）、
   `acRatio`（`grep -c` 命中的是注释 ⇒ 误报「还在」）、`oom-kill`（85 次全是一个 `MemoryMax=64M` 的故意测试
   ⇒ 差点误报「内存上限太紧」，实测峰值 1.5G/6G）。**前三次都是跑完命令直接用输出；第四次唯一的差别就是这个动作。**
   **⚠️ 同日第五次（方向相反，由 outer 捕获）暴露这个产物只补了一半：打印命中只挡【假阳性】，挡不住【假阴性】——计数为 0 时没有命中可打印。**
   实例：我判「打了 `delivery-critical` 标签的任务 **0** 条」，真值 **45** 条（44 done / 1 todo / 0 ready）；
   原因是 awk range `c==1 && /labels:/,/^[a-z_]+:/` 在下一行即终止，只输出 `labels:` 一行，够不到 list-item 形的标签。
   ⇒ **零计数的配套动作是另一个：把谓词对着一个【已知为真】的样本干跑一次**（我事后用它一条命令就定位了 bug）。
   **两个动作是同一条纪律的两半：非零查「命中的是不是我要的」，零查「谓词对真样本命不命中」；只做一半就只防一个方向。**
3. **枚举，不布尔**——布尔化的存在性检查会把「对象没了」伪装成「检查失败」。〔产物：判准③ 要求写出条数与清单〕
   **3b（镜像半边，2026-08-13 补，同日三个独立实例）：判定机件在【读不懂输入】时，不得返回与【合格】同形的值。**
   上半条说的是「对象没了 ⇒ 伪装成检查失败」；**这半条相反且更危险——「读不懂 ⇒ 伪装成检查通过」。**
   **三个实例，同一天，三个互不相关的机件，全部退出码 0、结构完整、数字合理**：
   ① `task-status-drift-check.ts:126` `if (!acSection) return {total:0,checked:0,unchecked:0}`
   ⇒ 标题带后缀（`## Acceptance Criteria (runnable — …)`）导致整段读不到 ⇒ **零未勾 ⇒ 判为完成**；
   ② `slot-refill.ts:373` `if (total === 0) return true` ⇒ 同一个根，**第一行就判 landed**，连未勾逻辑都走不到；
   ③ `outer-tick-log-check.sh:107/:112/:205/:262` `ACTION` 解析不出 ⇒ **每一条检查分支都跳过** ⇒ `:289` 打印
   `PASS — is self-consistent`。**③ 最能说明危害**：它被接进套件的当轮，"不产生新红"被当成接线成功的证据，
   **而"不产生新红"正是一个结构上不可能报红的检查会给出的结果**（与硬规则 4 同源）；
   **接线前我们【知道】那条义务没被执行，接线后套件每轮打印 PASS ⇒ 记录上看起来它正在被执行。**
   **⇒「没有检查」是已知的空白；「一个恒绿的检查」是一个假的保证，后者更贵。**
   **共同修法（三处实际采用的都是它）**：**给"无法评估"一个独立取值**，不与"合格"共用输出——
   `sectionFound:false` / `NOT-EVALUATED` + `evaluated:false`。**不是一律 fail-closed**：
   ③ 若当场改 fail-closed 会立刻让套件红并挡住在飞任务，**而"说实话"零代价**（`exit 0` 但取值可区分），
   fail-closed 留到该判据真正具备输入之后。**判据：一个判定的输出词表里，若没有"未评估"这一态，
   它就无法区分"查过且合格"与"没查成"。** 〔**无产物，靠自觉**；发生率已 3，若再现 ≥2 次则应造检测器〕
4. **一个结构上不可能取假的量，不是测量**——恒等式、自证、回显都属此类。〔**无产物，靠自觉**〕
   **推论（2026-08-10 恢复：此条曾被我在 292→169 压缩中误删，第 4 个受害者）**：**成本结构未知前不要设数值阈值**
   ——那是 AC9/416s 的错误；为一个从未被测量的量设目标同理。**先分解成本，再谈指标**；端到端耗时若依赖
   一个外生变量（如失败对象个数 N），它就不是指标，只能当同 N 下的前后对照基线。
   **推论二（2026-08-12 实证，代价：一台 16 核机器的套件被静默限制在 4 核当量跑了一整天）**：
   **「在本机等价于无限制」的字面值，不是无限制——它是一个依赖宿主的常量，换台机器就变成真限制，且静默。**
   实例：人 2026-08-11 逐字裁定「取消 CPU 配额」，实现落成 `cpuQuota: "400%"`（当时 4 核 ⇒ 400% = 用满全部核 = 等价无限制），
   任务体自己标明「不再传 `-p CPUQuota=` 才是更彻底的持久修法」但没做；搬到 16 核机器后 400% = **只给 4/16 核**，
   与裁定原意完全相反，没有任何检查会报出来。⇒ **要表达「不限制」，就在机制上不设那个限制（不传该参数），
   不要用一个恰好等于当前机器容量的数字**——`nproc`/`availableParallelism()` 这类**读宿主**的表达式可以，字面值不行。
   同族：任何写死的 `MemoryMax`/`TasksMax`/并发数/超时秒数，只要它的"合理性"依赖当前机器规格，就必须改成读宿主或显式不设限。
   **推论二的【检测半边】（2026-08-12 同日第三次实证后补，前两次是 `cpuQuota:400%` 与 `/tmp is tmpfs`）〔有产物〕**：
   上面管的是「别写字面量」；**已经写下的字面量如何被发现已经失效**，靠的不是记得去查，而是**两个独立读法互校**：
   **按 comm 精确匹配的计数为零、而按 cmdline 匹配的计数非零 ⇒ 报【仪器故障】，不是报「机器空闲」。**
   实例：`pgrep -xc node-MainThread` 归零而 `pgrep -cf 'bin/node'` 报二十余个（boheidc/Node v24 的真 comm 是 `MainThread`）
   ⇒ `resource-gate.sh:172/186/228` + `process-budget.sh:94` 全恒零、跨层进程预算从不节流，
   **而 `instrument-failure-check` 的 fixture 正把该字面量断言为「正确形式」——检查通过恰恰证明用了恒零的读法。**
   **该自检不需要知道正确字面量是什么 ⇒ 换机换版本继续有效**；而「让工具去数它自己所在的那个进程」
   是硬规则 4 的不可取假量，**不算自检**。一般形态：**恒零/恒真的读数携带零信息，且与「一切正常」同形。**
**推论三（2026-08-14 实证,代价:一个仪器「完成」了 21 小时而真实数据为 0）**:**一个只能被 fixture / 注入数据满足的判据,不是测量——它证明「能产出」,不证明「已产出」。**
   实例:`gap-phase-boundary-differential-accounting` **status=done、AC 5/5 全勾、scoped 141/0 绿**,而生产载体 `verification-round.jsonl` **167 轮中含 `cpu_usec` 的 = 0、`psi` 字段一个都没有**;根因是实现 `640ad48a` 落地于 `2026-08-13T17:28:26Z`,**而末轮记录是 `16:19:54Z`——落地后一轮都没跑过**,5 条 AC 全部由 `QUAY_TEST_CGROUP_SCRIPT`(`full-suite-runner.ts:795`)**注入的假 cgroup 数据**满足。
   **同形已在本文件出现过一次而未被抽象**:硬规则 3b 里「`instrument-failure-check` 的 fixture 正把该字面量断言为『正确形式』」。
   **〔产物〕任何以「产出某读数」为目标的任务,AC 必须至少有一条【读生产载体】**——形如「载体中满足 X 的记录数 ≥ N」,**且 N 只计【实现落地之后】的时间窗**。
   **⊢ 反例判据(一条命令可查)**:若一条 AC 在把 fixture/注入 seam 关掉后仍能通过,它才是测量;否则它只是回声。
   **与 C29 的分工**:C29 = 执行了、报了、但没留痕 ⇒ 与【没执行】同形;**本条 = 实现了、测试绿了、但生产没跑过 ⇒ 与【没实现】同形**。两者的修法同源:**把判据挪到产物上**。

**推论四（2026-08-14 实证,发生率 3,当日）**:**一个能【解释】现象的说法,不是一个被【检验】的结论。**
   三个实例都自洽、都由提出者自己给出、都错:①inner「心跳 57 行是闸合法 hold」(实测 writer 93 分钟零调用,闸从未有机会拒);②outer「A13 的根是闸结构拒写,已由 AC53-gate 修复」(该 gate 落地后心跳 3 小时不长 ⇒ 证否);③inner「A13 DEAD 是写-查时差伪影」(两次;负控制:同一检查器传 `--in-flight` ⇒ ALIVE,不传 ⇒ DEAD ⇒ 与时差无关)。
   **⇒ 推翻它们的手法三次完全相同:造一个能【区分】的对照**——查动作记录(而非结果载体)/ 让两假设给出【相反】预测 / 改一个参数看结论翻不翻。
   **⇒ 判据(动作,不是提醒)**:任何「我认为 X 是因为 Y」的结论投递前,**必须附一个若 Y 为假则结果会不同的对照**;给不出这个对照 ⇒ **降为假说,不得作为结论投递**(与硬规则 12「给不出发生率就降观察项」同形,换了一个维度)。
   **⇒ 代价**:这三条各让一层白走 1–3 小时;而三次的对照成本都是【一条命令】。
   **⇒ 与既有条目的关系(2026-08-14 18:5xZ 补,由审计引用才发现)**:`manager-loop-tick.md:1051`「成因报得太早,害下游改错」早已存在,门槛是**「证据强度未到【可控复现】之前」**——较高且较模糊;**本推论把门槛换成一个当场可做的动作:附一个对照。**今日三个实例推翻它们靠的都是【一条命令的对照】,不是可控复现。**⇒ 不是重复,是把门槛可执行化。****⚠️ 但我立本推论时【没查】既有条目是否已存在——而我同日多次要求别人先查现有的。记账。**

4b. **代理量会与实际偏离——优先观测直接量，不要叠加未经测试的过滤/派生**（人 2026-08-13 逐字裁定）。〔**无产物，靠自觉**〕
    **与硬规则 4 的分工**：4 管「结构上不可能取假」的量（恒真/恒零/自证）；**本条管「本来能取假、但因为中间隔了一层未经验证的过滤而不再反映实际」的量**。
    **一天内五个实例（全部真实发生，全部退出码 0、结构完整、数字合理）**：
    `resource.node_count` 的 comm 正则（本机 comm=`MainThread` ⇒ 恒 0，而 `pgrep -cf 'bin/node'`=25）；
    `outer.ticklog` 的行形谓词（要求 `YYYY-MM-DD HH:MM`，实际行是 `` - `04:09Z` `` ⇒ **291 行真样本命中 0**，恒报「没写 tick 行」）；
    `goal.phase_ac_checked` 的复选框正则（本阶段 12 条 AC 一个复选框都没有 ⇒ **贡献恒零**，`4/14` 测的是十天前那个阶段）；
    inner 心跳的 `runIds`（**陈旧 50 分钟**，指向早已 fan-in 完的任务）与 `slot-refill` 的 `in_flight_count`（滞后，我差点据此报假缺陷）。
    **操作含义**：判「某层是否在干活」用 **git 提交时间戳 / `git worktree list` / `/proc/<pid>/cwd`** 这类**外部可核**的量，
    **不要用它自己写的心跳、自己维护的在飞集合、自己解析出的计数**——**后者在它停摆时恰好也停止更新，与「一切正常」同形**。
    **最省事的自检**：一个量若由被测对象自己产生，它就不能用来判断被测对象是否活着（循环论证）。
4c. **写判据时：那个量必须【穿过所有中间层】还取得到**（4b 的**撰写侧**镜像半边，2026-08-23 立，**一天内同形三次，全部是我自己写的判据**）。
    〔**产物**：判据落笔前，把「从量的产生处到读取处」之间的每一层列出来，逐层问「它会不会改写/抹掉这个量」；
    列不出这条链 ⇒ 判据还没写完〕
    **⊢ 与 4b 的分工**：4b 管**观测时**（别用代理量看系统）；本条管**撰写时**（判据点名的量，到验收那一刻还在不在）。
    **三次实证（三个不同的中间层，三次都是「恒假」或「空转」，且都在实现前才抓到）**：
    ```
    AC4      中间层 = jq 合并      manager 的 --settings 是内联 JSON 且含 _launchSpec.roles
                                  ⇒ 本任务自己加角色就会改写它 ⇒「与改动前逐字一致」恒假
    AC140-4  中间层 = 路径限定     llm_invoked 只由晋升路径的 argv 派生，fix worker 不进该字段
                                  ⇒「跑 fix worker 看 llm_invoked 变 true」结构上不可满足
    AC140-2  中间层 = exec        claude-fjdac 末行 exec claude "$@"，argv0 不保留、env 保留
                                  ⇒ 测 argv0 恒假；改测驱动 spawn 的 argv 则恒真但什么也没验到
    ```
    **⊢ 三次的解法完全相同：换成一个穿过中间层的直接量**（`.env` 键集 / 判定函数本身 / `ANTHROPIC_BASE_URL`）。
    **⊢ 两种失败形态都要认**：**恒假**（正确实现被判失败）与**空转**（判据恒真但什么也没验到）——
    后者更危险，因为它**与「验过了」同形**（同硬规则 3b）。
    **⊢ 抓到它们靠的不是想，是【当场干跑一次】**：AC4 是我去捕基线时暴露的，AC140-2 是我去跑双向控制时暴露的。
    ⇒ **判据若声称「与 X 一致」或「某字段应为 Y」，落笔当轮就要取一次真实读数**；取不出可比形态 ⇒ 判据没写对。

5. **来源完备性**：在某来源搜不到 X，只有当该来源对 X 完备时才等于「X 不存在」。〔**一般情形无产物，靠自觉**〕
   **最危险的实例是批量删除，它有产物**：每次删文档 ≥50 行前，必须先产出**落点映射**——
   被删内容的**每一个**独有词条 → 它的新正本路径，并把该映射贴进删除提交。
   **验证的是「全部有家」不是「抽查几个有家」**（2026-08-10 实证：我抽查 7 个确认有正本就删了 164 行，
   `ToolSearch` / `makeWorkspace` / `gate-gameability` 三条无家可归，事后才发现）。
5b. **在某处修好 X ≠ X 只在那一处**（5 的镜像半边，2026-08-16 立，**同日三次、两层、三个互不相关的载体**）。
   〔**产物**：修完一个实例后，**在同一载体里 grep 该原则的其它适用点，把命中数与前 3 条贴进提交**；
   写不出这个数 ⇒ 视为只修了被报出来的那一个〕
   **三次实证（全部是"原则已经想明白，却只落实到它被发现的那一处"）**：
   ① `direct-to-develop-bypass-check.ts:31` 已为「引导问题」给 `fan-in-*` 开了排除，
      **而记录豁免的 checker 自己是同一类，漏了** ⇒ ruled 表每登记一条都自触发红，**4/4 = 100% 按构造**；
   ② 我在 AC88 写下「判据不得引用一个生命周期短于判据本身的对象」，**转头把 AC1b 锚在 commit SHA 上**
      ⇒ rebase/squash 后假阴性；
   ③ 我在 AC1 写了「`startedAt` 晚于立条时刻」，**紧邻的 AC1b 闭合条件漏了同一个限定**
      ⇒ 不加窗被 207 条历史轮误判为已闭合。
   **⊢ 共同形态**：修的人只盯着被报出来的那一个，**而缺陷是成簇的、且兄弟实例常在同一文件甚至同一行**。
   **⊢ 与 5 的分工**：5 问「搜不到是不是真没有」，本条问「**修好一个是不是就没有别的**」——
   两条都在防"局部完备被当成全局完备"，方向相反。

6. **缺值 = 未查**，不是「为假」。〔产物：判定入口校验，缺键即拒出结论〕
7. **要求记录某动作，就不能把该动作排在记录之后**。〔产物：收尾顺序=先清扫后写日志〕
8. **编号/命名不得复用**——否则缺席被伪装成在场。〔产物：`甲乙丙丁戊` 与判准 `①-⑤` 分离〕
9. **可见性 ≠ 执行**：一条规则若「守」与「不守」在记录上无法区分，它就只能靠意志——**该给它造产物，不是把它写得更醒目**。
10. **延迟 MCP 工具必须先 `ToolSearch` 取 schema 再调**（`select:<name>` 或关键词；确认真返回了 schema 才调）。
    未取先调必 `InputValidationError`；`ToolSearch` 对预期存在的名字返回零结果**是真故障信号**（被改名/被删/skill 引用过期），**不要盲目重试**。
    适用本仓库全部 quay/meta-cc/archguard/playwright MCP 工具（exp5-ADR-TOOLSEARCH-DEFERRED-SCHEMA-PATTERN）。〔**无产物，靠自觉**〕
11. **`git add` 与 `git commit` 之间不许有等待**——三层共用一个检出，**索引是跨层共享的可变状态，不是谁的私有暂存**。
    提交被 `precommit-guard` 挡住（轮在跑）时，**立刻 `git reset`**（只取消暂存，改动全留工作树），窗口开了再一次性 `add && commit`。
    〔产物：本轮若 `git diff --cached` 非空而未提交，即违规——一条命令可查〕
    **2026-08-13 一天内双向各中一次**：①manager 的 52 行 AC53 被守卫挡下、未 reset 去等窗口，**随即被 outer 的 `df1f3965` 一并提交
    ——内容落地但归属记成 outer，写在提交信息里的判据理由（负控制/为何不设阈值）全部丢失**；②同日 outer 把 3 个 task 文件 staged 等窗口，
    **若 manager 先提交，三条任务的立案理由会变成一条 manager 提交的附带内容**（已拦下）。
    **两次都不是"忘了提交"，是"以为索引归自己"。** 不绕过守卫是对的；**错的是在 add 之后去等**。
    **11b 同源，换对象：工作树本身就是生产输入。** 派发计算（`ready-pool-check` 等）读的是**盘上的 `tasks/*.md`，不是 git**
    ⇒ **谁改了盘上的任务体，谁就【立即】改变了另外两层的派发计算——不需要提交，也没有任何守卫拦。**
    **实证 2026-08-13**：4 条任务的 `## Touches` 由目录级收窄为具体文件后，**在未提交状态下** `dispatchable_disjoint` 即由 4 升到 7、`criterion_met` 翻 True。
    ⇒ **危险是它的镜像形态：「已生效而未记录」**——未提交的改动正在影响生产，而对任何读 git 的人不可见；
    **一次 `git checkout -- tasks/` 或"清理工作树"就会静默回退它，且 git 历史里没有任何痕迹说明它曾经变过。**
    〔无独立产物；靠 11 的 `git diff --cached` 与「改了盘上任务体就当场提交」共同覆盖〕
12. **要求一个新前置/新机制之前，先给出它【已经发生过几次】——给不出就降为观察项，不作阻塞。**
    〔产物：任何「必须先 X 才能 Y」的投递必须带 X 的**实际发生率读数**；无该读数的前置一律记为观察项，不得阻塞〕
    **实证 2026-08-13（人指出后实测）**：单日**新建任务 44 条、翻 done 12 条、阶段 AC 只推进 3 条 ⇒ 净增 32 条条件**。
    **最典型的一条由 manager 自己制造**：以「①b 合并后正确性」为停全局轮的前置、并追加要求 land 锁，
    **而 ①b 实为【检测延迟】非漏检**（每个新任务 fork develop 跑全量，develop 上的问题会被下一个任务抓到），
    **且 164 轮 74 红中无一归因于跨任务交互** ⇒ **用未测量的残差，挡住一个已被三条实测结论证成的目标**。
    **一般形态：每个前置单看都成立，合起来就是「永远差最后一步」。**
    **这与硬规则 4 推论（成本结构未知前不设数值阈值）同源，但方向不同**：那条禁的是"凭空设阈值"，
    本条禁的是**"凭空设前置"**——前者让判据不可信，**后者让目标不可达**。
    **12b（2026-08-14 补，取证方向澄清）：「已经发生过几次」默认查历史，不是等下一轮。**
    实证：manager 判"outer 是否常越权直改产品文件"时，手里恰好有一个 3.25 小时的窗口读数（=1），
    **把它当成了"发生率"给出结论"等下一轮"**；而同一个 session id 一条不加 `since` 的查询，
    **全历史真值 = 90**（13 个不同小时段，含当天，核心实现文件 `full-suite-runner.ts` 反复被直改）。
    **⇒ 窄窗计数冒充全量读数，是本条自己会犯的错，且犯错的正是要求"先给发生率"的这条规则的执行者。**
    **默认动作改为**：能查历史（会话记录、git log、任务/文档存量）就必须先查历史；
    **只有历史数据结构上不可得（全新场景、此前无载体记录）时，才退回"观察下一轮"**。
    「等下一轮」不是本条的默认取证法，是它的后备取证法。

## What this repo is

`quay` is a **provider-agnostic task board**: a small **Core** CLI/MCP client + a pluggable
**Provider ABI** for where tasks actually live. This same repo is ALSO the live workspace of a BAIME
(Bootstrapped AI Methodology Engineering) research experiment where quay's own backlog is driven by
an autonomous loop under `experiments/`. Both layers coexist — the `packages/` code is the product;
`experiments/` + `tasks/` + `docs/proposals/` are the methodology/research layer.

## Commands

无 `package.json` scripts、无构建步骤（纯 ESM，Node ≥20；开发机 Node 25）。根目录 `npm install`（npm workspaces, `packages/*`）。

- **跑 CLI**：`node packages/quay/bin/quay.js <cmd>`（版本探测入口，源码路径需 Node ≥22.6）；
  provider 直连：`node --experimental-strip-types packages/quay-native/bin/quay-native.ts <cmd>`
- **跑测试**：`scripts/test.sh`（唯一入口，ADR-019/DIR-109）。**它的头注释 120 行是唯一正本**——
  glob、三条泳道（main/serial/lowconc）、并发推导与预算、`--for-task` scoped 静态检查分层、
  `--test-concurrency=` 的 `=` 写法、`QUAY_TEST_LIVE_GITHUB`、`@test-group`/`@static-tier` 标注，
  **全部读脚本，不要在此处复制一份**（本节曾复制 144 行，占本文件 49%，正是漂移之源）。
- **Web UI**：`node --experimental-strip-types packages/quay/bin/quay.ts serve --host <ip> --port <p>`
  - **开发模式**：`node --watch --experimental-strip-types packages/quay/bin/quay.ts serve --host <ip> --port <p>`
    —— Node ≥18 `--watch` 对 import 模块变更自动重启进程（改 `packages/quay/src` 立即生效），
    **不新增 `--dev`/`--watch` CLI 入口**（`node --watch <既有入口>` 直接可用，零产品表层；人 2026-08-24 裁定）。
- **两条没有别处正本、故留在此**：①测试要用真 `.quay/config.yml` 建临时 workspace（见某测试文件里的
  `makeWorkspace()`）——**裸 tasks 目录不是合法 workspace**，config 是 provider map 不是扁平路径；
  ②**覆盖率不是目标**：从未被测量、可被刷（本仓库自带 `gate-gameability.test.mjs`）、
  且要紧的分支密集决策函数都已有直接 `import` 单测——**若要看覆盖率，它是参考不是指标**。
- **`scripts/test.sh` 覆盖不到的**（正本 `.github/workflows/ci.yml`）：`dist-verify-node-floor`
  （真 npm-pack 产物在 Node 底线上跑）、以及里程碑节奏的浏览器/agent e2e
  （`adr/ADR-010-scheduled-milestone-e2e-incl-browser-tests.md`，status: proposed）。
  **一次绿的 `scripts/test.sh` 不是这两类的证据。**
- **driver 进程管理**（`quay driver <start|stop|drain|status|restart> --kind <promotion|worker>`——
  **`liveness` 只有直调 `plugin/scripts/driver-runtime.ts` 才有**，`quay driver`（`cli/driver.ts:27`
  `VERBS`）未收录，2026-08-24 outer 核实的一个CLI表层缺口；正本仍是 kernel `--help`，**不要在此处复制参数表**）：
  `stop`/`restart` 只杀 supervisor+driver 自身，⛔ 不碰 worker kind 的在飞子进程（设计如此，见脚本注释）；
  worker kind 独有 `drain`（挡新派发、不杀在飞，写 `.quay/worker-control.json` `halted:true`）。
  **⛔ 已知缺口更新（2026-08-24，`gap-worker-driver-cold-start-inflight-blind` 已 done，读下面两行别读旧结论）**：
  「重启会重复派发存活 worker」这个方向**已修复并被 manager 直接对生产实时状态验证过**（`enumerateColdStartInflight`
  只读探测，非猜测/非采信自述）——手工 restart **不会**重派仍存活的 worker。**相反方向的残留也已修**（冷启动 worker 结束后 task 永久假在飞 → 已修）：`coldInflight` 每趟 pass 在
  `while` 循环内重扫（`enumerateColdStartInflightAsync`）——worker 退出 / worktree 消失任一生 ⇒ task 即离开
  排除集、下一轮重新可派（`gap-worker-driver-cold-start-inflight-refresh`，done 2026-08-24）。冷启动孤儿会
  自动收敛，无需手工救。**手工 restart 后仍建议核对
  一次** `ps aux | grep quay-task-worker`（按 task 名去重）作为习惯性负控制，但不再是必须的救火步骤。
  **manager 对 driver 生命周期（start/stop/restart）持人 2026-08-24 明确授权的常设控制权**（本项目后期
  开发阶段内），无需逐次请示；执行前仍应做上述现场核实（避免过期判断），执行后仍应做负控制确认。
## Architecture — the product (`packages/`)

Three packages, one ABI:

| Package | Role |
|---|---|
| `packages/quay` | **Core** — provider-agnostic CLI + web UI (`src/serve.ts`) + MCP client/server (`src/mcp-server.ts`). Talks to whichever provider is `enabled` in `.quay/config.yml` over the Provider ABI. |
| `packages/quay-native` | **Native provider** (reference) — a **markdown+YAML-frontmatter task store on local disk** (`tasks/*.md` ARE the data). CLI + MCP server. |
| `packages/quay-github` | **GitHub provider** — maps GitHub Issues onto the same task view-model. Proves the ABI transfers. |

Key cross-cutting facts (require reading several files to see):
- **Core is written against the task view-model only**, never a specific backend. A task = `{id, title, status, role (primitive|compound), labels, parent/children, body}`; the `body` markdown carries `## Proposal / ## Plan / ## Acceptance Criteria / ## Definition of Done` sections. Providers translate to/from this shape.
- **`.quay/config.yml`** (per-workspace) is the provider map: which provider is enabled, its `path`, `tasks_dir`, `mcp_entry`, `env`. `QUAY_NATIVE_TASKS_DIR` selects the native store's directory.
- **Core CLI `task edit` is status-only in v1** (QN-024) for backward compat unless full flags are given — for a body/extra/labels write, prefer MCP `task_write` or the native provider's own richer `quay-native task edit`. (Full-field parity was later added — see `packages/quay/bin/quay.ts` help; when in doubt check which surface you're on.)
- **Gate engine ("QENG")** — `packages/quay/src/gate/{engine,registry,gate-event-store,gate-log,acceptance-runner,lifecycle,driver}.js`, exposed as verb-less CLI commands `gate` / `gate-log` / `complete` / `adjudicate` / `promote` / `retreat` / `run`. Gates evaluate a named check and append an immutable **GateEvent** to `<workspaceRoot>/.quay/gate-events.jsonl` (gitignored). `quay gate <task>` defaults to the `acceptance` gate (runs `task.extra.acceptance` as a shell command, fail-closed if unset); lifecycle transitions live in `lifecycle.ts` (`todo→ready→done`, terminal `needs-human`). "The meter is runnable, not asserted."
- **Author→ready promotion gate is SHAPE-AWARE — the unified task-shape judgment across projects (gap-todo-shape-mismatch-author-gate, 2026-08-09).** The todo→ready gate (`ready-pool-check.ts`'s `artifactsComplete`) does NOT require a literal `## Contract` on every task: it dispatches on the task body's registered shape (contract → finding → plan), and a task is four-artifacts-complete when its OWN shape's sections are present and, at each author→ready gate evaluation (每轮判定时), ≥40 non-whitespace chars. A `contract`-shape task uses `## Contract` as its plan artifact; a `finding`-shape task uses `## Finding` and has NO plan dimension; a `plan`-shape task uses `## Plan`. Unknown shape fails closed. Since 2026-08-09 the `finding` shape ALSO recognizes the draft-heading AC/DoD variants (`## AC（draft）` / `## DoD（draft）`, and their half-width-paren forms) — a `（draft）` suffix is a heading-label convention, not an absent section. **This is the single judge quay and meta-cc must share**: a todo that carries its shape's four artifacts IS author→ready-eligible even without a `## Contract` heading, and a task whose artifacts are genuinely missing must be completed (or its shape recognized) rather than having a fabricated Contract pasted on. A task-shape-vs-gate mismatch (todos that look complete but carry an unrecognized shape/heading form) is a MECHANISM defect to fix in the gate or the task's shape — not a pool-number problem to paper over by promoting regardless of artifacts.

## Architecture — the methodology layer (`experiments/`, `tasks/`, `docs/`)

- **RETIRED (ADR-022, 2026-08-03): classic milestone loop 退役说明 → `orchestration/archive/AC58-retired-clauses.md#R18`.** The **two-layer fast mode is the sole development mode**（fast-mode telemetry under `milestones/fast-mode-telemetry/<date>.json`；`## Contract` 六键 + `task-contract-check.ts` 取代 ProposalReview/PlanCheck，subagent REFUTE 轮取代 Audit phase；`OUTER-LOOP.md` 曾是经典循环驱动文档，见 `experiments/quay-perpetual-stream/`）
- **`experiments/quay-perpetual-stream/`** is the active BAIME experiment (exp5): an autonomous outer loop that builds quay one milestone at a time. **`OUTER-LOOP.md` was the classic-loop driver document** (retired under ADR-022 — see the notice above); `inherited-core.md` is the pinned methodology; `dashboard.md` is mutable outer state; `scripts/it0-*.{sh,mjs}` are the mechanical gates (notably `it0-dod-check.sh` — the **DoD meta-enforcer**, Clauses 0-9, fixture-pinned by `dod-fixture-selfcheck.sh`).
- **Two-layer per-task worktree isolation（取代 RETIRED classic-loop 工作树机制，后者历史细节 → `orchestration/archive/AC58-retired-clauses.md#R19`）**: 两层模式用 plain `git worktree add` 按任务直接隔离（无 `milestone-worktree.ts`）。**path 约定 `/home/yale/work/quay-worktrees/<task-id>`，不在 `/tmp`**（`/tmp` 会被系统清理、且本机已实测 积压 3389 个测试遗留目录/1.1G；正本 `orchestration/inner-brief-2026-08-04-restart.md:103`）。**在飞任务数读法 = `git worktree list | grep -c quay-worktrees`**（`ls` 任一 `/tmp` 路径恒返回 0，会把工作中的 inner 伪装成空闲）。
  **🔴 2026-08-16 23:2xZ 更正：这条原写作「唯一正确读法」，而它在【两个方向上都高估】，实测如下——**
  **①它把非任务 worktree 也数进去**：验证轮自己的 `verify-round-<ts>-<hash>` 也在该目录下
  ⇒ 裸 `grep -c` 得 **4** 而真实任务 worktree = **3**；**`slot-refill` 自己是过滤掉它的**（两种传法都报 `in_flight=3`）
  ⇒ **文档教的读法比机件更粗**。**②它把死任务算成产能**：worktree 存在 ≠ 有人在干活
  ——实测同一时刻 ac100 停 5.1 小时、delivery 停 4.7 小时、零活进程，而它们照样计入在飞并占着 touches 锁
  ⇒ **4 个"在飞"里只有 1 个在动**（2026-08-16 三个 impl agent 同窗停摆，详见 `orchestration/manager-tick-log.md`）。
  **⇒ 它测的是【占着锁的 worktree 数】，这个量本身是对的、且判「该不该再派」时正是要它。**
  **⛔ 但不要用它回答「有几个任务在干活」——那要配一个活性直接量**（worktree 末次提交时刻 / 该路径下活进程数）。
  **⊢ 同硬规则 4b：worktree 数是代理量，`git log` 时刻与活进程是直接量。**（`isolationMode`/Land 锁等 milestone 级并发隔离旋钮属 RETIRED classic-loop → `orchestration/archive/AC58-retired-clauses.md#R19`；当前两层模式按任务无条件 `git worktree add`，无该旋钮。）
- **`prepare-milestone.js` worktree-isolation 支持（已随 ADR-022 退役）→ `orchestration/archive/AC58-retired-clauses.md#R20`**（文件已删，机制细节与理由档案见归档）
- **暂停/恢复（driver control-state）**：晋升/执行暂停已迁 driver control-state（`.quay/worker-control.json` / `.quay/promotion-control.json`, `driver-shared.ts` `isHalted`；旧 `.halt` 哨兵的 promotion/execution 角色已退役 2026-08-29, `gap-retire-halt-file-driver-based`——**manager 层跨项目 `.halt` 停泊态观察仍活**，归 `manager-tick-readings.ts`）。**编辑时仍遵循 DIR-027 人导卫生：在私有 worktree off `master` 工作，clean window 快进——不 race the loop on `master`。** `quay driver resume` 前跑 `experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh`（manual，非 CI/loop-wired）——git 树安全 go/no-go（clean tree / 无 mid-flight merge / master 无 stray worktree）。
- **Directives are TASK-CANONICAL** (DIR-028 / "Plan A", the single-source-of-truth principle): a directive is a `label:directive` quay task (`tasks/DIR-NNN.md`) and nothing else — there is no `directives/*.md` file, no projection, no anti-drift check (all retired). Create/steer via the `quay-directive` skill. Milestone candidates are `label:milestone-candidate` tasks; `backlog.md`/`dashboard.md` are **generated views** of the task store, not hand-edited sources.
- Recurring design principle enforced across this repo (see `docs/proposals/exp5-crystallization-strategy.md`): **single source of truth + executable invariants over prose.** When you find content living in two places (a file + a task copy; a charter copying a task's AC/DoD; a status in a field AND a body line), that is drift — fix the SOURCE (usually a doc/skill/template that generated it), not just the artifact.

- **单任务派发记录接口 = `plugin/scripts/dispatch-record.ts --add --task-id <id> --reason "<一句为什么选它>"`**（fail-closed：理由<8 非空白字符 exit 1 不写不派；指纹自动 `git hash-object`，算不出写 null 由 `dispatch-record-fingerprint-reason-check` 报红；正本 `fast-mode-tick-core.md` A16b）。**派发(机械)=内层（`fast-mode-tick-core.md:83`）——外层/非-inner 不手搓 Python 写 `orchestration/dispatch-record.jsonl`**（2026-08-20 外层 B9 手搓三键 `{ts,taskId,reason}` 漏指纹，已删；inner A16b 已记同一次派发，勿扩豁免名单）。同款先例：manager 语义派发 `semantic-face-dispatch-record.ts --add --kind <八类> --reason "..."`（`manager-tick-core.md` C30/AC145）。

## Reference docs

- `README.md` — install/usage + the three-package overview.
- `packages/quay/DESIGN.md`, `docs/proposals/quay-proposal.md` — Core architecture + Provider ABI rationale.
- `docs/proposals/exp5-crystallization-strategy.md` — the current "molten prose → executable single-source" direction (canonical task schema, formalized prompt-doc style).
- `adr/ADR-*.md` — first-class decision records (`quay-native adr list`). ADR-004..010 (status: proposed) crystallize the GIT-lens program; read them before extending it.
- `docs/references/` — the GIT framework (goal-closure `L_T..L_S`, 硬形变/Π_{S→E}, two-phase breathing) AND its limits: the continuous math (Fisher/natural-gradient/intrinsic-dim/ρ) is NOT rigor (ADR-006).

## Tools

- **archguard** (MCP) — static architecture analysis: the `L_D`/`L_G` instrument (dependency structure/cycles, god-packages, duplicated/reinvented abstractions) per ADR-007. Consult it before calling a milestone done.
- **meta-cc** (MCP) — search Claude Code session history (past errors, edit sequences, work patterns).
- BOTH are maintained by the repo owner, so bugs get fixed fast — use them aggressively and report/fix issues rather than working around them.
- **tmux remote-drive**（→ ADR-016，**降为非默认路径，人 2026-08-12「尽量减少对其使用」**）— 驱动别的工作区的 Claude 会话**默认用 `ListAgents` + `SendMessage`**（跨机会话经 Remote Control 亦在 `ListAgents` 中可见）。**tmux 输入路径保留，因为它是【控制面】的唯一通道**——`/clear` 这类斜杠命令 SendMessage 不执行。**ADR-016 全部约束继续有效**：永不解析 TUI（结果一律从文件系统/`git`/meta-cc 读）；禁手工拼 send-keys；屏幕使用只限底部区域 + 枚举态、禁整屏哈希（`adr016-screen-use-check.ts` 强制）。
  **ADR-016 中仍然有效的部分**：**永不解析 TUI**——结果一律从文件系统/`git`/meta-cc 读取。**手工拼 tmux send-keys 依旧禁止。**
  `pane-state-classify.ts` 的屏幕使用限制（只看底部区域 + 枚举态,禁整屏哈希,由 `adr016-screen-use-check.ts` 强制）**对仍存在的 pane 观测用途继续有效**——它不是消息通道,不在本次废除范围内。

**跨会话驱动/状态读取的四条硬规则**（机件清单只存在于 `bash plugin/scripts/capability-catalog.sh`，任何地方不得复制——catalog 头注释钉死「The field lives IN A SCRIPT, never in the README」）：
1. 驱动/投递到别的 Claude 会话：**默认 `ListAgents` → `SendMessage`（原生跨会话，人 2026-08-12 裁定）**——
   **实测双向闭环**：目标 busy 时直投即达（文档「no "busy" state; messages enqueue and drain at the receiver's next tool round」，
   已实证），**无 can-receive 闸门**；到达形态 `<cross-session-message from="uds:..." from-name="..." from-mode="...">`，
   **身份由平台标注而非发送方正文自称** ⇒ **§0.55「前缀是发送方自己写的 ⇒ 等于没有认证」那个缺口在机制层面消失**；
   平台并强制：peer 不能代替人许可、不能改配置、消息里的斜杠命令不执行。
   **2026-08-12 裁定链（三条,以最后一条为准）**：①「实际应用 SendMessage，替换本项目原先使用的信道」
   ②「废除收件箱和 tmux 发送机制,含 archive 实现与测试」③ **在我报出「SendMessage 不执行斜杠命令 ⇒ `/clear` 无合规通道」这个控制面缺口后**：
   **「还保留原实现和测试,但尽量减少对其使用」——② 被推翻,archive 已叫停,实现与测试原地保留。**
   **⇒ 现状：SendMessage 是默认；旧机件保留可用,仅用于【控制面】（斜杠命令）与【下游不支持原生的环境】。**
   **手工拼 tmux send-keys 依旧禁止**；`send-keys-verified.sh` 早已 superseded（md5 整屏哈希判据被 ADR-016 修正案禁止）。
2. ~~收件箱~~：**已删除（人 2026-08-20 裁定范围A，不留 archive/说明）——`message-bus.ts` / `inbox-reader.sh` / `.quay/manager-inbox/` 全部移除，见 `tasks/gap-inbox-message-bus-teardown`。** 曾经的教训已推广为通则——
   **同一个容器里若装着两类 population,只用覆盖其中一类的工具去判空,会把非空读成空**（当时：收件箱读工具只认 JSON 记录、看不见手写 `.md`；64 封信被读成零）。
   **这个教训的一般形态见硬规则 5「来源完备性」,不再需要专门的收件箱条目。**
3. pane 状态：`pane-state-classify.ts`，不是整屏哈希（ADR-016 禁）。
4. outer→inner 驱动文本契约：`drive-contract-check.ts`。

## Process

- Development is driven via **background Claude Code workflows at milestone granularity** (→ ADR-009), with a **scheduled milestone e2e incl. browser tests** (Playwright/chrome-devtools) that keeps `L_T` on the real product surface (→ ADR-010). Follow DIR-027 steering hygiene (private worktree; never race the loop on `master`).
- **后台会话编辑共享检出的正确姿势**：直接 Edit/Write 主检出会被 harness 的 worktree-isolation guard 拦（未 `EnterWorktree` 不可写）。任务体用 `task_write` MCP（Provider ABI 写 `tasks/*.md`）、代码改动进 worktree（`EnterWorktree` 或任务 worktree）。worker（claude -p）不撞 guard 是因 cwd 虽主检出、dispatch prompt 强制 file_path 用 worktree 绝对路径。⛔ 不要 Bash/Python 手搓硬插（2026-08-29 实证：解 worker-driver.ts 冲突时 Python 锚点插入吞 `/**` 留 orphan 注释，靠 worker 修回）。

## Split-decision routing policy

**正本已搬回任务体**：`tasks/gap-checksplitrecommendation-preserved-by-adr-022-but-never-wired-into-fast-mode.md`
（四个 code 的路由表、split 落实的四项验证、`> 2` 阈值裁定，全在那里）。
**状态：reference/manual，NOT mechanically enforced** —— `checkSplitRecommendation` 零非测试调用者，
没有任何 fast-mode 派发或任务撰写路径调它。**别把它当生效的机制用。**
## GIT review checklist

- Before calling a milestone done, ask **which of `L_T`/`L_C`/`L_D`/`L_G`/`L_S` is still dark** (ADR-006/007) and prefer **hard checks over prose** (ADR-004 — prose gets paraphrased away). See `docs/references/` for the framework and its limits (the continuous math is not rigor).

## Workflow resume anti-pattern (M144, 2026-07-25)

When a workflow Verify phase fails and the fix is to **external state** (gap-list.md, charter file, script on disk), do NOT resume with `resumeFromRunId`. The resume cache keys on (prompt, opts) only — it cannot see that external files changed. The cached failure returns instantly (~60ms, 0 tokens) and the Verify phase fails again with the same stale result.

**Rule:** if the fix touches anything OTHER than the workflow script's own agent prompt strings, re-run the workflow from scratch (`Workflow({script: ...})` without `resumeFromRunId`). Resume is safe ONLY when the fix is a prompt-text edit within the workflow script itself.

**Extension (M176, 2026-07-26, gap-workflow-name-dispatch-stale-script-cache):** the same staleness
class also hits plain `Workflow({name: "<saved-workflow>"})` calls, with NO `resumeFromRunId`
involved at all. Within one long-running session, a `name:`-based dispatch made AFTER the first
`name:`-based dispatch of that same workflow can still materialize the **old** script body, even
minutes after the underlying checked-in file (e.g. `.claude/workflows/execute-milestone.js`) was
edited and committed to `master` in between — confirmed via `diff` against the materialized script
under `~/.claude/projects/.../workflows/scripts/`. This is undocumented behavior (confirmed via
Claude Code's own docs/changelog — no mention of `name:`-resolution caching), not a repo bug.

**Rule:** in a session where a checked-in workflow script may have changed since the session
started (e.g. this session is itself implementing/patching that very script), always dispatch it
via `Workflow({scriptPath: "<absolute path to the real checked-in file>", ...})`, never
`Workflow({name: ...})` — `scriptPath` reliably re-reads the current on-disk content;
`name` may not. If the staleness is suspected but unconfirmed, diff the materialized script
(printed in the tool result / notification) against the real checked-in file before trusting a run's
outcome.

## Glob tool unavailable in subagent sessions (M148, 2026-07-25)

The `Glob` tool is **not available in subagent sessions**. Calling `Glob` from a subagent produces "Error: No such tool available: Glob". This has been observed in meta-cc session history as a recurring error pattern.

**Rule:** when you need file-pattern matching in a subagent, use `find` via Bash instead of `Glob`. Example: `find . -name '*.js' -not -path '*/node_modules/*'` instead of `Glob({pattern: '**/*.js'})`. All Bash tools (including `find`, `grep`, `ls`) work normally in subagent sessions.

## Pre-Edit freshness check (M150, 2026-07-25)

78% of Edit errors are stale `old_string` matches — the file has changed since you last read it, and the string you are trying to replace no longer exists at the expected location.

**Rule:** before calling `Edit` with an `old_string`, re-read the target region of the file with `Read` to confirm the string you intend to replace is still present exactly as you expect. Do not construct `old_string` from memory or from a stale read earlier in the conversation. A fresh read immediately before the edit is the only reliable source of the current file state.

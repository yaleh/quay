# 认识论硬规则事故档案（epistemology casebook）

本文件是 `CLAUDE.md`「认识论硬规则」的**取证面**：规则是怎么被发现的、日期、实例、代价、复盘。
常驻注入的 `CLAUDE.md` 只保留 **规则一行 + 一句 why + 产物/检查器路径 + 指向本文件的锚点**
——规则本身（裁定内容）没有改动，只是把事故叙事移出了每会话注入面。

搬迁理由、逐行落点与验证方式见 `orchestration/context-slimming/p1-landing-map.tsv` 与
`orchestration/context-slimming/landing-map-check.sh`（本文件每个 `## ` 标题就是一个锚点，
`CLAUDE.md` 的 `→ docs/epistemology-casebook.md#<标题>` 全部可解析）。

本文件**不被自动注入**——它的体量不消耗每会话预算，因此可以保留完整细节。

---

## why-no-copy

常驻文件「复制正本内容」这一禁令的来源事故（原文照录）：

> （实证 2026-08-10：`CLAUDE.md:204` 教了三天已被 `ruling F` 取代的做法，339 次绕过由此而来，
> 而没有任何检查发现——**覆盖率最高的位置，错误的杀伤力也最大**）。

一般形态：**覆盖率最高的位置，错误的杀伤力也最大**。一个被复制的清单在正本演化后不会收到任何
通知，而它的读者数最多 ⇒ 漂移的代价与该位置的覆盖率成正比。这是「只放指针，不放副本」的直接理由。

## rule-1

**规则**：用机件，不手搓——动作前先查 catalog 有没有同类工具。〔产物：投递工具名进记录 / `A16` 按位置计数〕

**最高频的一个实例，单列**：任何「查会话历史 / 读 transcript / 统计 agent 用量」都先用 `meta-cc` MCP，
不要手搓 `python`/`grep` 解析 `*.jsonl`。

- 实证：管理者台账里此类认账 **16 条**，且 2026-08-11 02:1x 在人指出的前五分钟内又连犯两次
  （手搓解析 `agent-*.jsonl` 与 `meta.json`）。
- **为什么单列而不靠上一句涵盖**：上一句是通则，而通则在动手那一刻不会浮现；这条此前只写在管理者
  自己的核（C15，且窄——只禁 `capture-pane` 回滚）与台账里，**不在唯一会被自动注入的本文件中**
  ⇒ 每次都要靠当场想起来。〔**无产物，靠自觉**〕

### meta-cc 的覆盖缺口与绕法（原「`meta-cc` 返回空 ≠ 没有数据」段）

`meta-cc` 返回空 ≠ 没有数据（硬规则 5 来源完备性）。已实测的一个覆盖缺口 + 绕法（2026-08-11 02:2x）：

- `query_session_content` 按 `working_dir` **哈希**定位 project，**只读【主会话 jsonl】**。
- **⚠️ 2026-08-14 12:1xZ 用干净针实测重验，范围比原记述更大，且多出一个陷阱。**

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

**⚠️ ① 的范围必须覆盖【两层】**：**2026-08-14 我只搜了 `workflows/` 下 8 个 run 就断言
「lane 无可查对象」，而同一会话有 126 个直属 subagent transcript 没搜** ⇒ 假结论。
**硬规则 5 的经典违反，当日第三次同形。**

### 成本口径：轮次数才是驱动量

**轮次数就是成本的驱动量**：实测一次 suite-fix workflow 42 个 agent 共 705 轮、缓存读占 **98.8%**、
真正新 token 仅 92 万 ⇒ **别用「总 token」判贵贱，要拆出 `cache_read` 再谈**
（2026-08-11 02:2x 就因未拆而给出过一个误导性的「省 9M token」结论）。

## rule-2

**规则**：按位置判定，不按关键词——注释、字符串、消息正文里提到不算命中。
〔产物：复用 `drive-contract-check.ts` / `test-framework-policy-check.ts` 的判定手法〕

但那两个产物只覆盖各自那一个检查，临时 `grep`/`wc -l` 没有产物 ⇒ 只能靠意志
⇒ **2026-08-12 一天内同形状四次**。

**给临时用法补的产物（动作，不是提醒）：引用一个计数之前，先打印它匹配到的前 3 条实际内容。**
做没做在记录里看得见。四次实证：

| # | 谓词 | 误报 | 真因 |
|---|---|---|---|
| ① | `--state-dir` | 「缺失」 | grep 了一个不覆盖 X 的模式 |
| ② | `1223 静态点×地板` / `cli-import 行数未变` | 「没做」 | 静态计数当执行次数（实为 execve 285→205、墙钟 −51%） |
| ③ | `acRatio` | 「还在」 | `grep -c` 命中的是注释 |
| ④ | `oom-kill` | 差点报「内存上限太紧」 | 85 次全是一个 `MemoryMax=64M` 的故意测试，实测峰值 1.5G/6G |

**前三次都是跑完命令直接用输出；第四次唯一的差别就是这个动作。**

**⚠️ 同日第五次（方向相反，由 outer 捕获）暴露这个产物只补了一半**：打印命中只挡【假阳性】，
**挡不住【假阴性】——计数为 0 时没有命中可打印**。实例：判「打了 `delivery-critical` 标签的任务
**0** 条」，真值 **45** 条（44 done / 1 todo / 0 ready）；原因是 awk range
`c==1 && /labels:/,/^[a-z_]+:/` 在下一行即终止，只输出 `labels:` 一行，够不到 list-item 形的标签。

⇒ **零计数的配套动作是另一个：把谓词对着一个【已知为真】的样本干跑一次**
（我事后用它一条命令就定位了 bug）。**两个动作是同一条纪律的两半。**

## rule-3

**规则**：枚举，不布尔——布尔化的存在性检查会把「对象没了」伪装成「检查失败」。
〔产物：判准③ 要求写出条数与清单〕

### 3b 镜像半边：读不懂 ⇒ 伪装成检查通过

**3b（镜像半边，2026-08-13 补，同日三个独立实例）：判定机件在【读不懂输入】时，不得返回与【合格】同形的值。**

上半条说的是「对象没了 ⇒ 伪装成检查失败」；**这半条相反且更危险——「读不懂 ⇒ 伪装成检查通过」。**

**三个实例，同一天，三个互不相关的机件，全部退出码 0、结构完整、数字合理**：

1. `task-status-drift-check.ts:126` `if (!acSection) return {total:0,checked:0,unchecked:0}`
   ⇒ 标题带后缀（`## Acceptance Criteria (runnable — …)`）导致整段读不到 ⇒ **零未勾 ⇒ 判为完成**；
2. `slot-refill.ts:373` `if (total === 0) return true` ⇒ 同一个根，**第一行就判 landed**，
   连未勾逻辑都走不到；
3. `outer-tick-log-check.sh:107/:112/:205/:262` `ACTION` 解析不出 ⇒ **每一条检查分支都跳过**
   ⇒ `:289` 打印 `PASS — is self-consistent`。

**③ 最能说明危害**：它被接进套件的当轮，"不产生新红"被当成接线成功的证据，
**而"不产生新红"正是一个结构上不可能报红的检查会给出的结果**（与硬规则 4 同源）；
**接线前我们【知道】那条义务没被执行，接线后套件每轮打印 PASS ⇒ 记录上看起来它正在被执行。**

**⇒「没有检查」是已知的空白；「一个恒绿的检查」是一个假的保证，后者更贵。**

**共同修法（三处实际采用的都是它）**：**给"无法评估"一个独立取值**，不与"合格"共用输出——
`sectionFound:false` / `NOT-EVALUATED` + `evaluated:false`。**不是一律 fail-closed**：
③ 若当场改 fail-closed 会立刻让套件红并挡住在飞任务，**而"说实话"零代价**
（`exit 0` 但取值可区分），fail-closed 留到该判据真正具备输入之后。

### 3b-2 上游判过、下游不读 ⇒ 输出与「查过且合格」同形（2026-09-21）

**同一形态的第四个变体，与上面三条的关键差别：上游没有读不懂，它【读懂了也判了】，下游没去看。**

`identity-replication-check.ts` 对「字面量复制度」有两个操作数（`hardcoded` / `accessor`），
阈值判定 `isFlagged = hardcoded >= 5 && hardcoded > accessor` 才是它的**结论**；`--json` 的
`table[]` 行把这两个操作数原样交出。下游 `architecture-review-cluster.ts` 的逐实体分支只过滤
`(row.hardcoded ?? 0) > 0` —— **判据的另一半整个缺席**：只要硬编码出现过就成簇，哪怕
`hardcoded < accessor`（= 大量文件走单一访问器引用、少数硬编码，**正是负控制要放过的形态**）。

**实测规模（不是设想）**：25 个 `P2-identity-*` 簇里 **8 个（32%）** 是检测器已经判过清白的假簇，
`gate-script-base.ts`（10 硬编码 / 231 访问器）就在列。**上游的判定在盘上、下游的读数与
「查过且合格」逐字同形** —— 记录上什么都看不出来。

**⚠️ 取证时踩到的第二层陷阱（值得单列，因为它把「修法」写成了恒真的形式）**：判词写作
「consumer ignores `flagged`」，照字面去读 `row.flagged` 会得到一个**结构上不可能取假**的判据——
`flagged` 只存在于 `sharedModuleControl`（单实体），`table[]` 行上**没有这个字段** ⇒ `undefined`
⇒ `undefined === false` 为假 ⇒「无泄漏」恒成立；而修法如果写成 `row.flagged !== true`，则恒真地
放行一切。**正确的判据是重新施加那条谓词**（两个操作数行上都有）。⇒ 与硬规则 4 同源：
**先确认那个量真的存在，再拿它当测量**。

**修法两条，缺一不可**（同 3b 的共同修法：让两种结局在读数上分开）：
① 谓词上收成**单一实现**（`isFlagged` 导出，`sharedModuleControl` 与 cluster 侧共用一份 ——
两份副本正是本缺陷的成因形态）；② 两侧都要有**能取假**的对照：只做「过滤掉清白行」而不做
「`flagged=true` 侧仍成簇」，等于把检测器关掉（`identity-replication-check.ts` 的注释自己就
写过这个担心），所以用例必须成对，且(a)的断言在删掉过滤时**必须变红**（实测：删掉后 2 条变红、
(b) 仍绿 —— 正是它要证明的「只关掉一半」）。

**同轮的第二成因（同一缺陷的另一个输入面）**：同一模块的 `SKIP_DIRS` 是手工**裸名**名单，不含
build 生成且 gitignored 的 `packages/quay/plugin/`（`package.sh` 把仓根 `plugin/` 暂存成的**第二份
拷贝**，411 个常规文件 / 0 个软链 / `git ls-files` 0 条）⇒ 同一实体被数两遍，`table[].codeFiles`
并集 729 个里 **82** 个落在该前缀下。修法是按**路径前缀**而非裸名排除：`walkFiles` 的 `prune` 只拿到
basename，而 `plugin` 同时是一个扫描根 —— 把裸名 `plugin` 塞进 `SKIP_DIRS` 会连带剪掉**任何**叫
plugin 的目录，**名字面比要表达的面宽**（过度剪枝是静默的，同 3b）。

**一处顺带的教训（AC 与 AC 会互相作用）**：修好第二成因后，`sharedModuleControl.importAccessor`
由 **231 → 230** —— 少的那个正是被排除的重复拷贝里的一条 accessor 引用。**AC 里逐字写死的读数
可能本身就是缺陷的产物**：它随修复而变，不是判据被放宽。⇒ 写 AC 时，凡引用检测器自身的读数，
应写明「修前读数」并说明第二个修复会如何移动它。

## rule-4

**规则**：一个结构上不可能取假的量，不是测量——恒等式、自证、回显都属此类。〔**无产物，靠自觉**〕

> **推论（2026-08-10 恢复：此条曾被我在 292→169 压缩中误删，第 4 个受害者）**：
> **成本结构未知前不要设数值阈值**——那是 AC9/416s 的错误；为一个从未被测量的量设目标同理。

### 推论二：「在本机等价于无限制」的字面值，不是无限制

**推论二（2026-08-12 实证，代价：一台 16 核机器的套件被静默限制在 4 核当量跑了一整天）**：

实例：人 2026-08-11 逐字裁定「取消 CPU 配额」，实现落成 `cpuQuota: "400%"`（当时 4 核
⇒ 400% = 用满全部核 = 等价无限制），任务体自己标明「不再传 `-p CPUQuota=` 才是更彻底的持久修法」
但没做；搬到 16 核机器后 400% = **只给 4/16 核**，与裁定原意完全相反，没有任何检查会报出来。

⇒ 同族：任何写死的 `MemoryMax`/`TasksMax`/并发数/超时秒数，只要它的"合理性"依赖当前机器规格，
就必须改成读宿主或显式不设限。

### 推论二的检测半边

**（2026-08-12 同日第三次实证后补，前两次是 `cpuQuota:400%` 与 `/tmp is tmpfs`）〔有产物〕**

上面管的是「别写字面量」；**已经写下的字面量如何被发现已经失效**，靠的不是记得去查，
而是**两个独立读法互校**。

实例：`pgrep -xc node-MainThread` 归零而 `pgrep -cf 'bin/node'` 报二十余个
（boheidc/Node v24 的真 comm 是 `MainThread`）⇒ `resource-gate.sh:172/186/228` +
`process-budget.sh:94` 全恒零、跨层进程预算从不节流，
**而 `instrument-failure-check` 的 fixture 正把该字面量断言为「正确形式」——检查通过恰恰证明用了恒零的读法。**

极重要的性质：**该自检不需要知道正确字面量是什么 ⇒ 换机换版本继续有效**；
而「让工具去数它自己所在的那个进程」是硬规则 4 的不可取假量，**不算自检**。

### 推论三：一个只能被 fixture 满足的判据，不是测量

**（2026-08-14 实证，代价：一个仪器「完成」了 21 小时而真实数据为 0）**：
**一个只能被 fixture / 注入数据满足的判据，不是测量——它证明「能产出」，不证明「已产出」。**

实例：`gap-phase-boundary-differential-accounting` **status=done、AC 5/5 全勾、scoped 141/0 绿**，
而生产载体 `verification-round.jsonl` **167 轮中含 `cpu_usec` 的 = 0、`psi` 字段一个都没有**；
根因是实现 `640ad48a` 落地于 `2026-08-13T17:28:26Z`，**而末轮记录是 `16:19:54Z`
——落地后一轮都没跑过**，5 条 AC 全部由 `QUAY_TEST_CGROUP_SCRIPT`（`full-suite-runner.ts:795`）
**注入的假 cgroup 数据**满足。

**同形已在本文件出现过一次而未被抽象**：硬规则 3b 里「`instrument-failure-check` 的 fixture
正把该字面量断言为『正确形式』」。

**〔产物〕任何以「产出某读数」为目标的任务，AC 必须至少有一条【读生产载体】**——
形如「载体中满足 X 的记录数 ≥ N」，**且 N 只计【实现落地之后】的时间窗**。

**⊢ 反例判据(一条命令可查)**：若一条 AC 在把 fixture/注入 seam 关掉后仍能通过，它才是测量；否则它只是回声。

**与 C29 的分工**：C29 = 执行了、报了、但没留痕 ⇒ 与【没执行】同形；
**本条 = 实现了、测试绿了、但生产没跑过 ⇒ 与【没实现】同形**。两者的修法同源：**把判据挪到产物上**。

### 推论四：能解释现象的说法 ≠ 被检验的结论

**（2026-08-14 实证，发生率 3，当日）**：**一个能【解释】现象的说法，不是一个被【检验】的结论。**

三个实例都自洽、都由提出者自己给出、都错：

1. inner「心跳 57 行是闸合法 hold」（实测 writer 93 分钟零调用，闸从未有机会拒）；
2. outer「A13 的根是闸结构拒写，已由 AC53-gate 修复」（该 gate 落地后心跳 3 小时不长 ⇒ 证否）；
3. inner「A13 DEAD 是写-查时差伪影」（两次；负控制：同一检查器传 `--in-flight` ⇒ ALIVE，
   不传 ⇒ DEAD ⇒ 与时差无关）。

**⇒ 推翻它们的手法三次完全相同：造一个能【区分】的对照**——查动作记录(而非结果载体) /
让两假设给出【相反】预测 / 改一个参数看结论翻不翻。

**⇒ 代价**：这三条各让一层白走 1–3 小时；而三次的对照成本都是【一条命令】。

**⇒ 与既有条目的关系（2026-08-14 18:5xZ 补，由审计引用才发现）**：`manager-loop-tick.md:1051`
「成因报得太早，害下游改错」早已存在，门槛是**「证据强度未到【可控复现】之前」**——较高且较模糊；
**本推论把门槛换成一个当场可做的动作：附一个对照。** 今日三个实例推翻它们靠的都是
【一条命令的对照】，不是可控复现。**⇒ 不是重复，是把门槛可执行化。**

**⚠️ 但我立本推论时【没查】既有条目是否已存在——而我同日多次要求别人先查现有的。记账。**

## rule-4b

**规则**：代理量会与实际偏离——优先观测直接量，不要叠加未经测试的过滤/派生
（人 2026-08-13 逐字裁定）。〔**无产物，靠自觉**〕

**与硬规则 4 的分工**：4 管「结构上不可能取假」的量（恒真/恒零/自证）；
**本条管「本来能取假、但因为中间隔了一层未经验证的过滤而不再反映实际」的量**。

**一天内五个实例（全部真实发生，全部退出码 0、结构完整、数字合理）**：

| # | 代理量 | 症状 |
|---|---|---|
| ① | `resource.node_count` 的 comm 正则 | 本机 comm=`MainThread` ⇒ 恒 0，而 `pgrep -cf 'bin/node'`=25 |
| ② | `outer.ticklog` 的行形谓词 | 要求 `YYYY-MM-DD HH:MM`，实际行是 `` - `04:09Z` `` ⇒ **291 行真样本命中 0**，恒报「没写 tick 行」 |
| ③ | `goal.phase_ac_checked` 的复选框正则 | 本阶段 12 条 AC 一个复选框都没有 ⇒ **贡献恒零**，`4/14` 测的是十天前那个阶段 |
| ④⑤ | inner 心跳的 `runIds` / `slot-refill` 的 `in_flight_count` | 前者**陈旧 50 分钟**，指向早已 fan-in 完的任务；后者滞后，差点据此报假缺陷 |

**操作含义**：判「某层是否在干活」用 **git 提交时间戳 / `git worktree list` / `/proc/<pid>/cwd`**
这类**外部可核**的量，**不要用它自己写的心跳、自己维护的在飞集合、自己解析出的计数**——
**后者在它停摆时恰好也停止更新，与「一切正常」同形**。

**最省事的自检**：一个量若由被测对象自己产生，它就不能用来判断被测对象是否活着（循环论证）。

## rule-4c

**规则**：写判据时，那个量必须【穿过所有中间层】还取得到（4b 的**撰写侧**镜像半边，2026-08-23 立，
**一天内同形三次，全部是我自己写的判据**）。
〔**产物**：判据落笔前，把「从量的产生处到读取处」之间的每一层列出来，逐层问「它会不会改写/抹掉这个量」；
列不出这条链 ⇒ 判据还没写完〕

**⊢ 与 4b 的分工**：4b 管**观测时**（别用代理量看系统）；本条管**撰写时**
（判据点名的量，到验收那一刻还在不在）。

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

## rule-5

**规则**：来源完备性——在某来源搜不到 X，只有当该来源对 X 完备时才等于「X 不存在」。
〔**一般情形无产物，靠自觉**〕

**最危险的实例是批量删除，它有产物**：每次删文档 ≥50 行前，必须先产出**落点映射**——
被删内容的**每一个**独有词条 → 它的新正本路径，并把该映射贴进删除提交。

**验证的是「全部有家」不是「抽查几个有家」**（2026-08-10 实证：我抽查 7 个确认有正本就删了 164 行，
`ToolSearch` / `makeWorkspace` / `gate-gameability` 三条无家可归，事后才发现）。

## rule-5b

**规则**：在某处修好 X ≠ X 只在那一处（5 的镜像半边，2026-08-16 立，
**同日三次、两层、三个互不相关的载体**）。
〔**产物**：修完一个实例后，**在同一载体里 grep 该原则的其它适用点，把命中数与前 3 条贴进提交**；
写不出这个数 ⇒ 视为只修了被报出来的那一个〕

**三次实证（全部是"原则已经想明白，却只落实到它被发现的那一处"）**：

1. `direct-to-develop-bypass-check.ts:31` 已为「引导问题」给 `fan-in-*` 开了排除，
   **而记录豁免的 checker 自己是同一类，漏了** ⇒ ruled 表每登记一条都自触发红，**4/4 = 100% 按构造**；
2. 我在 AC88 写下「判据不得引用一个生命周期短于判据本身的对象」，**转头把 AC1b 锚在 commit SHA 上**
   ⇒ rebase/squash 后假阴性；
3. 我在 AC1 写了「`startedAt` 晚于立条时刻」，**紧邻的 AC1b 闭合条件漏了同一个限定**
   ⇒ 不加窗被 207 条历史轮误判为已闭合。

**⊢ 共同形态**：修的人只盯着被报出来的那一个，**而缺陷是成簇的、且兄弟实例常在同一文件甚至同一行**。

**⊢ 与 5 的分工**：5 问「搜不到是不是真没有」，本条问「**修好一个是不是就没有别的**」——
两条都在防"局部完备被当成全局完备"，方向相反。

## rule-11

**规则**：`git add` 与 `git commit` 之间不许有等待——三层共用一个检出，
**索引是跨层共享的可变状态，不是谁的私有暂存**。〔产物：本轮若 `git diff --cached` 非空而未提交，
即违规——一条命令可查〕

**2026-08-13 一天内双向各中一次**：

1. manager 的 52 行 AC53 被守卫挡下、未 reset 去等窗口，**随即被 outer 的 `df1f3965` 一并提交
   ——内容落地但归属记成 outer，写在提交信息里的判据理由（负控制/为何不设阈值）全部丢失**；
2. 同日 outer 把 3 个 task 文件 staged 等窗口，**若 manager 先提交，三条任务的立案理由会变成
   一条 manager 提交的附带内容**（已拦下）。

**两次都不是"忘了提交"，是"以为索引归自己"。** 不绕过守卫是对的；**错的是在 add 之后去等**。

### 11b：工作树本身就是生产输入

**11b 同源，换对象：工作树本身就是生产输入。** 派发计算（`ready-pool-check` 等）读的是
**盘上的 `tasks/*.md`，不是 git** ⇒ **谁改了盘上的任务体，谁就【立即】改变了另外两层的派发计算
——不需要提交，也没有任何守卫拦。**

**实证 2026-08-13**：4 条任务的 `## Touches` 由目录级收窄为具体文件后，**在未提交状态下**
`dispatchable_disjoint` 即由 4 升到 7、`criterion_met` 翻 True。

⇒ **危险是它的镜像形态：「已生效而未记录」**——未提交的改动正在影响生产，而对任何读 git 的人不可见；
**一次 `git checkout -- tasks/` 或"清理工作树"就会静默回退它，且 git 历史里没有任何痕迹说明它曾经变过。**

〔无独立产物；靠 11 的 `git diff --cached` 与「改了盘上任务体就当场提交」共同覆盖〕

## rule-12

**规则**：要求一个新前置/新机制之前，先给出它【已经发生过几次】——给不出就降为观察项，不作阻塞。
〔产物：任何「必须先 X 才能 Y」的投递必须带 X 的**实际发生率读数**；无该读数的前置一律记为观察项，
不得阻塞〕

**实证 2026-08-13（人指出后实测）**：单日**新建任务 44 条、翻 done 12 条、阶段 AC 只推进 3 条
⇒ 净增 32 条条件**。

**最典型的一条由 manager 自己制造**：以「①b 合并后正确性」为停全局轮的前置、并追加要求 land 锁，
**而 ①b 实为【检测延迟】非漏检**（每个新任务 fork develop 跑全量，develop 上的问题会被下一个任务抓到），
**且 164 轮 74 红中无一归因于跨任务交互** ⇒ **用未测量的残差，挡住一个已被三条实测结论证成的目标**。

**一般形态：每个前置单看都成立，合起来就是「永远差最后一步」。**

**这与硬规则 4 推论（成本结构未知前不设数值阈值）同源，但方向不同**：那条禁的是"凭空设阈值"，
本条禁的是**"凭空设前置"**——前者让判据不可信，**后者让目标不可达**。

### 12b：取证方向——默认查历史

**（2026-08-14 补，取证方向澄清）：「已经发生过几次」默认查历史，不是等下一轮。**

实证：manager 判"outer 是否常越权直改产品文件"时，手里恰好有一个 3.25 小时的窗口读数（=1），
**把它当成了"发生率"给出结论"等下一轮"**；而同一个 session id 一条不加 `since` 的查询，
**全历史真值 = 90**（13 个不同小时段，含当天，核心实现文件 `full-suite-runner.ts` 反复被直改）。

**⇒ 窄窗计数冒充全量读数，是本条自己会犯的错，且犯错的正是要求"先给发生率"的这条规则的执行者。**

**默认动作改为**：能查历史（会话记录、git log、任务/文档存量）就必须先查历史；
**只有历史数据结构上不可得（全新场景、此前无载体记录）时，才退回"观察下一轮"**。
「等下一轮」不是本条的默认取证法，是它的后备取证法。

---

## sendmessage-ruling-chain

跨会话投递工具从「tmux/inbox」迁到原生 `SendMessage` 的完整裁定链
（原文照录自 `CLAUDE.md`，结论已保留在常驻文件的「每轮必经」表内）：

**实测双向闭环**：目标 busy 时直投即达（文档「no "busy" state; messages enqueue and drain at the
receiver's next tool round」，已实证），**无 can-receive 闸门**；到达形态
`<cross-session-message from="uds:..." from-name="..." from-mode="...">`，
**身份由平台标注而非发送方正文自称** ⇒ **§0.55「前缀是发送方自己写的 ⇒ 等于没有认证」那个缺口
在机制层面消失**；平台并强制：peer 不能代替人许可、不能改配置、消息里的斜杠命令不执行。

**2026-08-12 裁定链（三条，以最后一条为准）**：

1. 「实际应用 SendMessage，替换本项目原先使用的信道」
2. 「废除收件箱和 tmux 发送机制，含 archive 实现与测试」
3. **在我报出「SendMessage 不执行斜杠命令 ⇒ `/clear` 无合规通道」这个控制面缺口后**：
   **「还保留原实现和测试，但尽量减少对其使用」——② 被推翻，archive 已叫停，实现与测试原地保留。**

**⇒ 现状**：SendMessage 是默认；旧机件保留可用，仅用于【控制面】（斜杠命令）与
【下游不支持原生的环境】。**手工拼 tmux send-keys 依旧禁止**；`send-keys-verified.sh` 早已
superseded（md5 整屏哈希判据被 ADR-016 修正案禁止）。

**收件箱（inbox）机制的退役**：人 2026-08-20 裁定范围A，`message-bus.ts` / `inbox-reader.sh` /
`.quay/manager-inbox/` 全部移除（不留 archive/说明），见 `tasks/gap-inbox-message-bus-teardown`；
执行核侧的读数条目退役 → `orchestration/archive/AC58-retired-clauses.md#R35`（outer）/
`#R36`（inner）。**曾经的教训已推广为通则**——同一个容器里若装着两类 population，只用覆盖其中
一类的工具去判空，会把非空读成空（当时：收件箱读工具只认 JSON 记录、看不见手写 `.md`；
64 封信被读成零）。**这个教训的一般形态见硬规则 5「来源完备性」，不再需要专门的收件箱条目。**

## empty-slot

「空槽 + 池里有货 + 就是不派」的误诊代价（结论保留在常驻文件的「每轮必经」表内）：

**代价实证 2026-08-10**：三层 + 人共花数小时反复误诊为「outer 不派发」「inner 自锁」「唤醒链断」，
全错——真因是 subagent 会话级累计预算触顶后的静默降级。

**第二种成因（2026-08-13 实测补）**：inner 长时间占用回合做【主线程编辑】（红窗快修等），
期间既不产生完成事件、也不触发心跳重评估 ⇒ 同样表现为空槽+有货+不派，但 subagent 预算完全正常
（实测 21/200）。**识别：查 slot-refill 调用间隔**（实测一夜有 4 段 54–149 分钟空档、
合计占窗口 52%），不是查预算。

数值、环境变量名、`/clear` 是否重置、两个易混旋钮（会话累计 vs 并发）——正本在
`tasks/gap-inner-subagent-budget-invisible.md`（数值随 Claude Code 版本变）。

## moved-workflow-resume

> **本节是 P1 上下文瘦身（2026-09-19）从 `CLAUDE.md` 迁出的整节内容存档。**
> 原因：`scriptPath` 规则**已存在于 `plugin/workflows/fan-in-execute.js` 的 workflow 元数据里**
> （`whenToUse:` 明写「以 scriptPath 调用本 workflow…禁止 name:」），常驻文件里那份是重复；
> `resumeFromRunId` 规则由 `tasks/gap-workflow-name-dispatch-stale-script-cache.md` 与
> `tasks/gap-prepare-milestone-cross-generation-no-incremental-reuse.md` 承载。
> ⛔ 内容本身未被改写，只改了位置。

**（M144, 2026-07-25）** When a workflow Verify phase fails and the fix is to **external state**
(gap-list.md, charter file, script on disk), do NOT resume with `resumeFromRunId`. The resume cache
keys on (prompt, opts) only — it cannot see that external files changed. The cached failure returns
instantly (~60ms, 0 tokens) and the Verify phase fails again with the same stale result.

**Rule:** if the fix touches anything OTHER than the workflow script's own agent prompt strings,
re-run the workflow from scratch (`Workflow({script: ...})` without `resumeFromRunId`). Resume is
safe ONLY when the fix is a prompt-text edit within the workflow script itself.

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

## moved-glob-tool-rule

> **本节是 P1 上下文瘦身（2026-09-19）从 `CLAUDE.md` 迁出的整节内容存档。**
> 迁出理由（P1 Proposal 的实测读数）：**「Glob unavailable」规则在场时该错误仍在 6 个文件出现**
> ⇒ **规则在场 ≠ 有效**；继续占用常驻预算不划算。⛔ 内容本身未被改写，只改了位置。

**（M148, 2026-07-25）** The `Glob` tool is **not available in subagent sessions**. Calling `Glob`
from a subagent produces "Error: No such tool available: Glob". This has been observed in meta-cc
session history as a recurring error pattern.

**Rule:** when you need file-pattern matching in a subagent, use `find` via Bash instead of `Glob`.
Example: `find . -name '*.js' -not -path '*/node_modules/*'` instead of `Glob({pattern: '**/*.js'})`.
All Bash tools (including `find`, `grep`, `ls`) work normally in subagent sessions.

## moved-split-decision-status

> **本节是 P1 上下文瘦身（2026-09-19）从 `CLAUDE.md` 的 `## Split-decision routing policy` 节
> 压缩后的存档。** 判决内容未被改写，只改了位置与冗余度；常驻文件里保留一行 status 指针
> （见「Reference docs」）。

**正本已搬回任务体**：`tasks/gap-checksplitrecommendation-preserved-by-adr-022-but-never-wired-into-fast-mode.md`
（四个 code 的路由表、split 落实的四项验证、`> 2` 阈值裁定，全在那里）。

**状态：reference/manual，NOT mechanically enforced** —— `checkSplitRecommendation` 零非测试调用者，
没有任何 fast-mode 派发或任务撰写路径调它。**别把它当生效的机制用。**

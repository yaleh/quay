---
id: gap-fan-in-push-silently-fails-no-detection
title: worker-driver fan-in 完成后 push 到 origin/develop
  悄悄失败——已发生两次，均靠人工/偶然核实发现，无任何机制主动检测
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: plan
---

**type:** execution

## Proposal

**2026-09-16/17，同一类事故在本仓库发生了两次**：worker-driver（在主检出 `/home/yale/work/quay` 上跑）完成了一个任务的 fan-in（本地 `develop` 分支产生真实 commit），但 push 到 `origin/develop` 的步骤要么失败、要么根本没有真正被触发——本地 `develop` 领先 `origin/develop`，且这个"领先"状态本身**没有任何告警/日志明确指出**，任务的 `status` 字段却已经翻成 `done`，看起来完全正常。

**事故 1**：`gap-release-yml-missing-github-release-object` 与 `gap-closure-ratchet-stale-wire-into-precommit-guard` 两个任务的完整 fan-in 结果（含 `create-github-release` job 的代码改动）本地领先 origin 16 个提交，从未推送。根因疑似：另一个并行会话（tokyo-alpha self-hosted runner 部署）几乎同时做了一次直接 `git push`（commit `9f79bc17f`，author date `2026-09-16T14:57:25Z`——已核实这个 sha 与 tokyo-alpha runner 迁移相关：`gap-outer-tick-log-awk-mawk-interval-red` 任务体的 Evidence 段落逐字引用了同一个 commit `9f79bc17f` 作为触发 CI 跑的那次提交），其父提交是这两个任务 fan-in **之前**的 develop 快照，导致它抢先把 origin/develop 推进到了一个不包含这两个任务改动的点；worker-driver 随后若尝试 push 自己那条含这两个任务改动的本地 develop 历史，会因 non-fast-forward 被拒绝——但没有观察到任何这类失败的日志/告警，只发现本地领先 16 个提交且是干净的 fast-forward（是人工核实历史链条时发现的，不是任何检测机制报出来的）。

**事故 2**：`gap-dev-stats-collect-from-production-carriers` 任务标记 `done` 后，GOAL-021 的 AC-277 判据连续两轮（`2026-09-17T00:10:51Z` / `00:17:30Z`）报 `verdict: fail`，`CAUSE=stats-script-absent`——但该任务声称已产出的 `plugin/scripts/dev-stats-collect.ts` 脚本，实测确实以两条真实提交（`4abbe18d9`、`852e59b05`）存在于**本地** `develop` 分支，只是同样没有推送到 `origin/develop`（本次立案当场用 `Read` 核实：该文件在本地主检出磁盘上确实存在且内容完整，佐证 fan-in 已在本地真实发生）。这次是靠 GOAL-021 的 goal-driver 判据 fail 被一个独立的"stuck-goal-AC 黑洞监视" Monitor（本身设计用途是抓另一类问题——已认领 done/superseded 但判据仍失败的 goal-driver 去重盲区）间接、偶然地暴露出来的，不是任何专门针对"push 是否成功"的检测机制。

**共同模式**：①"任务 status=done" 与"代码真正到达远端共享仓库"完全脱钩——这比"疑似红需要重试"更危险，因为它在记录上与"一切正常"同形（硬规则 3b 的经典形态：读不出/检测不到的状态，不能与"合格"同形，但目前压根没有任何检测点，连"读不出"这个态都没有，是彻底的盲区）。②两次都是靠人工/偶然核实发现的，没有一次是被机制主动报出来的。③规模会越来越大：随着 self-hosted runner（tokyo-alpha）等更多并发写入 develop 的来源出现，这类竞态只会更频繁，不能继续依赖人工巧合发现。

**与既有机制的关系（区分，不是重复，已查重）**：`tasks/gap-doc-develop-sync-semantic-conflict-resolution.md`（done）与 `tasks/gap-main-manager-doc-doc-only-ff-only-tracking.md`（done）处理的是 **author 分支落后 develop、或两者出现语义分叉后如何合并**的问题——这些机制假设"该往前推的动作已经执行"，只是产物之间不同步。**本任务要处理的是更前置的一层**：**push 这个动作本身悄悄失败/被抢先时，完全没有人/机制知道**——是"检测 push 是否真的落地"的缺口，不是"落地后怎么和解分叉"的缺口，两者互补不重叠。已查重「push」「non-fast-forward」「fan-in」「origin/develop」「worker-driver push develop」等关键词，无同机制在飞或历史任务。

## Plan

**①（核心）** 新增一个检测器（建议 `plugin/scripts/fan-in-push-lag-check.ts`，具体命名由实现者按仓库既有命名惯例确认）：机械检测本地 `develop`（或 worker-driver 实际工作的 checkout 所在分支）相对 `origin/develop` 的领先提交数 + 领先提交集合里**最老一条**的 committer date。若领先数 > 0 **且**最老一条领先提交的时间已经超过某个阈值，判定为"push 滞后"，输出结构化事件（枚举领先提交数、最老提交 sha、领先时长——不是布尔）。**阈值不得凭空定**：需读一段真实的 driver round 间隔数据作为参照并写清依据（若阈值依赖当前 driver 轮转节奏这类会变的量，优先从配置/常量读，留可调整入口，不要写死一个未来可能失效的字面量——硬规则 4 推论二）。

**②** 这个检测应挂载到现有的常驻例行机制（driver 自己每轮附带检查、或 `.quay/config.yml` 的 `loop.routines` 一个新条目、或本项目已有的例行/quality 轨道——由实现者读代码后确定挂载点，不凭空新建一整套独立循环）。检测到滞后时：优先尝试**机械重试 push**（`git fetch` + rebase-or-ff-retry，解决网络瞬时失败或短暂 non-fast-forward）；重试仍失败（真正的 non-fast-forward，如被并发直接 push 抢先）则升级到既有的"语义同步兜底"机制（`gap-doc-develop-sync-semantic-conflict-resolution` 记录的第 1 层流程：develop 权威 wins + 语义合并）——**不在本任务重新发明合并策略**，只负责"检测到滞后并触发既有兜底机制"。

**③ 负控制（可证伪，必须做，真实 git 操作，不是伪造 JSON 输入）**：
- 构造"本地领先 origin 若干个提交，且最老一条已超过阈值"的场景 ⇒ 验证检测器报出滞后（正例）。
- 构造"本地领先 origin，但最老一条领先提交在阈值以内（刚刚发生）"的场景 ⇒ 验证**不**报警（避免把正常的、短暂的、driver 下一轮就会自己推送掉的领先窗口污染成噪音——这是本检测器最容易犯的假阳性方向，必须有对照）。
- 构造"本地与 origin 完全同步（领先数=0）"的场景 ⇒ 验证不报警（基线负控制）。

**④** 告警形态要能让人/manager 会话看到——参考现有的 needs-human / 告警载体惯例，不发明新通知渠道；具体接入点（写进某个 `.quay/*.jsonl` 载体供人核对，还是直接触发 needs-human 类任务，还是别的）由实现者判断，但必须给出理由。

## Acceptance Criteria

- [x] AC1（正例，真实构造）：用真实 git 操作（本地仓库 + 一个真实的本地"origin"远端，或等价的可控双仓库夹具）构造一个本地领先 origin 且最老领先提交已超过阈值的场景，检测器报出滞后事件，包含领先提交数、最老提交 sha、领先时长三个字段。
- [x] AC2（负控制1，假阳性方向）：领先但最老一条领先提交在阈值内（刚发生）⇒ 检测器不报警（真跑，不是推理）。
- [x] AC3（负控制2，基线）：本地与 origin 完全同步（领先数=0）⇒ 检测器不报警（真跑）。
- [x] AC4（阈值依据）：阈值的选择有实测依据——读一段真实的 driver round 间隔数据作为参照，写清楚为什么选这个数字；阈值从配置/常量读出而非写死字面量，给出该配置项的位置。
- [x] AC5（重试路径）：构造一个可通过简单机械重试解决的滞后场景（如短暂 non-fast-forward，重新 fetch 后可 ff），验证机械重试确实成功把本地 develop 推送到 origin/develop。
- [x] AC6（升级路径）：构造一个机械重试无法解决的真实 non-fast-forward 场景（如两个仓库对同一父提交产生了不同的后续提交），验证检测流程正确识别"重试不可解"并触发/移交既有语义同步兜底机制（不要求本任务重新实现该机制本身，只要求触发点被真实调用到）。
- [x] AC7（挂载与告警形态）：给出检测器实际挂载点的 file:line 证据（driver 轮转脚本 / `.quay/config.yml` routines 等），以及告警形态的落地证据（`.quay/*.jsonl` 追加记录，或 needs-human 触发，或其它），并说明选择理由。
- [ ] AC8：`bash scripts/test.sh --for-task gap-fan-in-push-silently-fails-no-detection` 退出 0。

## Definition of Done

验收对象是"下次同类事故（fan-in 完成但 push 静默失败）会被机制主动报出来，不需要人恰好去核对某个 goal AC 或恰好去翻 commit 历史才发现"——不是"写了一个检测脚本"就算完成。负控制必须证明这个检测器在真实场景下能取真也能取假，不是恒报警或恒沉默（硬规则 4：一个结构上不可能取假的量不是测量）。AC1-AC8 全部带真实读数（命令 + 输出），不是自述结论。

## Touches

- plugin/scripts/fan-in-push-lag-check.ts (new)
- plugin/test/fan-in-push-lag-check.test.mjs (new)
- plugin/scripts/capability-catalog.sh（新 plugin/scripts 脚本的六行声明义务——`select-static-checks-for-touches.ts` 的 touches-missing-registration 闸要求它进 Touches）
- plugin/scripts/worker-driver.ts（常驻环挂点，机械 fan-in 的 driver 轮转）
- tasks/gap-fan-in-push-silently-fails-no-detection.md（自身）

## Evidence

### 设计（两个刻意分开的半边 —— 这是本实现唯一容易做错的地方）

- **upsync 无年龄门**：只要领先数 > 0 就当轮机械推送（fetch + push）。fan-in 的产物应该在一个 pass 内到达 origin——**这才是事故本身的修法**；若把 push 也压在"超阈值才推"的门后，fan-in 结果会先躺最多一个阈值（默认 60 min）才上线，等于用一个新延迟换掉旧缺口。
- **告警有年龄门**：只有"领先扛过阈值而推送仍未成功"才报。年轻的领先是正常瞬时窗口（下一轮就推掉了），报它就是噪音（AC2 的假阳性方向）。
- 读数 verdict 枚举 `in-sync | within-threshold | lagging | pushed | escalated | not-evaluated`；`not-evaluated`（git 读失败）是**独立取值**，⛔ 不落进 `in-sync`（硬规则 3b）。CLI 退出码同构 0/1/2/3。

### AC1（正例，真实构造）—— 报出滞后，含三个字段

夹具：`plugin/test/fan-in-push-lag-check.test.mjs` 的 `makeWorld()` = 真 bare origin + 真 clone（`git init --bare` / `git clone`）；两个真实提交，committer date 各取 2 小时前（`GIT_COMMITTER_DATE`）。阈值取 1h。

```
$ node --experimental-strip-types plugin/scripts/fan-in-push-lag-check.ts --root <wt> --measure-only --json
{"verdict":"lagging","branch":"develop","remote":"origin","ahead":2,"behind":0,
 "oldestAheadSha":"<c1|c2 之一>","oldestAheadEpochMs":...,"lagMs":>=7200000,
 "thresholdMs":3600000,"thresholdSource":"env:…","diverged":false,"retry":"not-attempted",...}
exit=1
```
三个字段齐备：领先提交数 `ahead=2`、最老提交 sha `oldestAheadSha ∈ {c1,c2}`、领先时长 `lagMs ≥ 2h`。

**滞后事件落载体**（把 origin 指到一个不存在的路径 ⇒ 机械重试不可解 ⇒ 触发告警，`runPushLagCheck` 的完整路径）：
```
.quay/fan-in-push-lag.jsonl 追加一条：
{"ts":..., "event":"push-lag","verdict":"lagging","ahead":2,"behind":0,
 "oldestAheadSha":"...","oldestAheadEpochMs":...,"lagMs":...,"thresholdMs":3600000,
 "thresholdSource":"test:ac1","laggingAtMeasure":true,"retry":"error",...}
```
测试断言 13 项（含事件里三个字段 + thresholdSource），`node --test plugin/test/fan-in-push-lag-check.test.mjs` ⇒ **14 pass / 0 fail**。

### AC2（负控制1：假阳性方向）—— 领先但在阈值内 ⇒ 不报警

同一形状的夹具（ahead=2）但提交是"刚刚"发生的（`commitNow`）：

```
measurePushLag(...) ⇒ {"verdict":"within-threshold", ahead:2, behind:0, lagMs:<阈值内>}
runPushLagCheck(..., {measureOnly:true}) ⇒ verdict=within-threshold, eventFile=null
  且 .quay/fan-in-push-lag.jsonl 【文件都没被创建】（existsSync === false）
runPushLagCheck(...) 真实路径 ⇒ verdict="pushed"（年轻领先当轮推掉）, laggingAtMeasure=false,
  载体仍未创建（⛔ 正常节奏不刷载体）
```
⇒ **与 AC1 的唯一差别是年龄**，判定却相反 ⇒ 年龄门是真的在起作用，不是恒报警。

### AC3（负控制2：基线）—— 完全同步 ⇒ 不报警

```
measurePushLag(...) ⇒ {"verdict":"in-sync", ahead:0, behind:0,
                       oldestAheadSha:null, lagMs:null}     ← ⛔ null，不是伪造的 0
runPushLagCheck(...) ⇒ verdict=in-sync, retry=null, eventFile=null；CLI --json ⇒ exit 0
```

### AC4（阈值依据）—— 实测数据 + 派生式 + 可调入口

**实测参照（2026-09-17，本仓库 `.quay/worker-round.jsonl`，19394 轮）**：
```
pass 间隔  p50 = 0.6 min | p75 = 3.3 min | p95 = 5.1 min | p99 = 7.5 min | max = 141 min
（<2m 13749 轮 / 2–5m 3317 / 5–15m 2230 / 15–30m 67 / 30–60m 25 / >60m 5）
```
**取 12 的理由**：领先窗口的正常寿命 = 「本轮 upsync 当轮推掉」⇒ 远小于一个 pass 间隔。12 × p95 ≈ 61 min，也等于 12 × driver 自身默认轮间隔（reconcileMs 300s）。一个领先能扛过 12 个 pass 而每次重试都推不上去 ⇒ 结构性失败（真 non-ff / 远端不可达 / 凭据失效），不是瞬时抖动。事故 1/2 的领先窗口都在小时量级，12 轮的上界（≈61 min）远早于它们被发现的时间。

**配置项位置**：
- 乘数常量 `PUSH_LAG_ROUNDS_BEFORE_ALARM = 12` — `plugin/scripts/fan-in-push-lag-check.ts:62`
- 基数 = driver 自己的轮间隔，生产由 `worker-driver.ts` 传 `reconcileMs`（⛔ 不是写死的毫秒字面量——轮间隔是 host/config 派生的量，硬规则 4 推论二）
- 可调入口 ① `QUAY_PUSH_LAG_THRESHOLD_MS`（env，逐次覆盖）；② `.quay/config.yml` 的 `loop.push_lag_threshold_ms`（逐工作区）；解析函数 `resolvePushLagThresholdMs` — `fan-in-push-lag-check.ts:230`，**每次返回都带 `thresholdSource` 出处串**（env 名 / config 文件:键 / 派生式），且非法值记 `IGNORED as invalid`，⛔ 不静默回退。

**可证伪对照（同一份读数，只改阈值）**：30 分钟前的领先 + 阈值 10min ⇒ `lagging`；同一仓库 + 阈值 6h ⇒ `within-threshold`。⇒ 阈值是一个**真的会翻转判定的旋钮**，不是装饰。

### AC5（重试路径）—— 重新 fetch 后可 ff ⇒ 机械重试真的推上去

夹具：peer clone 先推一个提交、本机 `git fetch` 过（remote-tracking ref 前进），随后 origin 被移回 base（peer 的瞬态提交被上游丢弃）⇒ 本机 `refs/remotes/origin/develop` **陈旧领先**。

```
measurePushLag(...) ⇒ {"verdict":"lagging","ahead":2,"behind":1,"diverged":true}   ← 看似 non-ff
runPushLagCheck(...) ⇒ retry="pushed", verdict="pushed"（fetch 后 behind==0 ⇒ 纯领先 ⇒ 推）
   之后：git rev-list --count origin/develop..develop == 0
         git ls-remote origin refs/heads/develop 的 sha == 本地 develop（远端侧真实落地，不只是本地 ref 记账）
```
⛔ 且**没有**写升级 ledger（`.quay/doc-develop-sync.jsonl` 不存在）⇒ 可机械解决的滞后不会被误移交。

### AC6（升级路径）—— 真 non-fast-forward ⇒ 移交既有语义同步兜底

夹具：peer 推一个**真分歧**提交且 origin 停在那里（两侧各有对方没有的提交）。

```
runPushLagCheck(...) ⇒ retry="non-ff-escalate", verdict="escalated"
既有机制 ledger .quay/doc-develop-sync.jsonl 落一条：
  {"event":"push-lag-non-ff-escalate","phase":"escalate","branch":"develop","remote":"origin",
   "ahead":2,"behind":1,"oldestAheadSha":"...","lagMs":...,"detail":"true divergence after fetch: ..."}
两侧均未被改动：本地仍领先 2、origin 仍持有 peer 的提交 ⇒ 没有 force-push、没有覆盖。
```
**触发点被真实调用到**：writer 是 `driver-filters.writeDocDevelopSyncEvent`（`gap-doc-develop-sync-semantic-conflict-resolution` 的单一 ledger writer，与 author↔develop 同步共用）——那条机制的入口形态是「周期核对 ⇒ 同步待办（一条带 ahead/behind 的 ledger 记录）⇒ 机械半 ⇒ 语义半」，本条写入的正是那个**待办入口**；合并策略本身 ⛔ 未重新实现。
**负控制**：同文件另有一条用例断言 in-sync 树**不**写该 ledger（移交是有条件的），并直接调用一次 escalate writer 证明"能写"不是假设。

### AC7（挂载点与告警形态）

**挂载点（file:line）**：
- `plugin/scripts/worker-driver.ts:5587` `step = "push-lag";` / `:5588` `pushLagReading = runPushLagPass(rootDir, pushBranch, pushRemote, reconcileMs);` —— 在 `runResidentLoop` 的**每轮 pass** 内，与 `liveness` / `reconcile` / `reclaim-superseded` 同族（每轮无条件跑，⛔ 不依赖任何完成事件）。
- 辅助 `runPushLagPass` — `worker-driver.ts:1330`；读数投影进 round 载体 `push_lag` — `worker-driver.ts:1421`。
- 被推分支 = 机械 fan-in 的 merge target（`pushBranch`，缺省 develop），⛔ 不硬编码在检测器里。

**为什么挂在这里（而不是 `.quay/config.yml` routines / probe 轨道）**：唯一真的会"做 fan-in"的常驻进程就是 worker-driver 主检出的常驻环，所以它是唯一能在事故窗口内闭合的落点。既有 tick 心跳（`plugin/loop/fast-mode-tick-core.md` A17 的 `sync-lag-check.sh --push`）属**已退役的两层 tick**，生产上没有执行者；probe 轨道经 `probe-routine.ts` spawn 一个 **LLM agent** 且最短可用节奏 `interval:<N>m`（现网 120m/1440m）远慢于每轮 pass（p95≈5min）。

**告警形态（四处，各有读者）与理由**：
1. **`.quay/worker-round.jsonl` 的 `push_lag` 字段**（每轮写，in-sync 也写）—— 生产 driver argv 无 `--json`，round 记录是它唯一每轮必写的载体；`packages/quay/src/observation.ts` 已在读该载体 ⇒ Live 页/观测面天然可见。`push_lag: null` = 本轮**没跑**该步，⛔ 与"跑了且 in-sync"可区分（硬规则 4 推论三的读生产载体半边）。
2. **`.quay/fan-in-push-lag.jsonl`**（追加，只在有信号时写：lagging / escalated / 曾超阈值后被推掉）—— 事故台账；正常节奏不写 ⇒ "有记录"等于"出过事"。
3. **`.quay/doc-develop-sync.jsonl`** —— 真分歧的移交，进既有机制待办。
4. **CLI 退出码 1** —— 供人/包装脚本按。

**⛔ 为什么不用 needs-human**：本次滞后是**仓库级**事实，没有可指的任务对象——`markNeedsHuman(root, id, reason)` 需要一个 task id 并把那个任务翻成 needs-human，用它就得凭空挑一个无关任务。

**Touches 的两处收窄（与立案时的声明不同，理由在此）**：
- `plugin/probes/fan-in-push-lag.md` **未创建**：probe 规格的唯一消费者是 `.quay/config.yml loop.routines` 的 `probe:` 条目 + `probe-routine.ts`（spawn LLM agent）。本检查是纯机械的，且上面的挂点已覆盖每轮；造一份无人声明的 probe 规格 = 死文件（硬规则 9）。真相源只有一处。
- `plugin/scripts/sync-lag-check.sh` **未修改**：push 改为**委托既有原语** `periodic-push-backup.sh`（`pushOnce` — `fan-in-push-lag-check.ts:370`，经 `resolveKernelShellSibling` 解析）——never-force 纪律与跨机 verify 记录钩子都住在那一份实现里，第二份实现就是漂移源（`sync-lag-check.sh` 自己也是同一个委托形态）。缺该原语时返回独立的 `unavailable` 取值，⛔ 不与"推成功"同形。

### AC8
见下方"AC8 证据"（scoped 门读数）。

### 边界（诚实记录，⛔ 不粉饰）

- 本检测器覆盖 **develop → origin/develop** 一条线（机械 fan-in 的落点）。`author` 分支的 push 不在其内。
- 重试**不做 rebase / merge**：那属于"合并策略"，本任务明令不重新发明。真分歧一律移交既有语义同步兜底（AC6）。
- 告警是**机械可读**的（载体 + 退出码），⛔ 不新增推送通知渠道（任务 ④ 明令"不发明新通知渠道"）。

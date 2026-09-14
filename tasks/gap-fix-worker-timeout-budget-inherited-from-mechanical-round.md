---
id: gap-fix-worker-timeout-budget-inherited-from-mechanical-round
title: fix-worker 的 180s 超时预算抄自机械脚本的 ROUND_TIMEOUT_MS——落在 agent 真实时长分布正中，落地后仍 66% 被截断
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-fix-worker-spawn-timeout-persists-post-fix
---
**type:** execution

## Proposal

**这是 `gap-fix-worker-spawn-timeout-persists-post-fix` 修复之后的【残差】,不是它的重复。** 那条任务于 `3278ac8af`(2026-09-07T23:51:20Z)给 `roles.fix-worker` 补上 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS="0"`,把 fix-worker 的干净返回率从 **0**(2026-08-23 起 88 次 spawn 无一干净)拉到 **34%**。本任务处理剩下的 66%。

**读生产载体(`.quay/promotion-round.jsonl`,非 fixture)**:带 `durationMs` 的记录共 **32** 条,全部落在上述修复之后(2026-09-08T22:51:03Z → 2026-09-14T08:03:14Z),且 **32/32 的 argv 里都带 `BG_WAIT_CEILING` 键**(⇒ 上一条修复确在生效,本任务的读数是它之后的干净窗口)。其中:

- 干净返回 **11** / 超时 **21**
- 干净返回的时长(秒):63.7 / 88.0 / 107.5 / 118.6 / 147.8 / 148.9 / 154.0 / 157.7 / 161.2 / 163.2 / **173.0**;中位 **149s**,**最大值距 180s 上限只差 7 秒**
- 超时的 21 条全部截断在 ~180.4s(min 180363ms / max 190667ms)

**成因(附区分性对照)**:`plugin/scripts/promotion-driver.ts:111` 的 `FIX_WORKER_TIMEOUT_MS = 180_000` 与 `:107` 的 `ROUND_TIMEOUT_MS` 同值,`:110` 注释写明这是刻意复用、理由记作「⛔ 不为 fix worker 另设阈值——硬规则 4 推论」。**但 `ROUND_TIMEOUT_MS` 约束的是 `ready-pool-check`——一个零 LLM 的机械脚本;fix-worker 是一次 `claude -p` agent 调用。** 硬规则 4 推论要求的是「先分解成本再谈指标」,此处被执行成了「复用一个为别的对象测过的数」。
同族直接量对照:真正的 ready→done worker(同为 claude agent)墙钟中位 **1687s**,仅 62/1937(**3.2%**)能在 180s 内跑完。
**若成因为假会看到什么(反向指标)**:若这些超时是另一种失败模式(挂死/卡在某一步),干净返回组应聚集在远低于上限处、并与上限之间留出空档;实测是 **63s → 173s 连续铺满并顶住上限**——这是阈值切过连续分布中部的形状,不是双峰。

**⚠️ 已被证否、本任务不再采信的成因**:`[claude-code:unrecognized_model]` 已由 `gap-fix-worker-spawn-timeout-persists-post-fix` 的负控制证否(换 SDK 已知模型名 6.1s 干净报错退出,不挂)。本轮补一条同向读数:**落地后 11 次干净返回中 11/11 都带这行警告** ⇒ 它在成功与失败记录里同样出现,不是判据(硬规则 2)。

**⚠️ 一条会误导实现者的既有读数，已复算证否**：`gap-goal-gap-filing-spawn-budget-too-small-ring-spins-empty`（done）的对照表（该任务体第 53 行）记 `| promotion-driver fix-worker | 180s | 最近 400 轮 **266/266 零超时** |`，并据此论证「同一个数字对 fix-worker 100% 够、对 gap-filing 100% 不够」。**该读数在同一载体上不复现**：`.quay/promotion-round.jsonl` 最近 400 轮的 `fixes[]` 条目共 **684** 条，其中 **672 条是 `spawned:false`**（根本没起进程 ⇒ `timedOut` 结构上恒 false，与「跑完且没超时」同形），真正 `spawned==true` 的只有 **12** 条、其中 **10 条超时（83%）**。⇒ 那个「零超时」计数把**非事件**计成了成功——硬规则 4「一个结构上不可能取假的量，不是测量」，同时也是硬规则 3b「读不懂/没发生 不得与合格同形」。**⛔ 实现者不要据该表认为 fix-worker 的 180s 预算是够的。** 该表对 goal-driver 那一半（gap-filing agent 3/3 全超时、放宽到 900s 后单次 602.9s 成功）有独立的区分性对照支撑，**不受本条影响**，其「⛔ 不要换成另一个写死的数字、应接成配置项」的结论对本任务同样适用。**⊢ 更强的形式:这个计数不只是「不复现」,而是【结构上不可能】**——`.quay/promotion-round.jsonl` **全历史** 43,722 轮、40,570 条 `fixes[]` 条目里，`spawned==true` 的合计只有 **121** 次。`266 > 121` ⇒ 无论取哪个 400 轮窗口，266 都不可能是「真实 spawn 次数」的计数，只能是把 `spawned:false` 的条目算了进去。⛔ 这条不需要知道正确答案是多少就能判它为假（同 `instrument-failure-check` 的自检形态）。

**旋钮缺失**:`spawnFixWorker(argv, root, timeoutMs = FIX_WORKER_TIMEOUT_MS)` 的第三参数**全仓库无一调用方传值**,也没有 env / CLI / profiles.yml 覆盖路径 ⇒ 换机器、换模型、换 prompt 规模后,这个数只能改代码(硬规则 4 推论二:依赖宿主/外生条件的字面值不应写死)。

**第二半:超时被杀之后【晚到的落地】——列为待查,⛔ 不作结论**

- **已确证的一半**:生产记录里存在 `"ok":true` + `exit=null (timed-out)` + `(fix landed — reverified eligible)` 的条目共 **12** 条 ⇒ 超时的 fix worker 确实可能已把活干完。**但这 12 条进的是 `nowEligibleIds`,没有烧重试——`advanceRetryCap` 只吃 `stillIneligibleIds`,这部分记账是正确的**(立案时曾误判为「白烧的重试」,在此更正)。
- **未确证的一半**:`gap-rework-multiplier-predictors` 实测——round185 的 fix worker 于 05:00:26Z 被杀、reverify 判 stillIneligible(烧掉第 1 次重试),而该任务文件补 `(new)` 标注的提交 `c6ebc6c5b` 落在 **05:05:16Z**(晚于 kill 约 290s);round188 起始闸(约 05:03)读到的仍是旧状态,又派了一次 fix。**但 round189 的起始闸(约 05:12,已晚于 05:05:16)仍报 `touchesResolve=false`,而同一版本文件现在直接跑 `touches-orthogonality-check.ts --resolve` 是通过的(0/2 non-tagged missing)** ⇒ 这一步对不上,归因未闭合。**⛔ 不得作为结论投递,见 Plan 步骤 3。**

## Plan

1. 把 `FIX_WORKER_TIMEOUT_MS` 与 `ROUND_TIMEOUT_MS` **解耦**(两个成本结构不同的对象不共用一个字面量),并给它一条可覆盖路径(env 或 `.quay/profiles.yml` 的 `roles.fix-worker`),⛔ 不再写死。
2. ⚠️ **不要拿现有的「中位 149s」去定新值**——该分布已被 180s **右截断**(66% 落在截断点上),这个中位是幸存者的中位,不是真分布的中位。先给一个明显宽松的值(如 600s)跑一段真实窗口,拿到**未截断**的分布之后再收敛(硬规则 4 推论:成本结构未知前不设数值阈值)。
3. 查清 Proposal 第二半的未闭合归因:round189 起始闸为何在 `c6ebc6c5b`(05:05:16Z)之后仍报 `touchesResolve=false`。**必须给出一个能区分的对照**(例如:取该时刻的文件版本 + 同一 `--root` 重放一次闸;或核对 promotion-driver 当时读的工作树/分支是否与该提交所在的一致——已知线索:`.quay/store-commit-propagation.jsonl` 记该次 task_write 为 `propagated:false` / `branchClass:"other"`)。给不出区分性对照 ⇒ **降为观察项,不阻塞步骤 1**(硬规则 12 / 推论四)。
4. 仅当步骤 3 证成「晚到的落地被记成失败」时,才改记账:让「超时但工作树/任务文件已变更」与「真的没修」**三态可区分**(⛔ 不与合格同形,硬规则 3b),落点在 `promotion-driver.ts` 的 reverify/`advanceRetryCap` 调用处(`:762` 附近),必要时及 `driver-filters.ts`。

## Acceptance Criteria

- [x] **能取假**:`FIX_WORKER_TIMEOUT_MS` 不再等于/引用 `ROUND_TIMEOUT_MS`,且存在一条可覆盖路径——传/设一个显著不同的值(如 5000ms)能让一次真实 spawn 在该值附近超时;**负控制**:不传时仍走默认值(两次读数都贴进 `## Resolution`)。
- [ ] **生产载体取真,只计落地之后的窗口**:实现落地后 `.quay/promotion-round.jsonl` 新产生的 fix 记录中,`spawned==true && timedOut==false` 的比例 **> 34%**(落地前基线 = 11/32,时间窗 2026-09-08→2026-09-14)。⛔ fixture / 注入记录不算,N 只计实现落地之后(硬规则 4 推论三)。⚠️ **立案阶段就地更正(⛔ 不静默删除)**:该阈值**不具区分性** —— 实测落地前基线本身已达 `11/31 = 35.48%`(任务体写的 11/32 = 34.375% 亦 > 34%),即它是一个**修前就为真的恒真判据**(硬规则 4);**真正的取假量是 AC3**(干净返回 ∧ `durationMs>180000`,全历史 43,750 轮中恒为 0)与**新窗口超时的绝对条数**(基线 20/31)。三条判据与读法见 `## Resolution`。（待外部）
- [ ] **未截断分布已取到**:放宽后的记录中出现 **≥3 条 `durationMs > 180000` 的干净返回** ⇒ 证明此前那批超时里确有一部分只是「没跑完」,而非挂死(这条同时是成因判断的事后对照)。〔实测该量为**可取假**:全历史 43,750 轮中此类记录 = **0**、历史最长干净返回 175,004ms ⇒ 修前结构上不可能满足。〕（待外部）
- [x] **步骤 3 有交代**:归因要么闭合(区分性对照的实际输出贴进 `## Resolution`),要么显式写明降为观察项及理由。⛔ 不静默省略。⇒ **已闭合**,对照片及其输出见 `## Resolution`。
- [x] `bash scripts/test.sh --for-task gap-fix-worker-timeout-budget-inherited-from-mechanical-round` 全绿,且新增/改动的用例在该轮**被实际选中执行**(按测试名核对,不看总数)。⇒ `PASS`（exit 0，`tests 108 / pass 108 / fail 0`），三条新用例**按名逐条命中**（见 `## Resolution`）。
- [x] **结构判据须能取假**（⚠️ 立案当轮就地更正，⛔ 不静默删除：这里原写「`task-schema-check.ts` … exit 0」，而实测本文件被判 `N/A legacy (no schema marker)`、与同族任务一致，该脚本明示 `N/A-legacy` 为 exit-0-neutral ⇒ 该命令对本文件**结构上不可能报 fail**，是空转判据）：改判 `quay task check` 在 `author->ready` 闸对本任务报四件套齐备 —— `{shape:"plan", artifacts:{proposal,plan,ac,dod} 四项全 true}`；**负控制**：临时移除任意一个 `##` 章节后同一闸即报该项 missing。两次读数都贴进 `## Resolution`。⚠️ **二次就地更正(实现期实测)**:`quay task check` **不产出该读数** —— 它报的是 ready→done 的复选框闸(`<id>: FAIL — 0/6 AC checkboxes checked`);产出 `{shape, artifacts}` 的是 author→ready 闸的实现 `ready-pool-check.ts:711 artifactsComplete(body)`,判据改锚到该函数。读数 + 四维逐项负控制见 `## Resolution`。


## Definition of Done

fix-worker 的超时预算由**它自己被测量过的成本结构**决定,而不是从一个机械脚本的预算继承;该值有可覆盖旋钮;生产载体上干净返回率相对 11/32 的基线有可读提升,且读数落在实现落地**之后**的真实运行窗口。⛔「把数字改大了」「单测绿了」不算达成——上一代同族任务(`gap-fix-worker-spawn-inherits-unrecognized-model-deepseek-v4-pro-anthropic`)正是这样达成然后被生产读数证否的。若 Plan 步骤 3 证成晚到落地,则记账三态可区分亦须落地。

## Resolution

**实现**（`1ddd3c223` + `0ee624ef4` on `task/gap-fix-worker-timeout-budget-inherited-from-mechanical-round`）：
- `plugin/scripts/promotion-driver.ts`：`FIX_WORKER_TIMEOUT_MS` = 600_000（与 `ROUND_TIMEOUT_MS` = 180_000 **解耦**）+ `FIX_WORKER_TIMEOUT_ENV` + `resolveFixWorkerTimeoutMs` + `runFixPass(…, timeoutMs)` 穿透（此前第三参数**全仓库无一调用方传值** ⇒ 常量事实上不可覆盖）+ CLI `--fix-worker-timeout-ms` + 轮记录字段 `fix_worker_timeout_ms`（使放宽前/后的记录在载体上可区分）。
- `.quay/profiles.yml`：注明真实覆盖路径（⚠️ 该文件的 `env:` 是喂**子进程**的，写在那里到不了驱动进程）。
- `plugin/test/promotion-driver.test.mjs`：3 条新用例 + 1 处过期注释（"= 180s"）就地更正。

**AC1 读数（能取假 + 负控制，一条命令的实际输出）**
```
FIX_WORKER_TIMEOUT_MS = 600000   ROUND_TIMEOUT_MS = 180000   equal? = false
no override   -> {"ok":true,"value":600000,"source":"default"}   ← 负控制：不传 ⇒ 缺省
env=5000      -> {"ok":true,"value":5000,"source":"env"}
cli=7000+env  -> {"ok":true,"value":7000,"source":"cli"}          ← CLI 优先于 env（两条路径可区分）
cli=abc       -> {"ok":false,"error":"invalid --fix-worker-timeout-ms: abc (expected a positive integer of milliseconds)"}
```
真 spawn 取假：`runFixPass([gap-budget], root, "node -e setTimeout(()=>{},30000)", 1500)` ⇒ `spawned=true, timedOut=true, exitCode=null, durationMs=1514`（**贴住覆盖值**，⛔ 不是缺省 600000）。
端到端：`--fix-worker-timeout-ms 5000 --once` ⇒ 轮记录 `fix_worker_timeout_ms: 5000`；**不传** ⇒ `600000`（两次读数不同 ⇒ 该字段是真读数而非常量回声）；`--fix-worker-timeout-ms nope` ⇒ **exit 2**（fail-closed）。

**修前负控制（"改前红"）**：把 `FIX_WORKER_TIMEOUT_MS` 改回 180_000、让 `resolveFixWorkerTimeoutMs` 忽略全部覆盖、`runFixPass` 忽略第三参数（= 修前行为；**新符号名保留**，使红是**断言**而不是 import 失败），跑同三条用例 ⇒ **3/3 红**：
```
AssertionError: FIX_WORKER_TIMEOUT_MS must NOT equal ROUND_TIMEOUT_MS (the inherited-budget defect)
AssertionError: a command outliving the budget must be reported as a timeout
AssertionError: Missing expected exception: an unparseable --fix-worker-timeout-ms must exit 2
```
（跑完已还原：`diff` 与修后版本逐字一致。）

**AC4：Plan 步骤 3 归因 —— 已闭合（附区分性对照）**

问题：round189 起始闸（≈05:12Z，**晚于** `c6ebc6c5b` 05:05:16Z）为何仍报 `touchesResolve=false`？

**根因 = 判据的读面是 develop ref，而那次落地只到了 author 分支。** 四步证据链：

1. **写面**：`c6ebc6c5b`（05:05:16Z，把 3 条 Touches 补成 `(new)`）落在 **author**（主检出，task_write 的写面）。`.quay/store-commit-propagation.jsonl:528`（05:05:17.097Z）记 `{changeKind:"must-propagate", branchClass:"other", propagated:false}` ⇒ **同步到 develop 失败**（`packages/quay/src/store-commit.ts:186-188` 的 `propagated = gitOk(root,["push",".",`${branch}:develop`])`）。
2. **读面**：`ready-pool-check.ts:2991-2994` 在 `--apply` 时传 `taskReadRef: develop`（该处注释明写这是**刻意设计**：「the `--apply` write path must JUDGE candidates from the develop ref, not the disk」）；`:2322-2329` 的全池读是「**ref 优先**，**仅当该 id 不在 ref 上**才回退盘面」—— 该任务在 ref 上（旧版），故用的是 ref 里的旧 body。
3. **develop 在该窗口冻结**：develop reflog 自 `c1cea6663`（push @05:00:26Z）之后直到 `36a29da7e`（push @05:24:29Z）**无任何 push** ⇒ round188/189（≈05:03 / ≈05:12）读到的 develop 就是 `c1cea6663`。
4. **对照（一条命令即可区分两个假说）**：`checkTaskTouchesResolve` 对三个版本的**实际输出** ——
```
c21a93310 (04:47:15Z)  mustExist=5 missing=3 ⇒ majorityMissing=TRUE    ← 无 (new) 标注
c6ebc6c5b (05:05:16Z)  mustExist=2 missing=0 ⇒ majorityMissing=FALSE   ← 有 (new) 标注
dedbdb3a5 (=HEAD)      mustExist=2 missing=0 ⇒ majorityMissing=FALSE
```
**两个 body 精确复现了两个读数**，而 develop 在那一窗口持有的是**第一个** body ⇒ round189 的 `touchesResolve=false` 不是解析问题、不是缓存问题，是**判据读了另一个分支**。

⚠️ **与 Proposal 第二半的关系（诚实标注）**：这条闭合的根因**不是**「超时被杀 ⇒ 记账错」。同一时刻的判据**即使 fix worker 干净返回也会判 stillIneligible** —— 它的读面是 develop。**因此 Plan 步骤 4 的落点（在 `promotion-driver.ts` 的 reverify/`advanceRetryCap` 处加「超时但任务文件已变更」三态）针对的是另一个对象**：该实例里文件**确实已在盘上变更**（05:05:16Z，晚于 kill 约 290s），加这个三态探针会打印「已变更」而闸照旧判失败 —— 既救不回这次记账，还可能把 needs-human 掩盖掉（**恒真的"已变更"读数与"修好了"同形**，硬规则 3b）。**故 ⛔ 本任务不实现 Plan 步骤 4**；按硬规则 12 / 推论四（给不出区分性对照 ⇒ 降为观察项）落到下条。

**观察项（不阻塞本任务，供后续立案）**：写面（author）与判据读面（develop）之间的同步失败，是一个**静默的判据侧缺口**。`propagated:false` **落了痕**（`.quay/store-commit-propagation.jsonl`），但**没有任何消费者**把它接到「闸正读到陈旧 body」这件事上；`ready-pool-check` 的 ref 优先策略使「**已落地但未同步**」与「**没修**」**同形**（硬规则 3b）。修法方向：闸发现 ref 上该 id 的 body 与盘面不一致（且盘面更新）时，报 NOT-EVALUATED / 改读盘面，而不是照旧判「不合格」并烧重试。**⛔ 不在本任务范围内。**

**AC2 / AC3：留待外层** —— 两条都点名**实现落地之后**的 `.quay/promotion-round.jsonl` 生产窗口，本任务在工作树内**结构上产出不了**（driver 常驻从主检出加载源码；须落地 + driver 以新预算重启后才有新 fix 记录）。**留给外层的可执行读法与预期对照**：

- **只计落地后的窗口**（`fix_worker_timeout_ms == 600000` 即本任务新值；旧记录该字段为 `null`）：
  ```
  jq -r 'select(.fix_worker_timeout_ms==600000) | .fixes[]? | select(.spawned==true) | [.timedOut, (.durationMs//0)] | @tsv' .quay/promotion-round.jsonl
  ```
- **落地前基线**（本任务复算，`spawned==true` ∧ 带 `durationMs` ∧ argv 含 `BG_WAIT_CEILING`）：任务体所述窗口 `11/31 = 35.48%`（任务体记 11/32）、全窗口到 2026-09-14T10:49:08Z 为 `12/32 = 37.50%`；干净返回时长 `63.7 / 88.0 / 107.5 / 118.6 / 147.8 / 148.9 / 154.0 / 157.7 / 161.2 / 163.2 / 173.0`（秒，与任务体逐条一致）。
- **AC2 判据（已更正）**：新窗口 ① 干净返回比例 > 34% **且** ② `timedOut==true` 绝对条数**显著低于基线的 20/31** **且** ③ AC3 成立。
- **AC3 判据**：新窗口出现 **≥3 条 `durationMs > 180000` 且 `timedOut==false`**。
- ⚠️ **反向指标（若缺省 600s 仍不够，即成因为假时会看到什么）**：新窗口干净返回**仍全部低于 600s 且贴住 600s 上限**、超时条数**不降** ⇒ fix worker 的墙钟成本结构本就**无上界**（挂死在别处），须回到「分解成本」找那一步，**⛔ 不得当作已修**。这是本条唯一的取假方向。

**AC5 读数（scoped 门，按测试名核对）**
```
bash scripts/test.sh --for-task gap-fix-worker-timeout-budget-inherited-from-mechanical-round --allow-thin
⇒ exit 0 · ℹ tests 108 · pass 108 · fail 0 · duration_ms 148668
✔ gap-fix-worker-timeout-budget AC1 — budget decoupled from ROUND_TIMEOUT_MS and resolvable (CLI > env > default)
✔ gap-fix-worker-timeout-budget AC1 — a real fix-worker spawn honours a passed override (times out near 1500ms, not at the 600s default)
✔ gap-fix-worker-timeout-budget — --fix-worker-timeout-ms reaches the round record (end-to-end through the real CLI)
```
⚠️ 该轮跑在 `5b2129409`（本次 merge 到的 develop tip）上；此后 develop 前进到 `b11fa1a87126a995b0ad76e10406dd2c0774484f`，但 `git diff --stat 5b2129409..develop -- plugin/ packages/ scripts/` **为空**（9 个新提交全是任务文件）⇒ 对本次 scoped 选择集而言结果不变。scoped-gate 缓存按**实际 gated 的 tip** `5b2129409` 写入（⛔ 不写「当前的 develop」——那会是「缓存 SHA 不是门实际跑的那个 tip」，`scoped-gate-cache-sha-must-be-the-tip-you-gated`）；develop 已前进 ⇒ fan-in 侧按设计 **cache-miss 并照跑**（fail-closed）。

**AC6 读数（⚠️ 就地更正：判据点名的命令不产出该读数）**
`quay task check` 实测输出 `<id>: FAIL — 0/6 AC checkboxes checked` —— 它是 **ready→done 的复选框闸**，**不产出 shape/artifacts**。产出该读数的是 author→ready 闸的实现 `ready-pool-check.ts:711 artifactsComplete(body)`；判据已就地改锚到该函数（与 AC6 中 `task-schema-check.ts` 那处更正是同一手法：⛔ 不静默删除，就地更正并说明）。实测读数与**四维逐项负控制**：
```
as-is                        -> {"shape":"plan","complete":true,"artifacts":{"proposal":true,"plan":true,"ac":true,"dod":true},"missing":[]}
减去 ## Definition of Done   -> {"shape":"plan",…,"dod":false,"missing":["dod"]}
减去 ## Proposal             -> {"shape":"plan",…,"proposal":false,"missing":["proposal"]}
减去 ## Acceptance Criteria  -> {"shape":"plan",…,"ac":false,"missing":["ac"]}
钝化 Plan 正文(<40 非空白)   -> {"shape":"plan",…,"plan":false,"missing":["plan"]}   ← 只钝化正文，保留标题
```
⚠️ **负控制的一处例外（据实记录）**：直接删掉 `## Plan` **标题**不会报 `plan:false`，而是把 shape **重新派发**成 `proposal` ⇒ `{"shape":"proposal","complete":true,…}`。该维度的负控制必须钝化 Plan 的**正文**（保留标题、正文 < 40 非空白），如上表末行。这本身是「shape 派发在起作用」的正面证据。

## Touches

- `plugin/scripts/promotion-driver.ts`
- `plugin/scripts/driver-filters.ts`
- `plugin/test/promotion-driver.test.mjs`
- `plugin/test/driver-filters.test.mjs`
- `.quay/profiles.yml`
- `tasks/gap-fix-worker-timeout-budget-inherited-from-mechanical-round.md`

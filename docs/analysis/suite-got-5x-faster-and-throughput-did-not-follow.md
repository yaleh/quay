# 套件快了 5 倍，吞吐没有跟上——一次基于遥测载体的定量复核

> 2026-09-14。目的：把 `docs/references/` 里几条一直只有定性论证的主张，放到本项目自己的
> 遥测载体上量一遍。结论分三档：**已量出**（有读数、有窗口、可复跑）/ **被自己的读数推翻**
> （包括本文作者当场犯的两个错）/ **结构上还量不了**。
>
> 全部读数取自 `.quay/*.jsonl` 与 `git log develop`，窗口 2026-08-11 → 2026-09-14。
> ⚠️ 高分辨率遥测最早只到 2026-08-11，更早的历史只能靠 git（粒度到「周 + 行数」），
> 任何耗时/延迟类结论都不要往 8 月之前外推。

## 0. 数据面盘点（先盘载体，再设计指标）

| 载体 | 条数 | 窗口 | 能回答什么 |
|---|---|---|---|
| `measure-history.jsonl` | 503,380 | 08-12 → 09-14 | 按**测试文件**粒度的耗时/通过 |
| `promotion-round.jsonl` | 43,323 | 08-22 → 09-14 | 晋升轮 |
| `promotion-outcome.jsonl` | 41,977 | 08-22 → 09-14 | 每次晋升判定的结果 |
| `gate-events.jsonl` | 96,779 | 08-12 → 09-14 | 闸判定 pass/fail |
| `checker-cost.jsonl` | 94,668 | 08-11 → 09-14 | 每个 checker 的单次耗时 |
| `worker-round.jsonl` | 17,994 | 08-23 → 09-14 | worker 轮 |
| `verification-round.jsonl` | 1,678 | 08-12 → 09-14 | 每轮套件时长/绿红/lane |
| `fan-in-step-trace.jsonl` | 12,308 | **09-04** → 09-14 | fan-in 分步耗时（有缺口，见 §5） |
| `worker-outcome.jsonl` | 1,896 | 08-23 → 09-14 | 每次 worker 执行的墙钟与终态 |
| `fan-in-lock-events` + `fan-in-merge-lock-events` | 2,311 + 2,554 | — | 锁获取/释放（本次未展开） |

## 1. 已量出：套件快了 5 倍，吞吐没有跟上

`verification-round.jsonl` 按天聚合，中位套件时长：

| 时期 | 中位时长 | 每日轮数 |
|---|---|---|
| 08-18 ~ 08-21 | **14.6 – 17.2 min** | 33 – 45 |
| 09-06 ~ 09-11 | **3.1 – 4.3 min** | 56 – 115 |

同期「每日落地任务数」（直接量 = `git log develop` 上 `翻 … done` 的提交数，全窗口 940 次）
并没有随之系统性上升。日粒度相关性（n=34 天）：

```
corr(中位 suite 时长, 当日落地数)     = −0.11      ← 基本无关
corr(当日 suite 轮数,  当日落地数)     = +0.57
corr(中位 suite 时长, 当日 suite 轮数) = −0.37
```

**⊢ 「把测试跑快就能提高迭代速度」在这一个月的数据里不成立。** 派生指标「每落地任务的
验证成本」确实降了（138 min @08-12 → 13–18 min @8 月中 → **5–8 min** @9 月），但那是
成本下降，不是吞吐上升。

## 2. 已量出：熔融 → 结晶是一次可见的相变

`git log develop --numstat` 按周聚合，净增行数（加 − 删）分类统计：

| 周起 | code : doc 净增比 |
|---|---|
| 07-13 | **1 : 6.8**（与 `exp5-crystallization-strategy.md` 当时诊断的 1:9.38 同量级） |
| 07-20 | 1 : 1.5 |
| 07-27 | 1 : 0.7 ← 反转 |
| 08-03 | 1 : 0.3 |
| 08-17 | **散文净 −1,810 行**，代码净 +32,847 ← 真的发生过收缩 |
| 08-24 | 1 : 0.1 |
| 09-07 | 1 : 0.0 |

**⊢ 这是 ADR-008「呼吸」里收敛相的第一份连续曲线证据**——不是快照，是 10 周轨迹，
且中间有整整一周散文是净负的。注意这不等于 ADR-008 的**切换规则**被验证：收缩仍然
全部由人发起（见 `crystallization-the-contraction-phase-has-no-mechanism.md`），
本图只证明「收缩发生过且可测」，不证明「机制会自己触发收缩」。

## 3. 已量出：返工倍数中位 2 次

`worker-outcome.jsonl`：703 个不同任务、1,896 次 worker 执行。

| 一次落地 | 2 次 | 3 次 | 4 次 | 5 次 | ≥6 次 |
|---|---|---|---|---|---|
| 303 (43%) | 165 | 77 | 55 | 37 | 66 |

中位 2 次，p90 = 5 次，最高 **27 次**（`gap-retire-session-liveness`）。

## 4. 已量出（意外）：最贵的「验证」不是测试，是晋升闸

`checker-cost.jsonl`，145 个 checker，累计 217 小时：

| checker | 调用 | 中位 | 累计 | 占比 |
|---|---|---|---|---|
| **`ready-pool-check`** | **75,571** | 9.5 s | **212.7 h** | **97.8%** |
| 其余 144 个合计 | ~19,000 | — | 4.3 h | 2.2% |

作为对照，同期**整个测试套件**累计约 231 小时。**晋升闸的开销和跑完所有测试一样贵。**

而且在加速增长（调用数与单次时长同时涨，单次时长涨是因为它是 O(池大小)）：

| 时期 | 调用/天 | 中位 | 累计/天 |
|---|---|---|---|
| 08-12 ~ 08-22 | ~300 | 2.7 s | 0.1 – 0.7 h |
| 08-23（driver 化） | 2,520 | 4.7 s | 3.7 h |
| 09-11 | 6,316 | 11.4 s | **19.0 h** |
| 09-13 | 4,780 | 13.0 s | **17.3 h** |

三周涨 5 倍。可并发，所以不等于占满单核，但已是约 1 核持续占用，且**没有任何判据在盯它**。

## 5. 被自己的读数推翻：本文作者当场犯的两个错

这一节是刻意保留的——它们是「先盘载体再下结论」这条纪律的现成实例。

**错误一：把「fan-in 耗时几乎全是排队」说死了。**
分步耗时显示 8 个步骤合计中位仅 ~2 min（`scoped-gate` 76 s 占 53%、`doc-check` 29 s、
`merge-develop` 25 s），而单次 fan-in 端到端中位 **9.7 min**、p90 **154.6 min**、最大 693 min。
初稿据此断言「75% 以上是等待」。

**2026-09-14 第二版：缺口已拆开，初稿错在【读法】，不在数据。**
根因不是「suite 没写进载体」（§6 旧表述如此，已随之更正），而是**这个载体上有两套互不相交的
时长读法**：8 个步骤靠 `step-begin`/`step-end` 配对算，4 个 suite 决策步只有 `step-end`
（它们是**单发决策事件**，不是区间，本就没有可配对的 begin）——**配对读法对它们恒返回「无数据」，
而「无数据」与「这一步不存在」同形**。初稿用的正是配对读法，于是把一个**存在**的数据读成了
**缺席**（这正是硬规则 3b 的字面实例）。修法：`step-end` 一律自带 `durationMs`，不依赖配对
（`worker-driver.ts` `appendFanInStepTrace`；见 §6）。

按新读法复算，窗口 09-04 → 09-14 的真实读数（全部取自生产载体，`n=757` 次同时有 suite 与
acquire→release 锁段的 fan-in，非 fixture）：

| 量 | 定义（载体） | 中位 | p90 |
|---|---|---|---|
| 锁段端到端 | `fan-in-lock-events.jsonl` 的 acquire→release | **382 s** | 668 s |
| 其中 **suite** | `fan-in-step-trace.jsonl` `step-end[step=suite-end].durationMs` | **312 s** | 600 s |
| 其中其余 8 步 | 同载体的 begin/end 配对之和 | 133 s | 205 s |

**⊢ suite 一步就占锁段的 80%（按每次 run 的比值取中位）；其余 8 步合计 35%。**
**⊢ 锁段内没有大块空白**：「8 步 ≈ 2 min vs 端到端 9.7 min」这个缺口，绝大部分**就是 suite
本身**，不是排队。**初稿「75% 以上是等待」是错的，且错的方向是低估了 suite。**

**⊢ 独立载体交叉核对**：`verification-round.jsonl` 同期（09-04+，n=730）套件时长中位 253 s，
本载体的 suite 读数中位 312 s——**同一量级（差 19%）**。两者口径不同（前者含第三方路径与分泳道
记录），⛔ 因此不要把二者的差值当结论，只用它证「两个独立读法没有互相矛盾」。

**仍然量不出来的那一半（诚实标注）**：**锁外**的等待——一次 fan-in 从「决定要跑」到「真正拿到
锁」之间的时长——**没有任何载体记录**（`fan-in-lock-events.jsonl` 只有 `acquire`/`release`
两种事件，没有「开始等待」）。所以「排队占多少」目前只能回答**锁段内 ≈ 0**，不能回答整段
端到端。要补这一半，需要给 `acquire-fan-in-lock` 也写 begin/end——它是**真区间**，与上面那 4 个
决策事件不同类（见 §7）。

**错误二：把一个已修复的缺陷当成现存缺陷。**
初稿断言「机械 fan-in 不写 `complete` GateEvent（396 条 vs 940 次落地）」。按天拆开后：

| 窗口 | complete 事件 / git 落地 |
|---|---|
| 08-20 ~ 09-03 | **0%**（14 天全零） |
| 09-04 ~ 09-14 | **74% – 100%** |

`gap-mechanical-fan-in-writes-no-complete-gateevent` 已于 09-02 落地实现、09-04 翻 done。
**全期聚合掩盖了一次真实修复。** 残留的是「修复后仍有约 20% 落地不写该事件」，
这是个小得多、且形状不同的问题。

⊢ 两个错误同源：**都在没有分时间窗、没有核对载体覆盖面的情况下，把聚合数字当成当前状态。**

## 6. 载体自身的完整性缺口（已按实测修正表述；其中一条已修，修复时又露出第二条）

> **本节的用法**：任何「按载体统计吞吐/完成数」的结论，先读这张表——四行里有三行会让读数
> **与某个正常或异常状态同形**（硬规则 3b/4b），而其中一行的根因是**口径**而非载体。

| 缺口 | 实测 | 影响 |
|---|---|---|
| ~~`worker-outcome.final_state` 有死取值 `landed`~~ → **已修**（`gap-worker-outcome-final-state-landed-is-a-dead-value`） | 死取值全库 **1** 条（2026-08-28，手工 fan-in 手写落盘，⛔ 非代码所写）；真实成功态是 `completed`。**修复** = 词表闸 `assertFinalState` 挂在唯一落盘点 `appendOutcomeToFile` 上（词表外取值写不进去）+ 载体正本写明「成功态 = `completed`」 | 修复前：拿 `landed` 统计吞吐会得到「吞吐 ≈ 0」（与「系统停摆」同形）。修复后仍**不能**靠词表外的取值读数——闸只保证「不再写进去」，⛔ 不追改历史那条 |
| **（读数口径陷阱，修 `landed` 时当场发现）** 用 `git log \| grep '翻 … done'` 的**提交数**当地落数会**高估** | 同一任务可在一天内被多次翻 done ⇒ 09-09 提交 **71** 条 vs 去重任务 **54** 个（重复 17），09-10 54/44，09-11 43/34 | 提交数当分母 ⇒ 偏差被抬到 17.8–49.4%（看起来像「载体漏记」）；改用**去重任务数** ⇒ 同一窗口偏差 ≤4.8%。**这是同一个缺陷的另一张脸：口径错 ⇒ 读数与某异常态同形** |
| `fan-in-step-trace` 孤儿 `step-end` | 09-14 现场：2,150 / 7,353 = **29%**，**100% 集中在 4 个 suite 决策步**（`ac-precheck` 713、`suite-start` 713、`suite-end` 709、`suite-skip` 15），其余 8 个步骤孤儿率 **0%** | **这条的旧表述（「suite 结构上不可测时长」）已于 09-14 更正**：孤儿是真的，但它不是「数据不在」——那 4 条 `step-end` **自带时长**，是**配对读法**看不见它们（详见 §5 错误一第二版）。修法是让 `step-end` 一律自带 `durationMs`（12 组统一），**不是**给这 4 步补一个「写下去就立刻被配掉」的 begin——那种 begin 结构上不可能与 end 分离，是给孤儿率看的样子，不是挂起检测（硬规则 4）。另：`gap-fan-in-step-trace-suite-step-stopped-writing` 曾称这批步骤「整体停写」，与盘上实际（`step-end` 一直在写）不符，已在该任务体里更正 |
| `complete` GateEvent 覆盖率 | 修复后 74–94%，非 100% | 用它统计完成数会少 6–26% |

## 7. 还能做什么

**数据已就位、可立刻做：**
1. **排队论建模**——`fan-in-lock-events` + `fan-in-merge-lock-events` + 端到端时长，
   用 Little's law 回答「加并发能否提吞吐，还是只会加长队列」。§1 与 §5 都把矛头指向这里，
   优先级最高。
2. **验证的边际收益**——`gate-events` 96,779 条带 pass/fail 的判定 × `checker-cost`，
   算**每拦下一个缺陷的成本**。这正是 ADR-005「验证是绑定约束」从来只有定性论证的那个量。
3. **结晶半衰期**——规则落笔日期 → 其可执行强制落地日期，git 可直接算；把 ADR-004
   的「散文会被侵蚀」从故事变成分布（中位多少天、多少条至今无产物）。
4. **返工预测因子**——§3 的返工次数对任务属性（Touches 宽度、有无 `goal_ac`、shape、
   立案者）回归。

**需要先补仪器：**
5. **锁外等待（fan-in 排队）**——§5 错误一第二版把锁段内的构成拆开了（suite 80%），但
   「决定要跑到拿到锁」这一段仍**无载体**：`fan-in-lock-events.jsonl` 只有 acquire/release。
   最小补法是在 `acquireFanInLock` 前后各写一条 `acquire-fan-in-lock` 的
   `step-begin`/`step-end`（**它是真区间**，与 4 个单发决策事件不同类），并把它加进
   `instrument-decay-check.ts` 的 MANIFEST `expected`。补上它，「排队占多少」才第一次可算。
6. **缺陷发现延迟**——每个 gap 任务的「缺陷引入时刻（git blame）→ 立案时刻」配对，
   给硬规则「频率 × 静默」一个定量版本。现无现成字段。
7. **谁先发现**（人 / 循环 / 套件）——`维度边界与结晶.md` §2.1 的 n=5 需要扩到几百例，
   要从任务体抽取发现路径。

**结构上做不了：** 08-11 之前无遥测；连续数学（Fisher / 本征维度 / ρ）这次没有任何一个
分析需要它，顺带又给 ADR-006 添一条负面证据。

## 附：可复跑锚点

- 落地数直接量：`git log develop --format='%ai|%s' | grep -E '翻.*done|→ *done'`（940）
- 套件时长：`.quay/verification-round.jsonl` 的 `startedAt`/`durationMs`/`laneCount`
- 熔融↔结晶：`git log develop --numstat`，按 `tasks/` / `adr/` / `*.md` / `*.{ts,js,mjs,sh,py}` 分类
- 返工：`.quay/worker-outcome.jsonl` 按 `task` 计数
- **吞吐（成功态 vs 落地数）——⚠️ 口径见 §6 第二行，⛔ 别用提交数**：成功态 = `final_state == "completed"`；
  落地数 = `git log develop` 里 `^tasks: 翻 <id> done（` 的**去重任务数**（同一任务一天内可被翻 done 多次）。
  可复跑（粘贴即用，读生产载体 + git，无 fixture）：
  ```bash
  python3 - <<'PY'
  import json,subprocess,re,collections
  comp=collections.defaultdict(set)
  for line in open('.quay/worker-outcome.jsonl'):
      line=line.strip()
      if not line: continue
      r=json.loads(line)
      if r.get('final_state')=='completed' and r.get('task'): comp[(r.get('ts') or '')[:10]].add(r['task'])
  byday=collections.defaultdict(set)
  for l in subprocess.run(['git','log','develop','--format=%aI|%s'],capture_output=True,text=True).stdout.splitlines():
      iso,subj=l.split('|',1)
      m=re.match(r'^tasks: 翻 (\S+) done（',subj) or re.match(r'^tasks: 翻 (\S+)（',subj)
      if m: byday[iso[:10]].add(m.group(1))
  print(f"{'日(UTC)':12}{'去重落地':>9}{'completed':>10}{'偏差':>8}")
  for d in sorted(set(comp)&set(byday))[-7:]:
      a,b=len(byday[d]),len(comp[d])
      print(f"{d:12}{a:9d}{b:10d}{abs(b-a)/a*100:7.1f}%")
  PY
  ```
  实测（2026-09-14 读数）最近 7 个完整 UTC 日 **09-08 → 09-14** 偏差 =
  **4.8% / 0.0% / 2.3% / 2.9% / 0.0% / 0.0% / 0.0%**（全部 <10%）。
  ⚠️ 窗口敏感，如实记录：同一判据在 08-23…08-31 与 09-06 上是 12–29%（**未归因**——无对照，
  不声称成因）；载体本身从 08-23 起才有 `final_state`。故「<10%」是**最近窗口**的性质，⛔ 不是全载体的性质。
- 验证税：`.quay/checker-cost.jsonl` 的 `name`/`ms`/`at`
- 分步时长（§5 错误一第二版）——**读 `step-end` 自带的 `durationMs`，⛔ 不要配对 begin/end**：
  ```bash
  # 每组步骤的时长分布（12 组统一；suite 那 4 组只有 end，配对读法对它们恒空）
  jq -rc 'select(.event=="step-end" and (.durationMs|type)=="number") | [.step,.durationMs] | @tsv' \
    .quay/fan-in-step-trace.jsonl | awk '{a[$1]=a[$1]" "$2} END{for(k in a) print k, a[k]}'
  # 锁段端到端：.quay/fan-in-lock-events.jsonl 的 acquire→release 配对（⚠️ epoch 是【秒】）
  ```
- ⚠️ `fan-in-step-trace.jsonl` 的 `epoch` 字段单位是**秒**不是毫秒（初稿在此栽过一次）
- ⚠️ **配对读法已废弃**：对 4 个 suite 决策步（`ac-precheck`/`suite-start`/`suite-end`/`suite-skip`）
  它恒返回「无数据」，而那不是「没跑过」——初稿正是这样把一个存在的数据读成了缺席（§5 错误一）。

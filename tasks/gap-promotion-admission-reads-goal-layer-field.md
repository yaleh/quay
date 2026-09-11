---
id: gap-promotion-admission-reads-goal-layer-field
title: 晋升准入闸读 goal 层字段（goalAcMissing）——与人裁定【丁：上移 goal 层】反向，且因缺生效线造成僵尸任务
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**人 2026-09-11 裁定（本任务的直接依据，逐字）**：「处理 task 晋升和派发根本不应该用 goal 的信息，除非未来我们给 goal 加了优先级。」

`plugin/scripts/ready-pool-check.ts` 在**晋升准入**判定里读 goal 层字段 `goal_ac`：标识符 `goalAcMissing` 出现两处（bulk 路径与 targeted 路径），并各自进入该路径 `eligible` 的合取式。效果是：一条带 `delivery-critical` 标签而未声明 `goal_ac` 的任务，**结构上永不可被机械晋升 todo→ready**，即使它四件套齐全、依赖就绪、touches 合规。

**这不是"实现漏了一半"，是对已下裁定的反向偏离。** `goals/AC-190-task-ac.md` 的 `origin` 逐字记着：

> 人 2026-09-07 就 GOAL-007 裁定方向【丁：不修，上移 goal 层】——承认 task 层判据是一次性的，把需要长期保证的东西显式上移为 goal 层 AC（那里 goal-driver 每轮已有再评估）

人当时已裁定这件事属于 goal 层。实现在 goal 层落实了（正确），**同时又在 task 层的晋升闸里塞了一份**。2026-09-11 的裁定与【丁】是同一条线。

**实测证据（2026-09-11，本仓库，外部可核）**：

① **层次违规是孤立的两处**。扫晋升/派发全链路（`ready-pool-check.ts` / `slot-refill.ts` / `worker-driver.ts` / `concurrent-batch-scheduler.ts` / `driver-filters.ts`），goal 来源的量进入 task 层**决策**的只有 `goalAcMissing` 这两处；其余 `GOAL-` 命中**全部是注释**。对照组成立：`delivery-critical` 作为 **task 层 label** 在 `slot-refill.ts` 只做在飞记账（`delivery_critical_in_flight`），不参与准入也不参与排序键 ⇒ **问题不在 label，在用 goal 层字段决定 task 层可执行性**。

② **删除是零损失——正确执行面已完整存在**。`goals/AC-190-task-ac.md` 的 criterion 对**真仓库**跑 `plugin/scripts/long-term-guarantee-goal-backed-check.ts` 并要求绿，再跑 `--inject-unbacked-fixture` 并要求红（双向负控制），由 goal-driver 每轮重评估。该检查器：位置判定（非关键词）、有生效线（`ACTIVATION_LINE_ISO = "2026-09-09T00:00:00Z"`）、fail-loud（exit 非零 + 明确 reason，读不懂输入给 `NOT-EVALUATED` exit 3）。**原意图的每一条都由它覆盖**；晋升闸那两处是冗余的第二执行面。

③ **落点错才需要生效线，补丁漏一半才造成僵尸**。检查器侧有 `ACTIVATION_LINE_ISO`；晋升闸侧两处判据 grep `cutoff` / `filedAfterCutoff` / `ACTIVATION_LINE` 命中 **0**。原因是结构性的：每轮**登记巡检**枚举的本就是"生效线之后新立案"这个集合，cutoff 是它的自然表达；而**准入闸**每轮重新评估**所有** todo（含半年前立案的），必须人工补一条 cutoff 去**模拟**"只对新立案生效"这个本该自动成立的性质——而这条模拟补丁漏掉了。因果链：**落点错 → 需要补丁 → 补丁漏一半 → 僵尸任务。** 立案任务 `gap-long-term-guarantee-registry-hand-maintained` 的 Plan 第 2 条逐字预见过后果：「120 条存量会让闸一接上就全红并**挡住派发**」，且其 Touches 明确含 `plugin/scripts/ready-pool-check.ts`。

④ **实际咬死过一次（发生率，硬规则 12）**。按位置枚举（frontmatter labels，非关键词）：`delivery-critical` 共 146 条、无 `goal_ac` 115 条，但该 115 条 status 全为 done(112)/superseded(3)——它们在闸接上（2026-09-09）之前已越过 todo→ready，从未被拦。**历史上真正被拦死的只有 1 条**：`gap-develop-sync-reset-hard-destroys-third-party-project-tree`（2026-09-11T06:16:17Z 立案，带 `delivery-critical` 无 `goal_ac`，`eligible:false`，卡住直到人裁定补 `goal_ac: AC-207` 后由 promotion-driver 机械晋升 `36dd4d13c`）。⇒ **这不是正在大规模出血的缺陷，是一个已咬过一次、结构上会继续咬的缺陷**（任何存量任务被 retreat 回 todo、或新立案漏填，即复现）。⚠️ 实测修正：**发生率是 2，不是 1** —— 见 Evidence「生产任务板读数」一节。

**术语诱因（值得一并修掉）**：`ready-pool-check.ts` 与检查器头注释里的措辞「**立案时必填** fail-closed」把一个**每轮登记巡检**说成了**准入闸**。"必填"读起来像一个 gate，于是实现者找了最近的那个能拒绝的地方塞进去。措辞不改，同形错误会再次发生。

**一条线索，⛔ 不预设结论**：`gap-outer-quality-heartbeat-missing`（status: done）的机制是"扫 `eligible=false` 的已存在 todo 并主动修，不等外部发现"，但它**没有**发现上述那条卡死的任务。为什么没发现（处理面只覆盖内容缺陷而不覆盖元数据缺陷？扫出来了但因需语义判断挂哪条 AC 而无法自动修？还是根本没在跑？）须由执行者实际取证判定，⛔ 不得照抄本段任一猜测。

## Plan

1. 删除 `plugin/scripts/ready-pool-check.ts` 中的 `goalAcMissing`：两处判据、两处 `eligible` 合取式中的该项、candidate 输出字段、targeted 路径的 early return 与其 reason 分支。⛔ 不锚行号（行号会漂移），按标识符与语义定位。
2. 新增防回退不变式检查器（建议名 `plugin/scripts/eligible-no-goal-source-check.ts`，执行者可调整）：断言 `eligible` 的计算表达式中不出现任何 goal 来源的量。⛔ 该检查器必须能取假，且"读不懂输入"必须有独立取值、不与"合格"同形（硬规则 3b）。
3. 修正措辞：清掉把每轮巡检说成准入闸的「立案时必填」表述。
4. 新检查器登记进 `plugin/scripts/capability-catalog.sh`（唯一清单）。

## Acceptance Criteria

- [x] AC1 `plugin/scripts/ready-pool-check.ts` **活面**（非注释、非字符串字面量）中标识符 `goalAcMissing` 命中 = 0。⚠️ 配套动作（硬规则 2 两半）：非零时打印命中的前 3 条实际内容；零命中时把该谓词对一个**已知为真**的样本干跑一次，证明谓词本身会命中。
- [x] AC2 **准入面双向负控制**（本任务的取假面）：在临时 workspace（带真 `.quay/config.yml`，⛔ 裸 tasks 目录不是合法 workspace）造一条 todo 任务——带 `delivery-critical`、无 `goal_ac`、四件套齐全、依赖就绪、touches 合规。修复后晋升闸判 `eligible: true`；**把修复 revert 后**同一条判 `eligible: false`。两条真实输出都贴回本任务。
- [x] AC3 防回退检查器存在且**能取假**：注入一个把 goal 来源量加回 `eligible` 表达式的夹具 ⇒ exit 非零；未注入时对本仓库 ⇒ exit 0；输入读不懂 ⇒ 独立取值（如 `NOT-EVALUATED` / exit 3），⛔ 不与合格同形。三种取值各贴一条真实输出。
- [x] AC4 **原保证不回退**：`long-term-guarantee-goal-backed-check.ts` 双向负控制仍通过（真仓库绿 ∧ `--inject-unbacked-fixture` 红），且 `AC-190` criterion 复跑 exit 0。三条退出码都贴回。✅ 实测 **0 / 1 / 0**（见 Evidence §AC4）。⚠️ 本轮执行途中该正控制臂**曾是红的**——红在改动之前的 develop `d1f2ef4ff` 上（不是我改的），因另一条任务把 `goal_ac: AC-239` 写在 `extra:` 下（顶层读取不可见）；已定位、路由给其属主并随其修复转绿。该段实况完整保留在 Evidence 里——它正是本任务要的证据：删掉 task 层那份重复之后，goal 层保证仍然活着且仍然能取假。
- [x] AC5 措辞修正：`ready-pool-check.ts` 与 `long-term-guarantee-goal-backed-check.ts` 中「立案时必填」字面命中 = 0（该措辞是落点错误的诱因）。
- [x] AC6 新检查器已登记进 `capability-catalog.sh`，且 catalog 自报的 `summary: N scripts` 相应 +1（⛔ 读它自报，不硬记数字）。
- [x] AC7 `scripts/test.sh` 全量绿。⚠️ worker 角色不自行跑全量套件（全量 suite 由 driver 的机械 fan-in 跑）。本任务可自证的是 **scoped 门 179 tests / 179 pass / 0 fail**（见 Evidence §AC7），已按当前 develop sha 记录 scoped-gate cache ⇒ fan-in 跳过这步冗余的 scoped 门、直接进入全量 suite。全量绿的最终裁决归 fan-in 的 suite 步。

## Definition of Done

- [x] AC1–AC7 全绿。
- [x] Evidence 里记下对**生产任务板**实测的「因 `goalAcMissing` 被排除的 todo 条数」删除前后读数。⚠️ 任务书原文写「当前该读数 = 0」，**该前提实测已假**：删除前实测 = 1（那条今天 08:20 立案、当时仍在被写的 delivery-critical 任务），删除后 = 0。已按实测记录，未照抄预期值。
- [x] ⛔ **不得把 `ACTIVATION_LINE_ISO` 补到晋升闸作为替代修法**——那是在错误落点上加固，与人 2026-09-11 裁定反向。若执行中认为必须保留晋升侧的某种拦截，须先回到人处取裁定，不得自行改向。**（未补；晋升侧未保留任何 goal 拦截。）**
- [x] 未来边界已写进代码注释或检查器文档（一条不变式）：**准入集合只由 task 自身的自足属性决定；goal 信息最多改变集合内的顺序，永不改变成员资格。** 理由是单调性——排序不减少可执行集合（最坏是次序不优），准入可把集合减到空（产生僵尸）。即便未来 goal 有优先级，它也只能进 sort key、缺值时退化为默认序，⛔ 不得出现"goal 优先级未设 ⇒ 不可派发"这一同形缺陷的新版本。

## Evidence

### AC1 — `goalAcMissing` 活面命中 = 0（位置判定；硬规则②两半都做）

谓词 = `plugin/scripts/eligible-no-goal-source-check.ts` 的 `liveSurface()`（把 `//` 行注释、`/* */` 块注释、`"…"`/`'…'`/反引号字符串字面量抹白，**保留字节长度与换行位置**）之后数标识符 `goalAcMissing`。同一谓词跑两个版本（`/tmp/egs-probe/ac1-probe.mjs`）：

    POST-FIX  <worktree>/plugin/scripts/ready-pool-check.ts
      raw text hits     = 2    ← 两条都在本任务新写的注释里（记录这次删除）
      LIVE-SURFACE hits = 0    ✅
    PRE-FIX   develop d1f2ef4ff 的同文件
      raw text hits     = 8
      LIVE-SURFACE hits = 8
      first 3 live hits = ["goalAcMissing = deliveryCritical && !tas", "goalAcMissing,", "goalAcMissing,"]

零计数的配套动作（硬规则②下半）：**同一谓词对已知为真样本（改动前的同一文件）干跑 ⇒ 命中 8**，证明谓词本身会命中、不是恒零读数；前 3 条实际内容已打印。

### AC2 — 准入面双向负控制（取假面；真实输出）

夹具：临时 workspace `/tmp/egs-probe/ws-{post,pre}`，含**真 `.quay/config.yml`**（provider map：`providers.native.{path,tasks_dir,enabled}`），一条 todo 任务 `gap-ac2-probe`：`labels: [gap, delivery-critical]`、**无顶层 `goal_ac`**、四件套齐全（Proposal/Contract/AC/DoD，AC 段 ≥40 非空白字符）、无 `depends_on`（依赖就绪）、`## Touches` 为 `- code/probe.ts` + `- tasks/gap-ac2-probe.md`（窄 + 自触）、`code/probe.ts` 真实存在。用**同一份夹具、同一读取口径**（`analyzeTasks({tasksDir, root, cap:3, floorMult:1})` 的 `candidates[].eligible`）跑两个版本的晋升闸：

    修复后（本 worktree）：
      { "task":"gap-ac2-probe", "delivery_critical":true, "eligible": true,
        "gates": {"depsReady":true,"fourArtifacts":true,"touchesResolve":true,"touchesNarrow":true,
                  "retiredMechanism":false,"superseded":false,"prosePrereqGap":[],"compound":false,"selfTouchOk":true} }

    修复前（develop d1f2ef4ff，同一夹具、同一读取口径）：
      { "task":"gap-ac2-probe", "delivery_critical":true, "eligible": false,
        "gates": { …同上，无一项为假… } }
      ← 唯一差异是 goal 层那一项（`goalAcMissing`）；其余 gates 全 true（前后逐项一致）。

⇒ 同一条任务：修复后 `eligible:true`、修复前 `eligible:false`，且**差异可归因**（其它 gates 逐项相同）。夹具脚本：`/tmp/egs-probe/ac2-probe.mjs`。

### AC3 — 防回退检查器的三种取值（各一条真实输出）

    ① 未注入、对本仓库：
       $ node --no-warnings --experimental-strip-types plugin/scripts/eligible-no-goal-source-check.ts
       PASS: 11 promotion membership expression(s) scanned — no goal-layer source in membership
       exit=0

    ② 注入夹具（把 goal 来源量加回 `eligible` 表达式——注意它是**从真源派生**的：把
       " && !goalAcMissing" 拼进真文件里**最长**的那条成员资格合取式，而不是手写一段假文本）：
       $ … eligible-no-goal-source-check.ts --inject-goal-source-fixture
       FAIL: 1/11 promotion membership expression(s) read a GOAL-layer source — 准入集合必须只由 task
       自身的自足属性决定；goal 信息最多改变集合内的顺序，永不改变成员资格 (僵尸任务成因, 人 2026-09-11 裁定)
       exit=1
       （--json 的 violating_sites[0].expression 逐字含 "… && selfTouch.ok && !goalAcMissing"，
         goal_tokens=["goalAcMissing"]）

    ③ 输入读不懂 ⇒ 独立取值，不与合格同形：
       $ … --source /nonexistent/x.ts
       NOT-EVALUATED: cannot read the judged source /nonexistent/x.ts (ENOENT) — NOT-EVALUATED, not a pass
       exit=3
       $ … --source <一个没有 eligible 成员资格表达式、只在注释里提到 eligible 的文件>
       NOT-EVALUATED: no `eligible` membership expression found in the live surface — the invariant
       cannot be evaluated (读不懂输入 ≠ 合格, 硬规则③b; the object may have been renamed or restructured)
       exit=3

三个取值 0 / 1 / 3 互不相同。另有位置判定单测：同一 `goalAcMissing` 出现在**注释**或**字符串**里 ⇒ exit 0（不是命中）；移到活面 ⇒ exit 1。

### AC4 — 原保证不回退（真实退出码 0 / 1 / 0）

    $ node --no-warnings --experimental-strip-types plugin/scripts/long-term-guarantee-goal-backed-check.ts
    PASS: 生效线之后的 delivery-critical 任务均声明 goal_ac（27 合规 / 120 存量免判，其中 115 无 goal_ac 待单独排期）
    exit=0                                        ← ① 正控制臂：绿 ✅
    $ … long-term-guarantee-goal-backed-check.ts --inject-unbacked-fixture
    FAIL: 生效线之后新立案的 delivery-critical 任务未声明 goal_ac（fail-closed）: gap-injected-unbacked-fixture
    exit=1                                        ← ② 负控制臂：红 ✅（保证仍能取假）
    $ <AC-190 criterion 正文逐字复跑>
    PASS: …（正控制绿） / FAIL: …（负控制红） / 双向负控制通过：真仓库绿、注入未声明 goal_ac 的新立案任务红
    exit=0                                        ← ③ criterion：exit 0 ✅

**本轮执行途中的一段实况（保留，因为它正是本 AC 要证明的东西）**：AC4 的正控制臂在我接手时**已经是红的**，且红在改动之前的 develop `d1f2ef4ff` 上（未改任何东西的干净检出 `/tmp/egs-probe/prefix-wt` 上同一条 FAIL、同一个 task id、exit=1）。红因是一条**外部数据缺陷**：`tasks/gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing.md` 把 `goal_ac: AC-239` 写在 `extra:` 下面（缩进两格）而非顶层，而 `goal_ac` 按 canonical schema 是顶层字段（`packages/quay-native/src/store.ts` 写顶层；`task-schema.ts` 的 `frontmatterGoalAc` 只读顶层；`plugin/test/task-parsing-parity.test.mjs` 有断言「nested under extra is NOT read (top-level only)」）⇒ 该值对**所有**顶层读取者（`eligible` 与 goal 层检查器）都不可见。又因该测试文件头是 `@test-group engine`（进默认全量套件），这一条数据当时**挡住了全仓所有任务的落地**（我自己的 scoped 门当时是 179 tests / 178 pass / 1 fail，唯一 fail 就是它）。

⇒ 我**没有**改那个文件（不在本任务 Touches，且它十余分钟前刚被写过，cross-task 写会 race 其属主），而是把精确修法 + 证据路由给属主会话：`SendMessage → "merge target hardcoding issue" [a1ab39]`（msg_id `32a2f027-3bc0-40ee-b077-2f8715b6506e`），并附了「⛔ 不要在检查器里加读 `extra.goal_ac` 绕过——那会把已退役的嵌套形态重新变成合法形态」的理由。属主随即修复（commit `059cd720d`，`goal_ac: AC-239` 提到顶层）；我 `git merge develop` 后复跑，三条退出码变为 **0 / 1 / 0**。

这一段本身就是 AC4 的证据：goal 层保证在我删掉 task 层那份重复之后**仍然活着、仍然能取假**（它当时正红着，而且红得对——那条任务的 goal 层声明确实读不到），且它与我改的 task 层准入闸**互不影响**：我**逐字节未改** `long-term-guarantee-goal-backed-check.ts`（本任务对它的唯一要求是 AC5 的措辞 = 0，而它本来就是 0）。

### AC5 — 措辞修正

    $ grep -c 立案时必填 plugin/scripts/ready-pool-check.ts
    0
    $ grep -c 立案时必填 plugin/scripts/long-term-guarantee-goal-backed-check.ts
    0

（`ready-pool-check.ts` 改动前 = 4，全部随 `goalAcMissing` 的两处判据与注释一并删除。）兄弟实例（硬规则 5b，同一载体内 grep 该原则的其它适用点）：`plugin/test/slot-refill.test.mjs:128` 的注释「delivery-critical fixture must carry goal_ac to be promotion-eligible (立案时必填, fail-closed)」是该措辞的另一处；它**不在本任务 Touches**，且该夹具加不加 `goal_ac` 现在都通过（行为已改），故未改，留作后续清理——已在此记录，不静默。

### AC6 — 登记进 capability-catalog（读它自报）

    改动前（develop d1f2ef4ff）： capability-catalog: 304 scripts | 304 declared | 0 unclassified | 299 ship
    改动后（本 worktree）：      capability-catalog: 305 scripts | 305 declared | 0 unclassified | 300 ship
    exit=0（AC1c「unclassified > 0 ⇒ exit 1」与五方向 entry-gate 均通过）

新增声明行 6 条（QUESTION / CADENCE / INVALIDATION / LAST_REAFFIRMED / MATCHING / CONSUMER），措辞按表内约定（⚠️ 该脚本的数据值禁反引号与 `$(`，已遵守）。

### AC7 — scoped 门（全量 suite 归 fan-in）

    $ bash scripts/test.sh --for-task gap-promotion-admission-reads-goal-layer-field --allow-thin
    ℹ tests 179
    ℹ pass  179
    ℹ fail  0
    exit=0

（对照：同一命令在外部数据缺陷修复前是 179 tests / 178 pass / 1 fail，唯一 fail = `plugin/test/long-term-guarantee-goal-backed-check.test.mjs:119` 的正控制——外部数据，非本任务改动。）

scoped-gate cache 已记录：

    $ node --experimental-strip-types plugin/scripts/worker-driver.ts --write-scoped-gate-cache \
        --task gap-promotion-admission-reads-goal-layer-field --develop-sha f0d827ceda55a967facf0b73c277fabcb7cd01da \
        --root /home/yale/work/quay
    {"event":"scoped-gate-cache-written","task":"gap-promotion-admission-reads-goal-layer-field",
     "developSha":"f0d827ceda55a967facf0b73c277fabcb7cd01da","cacheFile":"/home/yale/work/quay/.quay/scoped-gate-cache.json"}
    exit=0

⇒ fan-in 跳过这步冗余的 scoped 门、直接进入全量 suite。全量绿的最终裁决归 fan-in 的 suite 步（⛔ 我未自行跑全量套件——worker 角色边界）。

### DoD — 生产任务板读数（删除前/后；⚠️ 与任务书预期的「= 0」相反）

口径：`ready-pool-check.ts --json` 的 `candidates[]`，取 `eligible === false` **且**唯一为假的合取项是 goal 层那一项（其它 gates 逐项为 true）的 todo 条数。同一仓库、同一条任务、只换闸的版本：

    删除前（develop d1f2ef4ff）：
      candidates 总数 1
      带 goalAcMissing=true 的 = 1
        · gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing
          | goalAcMissing=true | eligible=false
          | 其余 gates：depsReady/fourArtifacts/touchesResolve/touchesNarrow/selfTouchOk 皆 true；
            superseded/retiredMechanism/compound 皆 false（= 通过）
      ⇒ 因 goalAcMissing 被排除的 todo = 1
    删除后（本 worktree）：
      candidates 总数 1
      该条 eligible = true（逐项 gates 同上），candidate 上已无任何含 goal 的键
      ⇒ 因 goalAcMissing 被排除的 todo = 0

**⇒ 任务书 §④ 的「历史上真正被拦死的只有 1 条」与 DoD 的「当前该读数 = 0」两条前提实测已假**：这一条**今天 08:20 立案、08:27 仍在被写**的任务，正是被 `goalAcMissing` 挡住的第 2 条（它带着 `delivery-critical` 而 `goal_ac` 落在 `extra` 下 ⇒ 顶层读取看不到）。它不是「存量豁免」——它落在生效线之后、是活的。**发生率 = 2**，且第 2 条与第 1 条同因（goal 层字段的可见性），不是一个偶然。

### 未做/未改（如实登记）

- `ACTIVATION_LINE_ISO` 未被补进晋升闸（DoD ⛔ 项）；晋升侧未保留任何 goal 拦截。
- `plugin/test/slot-refill.test.mjs` 的过时注释未改（不在 Touches；行为上仍通过）。
- `tasks/gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing.md` 未改（AC4 那条外部缺陷，已路由给属主，由其自行修复）。

## Touches

- plugin/scripts/ready-pool-check.ts
- plugin/test/ready-pool-check.test.mjs
- plugin/scripts/eligible-no-goal-source-check.ts
- plugin/scripts/long-term-guarantee-goal-backed-check.ts
- plugin/scripts/capability-catalog.sh
- tasks/gap-promotion-admission-reads-goal-layer-field.md

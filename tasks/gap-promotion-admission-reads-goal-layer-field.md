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

④ **实际咬死过一次（发生率，硬规则 12）**。按位置枚举（frontmatter labels，非关键词）：`delivery-critical` 共 146 条、无 `goal_ac` 115 条，但该 115 条 status 全为 done(112)/superseded(3)——它们在闸接上（2026-09-09）之前已越过 todo→ready，从未被拦。**历史上真正被拦死的只有 1 条**：`gap-develop-sync-reset-hard-destroys-third-party-project-tree`（2026-09-11T06:16:17Z 立案，带 `delivery-critical` 无 `goal_ac`，`eligible:false`，卡住直到人裁定补 `goal_ac: AC-207` 后由 promotion-driver 机械晋升 `36dd4d13c`）。⇒ **这不是正在大规模出血的缺陷，是一个已咬过一次、结构上会继续咬的缺陷**（任何存量任务被 retreat 回 todo、或新立案漏填，即复现）。

**术语诱因（值得一并修掉）**：`ready-pool-check.ts` 与检查器头注释里的措辞「**立案时必填** fail-closed」把一个**每轮登记巡检**说成了**准入闸**。"必填"读起来像一个 gate，于是实现者找了最近的那个能拒绝的地方塞进去。措辞不改，同形错误会再次发生。

**一条线索，⛔ 不预设结论**：`gap-outer-quality-heartbeat-missing`（status: done）的机制是"扫 `eligible=false` 的已存在 todo 并主动修，不等外部发现"，但它**没有**发现上述那条卡死的任务。为什么没发现（处理面只覆盖内容缺陷而不覆盖元数据缺陷？扫出来了但因需语义判断挂哪条 AC 而无法自动修？还是根本没在跑？）须由执行者实际取证判定，⛔ 不得照抄本段任一猜测。

## Plan

1. 删除 `plugin/scripts/ready-pool-check.ts` 中的 `goalAcMissing`：两处判据、两处 `eligible` 合取式中的该项、candidate 输出字段、targeted 路径的 early return 与其 reason 分支。⛔ 不锚行号（行号会漂移），按标识符与语义定位。
2. 新增防回退不变式检查器（建议名 `plugin/scripts/eligible-no-goal-source-check.ts`，执行者可调整）：断言 `eligible` 的计算表达式中不出现任何 goal 来源的量。⛔ 该检查器必须能取假，且"读不懂输入"必须有独立取值、不与"合格"同形（硬规则 3b）。
3. 修正措辞：清掉把每轮巡检说成准入闸的「立案时必填」表述。
4. 新检查器登记进 `plugin/scripts/capability-catalog.sh`（唯一清单）。

## Acceptance Criteria

- [ ] AC1 `plugin/scripts/ready-pool-check.ts` **活面**（非注释、非字符串字面量）中标识符 `goalAcMissing` 命中 = 0。⚠️ 配套动作（硬规则 2 两半）：非零时打印命中的前 3 条实际内容；零命中时把该谓词对一个**已知为真**的样本干跑一次，证明谓词本身会命中。
- [ ] AC2 **准入面双向负控制**（本任务的取假面）：在临时 workspace（带真 `.quay/config.yml`，⛔ 裸 tasks 目录不是合法 workspace）造一条 todo 任务——带 `delivery-critical`、无 `goal_ac`、四件套齐全、依赖就绪、touches 合规。修复后晋升闸判 `eligible: true`；**把修复 revert 后**同一条判 `eligible: false`。两条真实输出都贴回本任务。
- [ ] AC3 防回退检查器存在且**能取假**：注入一个把 goal 来源量加回 `eligible` 表达式的夹具 ⇒ exit 非零；未注入时对本仓库 ⇒ exit 0；输入读不懂 ⇒ 独立取值（如 `NOT-EVALUATED` / exit 3），⛔ 不与合格同形。三种取值各贴一条真实输出。
- [ ] AC4 **原保证不回退**：`long-term-guarantee-goal-backed-check.ts` 双向负控制仍通过（真仓库绿 ∧ `--inject-unbacked-fixture` 红），且 `AC-190` criterion 复跑 exit 0。三条退出码都贴回。
- [ ] AC5 措辞修正：`ready-pool-check.ts` 与 `long-term-guarantee-goal-backed-check.ts` 中「立案时必填」字面命中 = 0（该措辞是落点错误的诱因）。
- [ ] AC6 新检查器已登记进 `capability-catalog.sh`，且 catalog 自报的 `summary: N scripts` 相应 +1（⛔ 读它自报，不硬记数字）。
- [ ] AC7 `scripts/test.sh` 全量绿。

## Definition of Done

- [ ] AC1–AC7 全绿。
- [ ] Evidence 里记下对**生产任务板**实测的「因 `goalAcMissing` 被排除的 todo 条数」删除前后读数。⚠️ 当前该读数 = 0（唯一被卡死的那条已于 2026-09-11 补 `goal_ac: AC-207` 解锁）——**读数为 0 不等于缺陷不存在**，AC2 的夹具双向负控制才是本任务的取假面；⛔ 不得用这个 0 论证"无需修"。
- [ ] ⛔ **不得把 `ACTIVATION_LINE_ISO` 补到晋升闸作为替代修法**——那是在错误落点上加固，与人 2026-09-11 裁定反向。若执行中认为必须保留晋升侧的某种拦截，须先回到人处取裁定，不得自行改向。
- [ ] 未来边界已写进代码注释或检查器文档（一条不变式）：**准入集合只由 task 自身的自足属性决定；goal 信息最多改变集合内的顺序，永不改变成员资格。** 理由是单调性——排序不减少可执行集合（最坏是次序不优），准入可把集合减到空（产生僵尸）。即便未来 goal 有优先级，它也只能进 sort key、缺值时退化为默认序，⛔ 不得出现"goal 优先级未设 ⇒ 不可派发"这一同形缺陷的新版本。

## Touches

- plugin/scripts/ready-pool-check.ts
- plugin/test/ready-pool-check.test.mjs
- plugin/scripts/eligible-no-goal-source-check.ts
- plugin/scripts/long-term-guarantee-goal-backed-check.ts
- plugin/scripts/capability-catalog.sh
- tasks/gap-promotion-admission-reads-goal-layer-field.md

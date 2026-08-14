---
id: gap-ac73-catalog-rhythm-consumer-check
title: AC73 capability-catalog 节奏栏消费检测——非「按需」机件必须有按位置命中的调用点，否则红
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**AC73（capability-catalog 节奏栏消费检测 —— manager 2026-08-14 05:2xZ 报，今日第三例「正确的东西造好了、零消费者」）**。

**背景（发生率=4，且各例互不相关 ⇒ 够支撑造检测器，硬规则 12 门槛给）**：
```
per_suite_lane_budget=8       算对、打印、无 reader             → AC68（已修：test.sh 读它）
fan-in-ff-protocol-check.ts   造好、测试绿、无 caller           → 本条（AC62 判据2 能取假但结构上不可能红）
checkSplitRecommendation      零非测试调用者（CLAUDE.md 已记）  → 既有
tick-core-drift-check         已接线但 --no-block（2026-08-14） → 第 4 种形态：有消费者但被静音
```
**AC62 的实例最具体**：`fan-in-ff-protocol-check.ts` 全仓零调用者（test.sh=0、三层执行核=0、其余 0——逐条打印核过），catalog 节奏栏写「按需」（capability-catalog.sh:412）。**判据2 字面要求「必须红」，但它不运行 ⇒ 结构上不可能红**。develop 真出现非 ff fan-in merge，没有任何东西报红。**对一个协议检查器，「按需」等于「从不」**——它的价值全在连续性，没人会在违规那一刻想起来手跑它。

**⚠️ 第 4 种形态（manager 2026-08-14 05:2xZ 报，今日第四例）**：`tick-core-drift-check` **已接线**（`scripts/test.sh:627`）**但带 `--no-block`**（`gap-tick-core-drift-check-not-in-suite`），今天输出逐字 **3 pairs, 0 consistent / 3 drifted**、`fast-mode` 那对 12 hunks / +29/-15——**但它报了不改变任何结果，于是「报了」和「没报」在下游无法区分**（与「按需」同构：结构上不能取假——恒绿，因为它不阻）。**接线前我们【知道】那份义务没被执行；接线后套件每轮打印 PASS ⇒ 记录上看起来它正在被执行——恒绿检查是假的保证（硬规则 3/9）**。

**判据（manager 建议形态，已并入第 4 形态）**：
- **判据1**：**凡节奏非「按需」的机件必须在 `scripts/test.sh` 或某个执行核里有一处按位置命中，否则红**——产物是本来就要维护的 capability-catalog，不是新增打卡。
- **判据2**：**「按需」本身也要被约束**——一个判据类机件若声明为「按需」，必须在 catalog 里写明**谁在什么条件下按它**，否则「按需」就是「无人」。
- **判据3**：**凡 `--no-block` 的检查器，必须写明【谁在什么时候读它的输出并据此动作】，否则红**——与判据2 同一句话的另一半：`--no-block` 报而不改结果，「报了/没报」下游不可区分 ⇒ 判据必须带消费方（manager ③ 逐字建议，2026-08-14）。
- **判据4（执行核双副本，manager 2026-08-14 A④ 逐字）**：**执行核以双副本存在（`orchestration/*-tick-core.md` 与 `plugin/loop/*-tick-core.md`），凡声明/触达执行核的配套机制必须对两份副本都可见——三面（声明谁是正本 / Touches 谁在改 / drift 改歪了谁报）缺一即红。** 实例：Touches 声明 `orchestration/fast-mode-tick-core.md` 的任务 =26、声明 `plugin/loop/` 那份 =9 ⇒ 两个任务可被判 disjoint 却双双去改第二份副本；「本文件不接锚」两句两份并存 ⇒ 无法识别正本（复制而恒真，硬规则 4）。
- **能取假（现成真实缺席样本，均 D2 不构造）**：
  - AC62 的 `fan-in-ff-protocol-check.ts`（零调用者 + 节奏「按需」且无「谁按它」）⇒ 回放必须红。
  - `tick-core-drift-check --no-block`（已接线但无消费方——今天 3 pairs 全漂、无人据此动作）⇒ 回放必须红。
  - **`checked === total` 在翻 done 方向零消费者（manager 2026-08-14 ④ 裁定并入，AC68 实证）**：同一谓词派发方向有 20-34 处消费者（ready-pool-check.ts=34 / slot-refill.ts=20），翻 done 方向零消费者——`loop-complete-task.ts` 只有 `sectionFound` 一处（:109-110 只判 `!sectionFound`），AC47 gate 明说 completion 判定归调用方 ⇒ AC68 0/5 unchecked 仍翻 done。**不是新族，是已判之族第三个实例** ⇒ 回放必须红。
  - **`fan-in-ff-executor-check.ts`（AC67 交付，零接线；manager 2026-08-14 ③ 裁定并入，第 4 实例）**：develop `scripts/test.sh` 含 `fan-in-ff-executor-check` = 0（谓词干跑已知接线的 check=4，非假零）；catalog 节奏「按需」（capability-catalog.sh:418）无「谁按它」⇒ AC67 判据3「回放主线程 fan-in 必须报红」结构上不可能红。**①④ 是同一族里更窄的一族：随任务落地的【新检查器】默认不接线，因为没有任何判据要求「接进 run_static_checks」** ⇒ 本阶段两条关键 AC（AC62、AC67）都因此勾不了。⇒ 回放必须红。
  - **优先级（manager 2026-08-14 ③ 裁定）**：AC73 与 AC75 同级——AC75 降重试代价、AC73 解两条 AC 收口阻塞；**两条都不与在飞重叠时同时派；只能派一条时 AC75 先**（重试代价每轮发生、AC 勾选可等）。
  - 判据4：AC67 已补 `plugin/loop/` Touches 行（本轮 647e3182 后）；**AC64 仍只声明 `precommit-guard.ts` 不声明执行核（合法——它不碰核）**；未来凡声明单份执行核副本的任务回放必须红。

**⚠️ AC62 的阶段 AC 保持未勾**（manager 已明确：任务 AC 全满足可 done，阶段判据2 因无接线不能勾）——本任务接线落地后，AC62 判据2 才可能红，manager 才勾。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 capability-catalog.sh 节奏栏（:411/:412 等）+ test.sh + 三层执行核的调用点形态。
2. 判据1：节奏非「按需」的机件 → 在 test.sh 或执行核按位置命中（无则红）。
3. 判据2：「按需」机件 → catalog 写明谁在什么条件下按它（无则红）。
4. 判据3：`--no-block` 检查器 → 写明谁在什么时候读它的输出并据此动作（无则红）。
5. 能取假（双样本，D2）：AC62 fan-in-ff-protocol-check（零调用者 + 无「谁按它」）+ tick-core-drift-check `--no-block`（无消费方）回放必须红。
6. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：节奏非「按需」的机件在 test.sh 或执行核有按位置命中，否则红。
- [ ] AC2 判据2：「按需」判据类机件在 catalog 写明谁在什么条件下按它，否则红。
- [ ] AC3 判据3：`--no-block` 检查器写明谁在什么时候读其输出并据此动作，否则红。
- [ ] AC4 能取假：fan-in-ff-protocol-check（零调用者 + 无「谁按它」）与 tick-core-drift-check `--no-block`（无消费方）双样本回放必须红——真样本不构造（D2）。
- [ ] AC5 接线后 AC62 判据2 可能红（manager 才勾阶段 AC）。
- [ ] AC6 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] catalog 节奏消费检测落地（非按需必有调用点 + 按需必写谁按 + `--no-block` 必写消费方）+ fan-in-ff-protocol-check 与 tick-core-drift-check 双样本回放红。

## Touches

- plugin/scripts/capability-catalog.sh（节奏栏「按需」机件补「谁在什么条件下按」+ `--no-block` 检查器补消费方）
- plugin/scripts/rhythm-consumer-check.ts (new)
- plugin/test/rhythm-consumer-check.test.mjs (new)
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY 快照派生刷新）
- scripts/test.sh（非按需机件的调用点接线——AC62 判据2 的 fan-in-ff-protocol-check 入其中之一；tick-core-drift-check 的 `--no-block` 补消费方）
- tasks/gap-ac73-catalog-rhythm-consumer-check.md（自身）

## Evidence

（2026-08-14 落地，subagent gap-ac73 实测）

**新检查器落地 + 三判据 gate 全绿**（`node --experimental-strip-types plugin/scripts/rhythm-consumer-check.ts --check`，判据4 report-only）：
```
rhythm-consumer-check: OK — rhythm-consumer-check-pass
  [判据1-non-按需-call-site] ok — 179 judged, 0 violation(s)
  [判据2-按需-consumer] ok — 52 judged, 0 violation(s)
  [判据3-no-block-consumer] ok — 3 judged, 0 violation(s)
  [判据4-execution-core-dual-copy] ok (report) — 48 judged, 48 violation(s) (report-only, 不阻)
```

**负控制回放红**（`node --test plugin/test/rhythm-consumer-check.test.mjs` — 16/16 pass）：
- 判据1 负控制：fan-in-ff-protocol-check 回放「每轮 cadence + 零调用者 + 未基线」态 → `judgeNonOnDemand(...)` RED（`kind:"unwired"`）。
- 判据2 负控制：fan-in-ff-executor-check 回放「按需 + 无 CONSUMER row」态 → `judgeOnDemandConsumer(null)` RED（`按需 without a CONSUMER row`）。
- 判据3 负控制：tick-core-drift-check 回放「--no-block + 无 CONSUMER row」态 → `judgeNoBlockConsumer(null)` RED（`--no-block without a CONSUMER row`）。
- 判据4 负控制：单副本 execution-core Touches → `judgeDualCopyTouches([...orchestration/fast-mode-tick-core.md])` RED。

**接线落地**：
- `fan-in-ff-protocol-check` 接入 `run_static_checks`（每轮 code-class，baseline=cd4f49b4 即 enforcement 起点；adoption 46bf61e8 与 enforcement 之间 7 次非 ff fan-in 是已记录 pre-existing debt——manager 第5实例，enforcement 起不再纵容）：
```
fan-in-ff-protocol-check: evaluated=true ok=true (pass)
  OK non-ff-fan-in — no-non-ff-fan-in-merge
  NOT-EVALUATED suite-in-lock — no-lock-events-file
  OK retry-record-shape — no-retry-record-file (nothing to validate)
```
- `rhythm-consumer-check` 接入 `run_static_checks`（每轮 code-class，自身不再零调用——治愈的是它检测的病）。
- catalog CONSUMER 表落地：52 条 按需 谁按声明 + 3 条 --no-block 消费方声明（task-contract-check / task-ac-carryover-check / tick-core-static-check）。

**scoped 门 + ts-typecheck + doc 门全绿**：
```
fan-in-ts-typecheck-gate: typecheck GREEN — ADMITTED (exit 0)
bash scripts/test.sh --for-task gap-ac73-catalog-rhythm-consumer-check --allow-thin  → exit 0, ℹ pass 32 fail 0
bash scripts/test.sh --static-checks-doc  → exit 0 (tick-core-drift-check --no-block 报 3 drifted 不阻)
```

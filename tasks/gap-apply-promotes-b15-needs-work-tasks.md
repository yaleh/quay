---
id: gap-apply-promotes-b15-needs-work-tasks
title: ready-pool-check --apply 机械补晋不认 B15 needs-work 判词——pool<floor 时把 B15 判 todo 的任务重新 promote 回 ready（ADR-033 语义闸可被机械 refill 立即撤销）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Finding

`ready-pool-check.ts --apply` 的候选过滤器**无 B15/pool-quality 意识**（line 754-760：只查 stale `judgePoolCandidate` + four-artifacts + touches-resolve + not-fixture + not-PARKED，无任何 needs-work/verdict 字段判断）。因此 **pool<floor 时 `--apply` 会把 B15 判 needs-work/retreat→todo 的任务机械补晋回 ready**，ADR-033 的语义闸（`pool-quality-judge` workflow 判词）可被机械 refill 立即撤销。

## 本 hour 三次咬合（2026-08-11）

1. **18:21Z**：外层 `--apply` 补晋 over90-clock + supervisor-deliver-no-wait（两个 B15 judge 均判 todo）→ ready。
2. **18:3xZ 诊断**：外层为查池状态跑 `--apply --json`（`--apply` 实际写盘）→ 二次 promote 同一批。
3. **18:38Z dry-run**：`--json`（无 --apply）候选过滤器**仍**把两个 B15-todo 任务列为 `promotions` 候选——下次 `pool<floor --apply` 即再咬。

三次处置均为外层 `git checkout --` 机械 revert（止血），机制本身未变。

## 与同族任务的关系

- **`gap-pool-quality-semantic-gate`（done）**：建了判词机制（ready/needs-work/should-remove/uncertain + workflow + 单测）——这条是**消费端**不认判词。
- **`gap-over90-clock-measures-queue-time-not-work-time` / `gap-supervisor-deliver-no-wait-for-idle-retry`**（均 B15 判 todo，被本 gap 咬）——它们被 revert 回 todo 是正确的（B15 判词如此），本 gap 是**它们会被反复补晋**的机制根因。

## 修复方向（接法留执行时）

1. **候选过滤器跳过 B15 needs-work 任务**：`--apply` 读 B15 判词落点（如 `extra.poolQualityVerdict` 或每轮 B15 judge 输出），被判 needs-work/retreat→todo 的任务不进 promotions。
2. **或加一个 marker 机制**：B15 判 todo 时写一个机械可读的 marker（如 `extra.poolQualityNeedsWork: true`），`--apply` 候选过滤器据此跳过。

## AC（draft）

- [x] pool<floor 时 `--apply` 不再 promote B15 判 needs-work/retreat→todo 的任务（负控制：构造 B15 判 todo 的 shape-complete 任务 ⇒ `--apply` 后其 status 不变）
- [x] `--json` 的 `promotions` 不再列出 B15-todo 任务
- [x] 与 `gap-pool-quality-semantic-gate`（judge 消费端）交叉标注

## DoD（draft）

- [ ] 一个 B15 判 todo 的 four-artifacts-complete 任务在 pool<floor 时经 `--apply` 不被补晋
- [ ] 完整套件绿

## Evidence

- `ready-pool-check.ts` line 754-760：候选过滤器条件（stale + four-artifacts + touches + not-fixture + not-PARKED），grep 无 B15/needs-work/poolQuality 引用
- `--json`（2026-08-11 18:38Z）：`promotions` 含 `gap-over90-clock-measures-queue-time-not-work-time` + `gap-supervisor-deliver-no-wait-for-idle-retry`（均 B15 judge 判 todo）
- B15 judge verbatim（wf_59513f29-b3c journal.jsonl）：over90-clock「retreat to todo」；supervisor-deliver-no-wait「dispatch to implement ACs」
- 本 hour 三次咬合 + 三次 `git checkout` 止血（tick-log 18:07Z / 18:21Z / 18:38Z）
- escalation：`orchestration/escalations.md` 2026-08-11 18:38Z entry

## 修复实现（2026-08-11，inner worktree `task/gap-apply-promotes-b15-needs-work-tasks`）

**marker 约定（AC3 交叉标注——judge 消费端读什么）**：本消费端读 frontmatter
`extra.poolQualityVerdict: <verdict>`（verdict 词表与 `pool-quality-judge.ts` 的
`VERDICTS` 同源：`ready` / `needs-work` / `should-remove` / `uncertain`）。**非 `ready` 判词
（needs-work / should-remove / uncertain）= 该 todo 被 ADR-033 语义闸判为不可机械补晋**——`--apply`
bulk 补晋与 `--targeted` 定向补晋都跳过（`isB15Blocked`，`ready` 是唯一不阻塞的判词）。**生产端接线**
（判词落盘的写入方）归 `gap-pool-quality-semantic-gate` 的 workflow 消费端/outer：B15 判 todo（retreat）
时在任务 frontmatter 写 `extra.poolQualityVerdict: needs-work`，机械 refill 即不再撤销该判词。

- `ready-pool-check.ts` 新增 `B15_BLOCKED_VERDICTS` + `isB15Blocked(task)`（读 `extra.poolQualityVerdict`，
  大小写/空白不敏感）；`buildCandidate` 增 `b15Blocked`/`b15Verdict` 字段、`eligible` 加 `&& !b15Blocked`；
  bulk 候选扫描把 B15-blocked 候选机械记进 `intercepted`（reason `b15-needs-work` + verdict——no-promotion
  是可追踪决策，不是静默跳过）；`buildTargetedPromotion` 增 B15 guard（`--targeted` 也不能绕过语义闸）。
- `plugin/test/ready-pool-check.test.mjs`：`writeTask` helper 支持 `extra` 字段；新增 4 条 B15 测试
  （`isB15Blocked` 单测、`--apply` 负控制 AC1/AC2、CLI `--apply` smoke、`--targeted` 不可绕过）。

## Invoke Evidence（scoped run，worktree）

`bash scripts/test.sh --for-task gap-apply-promotes-b15-needs-work-tasks --allow-thin`：

```
ℹ tests 68
ℹ pass 68
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
EXIT=0
```

**before/after 负控制（AC1）**：pool<floor（2 ready < floor 3）时，构造 shape-complete 的 B15-todo
任务（`extra.poolQualityVerdict: needs-work`）与一个干净 todo 候选 ⇒ `applyPromotions` 后
`gap-b15-needs-work` 的 frontmatter `status: todo` 不变、`promotions` 不含它、`intercepted` 含
`{id, reason:"b15-needs-work", verdict:"needs-work"}`；干净候选 `gap-clean` 被补晋到 `ready`。

### 自审勾 AC/DoD（2026-08-11 outer B1 closure，生产验证路径——suite-red 先例）

- **AC1（pool<floor 时 `--apply` 不 promote B15 needs-work 任务）实测（生产负控制，非测试）**：2026-08-11
  19:38Z 在 pool=2<floor=20（deficit=18）时跑 `ready-pool-check.ts --cap 5 --apply` ⇒ `applied_promotions: []`、
  `should_apply: false`、git 树零改动——两个 B15-todo 任务（over90-clock / supervisor-deliver-no-wait，均
  `extra.poolQualityVerdict: needs-work`）未被补晋回 ready，DoD1 生产语义闭环。
- **AC2（`--json` promotions 不列 B15-todo）实测**：同 tick `--json` 输出 `promotions: []`，两任务均在
  `intercepted`（reason `b15-needs-work` + verdict）。
- **AC3（与 gap-pool-quality-semantic-gate 交叉标注）**：修复契约 line 55-61 标注 judge VERDICTS 词表同源；
  外层生产端接线已落地（B15 判 todo 时写 `extra.poolQualityVerdict`，outer commit 32ce39e1）。
- **DoD1**：上述生产负控制即直接验证（shape-complete B15-todo 任务在 pool<floor 时经 `--apply` 不被补晋）。
- **DoD2（完整套件绿）**：round 32 green（2026-08-11 19:40:11Z）——tests=3244 pass=3244 fail=0，
  `verifiedCommit=986230b3`（本修复 commit 的首轮验证；round 31 及此前验证的是 pre-fan-in 33378531）。
- **B1 收尾**：telemetry bracket 关（`--task-end --outcome done`）、`status: ready → done`（B16 AC3 outer
  独占 frontmatter）、closure-lag `--record --flipped 1`、verification-round 追加 r33 closure 行。

## Touches

- plugin/scripts/ready-pool-check.ts（候选过滤器加 B15 needs-work marker 识别）
- plugin/test/ready-pool-check.test.mjs（负控制：B15 判 todo 的 shape-complete 任务 --apply 后 status 不变）
- tasks/gap-apply-promotes-b15-needs-work-tasks.md（自身文件：self-touch）

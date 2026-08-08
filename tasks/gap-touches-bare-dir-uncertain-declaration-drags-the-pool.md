---
id: gap-touches-bare-dir-uncertain-declaration-drags-the-pool
title: "Touches must NOT declare bare-directory globs with uncertain
  annotations ('若成脚本' / '或等价' / '可能') — branch-model's
  `plugin/scripts/（分支模型 helper：...，若成脚本）` expanded to 100+ files and
  collided 5/6 pool candidates (measured 2026-08-06 with the production chain
  parseTouches+checkTouchesPair+expandDeclaredTouches): a SPECULATIVE broad
  declaration drags the whole pool into conservative serialization (the task
  can't prove disjointness with anything in that dir); rule: declare CONCRETE
  paths, or an EXPLICIT candidate path (name the would-be script e.g.
  plugin/scripts/branch-helper.sh) — not a bare dir with 'if it becomes a
  script'; enforcement: mechanical check (flag bare-dir + uncertain-annotation
  Touches at filing) or template AC + reviewer discipline"
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**Touches 裸目录 + 不确定声明（'若成脚本'）把整个池拖进保守串行——生产链实测，立案。**

**【实测（管理者，生产链 parseTouches+checkTouchesPair+expandDeclaredTouches）】**：
- branch-model 的 Touches 有 `plugin/scripts/（分支模型 helper：...，若成脚本）`——裸目录 + 自己不确定
  （'若成脚本'）。展开后覆盖 plugin/scripts/ 下 **100+ 文件**。
- 实测碰撞：full-suite-runner-red-pattern 真撞 plugin/scripts/full-suite-runner.ts；send-keys-reliable-
  welcome-screen 真撞 send-keys-reliable.sh；complete-delivery-surface / delivery-surface-grows /
  two-machine-collaboration 自己也声明裸 plugin/scripts/，互相整目录重叠。
- **池 6 候选 5 个因此判不相交失败**（不是滚动派发机制问题，是一次投机性宽泛声明的连带样本）。

**【裁定（外层）】**：**要求任务立案时 Touches 不得用裸目录 + 不确定声明**——应：
1. 声明**具体路径**（真的会写的文件），或
2. **先占一个明确的候选路径**（如 `plugin/scripts/branch-helper.sh`），而非「若成脚本」这种不确定。

**【执行形态】**：机械检查（filing 时 flag 裸目录 + 不确定标注的 Touches）或任务模板 AC + 审查纪律。
与 tick 0c 的 ## Contract 机制同族（机器可消费的声明）。

### 选定机制

1. 规则：Touches 禁裸目录 + '若成脚本'/'或等价'/'可能' 类不确定声明；具体路径或明确候选
2. 机械检查：filing 时 flag 违规 Touches（或在 task-contract-check 族加一条）
3. 立即：branch-model 的 `plugin/scripts/（若成脚本）` 收窄（commit 到 helper 路径或删）

## Acceptance Criteria

- [ ] AC1: 规则落地——filing 时裸目录 + 不确定标注 Touches 被 flag（机械或模板 AC）
- [ ] AC2: branch-model 的 Touches 收窄（'若成脚本' → 明确候选路径或删）；池恢复可并行
- [ ] AC3: 复测：池候选 disjointness 正常（不再 5/6 被裸目录拖垮）

## Definition of Done

- [ ] AC1-AC3 全勾（裸目录+不确定标注 Touches 被 flag——机械或模板 AC；branch-model Touches 收窄——'若成脚本'改明确候选路径或删；复测池候选 disjointness 正常不再被裸目录拖垮）
- [ ] 裸目录 flag 实测 + 池 disjointness 复测正常
- [ ] scoped 门 `scripts/test.sh --for-task gap-touches-bare-dir-uncertain-declaration-drags-the-pool` 绿

## Touches

- plugin/scripts/（机械检查，若成脚本）
- plugin/loop/fast-mode-loop-tick.md / orchestrator-loop-tick.md（若文档引用）
- tasks/gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point.md（AC2 交叉标注）

## Contract

measure   pool_disjoint = `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root /home/yale/work/quay --json` stdout 的 dispatchable_disjoint 数字段
band      pool_disjoint >= 3（branch-model 收窄后池恢复）
invoke    `grep -n '若成脚本\|plugin/scripts/（' tasks/gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point.md`
control   branch-model 收窄前 5/6 撞（基线）；收窄后 ≥3 可并行
resume    规则与收窄分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T00:0xZ
changed: 管理者生产链实测立案——branch-model 投机性裸目录 Touches 拖垮 5/6 池候选。裁定规则
（具体路径或明确候选，禁裸目录+不确定）+ 机械检查方向 + 立即收窄 branch-model。

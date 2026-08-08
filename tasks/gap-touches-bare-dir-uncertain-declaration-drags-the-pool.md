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

- [x] AC1: 规则落地——filing 时裸目录 + 不确定标注 Touches 被 flag（机械或模板 AC）
- [x] AC2: branch-model 的 Touches 收窄（'若成脚本' → 明确候选路径或删）；池恢复可并行
- [x] AC3: 复测：池候选 disjointness 正常（不再 5/6 被裸目录拖垮）

## Definition of Done

- [x] AC1-AC3 全勾（裸目录+不确定标注 Touches 被 flag——机械；branch-model Touches 收窄——已收窄为具体路径；复测池候选 disjointness 正常不再被裸目录拖垮）
- [x] 裸目录 flag 实测 + 池 disjointness 复测正常
- [x] scoped 门 `scripts/test.sh --for-task gap-touches-bare-dir-uncertain-declaration-drags-the-pool` 绿

## Touches

- tasks/gap-touches-bare-dir-uncertain-declaration-drags-the-pool.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）
- plugin/scripts/touches-parser.ts（裸目录 + 不确定标注检测 flagBareDirUncertainTouches，AC1 机械检查）
- plugin/scripts/task-contract-check.ts（consumer 检查 bare-dir-uncertain-touch + shrink-only baseline，AC1）
- docs/analysis/bare-dir-touches-baseline.md（新增 shrink-only 祖父清单，AC1）
- plugin/test/bare-dir-touches-check.test.mjs（新增 node:test——检测 + 规则落地，AC1）
- plugin/test/task-contract-check.test.mjs（real-store 期望随新检查更新，AC1）
- plugin/test/touches-parser-parity.test.mjs（touches-parser 变更的相关测试）
- tasks/gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point.md（AC2 交叉标注：Touches 已收窄）

## Contract

measure   pool_disjoint = `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root /home/yale/work/quay --json` stdout 的 dispatchable_disjoint 数字段
band      pool_disjoint >= 3（branch-model 收窄后池恢复）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/task-contract-check.ts --root /home/yale/work/quay --strict-subset tasks/gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point.md`
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/task-contract-check.ts --root /home/yale/work/quay --strict-subset tasks/gap-touches-bare-dir-uncertain-declaration-drags-the-pool.md`
control   branch-model 收窄前 5/6 撞（基线）；收窄后 ≥3 可并行
resume    规则与收窄分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T00:0xZ
changed: 管理者生产链实测立案——branch-model 投机性裸目录 Touches 拖垮 5/6 池候选。裁定规则
（具体路径或明确候选，禁裸目录+不确定）+ 机械检查方向 + 立即收窄 branch-model。

## Evidence

**AC1（规则落地——机械检查 + 本任务 Touches 自身收窄）**：新增 `bare-dir-uncertain-touch` consumer
检查于 `plugin/scripts/task-contract-check.ts`（检测在单一来源 `plugin/scripts/touches-parser.ts` 的
`flagBareDirUncertainTouches`；pre-rule 遗留进 shrink-only 祖父清单 `docs/analysis/bare-dir-touches-baseline.md`）。
新测试 `plugin/test/bare-dir-touches-check.test.mjs` 15/15 绿（`fail 0` / `cancelled 0`）：
```
✔ flag: bare-directory + '若成脚本' annotation is flagged
✔ flag: bare-directory + '或等价' / '可能' / '待定' annotations are flagged
✔ flag: an entry that is ONLY an annotation (no path) is flagged
✔ flag AC1-negative: a CONCRETE file path with an uncertain annotation is NOT flagged
✔ flag AC1-negative: a bare directory WITHOUT an uncertain annotation is NOT flagged
✔ flag AC1-negative: an existing extension-less file (plugin/VERSION) is NOT a bare directory
✔ flag: no-annotation / (new) / (delete) entries are never flagged
✔ consumer: a NON-grandfathered task with the pattern → bare-dir-uncertain-touch violation
✔ consumer: the SAME pattern is NOT a violation when the file IS on the shrink-only grandfather list
✔ consumer: no ## Touches section → no finding
✔ readBareDirTouchesBaseline: absent file → empty set + null count
✔ CLI AC1: a NEW task with the pattern (no baseline) is REPORTED; ratchet growth → exit 1
✔ CLI AC1: with the file on the grandfather list, the same pattern is NOT a violation (exit 0)
✔ CLI AC1: the grandfather baseline itself is shrink-only — a ceiling breach exits 1
✔ CLI AC1 strict-subset: a touched task carrying the pattern FAILS the scoped run (filing-time flag)
ℹ tests 15  ℹ pass 15  ℹ fail 0  ℹ cancelled 0
```
filing-time flag（scoped tier，task-contract-check `--strict-subset` 是本任务触达时运行的静态检查）：
`plugin/scripts/task-contract-check.ts --strict-subset tasks/gap-touches-bare-dir-uncertain-declaration-drags-the-pool.md`
→ `task-contract-check: no violations.`（本任务自身 Touches 从裸目录 `plugin/scripts/（机械检查，若成脚本）`
收窄为具体路径——本任务就是规则的第一个标本）。全量 store 扫描 `new since baseline: 0`（pre-rule 遗留
14 文件在 `bare-dir-touches-baseline.md` 祖父清单内，不再新增）。

**AC2（branch-model Touches 收窄）**：branch-model 的 `## Touches` 已在 integration 上收窄为具体路径
（`plugin/scripts/fork-baseline.ts` / `integration-batch-merge.sh` / `integration-branch-model.ts` 等，
2026-08-06 `9e2ae728` outer closure round 14「Touches narrowed per ruling」）。机械验证（本任务 Contract
invoke）：
```
plugin/scripts/task-contract-check.ts --strict-subset tasks/gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point.md
→ task-contract-check: no violations.   （branch-model 无 bare-dir-uncertain-touch 违规 = Touches 已收窄）
```
交叉标注已双向写入 branch-model 任务体。

**AC3（池 disjointness 复测）**：`ready-pool-check.ts` 生产链实测（Contract measure 同一命令）：
```
node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root /home/yale/work/quay --json
  "pool": 16,
  "dispatchable_disjoint": 5,
  "criterion_met": true,
  "report": "pool 16/12 (floor = cap(3) × 4) · dispatchable_disjoint 5/3 — criterion met (≥cap mutually-disjoint candidates)"
```
`dispatchable_disjoint = 5 ≥ 3`（band 满足）——池恢复可并行，不再被裸目录拖垮（基线：branch-model 收窄前 5/6 撞）。

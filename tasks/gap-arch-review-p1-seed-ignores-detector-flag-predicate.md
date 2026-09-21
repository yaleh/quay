---
id: gap-arch-review-p1-seed-ignores-detector-flag-predicate
title: P1 删除闭包候选构件仍用裸 hardcoded>0 选取——同文件 clusterIdentityReport 已消费 isFlagged
  的未扫兄弟（硬规则 5b），8 个检测器已判清白的共享模块仍在候选池、紧贴 top-3 切线
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

架构复核 round 2018 把 `P1-deletion-closure` 判为 uncertain，理由是 `DC=15188 / R=84.85` 是**被走的宇宙**的产物而非耦合——`deletion-closure-check.ts` 的 `walkDocFiles()` 不剪 `.archguard/` 与 `.claude/worktrees/`（整份 repo 副本），于是它自己的 gitignored 输出目录与每个 agent worktree 快照都被算成 graph 成员（该轮 `clusters[].files` 逐字以 `.archguard/output/index.md` 与 `.claude/worktrees/agent-a06ef2e40a3b4e674/**` 开头）。

**那半边（walker 的输入面）已有任务认领**：`gap-deletion-closure-walker-respects-gitignore`（status: needs-human）。本任务既不重复它、也不依赖它、更不替代它——两者文件面与修法各自独立。

本任务认领的是同一条判词里的 **secondary** 成因，它目前**没有任何任务认领**。

### 缺陷：`deletionClosureComponents()` 仍用裸 `hardcoded > 0` 选取 P1 候选构件

`plugin/scripts/architecture-review-cluster.ts` 里两个同族函数在 2026-09-21 之后**不对称**：

| 函数 | 行 | 选取谓词 | 状态 |
|---|---|---|---|
| `clusterIdentityReport()`（P2 面） | `:148` | `isFlagged(row)`（`hardcoded>=5 && hardcoded>accessor`） | 已修（`gap-arch-review-cluster-ignores-detector-flag-predicate`，done） |
| `deletionClosureComponents()`（**P1 面**） | `:213-217` | `(row.hardcoded ?? 0) > 0` | **未修——本次的未扫兄弟** |

`deletionClosureComponents()` 决定**把哪些实体送进 `deletion-closure-check.ts`**（消费点 `plugin/scripts/quality-gate-driver.ts:743` → `defaultDeletionClosureArgv(root, components)`），即 round 2018 那条 label 里的 `[quay-init.sh, ready-pool-check.ts, full-suite-runner.ts]`。

实测（主检出 `/home/yale/work/quay`，`node --experimental-strip-types plugin/scripts/identity-replication-check.ts --json > /tmp/ir.json` 后统计 `table[]`）：

```
裸判据 (hardcoded>0) 候选池 : 25
isFlagged 候选池            : 17
裸放行而检测器已判清白      : 8
```

那 8 个逐字是：`touches-orthogonality-check.ts`(20/23)、`task-schema.ts`(18/36)、`gate-script-base.ts`(10/230)、`repo-root.ts`(9/85)、`driver-filters.ts`(9/14)、`gate-script-lib.sh`(6/74)、`touches-parser.ts`(6/26)、`suite-lock-slots.ts`(4/15)（括号内为 `hardcoded/accessor`）——**与 P2 面那条修法 AC1 里「已判清白却仍成簇」的 8 个 id 逐字同一批**。同一次修法扫了 P2 面、漏了 P1 面，缺的正是硬规则 5b 要求的动作（修完一个实例后，在同一载体里 grep 该原则的其它适用点）。

### 现状是【潜伏】的，不是【已发作】的——判据必须能取假

诚实读数（同一次实测）：当前 top-3 恰好**全部** `isFlagged=true`（`quay-init.sh` 52/2、`ready-pool-check.ts` 51/8、`full-suite-runner.ts` 42/12）⇒ 今天的候选选择**没有**出错，round 2018 的 DC 膨胀完全是 walker 那一半造成的。但 cutoff 落在 `hardcoded=42` 与 `20` 之间：`touches-orthogonality-check.ts`(20/23) **紧贴**切线下一位。任何一个上方构件掉到 20 以下，这个检测器已判清白的共享模块就会作为「构件」被送进删除闭包扫描，产出一条大而无意义的 DC——正是 P2 面那条修法存在的理由（`identity-replication-check.ts:167` 注释自己担心的那件事：判过清白的行不该进族）。

⚠️ 因此本任务的 AC **不**写成「某条 DC 变小」——那会是一条**恒真的回声**（硬规则 4：结构上不可能取假的量不是测量；今天的候选集合已经合法）。AC 写成**单元级 + driver 边界的差分判据**：构造一个 below-threshold 行排在 top-N 边界内，裸判据选它、`isFlagged` 判据不选它。

## AC

- [ ] AC1（复现固化·潜伏态可独立复核）：贴出立案时的三个读数（裸候选池 25 / isFlagged 池 17 / 裸放行而已判清白 8）与那 8 个实体的 `hardcoded/accessor` 清单，附所用命令（`identity-replication-check.ts --json` + `table[]` 逐行统计），使「8 个 id 与 P2 面已判清白的 8 个逐字同一批」可被独立复核。
- [ ] AC2（修后·按位置判定）：`grep -n 'hardcoded ?? 0)' plugin/scripts/architecture-review-cluster.ts` 在 `deletionClosureComponents()` 函数体内命中 **= 0**；该函数体经 `isFlagged` 过滤。贴出修后函数体逐字，以及 `grep -c 'isFlagged' plugin/scripts/architecture-review-cluster.ts`（修前 = import 行 + P2 用点 2 处；修后应 ≥ 3，且新增的那处落在 `deletionClosureComponents` 内）。
- [ ] AC3（负控制·边界行必须被排除，判据能取假）：单元级差分——构造一张表，令一个 below-threshold 行排在 top-N 边界内，例如
      `[{entity:"leak.ts",hardcoded:20,accessor:23},{entity:"real.ts",hardcoded:9,accessor:2},{entity:"real2.ts",hardcoded:8,accessor:3},{entity:"real3.ts",hardcoded:7,accessor:4}]`，`max=3`。
      **修前**该表选出 `["leak.ts","real.ts","real2.ts"]`（`leak.ts` 20/23 在列）；**修后**选出 `["real.ts","real2.ts","real3.ts"]`（`leak.ts` 不在列）。两次输出都贴。
      第二半（另一半能取假）：把 `leak.ts` 改成 `20/3`（越过谓词）⇒ **修后仍选它**，证明修法排的是「检测器判过清白」，不是把边界行一律丢掉。
- [ ] AC4（负控制·真构件不许被一起丢掉 + driver 边界）：(a) `isFlagged=true` 的行在上表与生产读数下**仍被选出**：贴出 `deletionClosureComponents(<真实 ir.json>)` 的 top-3 **仍为** `["quay-init.sh","ready-pool-check.ts","full-suite-runner.ts"]`。(b) **driver 边界**（真实消费面，非纯函数）：经 `plugin/test/quality-gate-driver.test.mjs` 既有的注入式 detector 缝（`fakeIdentityScript`/`fakeDeletionScript`），喂一张最高 `hardcoded` 行即 below-threshold 的 identity 表，断言 `runArchitectureReview` 实际传给 deletion 脚本的构件清单**不含**该行——该断言在把谓词换回裸计数时**必须变红**。红/绿两次输出都贴。
- [ ] AC5（回归有守卫）：`plugin/test/architecture-review-cluster.test.mjs` 增 AC3 的两条对照（修前选 `leak.ts`/修后不选；越过谓词后仍选）；**红/绿两次实跑**——把过滤换回裸 `(row.hardcoded ?? 0) > 0` 时其中至少一条必须变红。`node --experimental-strip-types plugin/test/architecture-review-cluster.test.mjs` 与 `node --experimental-strip-types plugin/test/quality-gate-driver.test.mjs` 均 exit 0。

## DoD

- `deletionClosureComponents()` 以 `isFlagged` 为选取判据（与同文件 `clusterIdentityReport()` 共用同一份谓词实现，⛔ 不各写一遍），`plugin/scripts/architecture-review-cluster.ts` 提交。
- **真实落地**（DIR-026 Reading A：fixture 必要不充分）：AC4(b) 的 **driver 边界**对照落进 `plugin/test/quality-gate-driver.test.mjs`，且**红过一次**（换回裸计数 ⇒ 红）。这是本缺陷可取假的最强形态——纯函数单测不够，driver 才是真实消费面。
- ⚠️ **本条必须写进收尾记录、不得含糊**：该缺陷当前是**潜伏**的（生产 top-3 已全部 `isFlagged=true`），故**生产载体（`.quay/architecture-review-round.jsonl`）上的「P1 label 构件全部合法」是一条恒真回声**（现在就已成立），⛔ 不得把它当作本任务落地的证据；本任务的落地证据是 AC4(b) 的 driver 边界红/绿。
- 下一轮架构复核的 `P1-deletion-closure` label 数值（DC/R）是否 honest 取决于 walker 那一半的修复状态，**那不在本任务范围内**——本任务的完成判据与它无关。
- 收尾在 `tasks/gap-arch-review-p1-seed-ignores-detector-flag-predicate.md` 记录修前/修后两组读数（候选池 25→17、8 个 id 退出候选池、top-3 不变）。

## Touches

- plugin/scripts/architecture-review-cluster.ts
- plugin/test/architecture-review-cluster.test.mjs
- plugin/test/quality-gate-driver.test.mjs
- tasks/gap-arch-review-p1-seed-ignores-detector-flag-predicate.md
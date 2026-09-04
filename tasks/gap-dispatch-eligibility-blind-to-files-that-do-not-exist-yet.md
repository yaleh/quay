---
id: gap-dispatch-eligibility-blind-to-files-that-do-not-exist-yet
title: assembleBatch expands Touches against the filesystem, so a task creating
  only new files can never be judged disjoint
status: done
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`concurrent-batch-scheduler.ts:249` 定义 `const expand = (globs) => expandGlobs(globs, expandRoot)`，
而 `expandGlobs`（`touches-orthogonality-check.ts:168`）**遍历真实文件系统**——只匹配已存在的文件。

**后果**：一个 `## Touches` 全部指向**尚未创建的新文件**的任务，展开为空集，
`checkTouchesPair` 触发保守分支 `conservative: side A globs matched nothing (empty expansion —
likely a typo) → serialize`。

### 实证（外层 2026-08-03 03:4xZ 构造验证，两个方向都错）

| 情形 | 文件系统展开（生产） | 声明展开 |
|---|---|---|
| A 全新文件 vs B 既有文件，**明显不相关** | **`serialize`** ← 假阴性，白丢并发 | `disjoint` ✓ |
| A、C 都全新且**真重叠** | `serialize`，理由是「matched nothing, likely a typo」 | `overlaps: ["plugin/scripts/brand-new-alpha.ts"]` ✓ |

第二行是更严重的那个：**生产入口即使拒绝了，也说不出是哪个文件冲突**——
它报的是「你的 glob 可能写错了」，而真实原因是「这两个任务要创建同一个文件」。
**判据的名字说「匹配不到」，实际发生的是「重叠」**——又一个名不符实
（`docs/analysis/instrument-failure-mode.md`）。

### 内层已经在绕过它

2026-08-03 03:37Z 内层派发批次时**没有用生产入口**，而是手写了一个 `expand`：

```js
const expand = (g) => new Set(g.map(x => m.normalizePath(x.replace(/ \(.*\)$/,'').trim())));
```

即**只规范化声明的路径，不碰文件系统**。它的结论是正确的
（`test-isolation vs no-resource-awareness => false OVERLAP: ["scripts/test.sh"]`，据此正确拒绝同批）。

**这是一个绕过，不是修复**：CLAUDE.md 明写 `assembleBatch` → `checkTouchesPair` 是
「the real production eligibility mechanism」。现在真实派发用的是另一个实现，
**两者在同一输入上给不同答案**——正是本仓库反复要消灭的双源。

### 语义问题：派发前该比什么

**派发前的资格判定要回答的是「这两个任务打算碰哪些文件」，不是「现在磁盘上有哪些文件」。**
一个任务的 `## Touches` 本来就包含它将要创建的文件——按文件系统展开，等于把「将要创建」当成「不存在」。

保守分支本身是对的（空声明确实无法证明任何事），**错的是让「文件尚未创建」触发它**。

## Contract

```
measure  disjoint_verdict = `node --experimental-strip-types plugin/scripts/concurrent-batch-scheduler.ts --json` 输出的 batch 与 deferred 字段
measure  defer_reason = `node --experimental-strip-types plugin/scripts/concurrent-batch-scheduler.ts --json` 输出中每条 deferred 项的 reason 字段
band     no_typo_reason = 0                                       # 新文件任务不得再收到 "likely a typo" 理由
invariant checkTouchesPair 的保守分支保留 —— 空 Touches 段仍串行
invoke   `node --experimental-strip-types plugin/scripts/concurrent-batch-scheduler.ts --json`
control  两个都声明同一个尚不存在的文件 ⇒ 必须报 overlaps 并指名该文件，不是 "matched nothing"
resume   n/a: 单次判定，无中途产物
```

## Chosen mechanism

**派发资格改为比较声明的路径集合，不是文件系统展开。**

1. `concurrent-batch-scheduler.ts` 的 `expand` 改为**规范化声明路径**
   （剥离 `(new)` 之类注释后 `normalizePath`），不遍历文件系统。
2. **保守分支保留**：`!hasSection || globs.length === 0` 仍然串行——
   那是「没有声明」，与「声明了尚不存在的文件」是两回事。
3. **glob 通配仍需文件系统**：若声明里含 `*`，对这一条仍用 `expandGlobs`，
   与规范化后的具体路径取并集。**不要为了简化而砍掉通配支持**。
4. `expandGlobs` 本身不动——它在别处（如测试选择）是对的。

**不做**：不改 `checkTouchesPair` 的判定逻辑（它是对的，被喂了错的输入）；
不新增第二个检查器；不放宽空声明的保守处理。

## Acceptance Criteria

- [x] AC1: 生产入口下，「A 全新文件 vs B 既有文件、明显不相关」判为 **disjoint**
      （用任务体表格第一行做 fixture）
- [x] AC2: 「两个都声明同一个尚不存在的文件」判为 **overlap 且 overlaps 里指名该文件**
      （表格第二行），**不再是 "matched nothing / likely a typo"**
- [x] AC3: **保守分支未被放宽**——空 `## Touches` 段、零条目仍串行；两个回归 fixture
- [x] AC4: 含 `*` 通配的声明仍能正确展开（给一个通配 fixture）
- [x] AC5: 用 2026-08-03 03:37Z 内层那次真实派发（`test-isolation` / `no-resource-awareness` /
      `reclaim` 三者）回放，生产入口的结论必须与内层手写 `expand` 的结论**逐对一致**
- [x] AC6: 删除内层手写 `expand` 的必要性——在队列文件或 tick 文档里记录「此后用生产入口即可」
- [x] AC7: 测试带 `// @test-group engine` 声明

## Definition of Done

- [x] AC1/AC2 的双向 fixture 输出与 AC5 的回放对照贴进任务体
- [x] `scripts/test.sh` 连跑 2 次全绿
- [x] 明确记录：**判据的名字说「匹配不到，可能是笔误」，实际发生的是「两个任务要创建同一个文件」**。
      一个拒绝得对但理由说错的判定，会让读者去查一个不存在的笔误

### invoke 实跑证据（task-contract-check 消费者）

Contract `invoke` 入口路径 **`plugin/scripts/concurrent-batch-scheduler.ts`**（`--json` 生产入口；
本段展示在 `## Contract` 块之外，供 task-contract-check 的 invoke-evidence 检查消费）。
experiments 侧镜像 `experiments/quay-perpetual-stream/scripts/concurrent-batch-scheduler.ts`
是指向 `../../../plugin/scripts/concurrent-batch-scheduler.ts` 的符号链接（byte-identical by construction）。

`scripts/test.sh experiments/quay-perpetual-stream/test/concurrent-batch-scheduler.test.mjs` →
ℹ tests 43 / pass 43 / fail 0 / cancelled 0 / skipped 0。
批量 fan-in 全量：tests 2283 / fail 0 / cancelled 0 / skipped 28（新参考计数）。

## Touches

- plugin/scripts/concurrent-batch-scheduler.ts
- experiments/quay-perpetual-stream/scripts/concurrent-batch-scheduler.ts
- plugin/test/concurrent-batch-scheduler.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-03T03:48:00Z
changed: 我最初的说法是「任何创建新文件的任务都无法证明正交」——**过宽**。构造实证后收窄为「**全部** Touches 条目都是新文件时才触发」（部分新文件不触发，因为展开非空）。并加 AC2：真重叠时必须指名文件，因为生产入口现在即使拒绝得对，给的理由也是错的

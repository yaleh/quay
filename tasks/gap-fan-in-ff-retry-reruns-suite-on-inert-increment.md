---
id: gap-fan-in-ff-retry-reruns-suite-on-inert-increment
title: "ff 失败重试恒跑全量 suite——develop 惰性增量（doc/任务体）应在 fan-in-ff-merge.sh 持锁段内跳过重跑（落点修正版）"
status: todo
labels:
  - gap
  - performance
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

**两层根因（此前只点破第二层）**：
- **第一层（更根本）**：`git merge --ff-only` 是**拓扑操作、对内容完全无知**——只问「develop tip 是不是分支祖先」，任何提交都让答案变否。doc-only 分类器活在「要不要跑 suite」层，ff 活在「能不能合入」层，**两层从未交汇**——这才是「被本项目自己判为惰性的提交能 100% 杀 ff」的根本。
- **第二层**：`fan-in-execute.js:277-278` 的 delta = 分支整体相对 develop（52cc982b 加宽，回答**问题 A「分支要落地需不需要跑 suite」**——必须看整体，修得对）。但 ff 重试该问的是**问题 B「刚打掉我 ff 的 develop 增量，会不会让已跑的 suite 失效」**——只该看本次增量。而重试 = 回阶段 1 重跑 ⇒ 重新回答了 A ⇒ 对代码任务恒为「要跑」。**两个各自正确的机制在交界处漏了一个问题没问。**

**实证**：λ 的 70% 是台账提交（26/37 次、4.33/h），`tasks/*.md` 不被任何检查器读、对 suite 零影响却 100% 杀 ff；suite-fix-relaunch 3 轮 suite 里 2 轮触发是纯 tasks/*.md 提交，6h 浪费 ≈1400s ≈ suite 忙时 11%。

## Acceptance Criteria

- [ ] AC1: **落点在 `fan-in-ff-merge.sh` 持锁段内**（正持 merge 锁、develop 不会再动）——ff 失败时当场判 develop 新 tip 相对 `suite_head` 的增量是否惰性（**复用同一 `--classify-delta`，不发明新判据**）；惰性 ⇒ 锁内 merge develop + 立即重试 ff，全程锁内、毫秒级、零竞争窗口。
- [ ] AC2: 负控制——增量非惰性（含代码）⇒ 照旧 exit 1 回阶段 1 重跑（现有行为不变）。
- [ ] AC3: **suite 证书闸精确弱化（必须同批）**——`suite_head == tip` 改为 `suite_head == tip OR (suite_head 是 tip 祖先 AND delta(suite_head, tip) 经分类器判惰性)`；可取假：增量塞一个 `@static-object` 覆盖路径 ⇒ 闸必须拒绝。
- [ ] AC4: **「惰性」由现有分类器计算，不得假设**——`--classify-delta` 读 `@static-object` 声明判定，**禁止手写路径表**（历史教训：`orchestration/` 曾被当 doc 是错的，`tick-core-static-check.ts:69-76` 硬编码 5 个 orchestration/*.md 为输入；手写表必漂，必须走可计算定义）。

## Definition of Done

- [ ] 一个 `tasks/*.md`-only 增量触发 ff 失败，锁内判惰性、当场 merge + re-ff 跳过全量 suite（真实输出）；代码增量 exit 1 重跑；`@static-object` 增量被闸拒绝；惰性判定全走 `--classify-delta`（无手写路径表）。

## Touches

- tasks/gap-fan-in-ff-retry-reruns-suite-on-inert-increment.md（自身）
- plugin/scripts/fan-in-ff-merge.sh（持锁段内增量分类 + suite 证书闸弱化）
- plugin/test/fan-in-ff-executor-check.test.mjs（惰性跳过 / 代码重跑 / @static-object 拒绝）

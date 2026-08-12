---
to: outer
from: manager
type: 人裁定转达（执行归你）—— 32 条 needs-human 的处置
---

## 人 2026-08-12 00:4xZ 裁定：needs-human 32 条按四组处置

我把 32 条 needs-human 按「活是不是已落地」枚举分组后报给人，**人已逐组裁定**。原话：「同意。C 组不动。」四组处置如下，**执行归你**（翻状态是 lifecycle 操作，复核要跑验证，两者都在我 §0 边界外）。

**先说一条机制事实，它决定了这批的紧迫性**：`packages/quay/src/gate/lifecycle.ts:40` —— `"needs-human": { forward: null, back: "todo" }`。**needs-human 无前向边，closure 永远不会翻它。** 这 32 条一条都不会自己动。

### A 组｜14 条 —— **复核后翻 done**（人裁定：「这一步不新增任何工作量，只是把已完成的东西记成已完成，且它直接改善池子的真实读数」）

判定依据：`status=needs-human` **且** `task/<id>` 分支已是 `integration` 的祖先（代码在主线上）。**其中 12 条已滞留 16-23 小时。**

| 任务 | 合入 integration 时刻 |
|---|---|
| `gap-observer-registry-target-decommission-and-criterion-invalidation` | 08-11 00:54:08Z |
| `gap-chart2-s2-test-assertions-stale-after-delivery-c-d` | 08-11 00:56:21Z |
| `gap-reconcile-step-skipped-no-compliance-product` | 08-11 07:07:34Z |
| `gap-slot-free-not-an-event-slots-stay-empty-missed-without-trace` | 08-11 07:08:38Z |
| `gap-verification-round-missing-phase-ms-breaks-cost-attribution` | 08-11 07:09:16Z |
| `gap-nyf-branch-existence-vs-commit-trace` | 08-11 07:11:21Z |
| `gap-serial-install-family-shared-prebuilt-fixture` | 08-11 07:12:13Z |
| `gap-prerequisite-gates-prose-invisible-to-mechanisms` | 08-11 07:13:38Z |
| `gap-shipped-ts-files-are-not-bundled-80-raw-typescript-in-the-artifact` | 08-11 07:15:04Z |
| `gap-git-history-landed-master-stale-under-two-line-model` | 08-11 07:52:42Z |
| `gap-inner-heartbeat-fields-shrunk-no-minimal-contract` | 08-11 07:55:20Z |
| `gap-worktree-leak-after-fan-in-occupies-slot-permanently` | 08-11 07:58:31Z |
| `gap-judgment-computed-not-wired-to-action` | 08-12 00:18:34Z（你刚合的） |
| `gap-suite-blocking-self-lock-blocks-fix-family` | 08-12 00:18:46Z（你刚合的） |

**「复核」是 AC18 口径：不看勾选，自己重跑 measure。**「分支已合入」只证明代码进了主线，**不证明 AC 达成**——反方向的错今晚已出现过一次（`launch-settings` 是 done 但代码从未进主线）。**不盲翻。**

### B 组｜**5 条 gap-\* 作废**（人裁定）

它们引用 ADR-022 已物理删除的机制，永远不可能 eligible，且每轮进候选集污染排序：

| 任务 | 引用的已删机制 |
|---|---|
| `gap-plancheck-blocking-only-convergence` | `prepare-milestone.js` |
| `gap-plancheck-no-diminishing-returns-exit` | `prepare-milestone.js` |
| `gap-prepare-milestone-no-size-aware-routing` | `prepare-milestone.js` + `execute-milestone.js` |
| `gap-prepare-milestone-no-worktree-isolation` | `prepare-milestone.js` + `execute-milestone.js` + `milestone-worktree.ts` |
| `gap-split-decision-finality-not-enforced` | `prepare-milestone.js` |

**6 条 DIR-\*（DIR-103 / DIR-119 / DIR-119-D / D2 / D3 / D4）人裁定归我逐条看**——不在本次作废之列，**你不要动它们**，我看完另投。

### C 组｜5 条 —— **人裁定：不动**

`DIR-101` / `DIR-103-B` / `DIR-105` / `DIR-121` / `gap-audit-findings-not-backpropagated-to-earlier-detectors`。**维持 needs-human，不退回不作废。**

### D 组｜2 条 —— **退回 todo**（人裁定）

- **`gap-quay-self-hosting-e2e-proof`** —— **AC16③ 的路径**。它 `depends_on` 四条：两条已 done，另两条是它的兄弟 `gap-cold-start-skill-has-no-recovery-branch` / `gap-no-formalized-bare-metal-session-bootstrap`（均 todo）。
- `gap-split-session-liveness-signals-unblocks-lowconc`

**⚠ 与我 `003351` 那封的交互，执行前请一并考虑**：这两条（以及那两个兄弟）都在 `gap-quay-has-never-self-hosted-its-own-cold-start` 这棵 **compound 树**下，而该树此刻**结构性死锁**——`depsReadyFor`（`ready-pool-check.ts:993`）把 `parent` 计入 deps 且要求父 `done`，父是 compound 又要等 children 全 done，双向互等。**⇒ 只把它们退回 todo 并不足以让它们可派**，除非同时处置那个死锁。**退回仍应执行**（人已裁定，且这是正确的状态），但请知道它单独不解锁。

### 一并给你的量化背景

32 条里 **14 条是已完成的工作、11 条描述已不存在的机制** ⇒ **真正需要人做判断的只有 7 条（C 组 5 + D 组 2）**，其余 25 条是**记账没跟上，不是决策积压**。这也是人裁定 A 组「不新增工作量」的依据。

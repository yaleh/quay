---
id: gap-git-graph-branch-name-fallback-to-trunk-ref
title: git-history 的 branchNameOf 在 heads 查不到时 fallback 到合并提交自身的 ref，而合并提交恒在
  trunk 上 ⇒ 28 条 lane 的名字 100% 都是 develop，图上无法区分任何一条 task 分支
status: done
labels:
  - gap
  - webui
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-git-graph-row-key-collides-on-multiclaimed-commits
---
**type:** execution

## Proposal

**现象（2026-09-08 对生产实例 `/git-history` 的 `#git-graph-data` JSON 直接取直方图）**：
图上每一条折叠分支的摘要都写作 `develop · N commits · T（点击展开）`——**28 条 lane 的 `ref` 直方图是
`{ "develop": 28 }`**，即 100% 同名。而这些 lane 实际上是 `task/gap-process-budget-…`、
`task/gap-meta-divergences-…` 等互不相同的任务分支（从同页 trunk 提交的 subject
`Merge branch 'develop' into task/<id>` 可逐条读出真名）。

**根因**：`packages/quay/src/serve-git.ts:250` 的 `branchNameOf(history, hash)`——

    for (const [name, tip] of Object.entries(history.heads ?? {})) { if (tip === hash) return name; }
    return history.commits.find((c) => c.hash === hash)?.ref ?? hash.slice(0, 7);   // :254

第一段按 `heads` 反查分支 tip；task 分支在 fan-in 之后**通常已被删除**，`heads` 里查不到 ⇒ 落到 `:254`
的 fallback，取**该 hash 自己那条提交的 `ref`**。而传进来的 hash 是这条 lane 的**合并提交**，合并提交落在
`develop` 上 ⇒ `ref` 恒为 `develop`。**fallback 的返回值与「查不到」这一事实同形**（CLAUDE.md 硬规则 3b：
读不懂输入时不得返回与合格同形的值）——调用方无从区分「这条 lane 真叫 develop」与「没查着，给你个 develop」。

**为什么它必须先于视觉改进修**：`gap-git-graph-lane-visual-encoding-and-fixed-width` 要做的
「在各分支最近节点旁用反色/外框标注分支名」以及「按分支着色」，在 28 个名字全一样的前提下**无法验证也无意义**
——标出来 28 个 `develop`、着色也分辨不出谁是谁。故本任务是它的前置。

**修法方向**：真名的可靠来源不是 `heads`（会被删），而是**合并提交的 subject**——本仓库 fan-in 产生的合并
提交形如 `Merge branch 'develop' into task/<id>` / `Merge branch 'task/<id>' into develop`，可解析出分支名；
其次是第二父提交所在的 ref。**并且：解析不出时必须返回一个与「解析成功」可区分的取值**（如
`{ name: null, reason: "unresolved" }` 或显式 `unnamed@<short-hash>`），由渲染层决定怎么显示，
而不是伪装成 `develop`。

## Acceptance Criteria

- [x] AC1 生产载体读数：加载 `/git-history`，对 `#git-graph-data` 的 `branches[].ref` 求直方图，断言
      **最大同名条数 / lane 总数 < 0.5**（即不再出现「全体同名」）。取假：改动前实测 `{develop: 28}`，比值 1.0。
- [x] AC2 生产载体读数：断言至少有 **≥1 条** lane 的 `ref` 能与同页某条 trunk 提交 subject 里
      `into task/<id>` 捕获出的 `<id>` 对上（证明取到的是真名，不是任意别的字符串）。
      失败时打印对不上的 lane 清单与条数，而非布尔。
- [x] AC3 「未解析」不与「已解析」同形（硬规则 3b 的直接落实）：单测断言当 `heads` 为空且 subject 无法解析时，
      命名函数返回的取值**不等于任何真实分支名**、且携带一个可判定的 `unresolved` 标记；断言
      `branchNameOf` 的旧 `:254` fallback 在同一输入下返回 `develop`（红），新实现返回 unresolved（绿）。
- [x] AC4 负控制（回答硬规则 4 推论四：附一个 Y 为假则结果不同的对照）：构造两个 fixture——(a) 分支 tip 仍在
      `heads` 中，(b) 分支已删除只剩合并提交——断言两者都解析出**同一个**分支名。若 (b) 解析不出而 (a) 能，
      说明只修了一半。
- [x] AC5 `bash scripts/test.sh --for-task gap-git-graph-branch-name-fallback-to-trunk-ref` 退出码 0。

## Definition of Done

在**真实运行的实例**上加载 `/git-history`，把改动前后的 `branches[].ref` 直方图并列贴进提交信息
（前：`{develop: 28}`；后：多个互不相同的 `task/*` 名 + 若干显式 unresolved）；并附截图，
图上能逐条读出不同的分支名。**fixture 绿不算达成**——必须是这一次对生产数据的读数。

## Touches

- `packages/quay/src/serve-git.ts`
- `packages/quay/test/gap-git-graph-branch-name-fallback-to-trunk-ref.test.mjs`
- `packages/quay/test/gap-git-history-lane-identity-and-row-layout-overlap.test.mjs`
- `tasks/gap-git-graph-branch-name-fallback-to-trunk-ref.md`

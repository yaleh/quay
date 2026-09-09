---
id: gap-store-commit-propagation-field-aware
title: store-commit
  AC勾选/evidence类字段跟分支走——commitTaskWrite传播判据改字段级，配acShortCircuitVerdict并集读（GOAL-011退出条件①）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
goal_ac: AC-218
---
## Proposal

现状：`packages/quay-native/src/store.ts:1121-1153` 的 `commitTaskWrite()` 传播判据只按【分支名】——
`task/*` 分支不 ff 到 develop，其它任何分支（包括主检出的 `author`）无条件 `ffPushToDevelop`（:1152）。
它不看【这次写改的是哪个字段】。SPEC-store-commit-unification-2026-09-08.md §5 的判准是：一个写的传播
策略由「谁读这个字段、什么时候读」决定，不由「谁写它」决定——AC 勾选、`## Evidence`、任务自身关联 goal
状态更新这三类字段只被该任务自己的 fan-in（`ac-precheck` 读 worktree 副本）读，却在非 `task/*` 分支上写
时被无条件推 develop。已实证事故：`gap-cli-write-surface-lacks-toplevel-fields` 的 worker 经 ABI 勾满
8 条 AC（`212f4e811` 落 author/develop），5 分钟后 `acShortCircuitVerdict` 读 worktree 副本见 0/8，
判 exited-not-landed，烧 45 分钟并重派；2026-09-09 复核过去 48h 24 次 ff-red 全部是同一根因的 not-a-
fast-forward / refusing-to-update-checked-out-branch，SPEC 自己 7 天基线（291 次 fan-in、31 次冲突、
12 次落在 tasks/*.md）与此互相印证——不是历史遗留，是仍在持续发生的生产成本。

本任务做两件绑在一起的事（GOAL-011 退出条件①的两半，AC-218 已挂在其中一半但至今无实现任务）：

①给 `commitTaskWrite`（或其调用方 `write()`）加**字段级判据**——对比写前/写后 frontmatter+body，识别
本次变更的字段集合是否**只**含「AC 复选框行（`- [x]`/`- [ ]` 切换）/ `## Evidence` 段内容 / 该任务自身
`extra.goal`/`goal_ac` 关联字段」这类"只被自己 fan-in 读"的字段；若是，即便当前分支不是 `task/*`，也
**不** ff 到 develop（跟分支走，等该任务自己 fan-in 时随 worktree 分支一起进 develop）。混合写（同一次
写里还改了别的字段，如新建任务的初始字段、状态生命周期翻转）判为「必须推 develop 类」，**保持现状不变
**——宁可多推、不可少推，避免把混合写误判成纯 AC 写而漏推导致真正需要尽快到 develop 的字段（如新建对
象）反而不可见。

②改 `plugin/scripts/worker-driver.ts` 的 `acShortCircuitVerdict`，判据覆盖 **develop ref ∪ worktree
副本**的并集——不再对刚勾完还没来得及 ff 的 worktree 副本视而不见（AC-218 判据原文，测试文件路径已由
AC-218 点名：`plugin/test/ac-shortcircuit-develop-worktree-union.test.mjs`）。②本身在①落地后依然有意
义（worktree 副本合法地领先 develop 是①的直接后果，短路判据必须能看到这个新常态），两者不是互相替代
关系。

非目标（明确排除，同 GOAL-011 正文）：不改「写面保留 author」；不动 promotion-driver 的 todo→ready、
新建 task/goal 立案这类必须尽快到 develop 的写；不做 SPEC 阶段 3（驱动侧直写点收敛）。退出条件②③（fan-
in 冲突率前后对照的经验读数、事故复现窗口）留给本任务落地**之后**用 SPEC 基线方法测，不在本任务实现
范围内、不作为本任务的 AC。

## AC

- [x] `packages/quay-native/test/store.test.mjs` 新增用例：纯 AC 复选框切换（无其它字段变更）在非
  `task/*` 分支写入时，`commitTaskWrite` 返回 `propagated===false`（不 ff 到 develop）；
  `node --experimental-strip-types --test packages/quay-native/test/store.test.mjs` exit 0
- [x] 同一测试文件的负控制用例：混合写（AC 切换 + 新建字段或状态翻转同时发生）在非 `task/*` 分支写入
  时，仍 `propagated===true`（照常 ff 到 develop）——防止字段级判据把范围改宽波及不该改的写
- [x] `plugin/test/ac-shortcircuit-develop-worktree-union.test.mjs` 落地（AC-218 判据原文点名的文件），
  覆盖「AC 勾选只落在 develop ref 或 worktree 任务分支提交、工作树副本未同步」场景下 `acShortCircuitVerdict`
  仍判全勾；`node --experimental-strip-types --test plugin/test/ac-shortcircuit-develop-worktree-union.test.mjs`
  exit 0
- [x] `node --experimental-strip-types --test packages/quay-native/test/store.test.mjs` 与
  `plugin/test/ac-shortcircuit-develop-worktree-union.test.mjs` 均绿后，跑一次 `scripts/test.sh` 全量
  无新增红（回归）

## DoD

不是「测试绿」而是「在真实写路径上跑通」（硬规则 4 推论三，同 GOAL-011 的教训）：①用一次真实或忠实模
拟的 `gap-cli-write-surface-lacks-toplevel-fields` 事故场景重放——在非 `task/*` 分支（主检出）经现有
ABI 写路径勾满一个任务的全部 AC，确认 `acShortCircuitVerdict` 不再误判 0/N、不触发 exited-not-landed
重派；②GOAL-011 的 `AC-218` 记录（`goal: GOAL-011`，当前 `needs-human`）在本任务落地后可被重新评估——
其判据脚本路径存在且可跑（不要求本任务改动 AC-218 记录本身的 status，那是 goal-driver 下一轮巡检的事）；
③本任务落地视为 GOAL-011 退出条件①的完整兑现（两半都做），退出条件②③留给落地后的经验读数窗口，不在
本任务的完成判定范围内。

## Touches

- packages/quay-native/src/store.ts
- packages/quay-native/test/store.test.mjs
- plugin/scripts/worker-driver.ts
- plugin/test/ac-shortcircuit-develop-worktree-union.test.mjs
- tasks/gap-store-commit-propagation-field-aware.md
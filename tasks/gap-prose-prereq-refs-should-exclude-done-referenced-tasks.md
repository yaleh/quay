---
id: gap-prose-prereq-refs-should-exclude-done-referenced-tasks
title: prosePrereqRefs 的 add() 只排除 superseded、不排除 done ⇒
  引用了已完成任务的散文句会被读成「未建边前置」，任务无法自愈地被永久拦在晋升闸外
status: todo
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Finding

**缺陷（实测 2026-09-18，非推断）**：`plugin/scripts/ready-pool-check.ts` 的 `prosePrereqRefs`（约 :1439）内部的 `add(id)` 通过 `readTaskStatusOnDisk` 读被引用任务的状态，**只跳过 `superseded`，不跳过 `done`**。而一个已 `done` 的任务不可能是「尚未满足的前置」。⇒ 只要散文里有一句命中 `PREREQ_KEYWORD_RE` 的话旁边带一个反引号任务 id，而该 id 早已 done，`prosePrereqGap` 仍然非空，任务被 fail-closed 拦在 todo→ready 闸外；且这个状态**无法自愈**——被引用任务已经完成，不会再有任何后续事件让缺口消失，只能靠人改写措辞。

**生产受害体（实测）**：`gap-touches-parser-early-subheading-latch-hides-declaration` 在 `.quay/promotion-outcome.jsonl` 中被跳过 **88** 次，理由均为 `prosePrereqGap=[gap-git-history-window-notes-ref-dominates]`；而被引用的那个任务已于 `2026-09-18T14:28Z`（commit `8ec3fe692`）翻 done。触发句含「当前阻塞器」（关键词 `阻塞`）紧邻一个反引号 id。

**同类先例（发生率至少 2）**：2026-09-15 一个任务因同形机制在 round 378-382+ 被连续拒绝，被引用任务同样已 done（见 `ready-pool-check.ts` 约 :1331 的注释；对应已完成的 `gap-prose-prereq-negation-window-is-before-keyword-only-and-sibling-markers-are-chinese-only`，那条修的是否定词窗口与 sibling 词表，**没有**触及「被引用者已 done」这一轴）。

<!-- dedup-ref -->
**查重（已核）**：`task_list` 对 `gap-prose-prereq` 前缀只有三条，均为 done：`gap-prose-prereq-detector-blind-to-repo-own-conventions`（漏检扩面）、`gap-prose-prereq-negation-blind-and-paragraph-scoped`（作用域与否定）、`gap-prose-prereq-negation-window-is-before-keyword-only-and-sibling-markers-are-chinese-only`（后置否定与英文 sibling）。三者机制均不同，本条治的是「被引用任务状态已是 done 却仍计为缺口」，非重复。

## Requested action

在 `prosePrereqRefs` 的 `add(id)` 里，除现有的 `superseded` 早返回外，再加：`readTaskStatusOnDisk(tasksDir, id) === "done"` 时也早返回。**保持 fail-closed**：`todo` / `ready` / `in-progress` / 未知状态 / 缺失或无法解析的 status **一律仍计入缺口**——未知状态绝不能被当成 done（硬规则 3b：读不懂不得伪装成合格）。不改关系边（`depends_on`）语义；`prosePrereqRefs` 由 ready-pool 分析与 promotion-driver 共用，修一处即两处生效。

## Acceptance Criteria

- [ ] AC1（先红）在 `plugin/test/ready-pool-check-s19.test.mjs`（若不适合则新建同目录兄弟测试）加用例：任务体含 ``前置：`gap-x` ``，tasks 目录里 `gap-x` 的 status 为 `done` ⇒ `prosePrereqGap` 严格等于 `[]`；修复前该用例**红**，贴原始红输出。
- [ ] AC2（负控制，防改成恒绿）同一任务体，`gap-x` status 为 `todo` ⇒ 仍为 `['gap-x']`；`gap-x` 无 status 或 status 无法解析 ⇒ 仍被计入缺口；两个方向各贴读数。
- [ ] AC3（不回归）`node --test plugin/test/ready-pool-check-*.test.mjs plugin/test/promotion-driver-*.test.mjs` 退出码 0，贴 `# tests` / `# pass` / `# fail` 三行。
- [ ] AC4（生产读数）落地后，对上述受害体正文（触发句 + 已 done 的引用）在真实 tasks 目录上求值，`prosePrereqGap` 不含那个已 done 的 id；贴读数。

## Definition of Done

**真实落地判据**：被 ready-pool 分析与 promotion-driver 共用的那一份 `prosePrereqRefs` 本体不再把已 done 的引用计为未建边前置；不是只在测试夹具里绿。不改关系边语义，不放宽对 todo/ready/未知状态的 fail-closed。可回滚：还原 `add()` 里新增的一行早返回即可。

## Touches

- plugin/scripts/ready-pool-check.ts
- plugin/test/ready-pool-check-s19.test.mjs
- tasks/gap-prose-prereq-refs-should-exclude-done-referenced-tasks.md

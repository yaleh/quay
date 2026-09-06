---
id: gap-sync-develop-to-doc-not-doc-silent-noop
title: syncDevelopToDoc 的 not-doc 分支静默无痕——分支改名后同步永久失效且不可观测
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Finding

`syncDevelopToDoc`（`plugin/scripts/driver-filters.ts:483`）里 `cur !== docBranch` 这条分支
（:489）直接 `return "not-doc"`，**不调用 `writeDocDevelopSyncEvent`**——与其它分支（`error`/
`not-ff`/`synced`）均落痕形成不对称。这是 CLAUDE.md 硬规则 3b 的实例：一个"读不懂/对不上号"的
判定结果，与"无事发生"在记录上同形。

**真实发生过一次，本次会话实测**（`gap-branch-rename-manager-doc-to-author` 落地过程中）：

- 分支改名（`git branch -m main/manager-doc author`）reflog 实测时间点 `2026-09-05T18:31:45Z`。
- 常驻 `promotion-driver` 进程自 `2026-08-31T12:45:37Z` 起运行，内存中的 `DOC_BRANCH` 常量停在
  改名前的值（Node 进程加载代码后不热更新，同已知模式 `driver-code-fix-activation-requires-main-sync-restart`）。
- 改名后每轮 `syncDevelopToDoc` 读到真实分支名 `cur="author"`，与陈旧常量 `docBranch`（旧值）
  对不上 ⇒ 命中 `cur !== docBranch` ⇒ 返回 `"not-doc"` ⇒ **不写任何事件**。
- 实测 `.quay/doc-develop-sync.jsonl` 最后一条记录停在改名前的 `18:18:56.733Z`，此后**零记录**——
  不是同步没触发，是触发了但这条路径本来就不落痕。
- 后果：主检出（doc 分支）静默落后 develop **8 个提交**，直到人工发现任务状态分歧
  （`[done ⚠ disk:ready]`）才追查到根因。若无人发现，该状态会无限期持续——**这条同步机制在分支
  改名/任何"当前分支名与常量对不上"的场景下会永久失效，且没有任何观测信号**。
- 修复动作（本次会话已做，作为止血，不是本任务的范围）：重启 `promotion-driver`
  （新进程 supervisor pid=3696193 / driver pid=3696202，取代 08-31 启动的旧进程），新进程从磁盘
  重新加载，`DOC_BRANCH` 恢复为当前值 `"author"`，同步恢复。**本任务要解决的是"以后不需要靠人
  工发现才能重启"这件事本身**。

## Acceptance Criteria

- [ ] AC1（能取假，核心修复）：`cur !== docBranch` 分支改为调用 `writeDocDevelopSyncEvent`
      写一个可区分事件（如 `doc-develop-sync-branch-mismatch`，字段至少含 `cur`/`expected`），
      而不是裸 `return "not-doc"`；⛔ 该分支仍不落痕则假。
- [ ] AC2（能取假，单测覆盖）：新增/扩展 `plugin/test/driver-filters.test.mjs` 的用例——构造一个
      "当前分支名与传入 docBranch 参数不一致"的 fixture，断言 `writeDocDevelopSyncEvent` 被调用
      且事件类型可区分于 `synced`/`not-ff`/`error`；⛔ 无该单测覆盖则假。
- [ ] AC3（能取假，负控制）：同一单测里验证 `cur === docBranch` 且 `behind === 0`（真正的"已同步，
      无需动作"）时**仍然**不写事件——本任务只补"对不上号"这一种情形的可观测性，不改变"确实无需
      同步"时的静默行为（那是合理的降噪，不是缺陷）；⛔ 把正常的"already"路径也改成写事件则视为
      过度修复、不通过。
- [ ] AC4（能取假，生产可用性）：该事件类型被至少一处"driver 健康度/观测"读面消费或至少在
      `orchestration/manager-tick-readings.ts` 或等效巡检脚本里可查（不要求本任务把它接进告警，
      但要求它是一个可被查询到的、有意义的信号，不是写完即弃的孤儿字段）；若判定"接入告警"超出
      本任务范围，需在此明确记录并给出后续任务指针，而不是留空。
- [ ] AC5（能取假，回归）：`node --test plugin/test/driver-filters.test.mjs` 全绿，且改动后
      `syncDevelopToDoc` 的四个既有分支（error/not-ff/synced/already）行为不变（既有单测不因本次
      改动而需要修改断言，除非断言本身就是本任务要修的那处静默）。

## Definition of Done

`cur !== docBranch` 分支落痕、有单测覆盖真实触发该分支的场景、既有分支行为不受影响、新事件是可
查询而非孤儿字段——下一次任何原因造成"当前分支名与 driver 进程内存里的预期分支名对不上"，
不再需要靠人工发现任务状态分歧才能定位根因。

## Touches

- plugin/scripts/driver-filters.ts
- plugin/test/driver-filters.test.mjs
- tasks/gap-sync-develop-to-doc-not-doc-silent-noop.md（self-touch）

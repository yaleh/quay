---
id: gap-tasks-page-develop-ref-full-history-git-log-cost
title: web /tasks·/task/&lt;id&gt; 的 develop-ref 读面阻塞：readTaskCommitTimesAtRef
  全历史 git log 遍历 + 详情页单任务读无缓存，冷请求 ~8.8s 同步阻塞整个 serve 进程
status: ready
labels:
  - gap
  - defect
  - performance
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`gap-dispatch-reads-stale-main-checkout-task-status`（done）把 web `/tasks` 列表页与 `/task/<id>` 详情页的 status/title/updated 读面统一改为以 `develop` git ref 为单一正源（AC1-AC6），这是**正确的正确性修复**——主检出 `main/manager-doc` 只是写面、常年落后 develop（实测落后 17～53 个提交），只读磁盘会导致列表/详情页互相矛盾（列表 done、详情 ready）。**但该任务的 AC5 只写了「渲染延迟可接受」，未量出具体数字**——本任务补量出：在接近生产规模的 develop（1668 个任务、11592 次提交，2026-09-01 实测）上，这层 develop-ref 读面本身引入了随**仓库提交总数**（而非任务数）线性增长的同步阻塞成本，且已在 2026-08-30 一次生产诊断会话中被口头记录（"`/tasks` 首次请求 ~7.4s，有缓存，别当挂起"）但从未正式立案。

**根因（`packages/quay/src/observation.ts`，全部 `execFileSync` 同步阻塞 Node 事件循环）**：

| 函数 | 位置 | git 命令 | 缓存 | 实测（1668 任务/11592 提交） |
|---|---|---|---|---|
| `readTaskStatusMapAtRef` | `observation.ts:1288` | `ls-tree` + `cat-file --batch` | TTL 2000ms | ~1.9s（未命中） |
| `readTaskTitleMapAtRef` | `observation.ts:1320` | **重复**跑一遍同样的 `ls-tree`+`cat-file --batch`（与上面读的是同一份原始内容，只是解析字段不同） | 独立 TTL 2000ms | ~1.9s（未命中） |
| `readTaskCommitTimesAtRef` | `observation.ts:1353-1382` | `git log --format=%cI --name-only <ref> -- tasks/`（**无 `-n`/`--since`，遍历整个仓库历史找每个文件的首次出现**） | TTL 2000ms | **~5.0s**（未命中） |
| `readTaskAtRefMeta`（详情页） | `observation.ts:1180` | `git show <ref>:tasks/<id>.md` | **无缓存** | ~8ms/次，但每次详情页请求都付 |
| `readTaskCommitTimeAtRef`（详情页） | `observation.ts:1388-1399` | `git log -1 --format=%cI <ref> -- tasks/<id>.md`（单文件也要走历史找匹配提交） | **无缓存** | ~0.5s/次，每次详情页请求都付 |

`/tasks` 冷缓存首次请求 ≈ 13ms(`ls-tree`) + 1.9s + 1.9s + 5.0s ≈ **8.8s**，且是 `execFileSync` **同步**——这 8.8s 内整个 Node 进程（含 `/health`、`/live` 等其它路由）一起卡死，不只是这一个请求慢。TTL 只有 2 秒，两次访问间隔一旦超过 2 秒（几乎所有真实浏览行为）就重新付全价。

**历史证据**：meta-cc 检索到的 2026-08-30 生产诊断会话（session `0996a002-b494-4563-b256-dd45a47cbe2f`）已实测同一根因（`git log develop -- tasks/` ~7.4s），当时被当作"已知、有缓存缓解"口头带过，未开性能任务；本任务是该口头记录的正式立案。

**范围裁定（人 2026-09-01）**：只做以下两个方向的组合，不做全部候选方案——
1. **`readTaskCommitTimesAtRef` 去"全历史遍历"化**：改为增量维护的提交时刻缓存（而非每次未命中就全量重放 `tasks/` 路径的整个历史）。
2. **后台预热**：由一个独立的定时刷新（不在请求路径内触发）主动维持 develop-ref 缓存新鲜，使请求路径在绝大多数情况下只读缓存、不 spawn git 子进程。

其余候选（合并 status+title 读、详情页复用列表缓存、`execFileSync`→异步、TTL 调参）留作后续任务，不在本任务范围。

## Plan

1. **增量提交时刻缓存**：`readTaskCommitTimesAtRef` 改为維护一个持久化的 `<taskId → lastCommitEpochMs>` 缓存（进程内 Map 即可，随后台刷新更新，不要求跨进程重启存活）；刷新时只需 `git log --format=%cI --name-only <ref> -- tasks/ <上次已知 HEAD>..<ref当前HEAD>` 增量 diff 出新提交，合并进已有 map，不再对全历史重放；`ref` 首次冷启动仍需一次全量建表（可接受，因为只发生在进程启动、不在请求路径内）。
2. **独立后台刷新 tick**：新增一个不依赖请求触发的定时任务（例如 serve 启动时起一个 `setInterval`，周期与 driver 机械 fan-in 周期相当，如 10-30s），主动调用 `readTaskStatusMapAtRef`/`readTaskTitleMapAtRef`/`readTaskCommitTimesAtRef` 的 `force:true` 刷新路径，写入同一份缓存；请求路径改为**只读缓存、缓存为空才现算一次兜底**（保留现有 fail-open 语义：git 不可用时返回空 map、caller 退化到 disk）。
3. **详情页单任务读面接入同一批量缓存**：`readTaskAtRefMeta`/`readTaskCommitTimeAtRef` 优先从后台刷新维护的批量缓存里查（缓存里已经有该任务的 status/title/commit time），只有缓存未覆盖该任务（例如任务是新建的、尚未提交到 develop）时才退化为单任务 git 调用。
4. 后台刷新失败（git 不可用/仓库损坏）不得让 serve 进程崩溃或使请求路径退化为无限期阻塞——失败仅跳过本轮刷新、沿用上一份缓存，直到 TTL 过期后请求路径退回现算兜底（保持现有 fail-open 语义，不新增 fail-closed 面）。

## Acceptance Criteria

- [x] AC1（能取假，主修，硬数字）：在合成的大规模 fixture（≥1500 个任务、≥10000 次触碰 `tasks/` 的提交，脚本生成而非真实仓库）上，`/tasks` 冷缓存首次请求（无预热、直接打）**< 1.5s**；预热后（后台刷新已跑过至少一轮）请求 **< 200ms**。（⛔ 冷请求 ≥1.5s 或预热后 ≥200ms ⇒ 假。）
- [x] AC2（能取假）：构造 develop 在两次后台刷新之间新增 N 个提交（N=5）的场景，第二次刷新耗时与 N 成正比而非与仓库总提交数成正比（断言：仓库提交数从 10000 加到 20000，若为增量实现，同样 N=5 的刷新耗时不随之显著增长；若仍是全量重放，耗时会随总提交数线性增长——用这个对照区分真做了增量还是只是包了层缓存）。
- [x] AC3（能取假）：`/task/<id>` 详情页在后台缓存已覆盖该任务时，不再对该任务单独 spawn `git show`/`git log`（断言：mock/spy `execFileSync` 调用次数，缓存命中路径下详情页请求触发 0 次新 git 子进程）；缓存未覆盖（任务只存在于磁盘、develop 无该文件）时仍正确退化为单任务读（现有语义不变）。
- [x] AC4（能取假，fail-open 回归）：后台刷新在 git 不可用（临时改 `PATH`/mock 报错）时不抛出未捕获异常、不使 serve 进程退出；下一次成功刷新后自动恢复正常缓存内容。
- [x] AC5（回归）：`gap-dispatch-reads-stale-main-checkout-task-status` 的 AC1-AC4/AC6（develop 覆盖 status/title/updated、disk≠develop 分歧标记、无 `git checkout develop`、晋升路径读 develop）全部继续通过，不因本次缓存改造而退化。
- [x] AC6（回归）：`packages/quay/test/observation.test.mjs`、`packages/quay/test/serve-task.test.mjs`、`packages/quay/test/serve-board.test.mjs` 全绿；`scripts/test.sh` 全量套件绿。

## Definition of Done

`/tasks`、`/task/<id>` 的 develop-ref 读面在接近生产规模（1500+ 任务/10000+ 提交）下，冷请求 < 1.5s、预热后 < 200ms（AC1 实测数字，非"可接受"这类不可取假描述）；`readTaskCommitTimesAtRef` 不再对每次缓存未命中做全历史重放（AC2 增量对照证实）；详情页单任务读面复用同一批量缓存、缓存命中时零新增 git 子进程（AC3）；后台刷新失败 fail-open 不影响 serve 存活（AC4）；`gap-dispatch-reads-stale-main-checkout-task-status` 的既有 AC 全部回归通过（AC5）；单测+全量套件绿（AC6）。

## Touches

- packages/quay/src/observation.ts（`readTaskCommitTimesAtRef` 增量化、新增后台刷新入口、`readTaskAtRefMeta`/`readTaskCommitTimeAtRef` 接入批量缓存）
- packages/quay/src/serve.ts（serve 启动时挂载后台刷新定时任务）
- packages/quay/src/serve-task.ts（详情页读面改走缓存优先路径，如需要）
- packages/quay/test/observation.test.mjs（AC1/AC2/AC4 单测：合成大规模 fixture、增量刷新耗时对照、fail-open）
- packages/quay/test/serve-task.test.mjs（AC3 单测：详情页零新增 git 子进程）
- tasks/gap-tasks-page-develop-ref-full-history-git-log-cost.md（自身）

## Needs-Human

**执行 2026-09-01T14:46:51.533Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=suite: suite red

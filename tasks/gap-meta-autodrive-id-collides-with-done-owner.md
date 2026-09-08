---
id: gap-meta-autodrive-id-collides-with-done-owner
title: meta-driver autoDrive 的 id 由 mechanismKeyword 确定性派生、done owner 不拦截 ⇒
  新发现静默覆盖既有 done 任务，9 小时零新增而轮次自报 1/1 auto-driven
status: done
labels:
  - gap
  - defect
  - meta-driver
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（直接量，2026-09-08 15:4xZ 实测）**：meta-driver 完全健康——`round 891`、30s 一轮、`halted=false`、pid 653532 自 07:33 存活——但**最近 9 小时零新任务**。逐层排查后定位到 `driveItems()`：

- 轮次层正常：最近 9h 约 1000 轮，`.quay/meta-driver-round.jsonl` 持续在写。
- 语义半触发闸 `shouldJudge` 正常：7 轮真跑完整语义半（其余按 `digest-unchanged` 跳过，属设计内节流）。
- divergence 通道无输入：全窗口 `divergenceCount: 0`（14 条 AC 全过），正常。
- **autoDrive 层出错**：7 轮里 5 轮 `autoDrive: []`，**2 轮产出候选且 `accepted: true`，但两次 id 都是 `gap-meta-syncdeveloptodoc`** —— 一条 2026-09-06T12:32 创建、当天即 `done` 的既有任务。

**根因（位置判定）**：`plugin/scripts/meta-driver.ts:1039`

```
const id = `gap-meta-${item.mechanismKeyword.toLowerCase().replace(/[^a-z0-9]+/g, "-")...}`;
```

id 是 `mechanismKeyword` 的**确定性 slug，不带任何唯一化**；而 `:1028-1035` 的去重闸 `blockingOwners()` **只挡未完成的 owner**，命中 `done` 的 owner 不拦，只在正文塞一行 ⚠️ 提示（`:962` 的 `staleOwners` 分支）。于是 `mechanismKeyword: "syncDevelopToDoc"` 派生出的 id 撞上既有 done 任务，`createTask` 走 `quay-native task create <既有 id>` 直接**覆盖它的正文**，且 autoDrive 路径不传 `--status`，任务保持 `done`。

**git 产物佐证（不是推断）**：`tasks/gap-meta-syncdeveloptodoc.md` 在 `2026-09-08T08:58:08`（提交 e460b3d34）与 `2026-09-08T14:32:20`（提交 1e38d84ba）各有一次提交，时刻与那两轮探测逐秒吻合；两次前后 `status` 均为 `done`；标题被改写（`语义同步 fallback 的 ff 步 3/6 失败` → `semantic-ff-failed 事件不落 detail：常驻 driver 跑旧代码且无检测`）——**14:32 的新发现覆盖掉了 08:58 的发现，两者不是同一个问题**。该任务正文第 17 行的 ⚠️ 里还把 `gap-meta-syncdeveloptodoc.md[done]` 自己列为 stale owner，自指。

**为什么载体上看不出来（硬规则 3b）**：这两轮的 `fact.reason` 是 `0 divergences, 0/0 proposals, 1/1 auto-driven, 0/0 decisions routed`——**「覆盖了一条 done 任务」与「真的立了一条新任务」输出同形**，都记 `accepted: true` + `filed as <id>`。所以只有去数 task 才发现 9 小时零新增。后果是两条真实发现被埋进一条 done 任务体，没有任何处理者会捡起它们。

**区分性对照（若判断为假则结果不同，硬规则 4 推论四）**：①若是 driver 停摆 ⇒ 轮次会停，实测 891 轮在写；②若是闸把语义半全跳了 ⇒ 每轮应为 `skipped-unchanged`，实测 7 轮带 `autoDriveOffered` 完整跑完；③若是真的没发现 ⇒ 7 轮应全 `autoDrive: []`，实测 2 轮 `accepted: true`。三条均被证否。

**方案**：给 `driveItems()` 补一个 done-owner 判定，且**「无法立案」必须有独立取值，不与「已立案」共用输出**：
1. 派生出 id 后、`createTask` 前，检查 `tasks/<id>.md` 是否已存在。已存在 ⇒ 不走 `createTask`。
2. 已存在且为 `done`/`superseded` ⇒ 这正是「问题仍在而任务已 done」，应作为**新任务**立案（id 加区分后缀，如 `-2` 或按 `evidenceKey` 派生），并在正文保留 staleOwners 证据；⛔ 不覆盖既有任务体。
3. 无论走哪条分支，`AutoDriveResult.reason` 必须能区分三态：`filed as <新 id>` / `rejected: 未完成 owner 在管` / `refiled as <新 id>（既有 <旧 id> 已 done）`——`accepted: true` 不得再出现在「写进既有任务」的路径上。

**去重（按机制词，非症状词）**：已 grep `blockingOwners` / `findOwningTasks` / `staleOwners` / `mechanismKeyword` / `driveItems` / `createAutoDriveTask` 于 `develop` 全部 `tasks/*.md`——命中 3 条均为他题（`gap-meta-kind-violates-spec-no-new-probe-driver-kind`、`gap-meta-driver-cap-undeclared-concurrency-literal`、`gap-meta-driver-concurrency-literal-cap-undeclared`，皆 done，讲 probe kind 与并发字面量），无覆盖本机制者。

## Acceptance Criteria

- [x] 单测全绿（含本任务新增用例）：`node --experimental-strip-types --test plugin/test/meta-driver.test.mjs`
- [x] 新增用例按位置存在且命名指向本机制：`test "$(grep -c 'done-owner\|doneOwner' plugin/test/meta-driver.test.mjs)" -ge 1`
- [x] `driveItems` 里存在「派生 id 已存在」的独立分支，且它不调用覆盖路径：`test "$(grep -c 'existsSync(path.join(root, "tasks"' plugin/scripts/meta-driver.ts)" -ge 1`
- [x] 三态可区分（硬规则 3b）：`AutoDriveResult.reason` 的取值里存在 refiled 这一态：`grep -q 'refiled as' plugin/scripts/meta-driver.ts`
- [x] 负控制（判据能取假）：把新增判定分支注释掉后重跑 `node --experimental-strip-types --test plugin/test/meta-driver.test.mjs` 必须失败——判据若在关掉实现后仍通过，它就是回声不是测量

## Definition of Done

真实落地 = **生产载体上出现新行为**（DIR-026 Reading A，不是「测试存在」）：实现合并进 `develop` 并让常驻 meta-driver 重启加载新代码之后，`.quay/meta-driver-round.jsonl` 中**实现落地时刻之后**的轮次里，至少一条 `autoDrive` 候选的处置属于新三态之一（`refiled as <新 id>` 或 `rejected`），且**不再出现「`accepted: true` 且其 id 对应的 `tasks/<id>.md` 在本轮之前已存在」**这种记录；同时 `git log -- tasks/gap-meta-syncdeveloptodoc.md` 在实现落地后不再新增由 meta-driver 产生的 `task_write` 提交。核对命令须读真实载体与 git 历史，不得由 fixture 或注入数据满足。

## Touches

- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `tasks/gap-meta-autodrive-id-collides-with-done-owner.md`
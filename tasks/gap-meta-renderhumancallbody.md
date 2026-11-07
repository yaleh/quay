---
id: gap-meta-renderhumancallbody
title: human-call 任务必须带线首 **PARKED 标记，不得进入派发池
status: ready
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
renderHumanCallBody 产出的 meta-human-call 任务不带线首 `**PARKED` 标记，而 isParked 是派发池唯一的排除半边 ⇒ 只能由人裁定、worker 结构上勾不了 AC 的裁定任务被推进 ready 派发池烧掉：2026-11-07 gap-meta-call-ac-936-goal-914-103 在 needs-human 停 31 分钟后被改 todo、29 秒后被晋升 ready、派给 worker，AC 4 条一条未勾、exited-not-landed 后回到 ready；worker kind 无重试上限（driver-filters.ts:56「worker 无重试上限 ⇒ 空集」）⇒ 每轮重派，而 AC-936 的 verdict=fail 已连续 111 轮（timeSeries goal:AC-936:verdict crossed=true），两次 meta-human-call 立案（一次停在 todo 隐形、一次在 ready 空转）都没让它到达人。

本轮读数（parking.needsHuman.counts）= `{"parking-reason-stale":0,"still-blocked":0,"no-registered-judge":4,"not-evaluated":0}`，采于 2026-11-07T06:58:37Z，由 meta-driver 机械采集。
涉及机制关键词：`renderHumanCallBody`（立案前已搜既有任务，无人认领）。

## AC
- [x] `node --experimental-strip-types --input-type=module -e "import { renderHumanCallBody } from './plugin/scripts/meta-driver.ts'; import { isParked } from './plugin/scripts/ready-pool-check.ts'; const item={question:'q',title:'t',options:'o',origin:'r',irreversible:'a choice that is hard to undo later',touches:'plugin/scripts/meta-driver.ts',conflict:[{source:'CLAUDE.md',quote:'x'}]}; const body=renderHumanCallBody(item,null,'2026-11-07T00:00:00Z','gap-meta-call-probe'); if(!isParked({body})){console.error('renderHumanCallBody output WOULD enter the dispatch pool');process.exit(1)} console.log('excluded-from-dispatch-pool')"` ⇒ 退出 0 且打印 excluded-from-dispatch-pool —— 证明 renderHumanCallBody 产出的任务体会被派发池自己的读取器 isParked 判为已停放，裁定任务不再被 worker 空烧；判据跑的是行为（喂真函数、用真 isParked），不是源码布局。

## DoD
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Evidence（2026-11-07，worker 会话，worktree /data/home/yale/work/quay-worktrees/gap-meta-renderhumancallbody）
- 实现：`plugin/scripts/meta-driver.ts` 的 `renderHumanCallBody` 现在渲染①线首 `**PARKED**（<日期>，meta-driver 机械立案；等人工裁定）…`（`ready-pool-check.isParked` 用它把任务挡出待派池）与②按 `readUnparkDeclaration` 读取面写的**可跑只读** unpark 检查（`grep -q '^## 人的裁定' tasks/<id>.md && echo ruled`，期望输出 `ruled`）；同时把 AC 的裁定落点明确为任务体的 `## 人的裁定` 段，使「检查读的量」与「AC 要求人写的量」是同一个量（硬规则 4c）。无 taskId 时不渲染路径命令（指向 `tasks/undefined.md` 的检查会恒红，把「没渲染」伪装成「人还没裁定」）。
- AC 判据逐字复跑（worktree 根）：`excluded-from-dispatch-pool`，exit 0。**负控**（把 `plugin/scripts/meta-driver.ts` 换回 develop 版本后跑同一条判据）：`renderHumanCallBody output WOULD enter the dispatch pool`，exit 1 ⇒ 判据能取假，不是恒真装饰。
- 行为侧（用生产读取器，不看源码布局）：把渲染结果连同 frontmatter 落成 `tasks/gap-meta-call-probe.md` 后跑 `scanParkedUnpark` ⇒ `counts={"unpark-passed":0,"unpark-still-blocked":1,"no-unpark-check":0,"not-evaluated":0}`（人未裁定）；在任务体追加 `## 人的裁定` 段后复跑 ⇒ `unpark-passed`，note 为 `output has "ruled"`。能力判定器未拒（命令是只读读数），也没有落进 `no-unpark-check`。
- ��测：`node --test plugin/test/meta-driver.test.mjs` ⇒ 183 pass / 0 fail，其中新增两条：①`isParked` 判真 + 删掉标记行后必须判假（取假臂）；②unpark 声明可被 `readUnparkDeclaration` 读出、命令 command-shaped、并在「未裁定 / 已裁定」两态各真跑一次。
- L_D code:doc: docLines=0 codeLines=90 ratio=0.000 verdict=PASS flagged=false（`node experiments/quay-perpetual-stream/scripts/git-lens-instrument.mjs ld --numstat-file <(git diff --numstat develop...HEAD)`）

## Touches
- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `tasks/gap-meta-renderhumancallbody.md`
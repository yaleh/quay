---
id: gap-task-write-duplicates-frontmatter
title: "6 任务文件双 frontmatter：task_write 重复写 frontmatter → 修数据 + 查根因 + 加 >1 ^id: 行检测器"
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

2026-10-30 排查「1 ready / 0 in flight」误报时发现：6 个任务文件含**两块完整 `---…---` frontmatter**，首块是权威状态（解析器读它），次块是残留（`grep '^status:'`/看板读到它），产生互相矛盾的两个 status 读数：

| 文件 | 首块(权威) | 次块(残留) |
|---|---|---|
| tasks/gap-ac297-git-history-page-zh-chrome-nav-current-and-own-title.md | done | ready |
| tasks/gap-ac326-branch-discard-drill-real-reading.md | done | retired |
| tasks/gap-d24e303c-skill-refs-plugin-loop-violates-ac3.md | superseded | superseded（同值重复） |
| tasks/gap-run-static-checks-parallelize-boheidc.md | superseded | superseded（同值重复） |
| tasks/gap-touches-parser-early-subheading-latch-hides-declaration.md | done | ready |
| tasks/goal-035-merge-and-postmerge-verify.md | done | ready |

损坏引入时间跨 2026-08-12 ~ 2026-10-10，已提交。根因已定位到一例（`git show 78ea4b68e`，gap-ac297）：一次 `task_write by cli:NNN`（worker 回写实现证据 + 勾选 AC）在**已有 frontmatter 的 body 之前又插入了整块新 frontmatter**（`+--- id… status: ready ---`），而非原地更新首块 frontmatter ⇒ 双 frontmatter。写路径落在 `packages/quay-native/src/store.ts` / `packages/quay/src/core/frontmatter-store-base.ts`（frontmatter 序列化）。

本任务三合一：① 机械修这 6 个文件（去重 frontmatter，保留权威首块，不动其余内容）；② 定位并修 task_write 重复 frontmatter 的根因 + 回归测试；③ 加一个「文件含 >1 个 `^id:` 行（双 frontmatter）」的检测器。

merge-candidate：`task-granularity-advice.ts` 无重叠 peer（数据文件与 store 写路径无其他 open 任务）。非重复：DIR-029 讲的是 body `dirStatus:` 行重复 frontmatter lifecycle，与本机制（写路径插第二块 frontmatter）不同。

## Acceptance Criteria

- [ ] AC1 修数据（6 文件单 frontmatter）：对下列 6 个文件逐一 `grep -c '^id: '` == 1 且 `grep -c '^status: '` == 1，且唯一 status == 权威首块值（done：gap-ac297 / gap-ac326 / gap-touches-parser / goal-035；superseded：gap-d24e303c / gap-run-static-checks-parallelize）。贴每个文件的 `grep -c` 与 `grep -m1 '^status:'`。
- [ ] AC2 修数据（无内容损失）：每个文件 `git diff` 只删第二块 frontmatter（连续 `---…---` 块），首块与 body 逐字未变（贴 `git diff --stat` + 每个文件 diff 全文，证明无正文/AC/DoD 改动）。
- [ ] AC3 根因定位并修复：实现证据**具名**写路径（`store.ts`/`frontmatter-store-base.ts` 的哪个函数 + 哪一行把 body 里已有的 frontmatter 再拼一份），并修复为「body 若含 frontmatter 则替换/剥离，⛔ 不重复插入」。
- [ ] AC4 回归测试：在 `packages/quay-native/test/store.test.mjs`（或 `packages/quay/test/frontmatter-store-base.test.mjs`）新增断言——一次 `task_write` 其 body 含完整 `---…---` frontmatter 时，落盘文件恰 1 个 `^id:`、1 个 `^status:`，且 status 取写入值而非 body 里的陈旧值（贴测试名与运行绿）。
- [ ] AC5 检测器（正/反向）：新增检测器（新 `plugin/scripts/task-double-frontmatter-check.ts` 或等价），对含 >1 `^id:` 行的任务文件 exit 非 0 并命名文件；对干净任务集 exit 0（贴两次运行 `echo $?`）。若为新 shipped 脚本，一并注册 capability-catalog 声明 + outline。
- [ ] AC6 范围门绿：`bash scripts/test.sh --for-task gap-task-write-duplicates-frontmatter --allow-thin` 绿。

## Definition of Done

6 个文件均恰 1 个 `^id:`/`^status:` 且 status 为权威值、diff 只删第二块 frontmatter；`task_write` 写含-frontmatter-body 不再产生双 frontmatter（回归测试绿）；检测器对双 frontmatter 文件 exit 非 0、对干净集 exit 0；`--for-task` 范围门绿。

## ADR-007 dark-axis record

该轴仍暗,理由:数据修复 + 写路径修复 + 一个检测器,无包/依赖结构变化,L_D/L_G 无可测结构量。

## Touches

- tasks/gap-ac297-git-history-page-zh-chrome-nav-current-and-own-title.md
- tasks/gap-ac326-branch-discard-drill-real-reading.md
- tasks/gap-d24e303c-skill-refs-plugin-loop-violates-ac3.md
- tasks/gap-run-static-checks-parallelize-boheidc.md
- tasks/gap-touches-parser-early-subheading-latch-hides-declaration.md
- tasks/goal-035-merge-and-postmerge-verify.md
- packages/quay-native/src/store.ts
- packages/quay/src/core/frontmatter-store-base.ts
- packages/quay-native/test/store.test.mjs
- plugin/scripts/task-double-frontmatter-check.ts
- plugin/scripts/capability-catalog-declarations.json
- tasks/gap-task-write-duplicates-frontmatter.md

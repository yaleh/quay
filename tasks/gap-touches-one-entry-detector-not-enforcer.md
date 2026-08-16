---
id: gap-touches-one-entry-detector-not-enforcer
title: "touches-one-entry-one-path 是 detector 非 enforcer——撰写面 0 接线，发生率 4（硬规则⑫ 够格提机制）"
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 2026-08-16 17:2xZ（发生率实测，硬规则⑫ 给数后够格提机制）。

**闸存在但只在【最晚】一层**：`touches-one-entry-one-path-check` 判据正确、确实报红，
但接在**全量套件的静态层**——每犯一次的代价 = 一条任务已经 fork、在飞、跑到静态层才红、
修 Touches 再重跑。今天 `gap-ac97` / `gap-release-timeout` 两条被它挡住（`# tests 0`，一个测试没跑到）。

**发生率（gate 落地 97cb1dde 2026-08-14 之后，全在 08-16 一天内）**：
```
9095bf86  10:34  ac86 Touches 拆开
64074591  12:28  AC91 Touches 拆开（自称"第 3 次同形"）
505dd16d  16:47  AC99 Touches 拆多路径
6a0d389a  16:50  gap-ac99 Touches 拆 '/' 连接（自称"第 4 次同形"）
```
**接线面实查**：checker 在 plugin/scripts + scripts/test.sh + mutation case + catalog 都有；
**撰写面 `.git/hooks/pre-commit` 命中 = 0**（819 字节，只有 precommit-guard）。零计数干跑确认谓词没错。

**⇒ 形态 = detector 而非 enforcer**：判据对、报红对，但位置太晚。

## Plan

1. 把同一个 check 前移到**撰写/提交那一刻**（任务体落盘时或 pre-commit），让「写错 Touches」在产生它的那一步就红。
2. ⛔ 不指定实现方式——由实现方选：pre-commit hook 接线 / 撰写侧脚本 / 其他。判据 = 提交前挡住。

## Acceptance Criteria

- [x] AC1: 撰写面（pre-commit 或等价落盘时机）接线 `touches-one-entry-one-path`——写一个多路径 Touches 的 commit 在提交前被拒（现为提交后才在 suite 静态层红）。
- [x] AC2: 接线后不再出现「任务 fork→在飞→静态层才红→改 Touches 重跑」的循环（判据：新任务 Touches 错误在提交前即红）。
- [x] AC3: 接线可 `git log` 追溯，且不破坏既有 pre-commit guard 功能。

## Definition of Done

- [x] touches-one-entry-one-path 从「suite 静态层 detector」前移到「撰写面 enforcer」，写错 Touches 在产生处即红。

## Touches

- .git/hooks/pre-commit（或撰写侧等价落盘时机——接线点）
- plugin/scripts/touches-one-entry-one-path-check.ts（若需导出供撰写面调用）
- tasks/gap-touches-one-entry-detector-not-enforcer.md（自身）

## Evidence（2026-08-16，scoped 门绿）

**机制**：`plugin/scripts/precommit-guard.ts` judge() 新增 ② Touches「一条目一路径」detector——对 staged
tasks/*.md（`git diff --cached --name-only` 过滤 `tasks/*.md`）读 **index blob**（`git show :<rel>`，即【将提交】的
内容），复用 `touches-one-entry-one-path-check.ts` 的 `checkTaskOneEntryOnePath` + shrink-only 祖父基线
（`readOneEntryBaseline`）判定；含多路径 bullet ⇒ 拒提交（reason=touches-multi-path-bullet）。静态层 check
（run_static_checks）原地保留——本 detector 是撰写面补充，不是替换。`--install-hook` 改用
`git rev-parse --git-path hooks` 解析 hooks 目录（worktree 下是 common dir，naive `path.join(gitDir,"hooks")`
写的钩子 git 不读）。**接线本体在 git tracked 的 `precommit-guard.ts`**（`git log` 可追溯），`.git/hooks/pre-commit`
是安装产物。

**AC1（撰写面接线，提交前拒）**——e2e 真实钩子（`plugin/test/precommit-guard.test.mjs`「AC1 e2e — a real
`git commit` of a multi-path Touches task is REJECTED by the installed pre-commit hook; a single-path task commits」）：
- 坏：`tasks/bad.md` Touches=`- a.ts / b.ts` ⇒ `git commit` 退出 1，输出含「Touches 多路径」，`git log` 无该提交（未落地）。
- 好：`tasks/good.md` Touches=`- a.ts` ⇒ `git commit` 退出 0，钩子打印「Touches 单路径（②）」。

**AC2（新任务 Touches 错误提交前即红）**——「AC2 — a NEW task's Touches error reds at the commit moment」：
staged 新任务 `tasks/gap-fresh.md` Touches=`- orchestration/a.md / orchestration/b.md` ⇒ guard 判定 exit 1、
reason=touches-multi-path-bullet。

**AC3（git log 追溯 + 不破坏既有 guard）**：
- 接线本体 = `plugin/scripts/precommit-guard.ts`（git tracked）⇒ `git log --oneline -- plugin/scripts/precommit-guard.ts` 可追溯；
  实现提交 `12510d87`。
- `resolveHooksDir` 与 `git rev-parse --git-path hooks` 一致（worktree 下解析到 common dir）——「AC3 — resolveHooksDir
  matches `git rev-parse --git-path hooks`」测试钉住。
- 既有 doc-check 闸未破坏：原 10 条 precommit-guard 测试（① doc 拒/放行、hook 安装/卸载、merge-bypass、AC63）全绿。

**scoped 门**（worktree 根，`scripts/test.sh` 退出 0）：
```
plugin/test/precommit-guard.test.mjs                                → tests 17, pass 17, fail 0
plugin/test/touches-one-entry-one-path-check.test.mjs
  + plugin/test/precommit-guard-retire-negative-control.test.mjs    → tests 24, pass 24, fail 0
scripts/test.sh --static-checks                                     → 47/47 mutation PASS, RESULT: PASS
scripts/test.sh --static-checks-doc                                 → DOC-CHECK EXIT 0
```

**负控制（硬规则②④ 能取假）**：
- 单路径 Touches ⇒ 放行（AC1 negative）。
- 非 tasks/*.md 的 staged 文件 ⇒ 放行（scope=staged tasks/*.md，Touches 检查只盯任务体）。
- 祖父基线列名任务的多路径 bullet ⇒ 放行（shrink-only 基线尊重，不为历史 debt 制造新 blocker）。

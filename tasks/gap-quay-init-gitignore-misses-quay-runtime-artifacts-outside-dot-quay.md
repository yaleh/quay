---
id: gap-quay-init-gitignore-misses-quay-runtime-artifacts-outside-dot-quay
title: quay-init 的 .gitignore 只覆盖 .quay/，遗漏 quay 自己写到别处的运行时产物 —— 污染工作树后 fan-in 的
  ff 永久失败
status: done
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**后果先说（已实际发生）**：第三方项目 quay-fleet 的一条任务，fan-in 一路走到
`anti-drift-land → ac-gate → flip-done`、suite 55/55 全绿，**最后卡死在 `ff` 步骤**：

```
step=ff exit=2 reason="fan-in-ff-merge: working tree not clean in /home/yale/work/quay-fleet
  ?? milestones/
  ?? tasks/.quay-parse-cache.json"
```

⇒ **实现完全正确、验收全绿的任务，因为两个 quay 自己写出来的文件而永远落不了地。**
而且错误信息只说「working tree not clean」，**不指向 quay 自己是那两个文件的作者**，
排查者会先去怀疑自己的改动。

**根因：init 的忽略清单只覆盖了 `.quay/` 这一处运行时状态。** 实测对照：

```
quay-init 写给第三方项目的 .gitignore（quay 贡献的全部内容）：
    .quay/*
    !.quay/config.yml
    !.quay/profiles.yml

quay 自己的 .gitignore 另有（且带解释性注释，说明 quay 明知它们是运行时产物）：
    :471  # persistent parse cache — a runtime derived artifact written to <tasksDir>/.quay-parse-cache.json
    :476  **/.quay-parse-cache.json
    :449  milestones/fast-mode-telemetry/*.json
```

**`tasks/.quay-parse-cache.json` 的要害在于它写在 `tasksDir` 下、不在 `.quay/` 下**，
所以 `.quay/*` 这条规则覆盖不到它。而它由 quay 自己的**读**路径写出——
`task_list` / `task_get`，以及 fan-in 自己的 `ac-precheck` / `anti-drift` 步骤都会碰它。
⇒ **只要 quay 读过一次任务台账，第三方项目的工作树就脏了，此后每一条任务的 ff 都会失败。**
这不是某一条任务的问题，是**装了 quay 就注定发生**。

**这是「双副本漂移」的又一实例**：quay 自己的 `.gitignore` 里那份清单是真相源，
init 模板是它的一份人工同步副本，而副本落后了。同工作区已知同形：
「修了一个副本、生产用的是另一个」。

<!-- dedup-ref -->
**同一后果已在两个互不相关的第三方项目上各发生一次（发生率 = 2，非孤例）**：
`gap-ac248-adr-check-differential-record-producer`（done）的「过程发现 4」记录了 **archguard** 上的同形故障——
旧 loop 残留的未跟踪目录（`milestones/`、`plugin/.quay/`）使 ff 的 clean-tree 前提永不成立
（实测 `working tree not clean`），当时的处置是**把目录移出仓外**（手工绕过）。
**为什么不是重复**：那条把它当**环境障碍**绕过，机制归因停在「ff 的 benign 白名单只认 `?? .quay/…`」，
没有追到 **init 模板**这个生成侧真相源，也从未提及 `.quay-parse-cache.json`。
本条立的是**生成侧单一真相源 + 防漂移检查**；两者同一后果、不同机制层。

## Plan

1. **让 init 的忽略清单从 quay 自己的 `.gitignore` 派生，而不是人工重列**：
   把 quay 的 `.gitignore` 里标注为「quay 运行时产物」的条目做成一份**可被两边共同消费的清单**
   （单一真相源），init 读它生成；⛔ 不接受"再手工补两行"——那只修了被报出来的那一个实例（硬规则 5b）。
2. 至少立即覆盖已知的两条：`**/.quay-parse-cache.json`、`milestones/fast-mode-telemetry/*.json`。
3. **加一条防漂移静态检查**：quay 自己 `.gitignore` 中标记为运行时产物的条目集合，
   必须被 init 写出的忽略清单覆盖；新增一条而 init 未跟进 ⇒ 红。
4. **收紧错误信息（必做，⛔ 原记为「可选但高价值」已作废）**：`fan-in-ff-merge` 报
   「working tree not clean」时，若脏文件命中 quay 自己的运行时产物清单，应在 reason 里点明
   「这是 quay 运行时写的，应加入 .gitignore」，而不是让排查者去怀疑自己的改动。
   **为什么必做（实测读数）**：**ff 的 benign 白名单只认 `?? .quay/…` 前缀** ⇒ 即便 init 把这两条
   写进第三方项目的 `.gitignore`，**任何已经存在的未跟踪残留**（`milestones/`、别的 loop 遗留物）
   **仍然会挡住 ff** —— **光修 `.gitignore` 不够：新项目从此干净，存量项目不会自愈。**
   这条 reason 是那个白名单口径**唯一的可见性来源**：否则排查者只看到「working tree not clean」，
   既不知道这些文件是 quay 自己写的，也不知道白名单只认某个前缀。
5. **评估 ff 的 benign 白名单口径本身是否过窄**：它只认 `?? .quay/…`，而 quay 的运行时产物明明
   还写到 `tasksDir`（`.quay-parse-cache.json`）与 `milestones/` 下。白名单应当与「quay 运行时产物
   清单」同源——也就是第 1 条要建的那个单一真相源；⛔ 不要再手工列第三份。

## Acceptance Criteria

- [x] AC1（负控制，改前必须红）：在干净临时目录跑一次真 `quay-init`，改前其 `.gitignore`
      **不含** `.quay-parse-cache.json`；改后包含。同样断言 `milestones/fast-mode-telemetry`。
- [x] AC2（后果级，端到端）：在该临时项目里跑一次会写 parse-cache 的 quay 命令
      （如 `quay task list`），改前 `git status --porcelain` **非空**且含 `tasks/.quay-parse-cache.json`；
      改后为**空**。这条是本缺陷的真实后果，⛔ 不要只断言文件内容。
- [x] AC3（防漂移，结构性）：静态检查比对「quay 自己 `.gitignore` 中标为运行时产物的条目集」
      与「init 写出的忽略清单」，前者未被后者覆盖即红。双向控制：给 quay 的 `.gitignore`
      加一条新的运行时条目而 init 未跟进 ⇒ 必须红；两边一致 ⇒ 绿。
- [ ] AC4：全量 `scripts/test.sh` 绿（本任务 delta 的 scoped 门已绿；**全量**由 fan-in 的全量 suite 判定；worker 结构上不跑套件，落地前 ff 的 suite 证书闸就是它的判据）（待外部）
- [x] AC5（存量项目，能取假）：在一个**已经含有** quay 运行时残留（如 `milestones/`）的第三方项目上
      跑 fan-in 的 `ff` 步骤，改前 reason 为裸 `working tree not clean`；改后 reason 必须点名
      「这些文件由 quay 运行时写出」并指出处置方式。⛔ 不得只在新项目上验——那会漏掉存量项目这一整类。

## Definition of Done

在一个**真实的第三方项目**上（非 fixture）：跑完一轮 `quay task list` 后 `git status --porcelain` 为空，
且一条任务的 fan-in 能走完 `ff` 步骤而不因 quay 自身运行时产物失败。
fixture 满足不算数（硬规则 4 推论三）。

## 证据（本任务实测读数，非 fixture）

**AC1 / AC2 双控制** —— 干净临时 git 项目（`git init` + 一条任务），真 `quay-init.sh` + 真 CLI
(`packages/quay/bin/quay.js`)。改前用的是 develop 的 `quay-init.sh` 副本（`git diff develop` 为空 ⇒ 同一份）。

```
改前（develop 版 quay-init）:
  .gitignore 尾部 = .quay/* / !.quay/config.yml / !.quay/profiles.yml      ← 无任何运行时产物条目
  $ quay task list  &&  git status --porcelain
  ?? tasks/.quay-parse-cache.json        ← 仅【读】一次任务台账即脏（parse cache 138 B 落盘）
改后（本 worktree 版 quay-init）:
  appended: quay runtime-artifact block (9 pattern(s) from plugin/scripts/quay-runtime-artifacts.txt)
  $ quay task list  &&  git status --porcelain
  （空；tasks/.quay-parse-cache.json 138 B 仍在磁盘、已被忽略）
```

**AC5 + DoD** —— 真实第三方项目 **quay-fleet** 的副本（真实任务台账、真实残留
`tasks/.quay-parse-cache.json` + `milestones/fast-mode-telemetry/2026-09-13.json`；真实 issue：
该项目的 `.gitignore` 曾被**手工**补过两行——正是本条要取代的「修一个实例」做法）。

```
改前 ff-merge 模块（develop 版），同一棵真实树上跑:
  fan-in-ff-merge: working tree not clean in <fleet copy> — …            ← 裸 reason（无归因）
  fan-in-ff-merge:   ?? milestones/
  fan-in-ff-merge:   ?? tasks/.quay-parse-cache.json
  exit=2
改后 ff-merge 模块（本 worktree）同一棵树:
  fan-in-ff-merge: 2 of the path(s) above are written by QUAY ITSELF, not by this task … manifest: …/quay-runtime-artifacts.txt
  fan-in-ff-merge:   QUAY RUNTIME ARTIFACT AREA: milestones — quay writes runtime state under this directory ("milestones/fast-mode-telemetry/*.json"); …
  fan-in-ff-merge:   QUAY RUNTIME ARTIFACT: tasks/.quay-parse-cache.json (matches "**/.quay-parse-cache.json" in the manifest)
  fan-in-ff-merge: disposition — quay-init writes these patterns into a NEW project's .gitignore; for an EXISTING project add the manifest's patterns to .gitignore (or re-run quay-init), …
仅留 quay 自己那个 parse cache（真文件、真大小）时:
  改前 exit=2 裸拒；改后 passed through a benign runtime-dirty tree … [quay's own runtime artifacts per …/quay-runtime-artifacts.txt: tasks/.quay-parse-cache.json]
  ⇒ 越过 clean-tree 闸，停在【与之无关的】suite 证书闸（该副本没有 suite capture）⇒「不再因 quay 自身产物失败」
在该副本上跑修好的 quay-init（追加 9 条）后再跑一次 quay task list:
  $ git status --porcelain
  （空）                                  ← DoD 第一条；parse cache 3621 B 仍在磁盘
```

**AC3** —— `gitignore-runtime-coverage-check.ts` 对真实树绿（9 条标记 ⇔ manifest 9 条）；两个方向的
红由单测（judged-2「标记多于 manifest」/ judged-3「manifest 多于标记」）与 mutation case
(`checker-mutation-cases/gitignore-runtime-coverage-check.sh`，两向注入 + 复原) 各取一次。

**AC4 的结构性说明** —— scoped 门（`scripts/test.sh --for-task … --allow-thin`）两次全绿：
merge develop **前** 118 tests / 0 fail，merge develop **后的最终树** 331 tests / 0 fail，
两次皆 0 STATIC_CHECK_FAILED；**全量** suite 由 fan-in 跑，故本项标注（待外部），
落地前 ff 的 suite 证书闸强制它。

**footprint（shrink-only ratchet 的正当增长记账）** —— `--reanchor` 后 `3 files / 568 → 1022 bytes`
(+454 = 新 `.gitignore` 块一行头 + 9 条 pattern)；`--gate` 复测同值 ⇒ 记录的是真实 laydown，非洗白。

**delta 自带的第二个「双副本漂移」（本轮修复；硬规则 5b 的成簇形态）** —— 本 delta 让
`plugin/scripts/touches-orthogonality-check.ts` 多了一条跨树 import
（`../../packages/quay/src/runtime-artifacts.ts`），把这条路径带进了 precommit-guard 的执行闭包。
`plugin/test/precommit-guard.test.mjs` 的 `copyGuardScripts` 把闭包**手工列成 9 个名字**——
一份与 import 图同源的第二副本 ⇒ 它落后了，且**落后是静默的**：钩子照装不误，只在
【钩子执行时】以 `ERR_MODULE_NOT_FOUND … esm/resolve:271` 死在被测的那次 commit 里。
实测（fan-in 全量 suite，`# fail 2`，两条都是它）：

```
✖ AC1 e2e — a real `git commit` of a multi-path Touches task is REJECTED … (1563ms)
✖ AC4 e2e — a real `git commit` of a delivery-critical task without goal_ac is REJECTED … (1972ms)
  AssertionError [ERR_ASSERTION]: install-hook: node:internal/modules/esm/resolve:271
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<scratch>/packages/quay/src/runtime-artifacts.ts'
    imported from <scratch>/plugin/scripts/touches-orthogonality-check.ts
```

修法 = 把闭包**从 import 图派生**（不再手列第二份），并按 repo 相对路径拷贝（旧清单
只有 `plugin/scripts/` 一个形状，**结构上无法表达** `packages/…` 这个依赖）；无法解析的
相对 import **抛错而非跳过**（硬规则 3b——静默变短的闭包与完整闭包同形）。
派生结果非空且**恰好等于**原手列 9 条 + 新增那 1 条（10 条，逐条比对）：

```
$ node <walker>   # entry = plugin/scripts/precommit-guard.ts
n=10
  packages/quay/src/runtime-artifacts.ts      ← 原手列清单缺的那条
  plugin/scripts/gate-script-base.ts          ┐
  plugin/scripts/long-term-guarantee-goal-backed-check.ts
  plugin/scripts/precommit-guard.ts           │ 原有的 9 条
  plugin/scripts/repo-root.ts                 │
  plugin/scripts/task-schema.ts               │
  plugin/scripts/touches-one-entry-one-path-check.ts
  plugin/scripts/touches-orthogonality-check.ts
  plugin/scripts/touches-parser.ts            │
  plugin/scripts/wiring-coverage-check.ts     ┘
```

红/绿控制 —— 同一条命令（`node --test plugin/test/precommit-guard.test.mjs`）：
改前由 fan-in 全量 suite 记录为 **2 fail**（上面那段原文）；改后 **25 tests / 25 pass / 0 fail**
（含 AC1/AC4 两条 e2e）。⛔ 不是「新测试变绿」，是**原红的那两条**转绿。

## Touches

- .gitignore
- docs/analysis/quay-init-closure-ratchet.baseline.json
- packages/quay/src/fan-in/ff-merge.ts
- packages/quay/src/runtime-artifacts.ts
- plugin/scripts/capability-catalog.sh
- plugin/scripts/checker-mutation-cases/gitignore-runtime-coverage-check.sh
- plugin/scripts/gitignore-runtime-coverage-check.ts
- plugin/scripts/quay-init.sh
- plugin/scripts/quay-runtime-artifacts.txt
- plugin/scripts/runner-static-gate.ts
- plugin/scripts/touches-orthogonality-check.ts
- plugin/scripts/worker-driver.ts
- plugin/test/driver-cli.test.mjs
- plugin/test/fan-in-ff-merge.test.mjs
- plugin/test/gitignore-runtime-coverage-check.test.mjs
- plugin/test/precommit-guard.test.mjs
- tasks/gap-quay-init-gitignore-misses-quay-runtime-artifacts-outside-dot-quay.md

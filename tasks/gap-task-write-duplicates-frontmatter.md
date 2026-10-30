---
id: gap-task-write-duplicates-frontmatter
title: "6 任务文件双 frontmatter：task_write 重复写 frontmatter → 修数据 + 查根因 + 加 >1 ^id: 行检测器"
status: done
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

- [x] AC1 修数据（6 文件单 frontmatter）：对下列 6 个文件逐一 `grep -c '^id: '` == 1 且 `grep -c '^status: '` == 1，且唯一 status == 权威首块值（done：gap-ac297 / gap-ac326 / gap-touches-parser / goal-035；superseded：gap-d24e303c / gap-run-static-checks-parallelize）。贴每个文件的 `grep -c` 与 `grep -m1 '^status:'`。
- [x] AC2 修数据（无内容损失）：每个文件 `git diff` 只删第二块 frontmatter（连续 `---…---` 块），首块与 body 逐字未变（贴 `git diff --stat` + 每个文件 diff 全文，证明无正文/AC/DoD 改动）。
- [x] AC3 根因定位并修复：实现证据**具名**写路径（`store.ts`/`frontmatter-store-base.ts` 的哪个函数 + 哪一行把 body 里已有的 frontmatter 再拼一份），并修复为「body 若含 frontmatter 则替换/剥离，⛔ 不重复插入」。
- [x] AC4 回归测试：在 `packages/quay-native/test/store.test.mjs`（或 `packages/quay/test/frontmatter-store-base.test.mjs`）新增断言——一次 `task_write` 其 body 含完整 `---…---` frontmatter 时，落盘文件恰 1 个 `^id:`、1 个 `^status:`，且 status 取写入值而非 body 里的陈旧值（贴测试名与运行绿）。
- [x] AC5 检测器（正/反向）：新增检测器（新 `plugin/scripts/task-double-frontmatter-check.ts` 或等价），对含 >1 `^id:` 行的任务文件 exit 非 0 并命名文件；对干净任务集 exit 0（贴两次运行 `echo $?`）。若为新 shipped 脚本，一并注册 capability-catalog 声明 + outline。
- [x] AC6 范围门绿：`bash scripts/test.sh --for-task gap-task-write-duplicates-frontmatter --allow-thin` 绿。

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

## Evidence

（全部读数 2026-10-30，worktree `/data/home/yale/work/quay-worktrees/gap-task-write-duplicates-frontmatter`；AC 勾选经 Provider ABI 的 `task edit` 写入，未手改 checkbox 字符。）

### AC1 — 修数据（5 个真实双 frontmatter + 1 个误报不修）

对 5 个**真实**双 frontmatter 文件逐一读数（`grep -c '^id: '` / `grep -c '^status: '` / `grep -m1 '^status:'`）：

```
tasks/gap-ac297-…/gap-ac297-git-history-page-zh-chrome-nav-current-and-own-title.md   id=1  status=1  status: done
tasks/gap-d24e303c-skill-refs-plugin-loop-violates-ac3.md                            id=1  status=1  status: superseded
tasks/gap-run-static-checks-parallelize-boheidc.md                                   id=1  status=1  status: superseded
tasks/gap-touches-parser-early-subheading-latch-hides-declaration.md                 id=1  status=1  status: done
tasks/goal-035-merge-and-postmerge-verify.md                                         id=1  status=1  status: done
```

每个文件的唯一 status 均等于权威首块值（done / superseded）。

**第 6 个 `gap-ac326-branch-discard-drill-real-reading.md` 未改（如实标注：误报）**：其 `grep -c '^id: '`=2、`grep -c '^status: '`=2 的第二个 `---…---` 块（行 125–146）**在 `## Evidence` 的 ``` code fence 内**，是引用 `goals/GOAL-901-*.md` 全文（`id: GOAL-901`、`status: retired`、`branch: true`）作为 gap-ac326 自身 AC2 的载体证据，**不是残留 frontmatter**。删除它 = 破坏 gap-ac326 已完成任务的 Evidence 且违反 AC2「body 逐字未变」。它的权威首块本就是单 frontmatter（`status: done`），真实解析器只读首块 ⇒ 无矛盾 status。检测器按「首块后紧跟第二块」的连续签名判断，正确地**不**标记它（见 AC5）。

### AC2 — 修数据（无内容损失）

`git diff --stat -- tasks/`（5 文件）：

```
…/gap-ac297-….md      | 17 ------------
…/gap-d24e303c-….md   | 12 ------------
…/gap-run-static-checks-parallelize-boheidc.md | 12 ------------
…/gap-touches-parser-….md | 14 --------------
…/goal-035-….md       | 15 ---------------
5 files changed, 70 deletions(-)
```

每个文件的 `git diff` 只删第二块 `---…---` frontmatter（连续块），首块与 body 逐字未变——diff 全文在实现提交 `df56ad2cb` 中可复核（无任何正文/AC/DoD 行改动）。gap-ac326 零 diff（有意未改）。

### AC3 — 根因定位并修复（具名到函数与行）

- **`packages/quay-native/src/store.ts` 的 `serialize()`（原 :553-556）**：`return `---\n${fm}\n---\n${body}`` 把 body 逐字拼在新 frontmatter 之后；body 若已含 frontmatter（调用方传整份旧文件或自带 frontmatter 的 body）⇒ 双块。
- **`packages/quay/src/core/frontmatter-store-base.ts` 的 `serializeFrontmatter()`（原 :38-40）**：同一形状。

修复：两处新增 `stripLeadingFrontmatter(body)`（`parse`/`parseFrontmatter` 的镜像半边），先剥掉 body 的前导 `---…---` 块再拼接 ⇒ 「body 若含 frontmatter 则剥离，⛔ 不重复插入」。

### AC4 — 回归测试

新增 `packages/quay-native/test/store.test.mjs` 测试名 `AC4: body containing a full frontmatter block does not produce a second one`：`store.write` 其 body 含完整 `---…---` frontmatter（内含陈旧 `status: ready`）时，落盘文件恰 1 个 `^id:`、1 个 `^status:`，且 `store.get` 的 status=`done`（写入值）而非 body 里的 `ready`。

运行绿：`node --experimental-strip-types --test packages/quay-native/test/store.test.mjs` ⇒ `ℹ tests 22 / pass 22 / fail 0`。

### AC5 — 检测器（正/反向 + 注册）

新增 `plugin/scripts/task-double-frontmatter-check.ts`（连续双 frontmatter 签名：剥离首块后，剩余部分若以 `---` 行开始 ⇒ 双块；code-fence 安全）。

- 正向：`git show develop:tasks/gap-ac297-….md > /tmp/…/x.md` 后 `node … task-double-frontmatter-check.ts /tmp/…/x.md` ⇒ `DOUBLE-FRONTMATTER: /tmp/…/x.md`，`echo $?`=**1**。
- 反向（干净任务集）：`node … task-double-frontmatter-check.ts tasks` ⇒ `3062 scanned, 0 double-frontmatter`，`echo $?`=**0**。
- 误报对照：`node … task-double-frontmatter-check.ts tasks/gap-ac326-….md` ⇒ `1 scanned, 0 double-frontmatter`，`echo $?`=**0**（code fence 内的 GOAL-901 引用不误判）。
- 注册：`plugin/scripts/capability-catalog-declarations.json` 已加 QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING/CONSUMER 六表条目；`bash plugin/scripts/capability-catalog.sh --summary` ⇒ `capability-catalog: 408 scripts | 408 declared | 0 unclassified | 402 ship`，`echo $?`=**0**。outline 已退役（`select-static-checks-for-touches.ts` 注明 former SECOND product 已 RETIRED，新脚本不再需要 outline 授权）。

### AC6 — 范围门绿

`bash scripts/test.sh --for-task gap-task-write-duplicates-frontmatter --allow-thin` ⇒ **exit 0**，`ℹ tests 129 / pass 129 / fail 0`（scoped 静态检查逐条 PASS；选择器选中本任务新增/改动的测试文件，含 `packages/quay-native/test/store.test.mjs`）。

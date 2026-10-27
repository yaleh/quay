---
id: gap-doc-surfaces-missing-meta-prefix
title: DOC_SURFACES 缺 `meta/` ⇒ 任何必须写 META 记录的任务被判 code delta 并跑全量
  suite（gap-ac920 因此 3 轮卡在 OOM）
status: done
labels:
  - gap
parent: null
children: []
extra: {}
---
## Finding

**结论**：`DOC_SURFACES`（`plugin/scripts/select-static-checks-for-touches.ts:283-286`）缺 `meta/`，
于是**任何必须写 META 记录的任务都被判成 code delta** ⇒ fan-in 跑全量 suite，而不是 doc-only 跳过。
`meta/` 与已列入的 `tasks/`、`goals/` 同性质：都是 quay 自己写、只被读作文档/遥测的存储面。

### 事实一：直接读数（2026-10-24，cwd=/data/home/yale/work/quay）

```
$ node --no-warnings --experimental-strip-types -e '\n  import("./plugin/scripts/select-static-checks-for-touches.ts").then((m)=>{\n    const r=m.classifyDeltaPaths(".", ["meta/META-017-x.md","tasks/gap-x.md","goals/AC-920-x.md"]);\n    console.log("codePaths=",r.codePaths);\n    console.log("surfaces=",JSON.stringify(r.decision.docSurfaces));\n  })'
codePaths= [ 'meta/META-017-x.md' ]
surfaces= ["tasks/","goals/","docs/","adr/",".quay/","measurements/","milestones/","orchestration/archive/","plugin/loop/"]
```

- `tasks/gap-x.md` 与 `goals/AC-920-x.md` ⇒ doc（被 `tasks/`、`goals/` 前缀吸收）；
- `meta/META-017-x.md` ⇒ **code**（不在任何 doc surface 里，且无 registry checker 的 `objects` 命中它 ——
  实测 `registry checks matching meta: 0`，`isDocPath("meta/probe.md", null, docSurfaces) === false`）。
  ⇒ 排除项只有一个：**DOC_SURFACES 少了 `meta/` 这一条**。

### 事实二：同族先例已修过一次（硬规则 5b：修一个别漏一簇）

`tasks/gap-doc-surfaces-missing-goals-prefix.md`（status: done）修的就是同一张表的 `goals/` 缺项。
`meta/` 是同簇的兄弟实例，当时没有被一起查 —— 这次补 `meta/` 时**必须**把 quay 自有写面逐条过一遍
（`tasks/ goals/ meta/ adr/ docs/ measurements/ milestones/ orchestration/archive/ plugin/loop/ .quay/`
以及 `state/` 之类实际存在的目录），⛔ 不是只补一个 meta/ 就交差。

### 事实三：重复代价（已发生，不是假想）

- `gap-ac920-criterion-pipe-swallows-exit-code` 的 AC3 **要求**用 `quay meta write META-017` 落一条
  board-visible 记录；该记录一提交，该任务的 delta 里就多一个 `meta/…md` ⇒ `classifyDeltaPaths`
  返回非空 ⇒ `needSuite=true` ⇒ 跑全量 suite。该任务因此 2026-10-23/24 连续 **3 轮**
  `exited-not-landed`（`step=suite: oom-killed`），它自己的 delta 其实只有 2 个 markdown 文件。
- 只要 `meta/` 一天不在 doc surface 里，**每一条「必须写 META 裁定请求」的 gap 任务**都自动背上一次
  全量 suite；而全量 suite 当前还卡在另一个缺陷上
  （`gap-fan-in-recovery-ladder-inert-bucket-full-drops-test-concurrency`，已立案）。

### 判据为何一直没红

没有任何测试断言 `DOC_SURFACES` 覆盖 `meta/`：`select-static-checks-for-touches.test.mjs` 只测
`tasks/` / `goals/` 的行为，`fan-in-execute-paths-s01.test.mjs:89` 的注释也只点名 `goals/`。
⇒ 「缺项」与「本来就该是 code」在记录上不可区分（硬规则 9：该给它造产物）。

## AC

- [x] AC1 对照读数：贴 `classifyDeltaPaths(root, ["meta/x.md"])` 修复前 `codePaths=["meta/x.md"]`、
  修复后 `codePaths=[]`；以及 `isDocPath("meta/x.md", null, docSurfaces)` 修复前 false / 修复后 true。
  两条命令 + 两对输出逐字进 Evidence。
- [x] AC2 判据能取假（负对照）：修复后，一个**真正的代码**路径仍被判 code（例：
  `plugin/scripts/meta-driver.ts` 或 `packages/quay/src/meta-store.ts`），且 `meta/` 前缀不会误吞它
  （`meta-driver.ts` 在 `plugin/scripts/` 下，⛔ 不是 `meta/` 目录）。贴该路径的 `codePaths` 读数。
- [x] AC3 兄弟实例一次查全（硬规则 5b）：把 `DOC_SURFACES` 的命中与前 3 条内容贴进提交，并逐条判定
  quay 自有写面里还有哪些缺失（至少覆盖 `meta/`、`state/`、`measurements/`、`.quay/` 与实际存在的目录）；
  ⛔ 只补 `meta/` 而不给这张逐条清单视为未完成。
- [x] AC4 真实载体（不是 fixture）：`git -C <worktree> diff --name-only develop...HEAD` 对
  `gap-ac920-criterion-pipe-swallows-exit-code` 返回的两条 markdown（`meta/…md` + `tasks/…md`）经修复后的
  classifier 输出为**空**；贴该命令与输出。
- [x] AC5 单测：`select-static-checks-for-touches.test.mjs`（或同族测试）新增断言「`meta/` 是 doc surface
  且真正的代码路径仍是 code」，并证明该断言在移除 `meta/` 表项时变红（贴红/绿两次运行）。

## DoD

- 真实载体读数：`gap-ac920-criterion-pipe-swallows-exit-code`（或任一 meta-only 真任务）的下一次 fan-in
  日志/事件出现 `step: "delta" … reason: "doc-only delta → skip suite"`（或
  `suite-skip reason=doc-only-delta`），且该任务不再进入全量 suite；⛔ 不是 fixture/注入数据满足。
- 反例判据（一条命令可查）：把 seam 关掉（喂一个真代码路径）后判据仍非空 ⇒ 证明「doc-only 跳过」
  不是恒真标签，而是真的在分类。
- ⛔ 不以此为借口放宽其它面：只加 `meta/`（及 AC3 清单里同样成立的 quay 自有文档面），
  ⛔ 不把 `plugin/`、`packages/`、`scripts/` 任何路径加进 doc surface。

## Touches

- `plugin/scripts/select-static-checks-for-touches.ts`
- `plugin/test/select-static-checks-for-touches.test.mjs`
- `plugin/test/fan-in-execute-paths-s01.test.mjs`
- `tasks/gap-doc-surfaces-missing-meta-prefix.md`

## Evidence

实现提交：`9b12db8d0`（分支 `task/gap-doc-surfaces-missing-meta-prefix`，worktree
`/data/home/yale/work/quay-worktrees/gap-doc-surfaces-missing-meta-prefix`）。

### AC1 —— 修复前/后对照读数（逐字）

修复前 = `git show develop:plugin/scripts/select-static-checks-for-touches.ts` 放回同一 `plugin/scripts/`
布局（兄弟模块 symlink、`node_modules` symlink）后 import；修复后 = worktree 里的实现。root 均为
本任务 worktree（registry mode）。命令：

```bash
node --no-warnings --experimental-strip-types -e "
const m = await import('<…/select-static-checks-for-touches.ts>');
const r = m.classifyDeltaPaths('<worktree>', ['meta/x.md']);
console.log('codePaths=', JSON.stringify(r.codePaths));
console.log('docSurfaces=', JSON.stringify(r.decision.docSurfaces));
console.log('isDocPath(meta/x.md,null,docSurfaces)=', m.isDocPath('meta/x.md', null, r.decision.docSurfaces));
"
```

```
=== BEFORE ===
codePaths= ["meta/x.md"]
docSurfaces= ["tasks/","goals/","docs/","adr/",".quay/","measurements/","milestones/","orchestration/archive/","plugin/loop/"]
isDocPath(meta/x.md,null,docSurfaces)= false

=== AFTER ===
codePaths= []
docSurfaces= ["tasks/","goals/","docs/","docs-managed/","meta/","adr/",".quay/","measurements/","milestones/","orchestration/archive/","plugin/loop/"]
isDocPath(meta/x.md,null,docSurfaces)= true
```

### AC2 —— 负对照：真代码路径仍是 code（逐字）

```
plugin/scripts/meta-driver.ts => codePaths= ["plugin/scripts/meta-driver.ts"] isDocPath= false
packages/quay/src/meta-store.ts => codePaths= ["packages/quay/src/meta-store.ts"] isDocPath= false
isUnderDocSurface("plugin/scripts/meta-driver.ts")= false
```

（`isUnderDocSurface` 是段前缀匹配 `p === s || p.startsWith(s + "/")`，不是子串匹配 —— 名字里含
`meta` 但不在 `meta/` 目录下的文件不会被吞。）

### AC3 —— 兄弟实例逐条清单（硬规则 5b；本 worktree 实测）

`DOC_SURFACES` 命中（`grep -rn "DOC_SURFACES" plugin/scripts/select-static-checks-for-touches.ts`）前 3 条内容：

```
:297:export const DOC_SURFACES = [
:308: *  ⛔ `DOC_SURFACES` above is NOT a valid default here. It is quay's OWN layout (docs/, adr/,
:313:export const CONSERVATIVE_DOC_SURFACES = ["tasks", "goals", ".quay"];
```

逐面判定（registry `@static-object` 命中数 / 文件类型 census / 结论）：

| 面 | registry 命中 | 文件类型 | 判定 |
|---|---|---|---|
| `meta/` | 0 | 16 md | **新增 DOC**（META 存储，`quay meta write` 写面） |
| `docs-managed/` | 0 | 26 md | **新增 DOC**（document-store 写面） |
| `state/` | — | 目录不存在 | 不加（本树无此面；凭空加一个不存在的面是死条目） |
| `measurements/` | 0 | 4 json + 1 txt | 已在表内，保持 |
| `.quay/` | 0（`config.yml` 单独命中 ⇒ 该文件仍 code） | 75 json + 4 jsonl + … | 已在表内，保持（registry override 优先） |
| `tasks/` | 2 | 2985 md | 已在表内（task-file carve-out 先于 registry） |
| `goals/` | 0 | 298 md | 已在表内，保持 |
| `adr/` `docs/` `milestones/` `orchestration/archive/` `plugin/loop/` | 0 | md/json | 已在表内，保持 |
| `archive/` | — | 18 ts + 39 mjs + 5 js + 7 sh + 27 md | ⛔ 不加：含可执行 checkers，是代码面 |
| `experiments/` | 2（`experiments/*/test/`） | 27 ts + 72 mjs + 26 sh | ⛔ 不加：活 checkers |
| `test/` | — | 2 sh（e2e 驱动） | ⛔ 不加：可执行 |
| `plugin/` `packages/` `scripts/` | — | 产品 | ⛔ 一律不加 |

`CONSERVATIVE_DOC_SURFACES`（`tasks, goals, .quay`）**本任务不动**：它是第三方面（无 registry、无
`loop.doc_surfaces` 声明）的 fail-closed 下限，`packages/quay/src/init.ts` 的 `doc_surfaces` 镜像与之
同值；放宽它会把第三方的同名目录判成 doc，与本任务「不放宽其它面」的边界冲突。

### AC4 —— 真实载体（gap-ac920，非 fixture）

```bash
$ git -C /data/home/yale/work/quay-worktrees/gap-ac920-criterion-pipe-swallows-exit-code \
      -c core.quotepath=off diff --name-only develop...HEAD
meta/META-017-请裁定-ac-920-判据-2-1-tail-6-恒-pass-的处置-改判据-退役-保持现状-ac-922-已-sup.md
tasks/gap-ac920-criterion-pipe-swallows-exit-code.md

# 这两条路径喂给修复后的 classifier（root = 该任务 worktree）：
mode= registry
codePaths= []
```

### AC5 —— 单测红/绿两次运行（逐字）

新增断言在 `plugin/test/select-static-checks-for-touches.test.mjs`：`meta/` 与 `docs-managed/` 是 doc
surface（`isDocPath` + `classifyDeltaPaths` 两路），`plugin/scripts/meta-driver.ts` /
`packages/quay/src/meta-store.ts` 仍是 code；并含一个进程内可证伪对照（把 `meta/` 从 surface 列表里
过滤掉后同一谓词必须翻回 false）。`fan-in-execute-paths-s01.test.mjs` 的 REAL doc-delta 用例加入
`meta/` + `docs-managed/` 文件，走真实 fan-in step-2 bash 判定。

绿（修复版）：

```
$ node --no-warnings --experimental-strip-types --test plugin/test/select-static-checks-for-touches.test.mjs
ℹ tests 24  ℹ pass 24  ℹ fail 0
$ node --no-warnings --experimental-strip-types --test plugin/test/fan-in-execute-paths-s01.test.mjs
ℹ tests 10  ℹ pass 10  ℹ fail 0
```

红（临时从表中删掉 `"meta/"`，跑完立即还原）：

```
$ node --no-warnings --experimental-strip-types --test --test-name-pattern "DOC_SURFACES" plugin/test/select-static-checks-for-touches.test.mjs
✖ DOC_SURFACES — meta/ and docs-managed/ are doc surfaces, a real code path stays code
  AssertionError [ERR_ASSERTION]: meta/META-017-a-ruling.md must be DOC (quay-written markdown store)
  false !== true
ℹ pass 0  ℹ fail 1
```

### DoD 状态（诚实记录）

- 反例判据：AC2/AC5 的负对照已给出（真代码路径非空、去掉表项即红）——「doc-only 跳过」不是恒真标签。
- 真实载体读数（`gap-ac920` 的**下一次** fan-in 日志出现 `doc-only delta → skip suite`）：由 driver 在
  本任务 fan-in 落地后对 gap-ac920 的下一轮产生，**本会话不可自证**；⛔ 不以 fixture 读数替代
  （硬规则 4 推论三）。本任务提供的可核前置是 AC4：它那条真实 delta 经修复后 classifier 已为空。

## Dark Axis

该轴仍暗,理由: 本任务只给一张路径前缀表补一个 quay 自有的文档面条目并加断言，不新增/删除模块、不改变依赖方向（L_D/L_G 无可采读数）；效果由 AC1/AC4 的真实分类读数直接度量。
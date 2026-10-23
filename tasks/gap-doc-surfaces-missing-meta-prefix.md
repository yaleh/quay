---
id: gap-doc-surfaces-missing-meta-prefix
title: DOC_SURFACES 缺 `meta/` ⇒ 任何必须写 META 记录的任务被判 code delta 并跑全量
  suite（gap-ac920 因此 3 轮卡在 OOM）
status: ready
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
$ node --no-warnings --experimental-strip-types -e '
  import("./plugin/scripts/select-static-checks-for-touches.ts").then((m)=>{
    const r=m.classifyDeltaPaths(".", ["meta/META-017-x.md","tasks/gap-x.md","goals/AC-920-x.md"]);
    console.log("codePaths=",r.codePaths);
    console.log("surfaces=",JSON.stringify(r.decision.docSurfaces));
  })'
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

- [ ] AC1 对照读数：贴 `classifyDeltaPaths(root, ["meta/x.md"])` 修复前 `codePaths=["meta/x.md"]`、
  修复后 `codePaths=[]`；以及 `isDocPath("meta/x.md", null, docSurfaces)` 修复前 false / 修复后 true。
  两条命令 + 两对输出逐字进 Evidence。
- [ ] AC2 判据能取假（负对照）：修复后，一个**真正的代码**路径仍被判 code（例：
  `plugin/scripts/meta-driver.ts` 或 `packages/quay/src/meta-store.ts`），且 `meta/` 前缀不会误吞它
  （`meta-driver.ts` 在 `plugin/scripts/` 下，⛔ 不是 `meta/` 目录）。贴该路径的 `codePaths` 读数。
- [ ] AC3 兄弟实例一次查全（硬规则 5b）：把 `DOC_SURFACES` 的命中与前 3 条内容贴进提交，并逐条判定
  quay 自有写面里还有哪些缺失（至少覆盖 `meta/`、`state/`、`measurements/`、`.quay/` 与实际存在的目录）；
  ⛔ 只补 `meta/` 而不给这张逐条清单视为未完成。
- [ ] AC4 真实载体（不是 fixture）：`git -C <worktree> diff --name-only develop...HEAD` 对
  `gap-ac920-criterion-pipe-swallows-exit-code` 返回的两条 markdown（`meta/…md` + `tasks/…md`）经修复后的
  classifier 输出为**空**；贴该命令与输出。
- [ ] AC5 单测：`select-static-checks-for-touches.test.mjs`（或同族测试）新增断言「`meta/` 是 doc surface
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

## Dark Axis

该轴仍暗,理由: 本任务只给一张路径前缀表补一个 quay 自有的文档面条目并加断言，不新增/删除模块、不改变依赖方向（L_D/L_G 无可采读数）；效果由 AC1/AC4 的真实分类读数直接度量。
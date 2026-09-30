---
id: gap-arch-coverage-primary-scope-usurped-by-root-analyze
title: arch-coverage-report 的 primary scope 被一次「无 sources 的 archguard
  analyze」夺走且不可归还 —— 每个 worktree 的 full suite 恒 2 红，挡住全部 code 落地
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**缺口（立案轮直接量，2026-09-30T09:56–10:20Z，主检出 `/data/home/yale/work/quay`）**

`plugin/test/arch-coverage-report.test.mjs` 的两条 real-repo 断言在**任何** worktree 里都红 —— 它们读的 `REAL_MANIFEST` 是主检出的生成物（该文件 `:42-43`，`MAIN_ROOT = mainCheckoutRoot(REPO_ROOT)`）：

```
✖ real repo — the default global scope covers only PART of the tracked .ts (AC3)
    actual: ['']   expected: ['packages/quay/src']     (:236 deepStrictEqual)
✖ real repo — at least one tracked .ts directory is covered by NO scope (AC3's companion)  (:258)
```

复现（主检出与 worktree 都可，3 秒）：`node --test plugin/test/arch-coverage-report.test.mjs` ⇒ `fail 2`。

**成因：`.archguard/query/manifest.json` 的 primary scope 被一次「省略 sources 的 analyze」夺走，且夺走后带 sources 的 analyze 拿不回来。**

- 该 manifest（生成物、gitignored）现 `globalScopeKey = b4f87b21`，条目逐字为
  `{"key":"b4f87b21","label":"quay (typescript)","sources":["/data/home/yale/work/quay"],"role":"primary","entityCount":5317,"generatedAt":"2026-09-30T09:45:28.810Z"}` —— sources 是**仓库根**，报告相对化后得 `''`。
- 期望态由正本共同钉死：`plugin/scripts/arch-coverage-report.ts:11`「Measured 2026-09-19 it is `packages/quay/src`」；测试 `:236` 期望 `["packages/quay/src"]`。
- 时间线：`26b300e9`（sources = `packages/quay/src`）mtime **17:25** → 一次 analyze 于 **09:45:28Z** 生成根 scope 并取得 `role:"primary"` → fan-in suite 在 **~09:46:25Z** 读到它 ⇒ 2 红。其后 17:56 又一批 analyze 写入（scopes 15 → 19），`globalScopeKey` **未变**。

**两半对照（本轮实测，非推断）**

| 动作 | 结果 |
|---|---|
| 复制主检出 `.archguard` 到 worktree，再 `archguard_analyze(projectRoot=<worktree>, sources=["packages/quay/src"])` | `globalScopeKey` **仍 = b4f87b21**；新 scope 只作普通 scope 加入，**未**取得 primary |
| 直接对**主检出**跑 `archguard_analyze(projectRoot=/data/home/yale/work/quay, sources=["packages/quay/src"])`（= suite 的 `archguard-runner.ts` 每轮都跑的同一形态） | `globalScopeKey` **仍 = b4f87b21**，`role:"primary"` **仍**在根 scope 上 |

⇒ 这不是「manifest 脏了、重跑一次就好」：primary 只由「省略 sources ⇒ 以整仓为根」的那次 analyze 授予，且一旦被根 scope 占住，带 sources 的 analyze 再也拿不回来。

**为什么单独立案（不是重复）**：`gap-suite-ambient-reds-block-all-code-landings`（done）修的是**symlink 路径形态**那一类，其 AC3 记录的判据是「manifest 仍 symlink 形态而测试绿」；本条根因**不是路径形态**（现 sources 全是 realpath 形态），而是 **`role:"primary"` 的归属**。`gap-arch-coverage-report-couples-to-archguard-manifest-path-form`（superseded）已并入前者。⛔ 继承其纪律：**不得以「删掉 `.archguard` 让它重新生成」为修法**。

**影响**：该红出现在**每一个** worktree 的 full suite（都读主检出 manifest）⇒ 它与 `packages/quay/test/ac289-criterion-address-derivation.test.mjs` 的 5 红共同构成当前全量 suite 的全部 7 红，⇒ 两个在飞任务都无法落地。

## Plan

1. **红基线**：`node --test plugin/test/arch-coverage-report.test.mjs`（主检出）⇒ `fail 2`；逐字贴两条断言与 `manifest.globalScopeKey` + `role` 条目。
2. **判定修法归属**（三选一，须可复算）：
   (a) **archguard 侧**（若存在「以本 scope 为 global/primary」的开关或 `archguard.config.json` 能声明 global scope）：让带 sources 的 analyze 能**归还** primary ⇒ 修法是操作形态，本任务应改 finding/操作形态，⛔ 不得硬塞进 (b)/(c) 的 diff。
   (b) **报告侧**（`plugin/scripts/arch-coverage-report.ts`）：primary 的 sources 等于项目根（覆盖整棵树）而存在被真实 analyze 过的更窄 scope 时，不把「覆盖一切」当成 AC3 要锚的 global —— 但**必须仍是三态**：读不懂 ⇒ `NOT-EVALUATED`（硬规则 3b），⛔ 不许把 `['']` 悄悄改写成 `packages/quay/src`。
   (c) **测试侧**（`plugin/test/arch-coverage-report.test.mjs`）：期望由字面 `packages/quay/src` 改为「primary 必须**窄于**整仓」，并保留可红负控。
3. **取假（负控）**：修完须证明判据仍可红 —— 注入 primary = 整仓的 manifest fixture ⇒ 必须仍报红或 `NOT-EVALUATED`。
4. **落地判据**：修后该文件在主检出与任一 worktree **同时**绿，且**不删** `.archguard`、**不手改** manifest JSON。

## AC

- [x] AC1（红基线可复算）：主检出 `node --test plugin/test/arch-coverage-report.test.mjs` ⇒ `fail 2`；贴出 `actual: [''] / expected: ['packages/quay/src']` 与 `manifest.globalScopeKey`、`role` 条目（逐字）。
- [x] AC2（根因是对照，不是解释）：贴出本轮两次动作的读数 —— ① worktree 副本上带 sources 的 analyze ⇒ primary 不动；② 主检出上带 sources 的 analyze（`archguard-runner.ts` 同形）⇒ primary 仍不动。⛔ 缺任一对照 ⇒ 结论降为假说（硬规则 4 推论四）。
- [x] AC3（修后绿 + 仍可红）：`node --test plugin/test/arch-coverage-report.test.mjs` 在主检出与任一 worktree 都 `fail 0`；并证明判据**仍可红**（注入 primary = 整仓的 manifest fixture ⇒ 仍红或 `NOT-EVALUATED`，⛔ 不得伪装成 pass）。
- [x] AC4（纪律）：`.archguard/query/manifest.json` **未被手改**、`.archguard` **未被删除**（贴 `git status --porcelain .archguard` 为空 + mtime 归因）；若修法落在 (b)/(c)，其 diff 必须在 Touches 内。
- [x] AC5（作用域 + 不回归）：`git diff --name-only develop...HEAD` 只含本任务 Touches；`bash scripts/test.sh --for-task gap-arch-coverage-primary-scope-usurped-by-root-analyze --allow-thin` 绿。

## DoD

1. **REAL LANDING**：不是「测试改绿了」，而是**同一份 manifest 在「primary 是整仓」与「primary 是 `packages/quay/src`」两种真实状态下给出两个可区分的读数**，且两种状态都能在**主检出**上复算（贴两条 `--json` 读数）。
2. **判据仍可红**：AC3 的注入负控必须在关掉 fixture seam 之外仍能取假（硬规则 4 推论三）。
3. **不得以删除为修法**：逐字继承 `gap-suite-ambient-reds-block-all-code-landings` 的纪律。
4. **可回滚**：写明回滚形态（(b)/(c) ⇒ `git checkout -- <file>`；(a) ⇒ 回到原 analyze 形态，纯本地无外部状态）。
5. **证据留痕**：红基线、两次对照、修后读数、负控，落成任务体内联或 `.quay/*` 未跟踪 scratch。

## Touches

- `plugin/scripts/arch-coverage-report.ts`
- `plugin/test/arch-coverage-report.test.mjs`
- `tasks/gap-arch-coverage-primary-scope-usurped-by-root-analyze.md`

（说明：前两条是候选修法的两个落点（(b) 报告侧 / (c) 测试侧）；第三条 self-touch。⛔ `.archguard/**` 是生成物、gitignored，**不在** Touches 内。）

## Evidence

完整逐字读数：`.quay/ac-primary-scope-evidence/EVIDENCE.txt`（未跟踪 scratch；两条 `--json` 读数为同目录 `state-A-narrow-global.json` / `state-B-whole-repo-global.json`）。

**修法归属 = (b)+(c)（不是 (a)）**。(a) 需要改 `/data/home/yale/work/archguard`（外仓）；本仓内唯一的 archguard 侧杠杆 `archguard.config.json` 的 `diagrams` 一旦非空会**忽略 `cliOptions.sources`**（`normalize-to-diagrams.ts` 显式 warn「requested sources are ignored」）⇒ 会打断 `archguard-runner.ts` 的六 scope analyze，不是可行修法。判定依据（决定性代码路径）：

- `src/cli/analyze/normalize-to-diagrams.ts`：**省略 sources** + 自动探测 ⇒ `planDefaultDiagrams()`
- `src/cli/utils/default-scope-planner.ts:25` `const role: QueryRole = index === 0 ? 'primary' : 'secondary';`
- `src/cli/analyze/normalize-to-diagrams.ts` `normalizeSingleSource()`：`-s` 路径调 `createProjectRootLanguageDiagrams({source})` —— **不传 role**
- `src/cli/analyze/run-analysis.ts:325` `preferredGlobalScopeKey = queryScopes.find(s => s.role === 'primary')?.key`
- `src/cli/query/query-artifacts.ts:168-171` `globalScopeKey = preferred ?? selectGlobalScopeKey(mergedList)`
- `src/cli/query/query-artifacts.ts:87-96` `selectGlobalScopeKey()`：取 entityCount 最大的 **parsed** scope，平手才偏好 `role==='primary'`
  ⇒ 带 sources 的 analyze 贡献 scope 但**无 role**，回退到「最宽 parsed scope」比较；根 scope 持有**全部**文件，永远不会输。**logical 上不可归还。**

**AC1（红基线，主检出·未修代码，逐字）**：`pass 11 / fail 2`；
`✖ real repo — the default global scope covers only PART of the tracked .ts (AC3)`，`actual: [ '' ]` / `expected: [ 'packages/quay/src' ]` / `operator: 'deepStrictEqual'`（`:236`）；
`✖ real repo — at least one tracked .ts directory is covered by NO scope`，`actual: false` / `expected: true`（`:258`）。
`manifest.globalScopeKey: b4f87b21`；role 条目 `[{"key":"b4f87b21",...,"sources":["/data/home/yale/work/quay"],"entityCount":5317,"role":"primary"},{"key":"b897ce8f","label":"quay (python)","sources":["/data/home/yale/work/quay"],"role":"secondary"}]`。

**AC2（两次对照，本轮实测）**：① worktree 副本（把主检出 `.archguard` `cp -a` 进 worktree 后）跑 `archguard analyze --lang typescript --format json --work-dir <wt>/.archguard -s packages/quay/src`（cwd = worktree）⇒ `globalScopeKey` **仍 b4f87b21**、roles **逐字不变**、scopes 19→20（新增 scope 未夺 primary）。② 主检出跑 `archguard-runner.ts` 同形（`--work-dir <main>/.archguard --output-dir <main>/.archguard/output/c2 -s packages/quay/src`）⇒ `globalScopeKey` **仍 b4f87b21**、`role:"primary"` **仍在根 scope**、scopes 19（复用 `26b300e9`）。两个方向都在场 ⇒ 结论是**对照**不是解释。

**AC3（修后绿 + 仍可红）**：worktree 内 `node --test plugin/test/arch-coverage-report.test.mjs` ⇒ `tests 14 / pass 14 / fail 0`（scoped 门内同一条读数，见 AC5）。
**负控（mutation，`cp` 备份、非 `git checkout`）**：只回退「whole-repo scope 不计入覆盖」这一条规则（保留分类），即 `attributionScopes = scopes.filter(s => !s.wholeRepo)` → `= scopes`、`narrowRefs` 同改 ⇒ 立刻 **4 红**：`selftest — every injected case passes`、`real repo — the declared global scope is CLASSIFIED (AC3)`、`real repo — at least one tracked .ts directory is covered by NO scope`、`injected fixtures — whole-repo vs narrow give two DISTINGUISHABLE readings`；`--selftest` 亦报 `SELFTEST FAIL: whole-repo-scope-is-not-credited-as-coverage — uncoveredTsDirs=[] tsFiles=[["SCOPE_ROOT",3,true]]`。回退经 `cp` 还原，md5 逐字回到 `e75534975cc7f584194f45cd14d5b4e0`，再跑 `pass 14 / fail 0`。⇒ 判据在关掉 fixture seam 之外仍能取假。
（口径说明：AC3 的「主检出」半边与 worktree 半边读的是**同一个** `REAL_MANIFEST`（`MAIN_ROOT` 恒为主检出）且同一 commit 的 `git ls-files` 面，故 worktree 读数即主检出读数；主检出自身要绿只需本次 diff 落地，落地点即 fan-in ff develop。）

**AC4（纪律）**：`git -C /data/home/yale/work/quay status --porcelain .archguard` = **空**；`git check-ignore -v .archguard/query/manifest.json` ⇒ `.gitignore:447:.archguard/`。mtime：控制前 `2026-09-30 18:05:54.560711152 +0800` → 控制后 `2026-09-30 18:12:04.470385770 +0800`——**唯一**改写来自 CONTROL 2 那次 `archguard analyze`（机件运行，非手改 JSON）；`globalScopeKey` 与 role 条目与 BEFORE **逐字一致**，`.archguard` **未删除**。

**AC5（作用域 + 不回归）**：`git diff --name-only develop...HEAD` ⇒ 仅 `plugin/scripts/arch-coverage-report.ts`、`plugin/test/arch-coverage-report.test.mjs`（第三条 Touches `tasks/<id>.md` 由 `task_write` 自身提交）。`bash scripts/test.sh --for-task gap-arch-coverage-primary-scope-usurped-by-root-analyze --allow-thin` ⇒ **rc=0**（scoped 静态检查逐项 PASS；scoped 测试 `pass 14 / fail 0`）。

**DoD 1（两个可区分读数，主检出上复算；报告 = 本任务修后版本，root = 主检出）**：

| 状态 | `globalScopeKey` | `globalScopeKind` | `globalScopeSources` | `globalScopeCoversTsFraction` | `globalScopeNote` | `ts.coverageFraction` | `uncoveredTsDirs` |
|---|---|---|---|---|---|---|---|
| A（fixture：`globalScopeKey=26b300e9`） | `26b300e9` | `narrow` | `["packages/quay/src"]` | `0.224` | `null` | `0.983` | `["experiments/quay-perpetual-stream/fixtures/preparation","scripts"]` |
| B（**LIVE** manifest） | `b4f87b21` | `whole-repo` | `[""]` | `1` | SET（逐字见下） | `0.983` | 同上 |

两态**可区分**（kind / sources / fraction / note 全不同），而**覆盖读数与态无关**（同一份 uncovered 列表）——这正是测试能在任一宿主 manifest 形态下为绿的机制。B 态 note 逐字：`the manifest's global scope b4f87b21 is the REPOSITORY ROOT (relativized sources [""]) — it contains every tracked path BY CONSTRUCTION, so "covers everything" is a tautology rather than a coverage reading, and it is therefore reported here but NOT credited in the per-scope attribution`。

**DoD 2（判据仍可红）**：见 AC3 mutation 负控（4 红 + `SELFTEST FAIL`）。

**DoD 3（不得以删除为修法）**：`.archguard` 未删、manifest JSON 未手改（见 AC4）；测试侧也没有把 `uncoveredTsDirs` 的期望放宽——它现在仍要求**非空**，靠的是报告不再把根 scope 记为覆盖。

**DoD 4（可回滚）**：修法落在 (b)/(c)，纯代码、无外部状态 ⇒ 回滚 = `git checkout -- plugin/scripts/arch-coverage-report.ts plugin/test/arch-coverage-report.test.mjs`（回到修前形态：该文件重新 `fail 2`）。manifest 与 `.archguard` 全程未被本任务写过（除 CONTROL 2 那次机件 analyze，其读数字节不变）。

**本轮收尾补记（2026-09-30T10:5xZ，零 delta 落地的可解释性留痕）**：本任务的分支在最后一次 `git merge develop` 后 **delta 为空** —— `git diff --name-only develop HEAD` 输出为空，因为 `plugin/scripts/arch-coverage-report.ts` 与 `plugin/test/arch-coverage-report.test.mjs` 的两份字节已先由在飞任务 `gap-ac289-criterion-carrier-absence-not-evaluated`（**done**）在 `652176915` "adopt gap-arch-coverage's committed fix byte-exact, breaking the second half of the suite deadlock" 中**逐字采纳**（md5 双向核对：`e75534975cc7f584194f45cd14d5b4e0` / `fadffb2f054182bbc31cc2eaf0184053`），并于 develop tip `dbc3df984` 可见。⇒ 本任务是「谁先落地谁带走字节」的**后落地**一侧：零 delta 是既定收敛结果，不是「没干活」（硬规则 11b 的另一半：已生效而未记录）。⛔ 未为此制造任何 delta。

同一轮实测（合并后树，三条此前全红的文件在隔离跑）：`node --test packages/quay/test/ac289-criterion-address-derivation.test.mjs packages/quay/test/ac302-criterion-address-derivation.test.mjs plugin/test/arch-coverage-report.test.mjs` ⇒ `tests 45 / pass 45 / fail 0`；`fan-in-ac-completion-gate.ts --task <id> --worktree <wt> --json` ⇒ `{ok:true,total:5,checked:5}`；`bash scripts/test.sh --for-task gap-arch-coverage-primary-scope-usurped-by-root-analyze --allow-thin` ⇒ **rc=0**（scoped 测试 `pass 14 / fail 0`）。

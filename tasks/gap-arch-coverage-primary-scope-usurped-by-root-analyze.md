---
id: gap-arch-coverage-primary-scope-usurped-by-root-analyze
title: arch-coverage-report 的 primary scope 被一次「无 sources 的 archguard
  analyze」夺走且不可归还 —— 每个 worktree 的 full suite 恒 2 红，挡住全部 code 落地
status: todo
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
| 复制主检出 `.archguard` 到 worktree，再 `archguard_analyze(projectRoot=<worktree>, sources=["packages/quay/src"])` | `globalScopeKey` **仍 = b4f87b21**；新 scope `061a3b70` 只作普通 scope 加入，**未**取得 primary |
| 直接对**主检出**跑 `archguard_analyze(projectRoot=/data/home/yale/work/quay, sources=["packages/quay/src"])`（= suite 的 `archguard-runner.ts` 每轮都跑的同一形态） | 复用 `26b300e9`，`globalScopeKey` **仍 = b4f87b21**，`role:"primary"` **仍**在根 scope 上 |

⇒ 这不是「manifest 脏了、重跑一次就好」：primary 只由「省略 sources ⇒ 以整仓为根」的那次 analyze 授予，且一旦被根 scope 占住，带 sources 的 analyze 再也拿不回来。

**为什么单独立案（不是重复）**：`gap-suite-ambient-reds-block-all-code-landings`（done）修的是**symlink 路径形态**那一类，其 AC3 记录的判据是「manifest 仍 symlink 形态而测试绿」；本条根因**不是路径形态**（现 sources 全是 realpath 形态），而是 **`role:"primary"` 的归属**。`gap-arch-coverage-report-couples-to-archguard-manifest-path-form`（superseded）已并入前者。⛔ 继承其纪律：**不得以「删掉 `.archguard` 让它重新生成」为修法**。

**影响**：该红出现在**每一个** worktree 的 full suite（都读主检出 manifest）⇒ 它与 `packages/quay/test/ac289-criterion-address-derivation.test.mjs` 的 5 红共同构成当前全量 suite 的全部 7 红（立案轮把池内 17 个 `ac*-criterion-address-derivation` 夹具逐个单跑，只有 ac289 红），⇒ 两个在飞任务（`gap-ac289-…`、`gap-ac302-…`）都无法落地。

## Plan

1. **红基线**：`node --test plugin/test/arch-coverage-report.test.mjs`（主检出）⇒ `fail 2`；逐字贴两条断言与 `manifest.globalScopeKey` + `role` 条目。
2. **判定修法归属**（三选一，须可复算）：
   (a) **archguard 侧**（首选，若存在「以本 scope 为 global/primary」的开关或 `archguard.config.json` 能声明 global scope）：让带 sources 的 analyze 能**归还** primary ⇒ 修法是操作形态，本任务应改 finding/操作形态，⛔ 不得硬塞进 (b)/(c) 的 diff。
   (b) **报告侧**（`plugin/scripts/arch-coverage-report.ts`）：primary 的 sources 等于项目根（覆盖整棵树）而存在被真实 analyze 过的更窄 scope 时，不把「覆盖一切」当成 AC3 要锚的 global —— 但**必须仍是三态**：读不懂 ⇒ `NOT-EVALUATED`（硬规则 3b），⛔ 不许把 `['']` 悄悄改写成 `packages/quay/src`。
   (c) **测试侧**（`plugin/test/arch-coverage-report.test.mjs`）：期望由字面 `packages/quay/src` 改为「primary 必须**窄于**整仓」，并保留可红负控。
3. **取假（负控）**：修完须证明判据仍可红 —— 用现有 `runReport({manifestPath})` 入口（该文件 ③ 区块）注入 primary = 整仓的 manifest fixture ⇒ 必须仍报红或 `NOT-EVALUATED`。
4. **落地判据**：修后该文件在主检出与任一 worktree **同时**绿，且**不删** `.archguard`、**不手改** manifest JSON。

## AC

- [ ] AC1（红基线可复算）：主检出 `node --test plugin/test/arch-coverage-report.test.mjs` ⇒ `fail 2`；贴出 `actual: [''] / expected: ['packages/quay/src']` 与 `manifest.globalScopeKey`、`role` 条目（逐字）。
- [ ] AC2（根因是对照，不是解释）：贴出本轮两次动作的读数 —— ① worktree 副本上带 sources 的 analyze ⇒ primary 不动；② 主检出上带 sources 的 analyze（`archguard-runner.ts` 同形）⇒ primary 仍不动。⛔ 缺任一对照 ⇒ 结论降为假说（硬规则 4 推论四）。
- [ ] AC3（修后绿 + 仍可红）：`node --test plugin/test/arch-coverage-report.test.mjs` 在主检出与任一 worktree 都 `fail 0`；并证明判据**仍可红**（注入 primary = 整仓的 manifest fixture ⇒ 仍红或 `NOT-EVALUATED`，⛔ 不得伪装成 pass）。
- [ ] AC4（纪律）：`.archguard/query/manifest.json` **未被手改**、`.archguard` **未被删除**（贴 `git status --porcelain .archguard` 为空 + mtime 归因）；若修法落在 (b)/(c)，其 diff 必须在 Touches 内。
- [ ] AC5（作用域 + 不回归）：`git diff --name-only develop...HEAD` 只含本任务 Touches；`bash scripts/test.sh --for-task gap-arch-coverage-primary-scope-usurped-by-root-analyze --allow-thin` 绿。

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

（说明：前两条是候选修法的两个落点（(b) 报告侧 / (c) 测试侧）；第三条 self-touch。若判定修法在 archguard 侧（(a)）⇒ 本任务改为 finding/操作形态并在 Proposal 写明「无代码落点」，⛔ 不许把 (a) 硬塞进 (b)/(c) 的 diff。⛔ `.archguard/**` 是生成物、gitignored，**不在** Touches 内：任何「编辑 manifest JSON」的修法都是错的。）
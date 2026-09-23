---
id: gap-workflow-journal-selftest-mkdtemp-requires-tmp-dir
title: workflow-journal 的 selftest 依赖一个被 gitignore 的 tmp/，而只有兄弟 selftest 顺手创建它
  —— 新 worktree 里按测试顺序随机红（实测 2 次 fan-in 退场）
status: ready
labels:
  - gap
  - defect
  - test
parent: null
children: []
extra: {}
---
## Proposal

**机制**：`plugin/scripts/workflow-journal.ts:472` 用
`fs.mkdtempSync(path.join(process.cwd(), "tmp", "workflow-journal-selftest-"))`
建 selftest 的 fixture，前提是 `<cwd>/tmp/` **已经存在**（`mkdtempSync` 的父目录不建）。而 `tmp/` 被 `.gitignore:464` 忽视——那一行自己的注释就写着：repo-root `tmp/` 是 RUNTIME residue、不是源码。**没有任何东西在会话/套件启动时创建它**；它只作为**别的 selftest 的副作用**出现。

同一个模式的三个实例，只有两个会创建父目录：

| 文件 | 行为 |
|---|---|
| `plugin/scripts/run-identity.ts:389` | `fs.mkdirSync(path.join(savedCwd, "tmp"), { recursive: true })` ← **创建** |
| `plugin/scripts/stage-receipt.ts:685` | 曾经不创建，**已修**（见下） |
| `plugin/scripts/workflow-journal.ts:472` | **不创建**，`mkdtempSync` 直接用 |

⇒ `workflow-journal` 的 selftest 绿不绿，取决于**套件里哪个测试先跑**：`run-identity`（或上一轮遗留的 `tmp/`）先把目录建出来就绿，否则 `mkdtemp` 抛 ENOENT。这是**测试间的隐藏顺序耦合**，不是被测代码的性质。

**RED→GREEN 实证（同一条断言，一条命令可复现）**：
- 谓词：`node --test plugin/test/workflow-journal.test.mjs`（在 worktree 里）
- `<worktree>/tmp/` **不存在** ⇒
  `✖ selftest exits 0 for both B2 modules`
  `AssertionError: {"ok":false,"code":"workflow-journal-error","message":"ENOENT: no such file or directory, mkdtemp '<worktree>/tmp/workflow-journal-selftest-XXXXXX'"}`
  （11 pass / 1 fail）
- 建回 `tmp/`（或直接重跑，因为上一轮已把它留下）⇒ **12 pass / 0 fail**。
- **主检出结构上观测不到这个缺陷**：`/data/home/yale/work/quay/tmp/` 自 2026-09-23 19:47 起就存在（某次运行留下的），所以主检出永远绿 —— 这正是它活了这么久的原因（硬规则 4b：观测面不同，结论不同）。

**代价（实测，不是推测）**：`gap-quay-init-config-heredoc-leaks-maintainer-comments` 连续 **2** 轮 fan-in 以 `exited-not-landed` 退场，两次的 suite-red 都是这一条 ENOENT（真因日志 `.quay/fan-in-suite-gap-quay-init-config-heredoc-leaks-maintainer-comments~wk-prod-anchor~1790183832687-8b458b.log`）。它与该任务的改动**完全无关**（该任务只动 `quay-init.sh` / 两个测试 / 一个 baseline）。

**同类已修实例 —— 就是没被扫到的那个兄弟**：`plugin/scripts/stage-receipt.ts:685-687` 是**逐字同形**的代码，但多了两行修复 + 一条指名道姓的注释：

```
// gap-stage-receipt-selftest-mkdtemp-requires-tmp-dir: `tmp/` is gitignored runtime state —
// present in the primary checkout but ABSENT in a fresh worktree/CI checkout. mkdtempSync
// under a non-existent parent throws ENOENT (round-52 suite-fix worktree). Ensure it exists.
const tmpParent = path.join(savedCwd, "tmp");
fs.mkdirSync(tmpParent, { recursive: true });
```

该修复落在 suite-fix round-3（`f05a4bdfe`）——**只补了当时红的那一个实例**，且 `tasks/` 里没有对应的 gap 任务（注释里引用的 id 没有任务文件，全仓只在 `stage-receipt.ts` 自己身上搜得到）⇒ 兄弟实例没被扫到。这正是**硬规则 5b**（「在某处修好 X ≠ X 只在那一处」）的教科书形态：缺陷成簇、兄弟在**同一目录**、修的人只盯着被报出来的那一个。**本任务的第一条 AC 就是把那次漏掉的扫尾补上，而不是又修单独一个点。**

## AC

- [ ] `plugin/scripts/workflow-journal.ts` 的 `selftest()` 里，`mkdtempSync` 之前有一行创建 `tmp` 父目录（按**位置**判定：该 `mkdirSync` 必须在同一个函数内、位于那一次 `mkdtempSync` 之前；⛔ 不按关键词判定，别处出现 `mkdirSync` 不算）。
- [ ] 同一处修复在**两个镜像**上都存在且逐字节相同：`plugin/scripts/workflow-journal.ts` 与 `experiments/quay-perpetual-stream/scripts/workflow-journal.ts`（引用既有 `mirror-pair-drift-check`，⛔ 不新造检查器）。
- [ ] **负控（RED→GREEN，一条命令可查）**：把 `<worktree>/tmp/` 整个移走，`node --test plugin/test/workflow-journal.test.mjs` 仍 **exit 0**（12 pass / 0 fail）。移走前红、移走后绿才成立；若移走后仍红 ⇒ 该 AC 不成立，说明还有第二个 `<cwd>/tmp` 依赖没被处理。
- [ ] `bash scripts/test.sh --for-task gap-workflow-journal-selftest-mkdtemp-requires-tmp-dir` 退出 0，且执行 ≥1 个测试文件。

## DoD

真实落地判据：在**全新 `git worktree add` 出来的检出**里（`tmp/` 结构上不存在 —— 这是本缺陷唯一能被观测的载体）从冷启动跑一次 `scripts/test.sh`，`plugin/test/workflow-journal.test.mjs` 与 `plugin/test/stage-receipt.test.mjs` 均绿。⛔ 只在主检出跑一遍**不算**（主检出里 `tmp/` 一直被上一次运行留着，缺陷观测不到 —— 本 Proposal 已给出该读数）。完成记录附：① 该新 worktree 的绝对路径；② 冷跑前后 `ls -d <wt>/tmp` 的两次读数（证明它自始至终不存在、而不是被谁中途建了）。

## Touches

- plugin/scripts/workflow-journal.ts
- experiments/quay-perpetual-stream/scripts/workflow-journal.ts
- tasks/gap-workflow-journal-selftest-mkdtemp-requires-tmp-dir.md

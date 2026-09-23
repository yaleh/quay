---
id: gap-workflow-journal-selftest-mkdtemp-requires-tmp-dir
title: workflow-journal 的 selftest 依赖一个被 gitignore 的 tmp/，而只有兄弟 selftest 顺手创建它
  —— 新 worktree 里按测试顺序随机红（实测 2 次 fan-in 退场）
status: done
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

- [x] `plugin/scripts/workflow-journal.ts` 的 `selftest()` 里，`mkdtempSync` 之前有一行创建 `tmp` 父目录（按**位置**判定：该 `mkdirSync` 必须在同一个函数内、位于那一次 `mkdtempSync` 之前；⛔ 不按关键词判定，别处出现 `mkdirSync` 不算）。
- [x] 同一处修复在**两个镜像**上都存在且逐字节相同：`plugin/scripts/workflow-journal.ts` 与 `experiments/quay-perpetual-stream/scripts/workflow-journal.ts`（引用既有 `mirror-pair-drift-check`，⛔ 不新造检查器）。
- [x] **负控（RED→GREEN，一条命令可查）**：把 `<worktree>/tmp/` 整个移走，`node --test plugin/test/workflow-journal.test.mjs` 仍 **exit 0**（12 pass / 0 fail）。移走前红、移走后绿才成立；若移走后仍红 ⇒ 该 AC 不成立，说明还有第二个 `<cwd>/tmp` 依赖没被处理。
- [x] `bash scripts/test.sh --for-task gap-workflow-journal-selftest-mkdtemp-requires-tmp-dir` 退出 0，且执行 ≥1 个测试文件。

## DoD

真实落地判据：在**全新 `git worktree add` 出来的检出**里（`tmp/` 结构上不存在 —— 这是本缺陷唯一能被观测的载体）从冷启动跑一次 `scripts/test.sh`，`plugin/test/workflow-journal.test.mjs` 与 `plugin/test/stage-receipt.test.mjs` 均绿。⛔ 只在主检出跑一遍**不算**（主检出里 `tmp/` 一直被上一次运行留着，缺陷观测不到 —— 本 Proposal 已给出该读数）。完成记录附：① 该新 worktree 的绝对路径；② 冷跑前后 `ls -d <wt>/tmp` 的两次读数（证明它自始至终不存在、而不是被谁中途建了）。

## Touches

- plugin/scripts/workflow-journal.ts
- experiments/quay-perpetual-stream/scripts/workflow-journal.ts
- tasks/gap-workflow-journal-selftest-mkdtemp-requires-tmp-dir.md

## Evidence — 本轮（2026-09-24）· 冷载体 RED→GREEN 复验 + 兄弟扫尾

**改动**：`plugin/scripts/workflow-journal.ts` `selftest()` 内，`mkdtempSync` 之前加
`const tmpParent = path.join(savedCwd, "tmp"); fs.mkdirSync(tmpParent, { recursive: true });`
（与已修的 `stage-receipt.ts` 同形）。

**兄弟扫尾（硬规则 5b）—— repo-root `tmp/` 的【全部 4 个】消费者，现已全部自足**（无一再依赖"别人先建"）：

| 消费者 | 自足方式 |
|---|---|
| `plugin/scripts/run-identity.ts:389` | `fs.mkdirSync(path.join(savedCwd, "tmp"), { recursive: true })`（原有） |
| `plugin/scripts/stage-receipt.ts:685` | `tmpParent` 变量 + `mkdirSync`（既有修复 `f05a4bdfe`） |
| `plugin/scripts/workflow-journal.ts:475` | **本次修复** |
| `plugin/test/workflow-event-schema.test.mjs:37` | `if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true })`（既有，自足） |

第 4 项**不在**任务原述的 3 个之列：它经 `const TMP = path.join(REPO_ROOT, "tmp")` 间接引用，故 `mkdtempSync(path.join(<x>, "tmp", ...))` 的窄模式扫不到。用更宽的模式（`join(...`tmp`...)` 且排除 os.tmpdir/TMPDIR/`/tmp`）才扫出来，确认它**自足**（非缺陷实例）。⇒ **无遗漏的依赖实例。**

**AC2（镜像）**：`experiments/quay-perpetual-stream/scripts/workflow-journal.ts` 是指向 `../../../plugin/scripts/workflow-journal.ts` 的 **symlink** ⇒ 一处改动即覆盖两镜像，无法漂移；scoped 门内 `mirror parity: workflow-journal.ts byte-identical across experiments/plugin` 绿。⛔ 未新造检查器。

**AC1（按位置）**：`plugin/scripts/workflow-journal.ts` 实测行号 —— `467: export function selftest()` / `476: fs.mkdirSync(tmpParent, { recursive: true })` / `477: const fixtureDir = fs.mkdtempSync(path.join(tmpParent, ...))`。同函数、严格位于该次 `mkdtempSync` 之前。

**AC3 负控（同一条断言，两个方向）**，实测于**全新 `git worktree add`（`tmp/` 结构上不存在）**：
- 修复前（develop 版文件）：12 tests / **11 pass / 1 fail**，exit 1，`ENOENT … mkdtemp '<wt>/tmp/workflow-journal-selftest-XXXXXX'`
- 修复后：**12 pass / 0 fail**，exit 0
- 再把 `<wt>/tmp` 整个 `mv` 走 ⇒ 仍 **12 pass / 0 fail**，exit 0

**AC4**：`bash scripts/test.sh --for-task gap-workflow-journal-selftest-mkdtemp-requires-tmp-dir --allow-thin` ⇒ **exit 0**，执行 `plugin/test/workflow-journal.test.mjs`（12 tests / 12 pass / 0 fail）。scoped-gate cache 已写，key = 该轮 scoped 门**实际评过的** develop sha（worker 退出前 merge 到的 tip）。

**DoD 冷载体读数**：
① 新 worktree 绝对路径 = `/data/home/yale/work/cold-carrier-wj-selftest`（`git worktree add --detach` @ 本任务 merge tip `7da4ecd35`；刻意建在 `quay-worktrees/` **之外**，不污染"在飞任务数"读数）。
② `ls -d <wt>/tmp` 两次读数：
- **T0 = `03:42:14.022`**（`rm -rf` 后）⇒ `No such file or directory` —— **不存在**
- 跑 `bash scripts/test.sh plugin/test/workflow-journal.test.mjs plugin/test/stage-receipt.test.mjs`（`workflow-journal` **排在最先**，即会红的那个顺序）⇒ 20 tests / **20 pass / 0 fail**，exit 0
- **T1 = `03:42:31.608`**（跑完）⇒ `tmp` 存在，`mtime = 03:42:31.581`，**落在 [T0, T1] 窗口内**

⚠️ **逐字读 DoD 的「自始至终不存在」在修复后不可能成立**（修复本身就 `mkdirSync` 出 `tmp/`，与 `run-identity`/`stage-receipt` 同款行为）。载荷读数是 **T0 时不存在** —— 那才是让缺陷可观测的冷启动条件；T1 后的存在**由修复产生**，已用 `mtime` 落在运行窗口内证明它不是"被谁中途建了"的既有目录。

⚠️ **冷载体的冷跑只覆盖 DoD 点名的两个文件，不是 `scripts/test.sh` 的默认全 glob**：worker 合同明确「不跑 suite（fan-in 负责）」，且本机正与 peer worker 的 suite 并发（load ≈ 35/128，台账记有多个负载敏感 flake 家族）。全 glob 冷跑改由 fan-in 在**本 worktree** 上给出 —— worker 退出前**已移除本 worktree 的 `tmp/`**，使那次全量 suite 成为真正的冷启动跑（且上面已证明全 glob 内仅有的 4 个 repo-root `tmp/` 消费者现在都自足）。
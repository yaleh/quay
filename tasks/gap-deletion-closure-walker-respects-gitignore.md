---
id: gap-deletion-closure-walker-respects-gitignore
title: deletion-closure-check.ts 的 fs walker 不认 .gitignore——12010 文件闭包里 10962
  条来自 .claude/worktrees，R=44.32 量的是 worktree 快照不是删除债
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

`plugin/scripts/deletion-closure-check.ts` 的闭包扫描走 `walkFiles`（`plugin/scripts/fs-walk.ts`），而它的 skip 面是**手工名单**：`SKIP_DIRS = new Set(["node_modules","vendor","fixture",".git",".quay","dist","coverage"])`（`deletion-closure-check.ts:94`，doc 面 `:112` 同一份）。**它不认 .gitignore**，于是把 gitignored 的整棵 worktree / 暂存树当成"引用被测构件的文件"。

现场实跑（立案时，主检出 `/home/yale/work/quay`）：

```
$ node --experimental-strip-types plugin/scripts/deletion-closure-check.ts \
      gate-script-lib.sh quay-init.sh ready-pool-check.ts
CallGraph (真调用) = 271 文件
DC (删除闭包, code∪comment∪doc) = 12010 文件
R = |DC|/|CallGraph| = 44.32
  code 291 / comment 233 / doc 11596
```

DC 的 12010 条按前缀逐条分解（同一份 `--json` 报告的 `refs[].file`）：

| 前缀 | 条数 | git 状态（`git check-ignore -v` 现场核实） |
|---|---|---|
| `.claude/worktrees/agent-*/` | **10962** | gitignored — `.gitignore:29  **/worktrees/` |
| `tasks/` | 484 | tracked |
| 其它（`plugin/scripts/`、`docs/`、`adr/` 等） | 439 | tracked |
| `packages/quay/plugin/` | 90 | gitignored — `.gitignore:26  packages/quay/plugin/` |
| `experiments/` | 33 | tracked（该目录 121 个 tracked 条目，含 59 个软链） |
| `.archguard/` | **2** | gitignored — `.gitignore:447  .archguard/` |

`git ls-files | wc -l` = **6726** ⇒ DC=12010 在结构上不可能全是本仓的引用面；其中 **11054 条（92%）**落在三个 gitignored 前缀下。DC 清单前 15 条逐字贴出的正是 `.archguard/output/index.md` 与 `.claude/worktrees/agent-a06ef2e40a3b4e674/docs/...`——walker 把**另一个 worktree 的整份 repo 内容副本**读成了"引用 X 的文件"。

**判定**：这是探针的**输入面缺陷**（硬规则 3b 同族——walker 读不懂"哪些树属于本仓"，就返回一个与"引用了很多文件"同形的巨大数字），不是删除闭包真值。R=44.32 这个量本身没错，错的是分母/分子两侧都被 worktree 快照污染。

**修法方向（要求可观测结果，不锁定实现）**：
- 让 walker 的 skip 面**由 gitignore 驱动**（`git check-ignore` / `git ls-files -co --exclude-standard` 等价机制），而不是再往手工名单里加名字——**手工名单正是本缺陷的成因**；换成"再多加三个名字"只是把下一次同族缺陷推后。
- 兜底：至少必须覆盖 `.claude/worktrees/`（git worktree 容器，参照已 done 的同族处置 [[gap-loop-shipping-scan-does-not-exclude-worktrees]]）、`.archguard/`、`packages/quay/plugin/`。
- ⛔ **不得顺手排除 `tasks/` 或 `experiments/`**——它们是 tracked 的真实引用面（`experiments/quay-perpetual-stream/scripts/` 121 个 tracked 条目里有 59 个软链，是真实结构边）。

<!-- dedup-ref -->
相关联但不同机制：[[gap-routine-semantic-dedup-scan-fs-walk-family]]（已 done）抽走的是 walker 的**骨架**（`fs-walk.ts`），其非目标逐字写着"callers keep their own predicates and constants"——本任务改的正是调用方自己的 skip 面；[[gap-loop-shipping-scan-does-not-exclude-worktrees]]（已 done）修的是**另一个** walker（`plugin/test/loop-shipping.test.mjs` 的 `walk()`），本任务不动那个文件。

## AC

- [x] AC1（复现固化）：贴出立案读数逐字（DC=12010 / R=44.32 / code=291 / comment=233 / doc=11596）、DC 的按前缀分解表，以及分解所用的命令（`--json` + 逐条前缀计数），使"11054/12010 落在 gitignored 前缀下"可被独立复核；并附 `git ls-files | wc -l` = 6726 与三条 `git check-ignore -v` 输出。
- [x] AC2（修后·位置判定，不是"总数变小"）：修后重跑同一条命令，`--json` 的 `refs[].file` 中落在 `.claude/worktrees/`、`.archguard/`、`packages/quay/plugin/` 下的条数**各自 = 0**（三条 `grep -c` 各打印 0），DC 落到 ~956 量级（= 12010 − 10962 − 90 − 2，以现场为准）。贴出修后完整的分类计数段。
- [x] AC3（负控制·真引用不许被一起丢掉）：修后 `tasks/` 前缀条数 ≥ 400、`plugin/scripts/` 下的 code 类命中仍 > 0、`CallGraph > 0`（贴出这三个读数）；即排除的是 gitignored 树，不是把扫描面砍成空集。
- [x] AC4（负控制·walker 真的会排除，而不是现场恰好没有）：在一个被本次修法排除的 gitignored 树内构造临时引用文件（例如 `.archguard/fixture-<ts>/ref.md` 或 `packages/quay/plugin/fixture-<ts>/ref.sh`，内容引用被测构件），重跑 ⇒ 该路径**不**出现在 DC；删除该 fixture 后重跑 ⇒ 输出与 AC2 逐字一致。三读（注入前 / 注入后 / 撤除后）的 `refs` 计数全部贴出。
- [x] AC5（同族回归）：`node --experimental-strip-types plugin/test/deletion-closure-check.test.mjs` exit 0；且既有反向判据不回归——`deletion-closure-check.ts gate-script-lib.sh` 的剖面比 **R ≤ 2**（贴出该次读数）。
- [x] AC6（scoped 门）：`bash scripts/test.sh --for-task gap-deletion-closure-walker-respects-gitignore` 绿（或等价 scoped 静态门）。

## 复现与修后读数（AC1–AC6 实跑证据）

**实现摘要**（正本在两处代码注释，此处只记落点）：
- `plugin/scripts/fs-walk.ts` 新增 `gitVisiblePaths(root)`（`git ls-files --cached --others --exclude-standard -z`：tracked ∪ untracked-not-ignored，POSIX 相对路径）、`visibleDirPrefixes(paths)`（每个可见路径的全部祖先目录 ⇒ walk 能 **O(1) 剪掉整棵 gitignored 子树**而不是走下去再丢弃）、`VisibleSet`；`WalkOptions.visible` 把它接进唯一的遍历骨架。
- `plugin/scripts/deletion-closure-check.ts`：`scanVisible(root)` / `ignoreSourceOf(root, visible)` 两个面各自只有一个入口；`walkDcCodeFiles` / `walkDocFiles` / `deletionClosure` 都带 `visible` 参数。**三取值，没有"沉默"那一档**（硬规则 3b）：git 回答得了 ⇒ `kind:"git-worktree"`；回答不了 ⇒ `kind:"manual-skip-only"` **并在 stdout 上打 ⚠️ 行**，`gitVisiblePaths` 返回 `null`（**不是空集** —— 空集会读成"这里没有东西被忽略"）。
- `SKIP_DIRS` **保留**，但职责收窄到 gitignore 表达不了的两件事：非 git 夹具的兜底，以及 `.quay`（**部分 tracked** 的运行时状态目录，gitignore 不覆盖它，但它不是删除债的引用面；`vendor`/`coverage`/`fixture` 同为构建/夹具策略）。⛔ 往这个名单加名字是**禁止的修法**，注释里已逐字写明。

⛔ 读数取样面 = **生产载体**：`--root /home/yale/work/quay`（本仓真实树；三个 gitignored 树在那里都真实存在 —— 我的任务 worktree 里它们**不存在**，所以对着 worktree 跑这一条会是"现场恰好没有"的空转读数）。
⚠️ 该树是**活共享检出**：另一层在并行写 `tasks/*.md`，所以 `tasks/` 条数与 doc 计数随时间漂移（立案 484 → 实测 486 → 最终 487）。每条读数都带时刻；除该前缀外的一切差异都已逐条归因（见 AC4）。

### AC1 — 修前复现（T=2026-09-20 18:49Z，逐字）

命令（分解即对同一份 `--json` 逐条前缀计数）：

```
node --experimental-strip-types plugin/scripts/deletion-closure-check.ts \
  gate-script-lib.sh quay-init.sh ready-pool-check.ts --root /home/yale/work/quay --json
node -e 'const r=require("<该 --json>");
         console.log(r.counts.dcTotal, r.counts.ratio,
                     r.refs.filter(x=>x.file.startsWith(P)).length)'   # P = 各前缀
```

```
CallGraph (真调用) = 271 文件
DC (删除闭包, code∪comment∪doc) = 12012 文件
R = |DC|/|CallGraph| = 44.32
code 291 / comment 233 / doc 11598
```

| 前缀 | 条数 | git 状态 |
|---|---|---|
| `.claude/worktrees/` | 10962 | gitignored |
| `tasks/` | 486 | tracked |
| `packages/quay/plugin/` | 90 | gitignored |
| `.archguard/` | 2 | gitignored |
| `experiments/` | 33 | tracked |
| 其它（`plugin/scripts/`、`docs/`、`adr/` 等） | 439 | tracked |
| **三个 gitignored 前缀合计** | **11054** | = 92.0% of 12012 |

与立案读数的唯一差异：`tasks/` 484→**486**、`doc` 11596→**11598**（活共享树上新增 2 个任务文件），其余 10962 / 90 / 2 / 33 / 439 / 271 / 291 / 233 / 44.32 逐字相同。

`git ls-files | wc -l`（在 `/home/yale/work/quay` 跑）= **6732**（立案 6726；同上漂移）。

三条 `git check-ignore -v` 输出（在 `/home/yale/work/quay` 跑）：

```
.gitignore:29:**/worktrees/	.claude/worktrees/agent-a06ef2e40a3b4e674/README.md
.gitignore:447:.archguard/	.archguard/output/index.md
.gitignore:26:packages/quay/plugin/	packages/quay/plugin/quay.js
```

### AC2 — 修后（T=2026-09-20 18:51:16Z）

三条 `grep -c` 等价的逐前缀计数（对同一份 `--json` 的 `refs[].file`）：

```
.claude/worktrees/      → 0
.archguard/             → 0
packages/quay/plugin/   → 0
```

修后完整的分类计数段（逐字，human 输出）：

```
deletion-closure-check — P1 删除闭包检测器 (docs/proposals/archguard-generation-era-primitives.md §3)
component(s): gate-script-lib.sh, quay-init.sh, ready-pool-check.ts
root: /home/yale/work/quay
skip 面: gitignore 驱动 — git ls-files --cached --others --exclude-standard (7026 条可见路径) ∪ SKIP_DIRS(7 条策略名)
CallGraph (真调用) = 205 文件
DC (删除闭包, code∪comment∪doc) = 957 文件
R = |DC|/|CallGraph| = 4.67

按位置分类 (并集 = DC, 重叠允许):
  code    (6 类结构边): 219
  comment (注释引用):    219
  doc     (.md 文档提及): 623

结构边细分 (code 位置):
  import/source/bash/exec/spawn (call): 205
  string literal (字面量, 非调用):      14
  output-schema (输出解析):             146
  test fixture (测试夹具):              83
  Touches (任务体声明):                 191
```

DC 12012 → **957**（= 12012 − 11054 − 1；那 −1 是同一窗口内另一个层写的任务文件恰好提到构件，见 AC4 的归因）。**判定按位置**：三个前缀各 0，而不是"总数变小了"。

### AC3 — 负控制：真引用没有被一起丢掉（同一次读数）

```
tasks/ 前缀条数            = 487   (要求 ≥ 400)
plugin/scripts/ 下 code 类 = 104   (要求 > 0)
CallGraph 总数             = 205   (要求 > 0)
experiments/ 前缀条数      = 33    (不得被顺手排除 —— 与修前逐字相同)
```

### AC4 — 负控制：walker 真的会排除（注入三读 + 面开关对照）

注入面 = 生产载体里真实存在的 gitignored 树 `.archguard/`；fixture 内容逐字：

```
$ cat /home/yale/work/quay/.archguard/fixture-20260920T185032/ref.md
# fixture

gate-script-lib.sh is referenced here
```

三读（同一命令、同一 7 秒窗口 T=18:50:32→18:50:39，`root=/home/yale/work/quay`）：

```
(A 注入前) refs=957  dc=957  callGraph=205 | .claude/worktrees/=0 .archguard/=0 packages/quay/plugin/=0 | md5(refs)=60667cd2eb58
(B 注入后) refs=957  dc=957  callGraph=205 | .claude/worktrees/=0 .archguard/=0 packages/quay/plugin/=0 | md5(refs)=60667cd2eb58
(C 撤除后) refs=957  dc=957  callGraph=205 | .claude/worktrees/=0 .archguard/=0 packages/quay/plugin/=0 | md5(refs)=60667cd2eb58

A\B = []        B\A = []        B\C = []
A vs C identical?  true          fixture 路径出现在 B.refs?  []
```

⇒ 注入**没有**改变输出，撤除后与注入前**逐字节一致**（`cmp` 亦为 IDENTICAL）。

**面开关对照**（同一棵树、同一份 fixture —— 排除必须由 skip 面做出，而不是"fixture 恰好没被读到"）：

```
fixture = /home/yale/work/quay/.archguard/fixture-20260920T185046/ref.md
面开 (gitignore 驱动): refs=957    fixture 在 DC? []                                        → false
面关 (仅 SKIP_DIRS)   : refs=12014  fixture 在 DC? ['.archguard/fixture-.../ref.md']        → true
```

**并发写入归因**（不静默）：第一次三读里 (A)=956、(B)=957，集合差逐条打印后是唯一一条
`tasks/gap-arch-tsify-develop-deliver-tgz-python-heredocs.md` —— 那是活共享检出上**另一层**在两读之间写的任务文件（它提到被测构件），不是 fixture 造成的。重跑一次 7 秒窗口内的三读即逐字节一致（上表）。这条差异是**记录**下来的，不是忽略掉的。

### AC5 — 同族回归

```
$ node --experimental-strip-types plugin/test/deletion-closure-check.test.mjs ; echo $?
0
ℹ tests 13   ℹ pass 13   ℹ fail 0     (原 8 条 + 本次新增 5 条 skip 面用例)

$ node --experimental-strip-types plugin/scripts/deletion-closure-check.ts gate-script-lib.sh --root /home/yale/work/quay
skip 面: gitignore 驱动 — git ls-files --cached --others --exclude-standard (7026 条可见路径) ∪ SKIP_DIRS(7 条策略名)
CallGraph (真调用) = 81 文件
DC (删除闭包, code∪comment∪doc) = 122 文件
R = |DC|/|CallGraph| = 1.51          (判据 R ≤ 2 ✅)
```

修前同一条命令读数为 CallGraph 142 / DC 1055 / **R = 7.43** ⇒ 这条反向判据在修前是**红的**，本修法把它带回 1.51。新增的 5 条单测钉住：`gitVisiblePaths` 在非 git 根返回 `null`（不是空集）、tracked∪untracked 的可见集、`visibleDirPrefixes`、以及"同一棵树面开/面关只差被排除的那一条"的对照。

### AC6 — scoped 门

```
$ bash scripts/test.sh --for-task gap-deletion-closure-walker-respects-gitignore --allow-thin
SCOPED GATE EXIT=0
（scoped 静态相全部 run_checker 通过，含 mirror-pair-drift / worktree-namespace-literal /
  task-file-bypass / superseded-capability / import-graph 等；scoped 单测相 ℹ tests 31 / pass 31 / fail 0）
```

`scripts/test.sh` 里 `tests 31` 是该 scoped 泳道同时跑的 `fs-walk.test.mjs` + `deletion-closure-check.test.mjs`。

### DoD 核对

- 生产载体（本仓真实树 `/home/yale/work/quay`）跑过 `--json`：三个 gitignored 前缀条数各 **0**，报告仍非空（`CallGraph = 205 > 0`）✅
- AC2/AC3/AC4 三组真实输出（含 AC4 的注入前/注入后/撤除后三读 + 面开关对照）已逐字贴入本任务体 ✅
- 每条数字都注明来自哪条命令 ✅
- ⛔ 未以"新增单测通过"代替生产读数（生产读数在上；单测只作为 AC5 的回归面）✅
- ⛔ 未以"DC 数字变小了"代替"该前缀条数为 0"（AC2 判定按位置：三条各 0）✅

## Touches

- plugin/scripts/deletion-closure-check.ts
- plugin/scripts/fs-walk.ts
- plugin/test/deletion-closure-check.test.mjs
- tasks/gap-deletion-closure-walker-respects-gitignore.md

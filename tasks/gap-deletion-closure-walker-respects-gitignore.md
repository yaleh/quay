---
id: gap-deletion-closure-walker-respects-gitignore
title: deletion-closure-check.ts 的 fs walker 不认 .gitignore——12010 文件闭包里 10962
  条来自 .claude/worktrees，R=44.32 量的是 worktree 快照不是删除债
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

- [ ] AC1（复现固化）：贴出立案读数逐字（DC=12010 / R=44.32 / code=291 / comment=233 / doc=11596）、DC 的按前缀分解表，以及分解所用的命令（`--json` + 逐条前缀计数），使"11054/12010 落在 gitignored 前缀下"可被独立复核；并附 `git ls-files | wc -l` = 6726 与三条 `git check-ignore -v` 输出。
- [ ] AC2（修后·位置判定，不是"总数变小"）：修后重跑同一条命令，`--json` 的 `refs[].file` 中落在 `.claude/worktrees/`、`.archguard/`、`packages/quay/plugin/` 下的条数**各自 = 0**（三条 `grep -c` 各打印 0），DC 落到 ~956 量级（= 12010 − 10962 − 90 − 2，以现场为准）。贴出修后完整的分类计数段。
- [ ] AC3（负控制·真引用不许被一起丢掉）：修后 `tasks/` 前缀条数 ≥ 400、`plugin/scripts/` 下的 code 类命中仍 > 0、`CallGraph > 0`（贴出这三个读数）；即排除的是 gitignored 树，不是把扫描面砍成空集。
- [ ] AC4（负控制·walker 真的会排除，而不是现场恰好没有）：在一个被本次修法排除的 gitignored 树内构造临时引用文件（例如 `.archguard/fixture-<ts>/ref.md` 或 `packages/quay/plugin/fixture-<ts>/ref.sh`，内容引用被测构件），重跑 ⇒ 该路径**不**出现在 DC；删除该 fixture 后重跑 ⇒ 输出与 AC2 逐字一致。三读（注入前 / 注入后 / 撤除后）的 `refs` 计数全部贴出。
- [ ] AC5（同族回归）：`node --experimental-strip-types plugin/test/deletion-closure-check.test.mjs` exit 0；且既有反向判据不回归——`deletion-closure-check.ts gate-script-lib.sh` 的剖面比 **R ≤ 2**（贴出该次读数）。
- [ ] AC6（scoped 门）：`bash scripts/test.sh --for-task gap-deletion-closure-walker-respects-gitignore` 绿（或等价 scoped 静态门）。

## DoD

修后对**生产载体**（本仓库真实树）跑过一次：`deletion-closure-check.ts gate-script-lib.sh quay-init.sh ready-pool-check.ts --json` 的报告里三个 gitignored 前缀条数为 0、报告仍非空（CallGraph > 0），AC2/AC3/AC4 的三组真实输出（含 AC4 的注入前/注入后/撤除后三读）逐字贴进任务体，每条数字都注明来自哪条命令。⛔ 不以"新增单测通过"代替生产读数（hard rule 4 推论三），也不以"DC 数字变小了"代替"该前缀条数为 0"。

## Touches

- plugin/scripts/deletion-closure-check.ts
- plugin/scripts/fs-walk.ts
- plugin/test/deletion-closure-check.test.mjs
- tasks/gap-deletion-closure-walker-respects-gitignore.md

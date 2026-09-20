---
id: gap-identity-accessor-regex-source-computed-path
title: identity-replication-check.ts 的 accessor 正则读不出本仓两种主流 source
  idiom——gate-script-lib.sh 143 处正当引用被计成 hardcoded=143/accessor=0
status: done
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

`plugin/scripts/identity-replication-check.ts` 的 `importRe` **有两份逐字相同的副本**——`literalReplication()`（约 :288）与 `replicationTable()`（约 :349）。两处都只有四个分支：`import … from "…"` / `import("…")` / `require("…")` / `(?:^|[;&|\n])\s*(?:\.|source)\s+["']?[^"'\n]*?<stem>(?:\.sh)?["']?`。**最后那个分支要求 `source`/`.` 与路径出现在同一行、且路径里不含引号**，于是本仓两种**主流** idiom 全都读不进去：

```bash
# idiom A —— 直接引用（本仓 6 个 .sh）
source "$(dirname "$0")/gate-script-lib.sh"
# idiom B —— 先赋值路径、再 source 变量（本仓 61 个 .sh，主流形态）
_gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: …"; fi
```

`[^"'\n]*?` 在 `"$(dirname "` 的第二个引号处必然失败（idiom A 不命中）；`_gap_help_lib=…` 那一行根本没有 `source`/`.` 前缀、且真正的 `source` 在下一行用的是**变量**（idiom B 不命中）。⇒ **这两种写法恰恰就是该共享库的单一访问器**，却被逐个计成 `hardcoded`。

现场实跑（立案时 `node --experimental-strip-types plugin/scripts/identity-replication-check.ts`，全量字面量复制度表头部逐字）：

```
gate-script-base.ts       code=241  full=252  accessor=231  hardcoded=10
gate-script-lib.sh        code=143  full=148  accessor=0    hardcoded=143
suite-slot-lib.sh         code= 21  full= 25  accessor=5    hardcoded=16
```

而现场实测的引用面：`grep -rln "gate-script-lib\.sh" --include=*.sh plugin/ experiments/` = **67 个 shell 文件**，其中 idiom B 61 个、idiom A 6 个（`grep -rln '_lib=.*gate-script-lib\.sh' --include=*.sh` = 61）；`suite-slot-lib.sh` 同理存在真实的 `source` 调用点。⇒ 报告的 `accessor=0 / hardcoded=143` 是**检测器假读**（硬规则 3b 同族：正则读不懂输入，就返回一个与"各自硬编码"同形的值），不是复制债。**⛔ 在正则修好之前，不得对 143 这个数字立案做任何合并/抽取动作。**

**修法方向**：扩 `importRe`，使 ①「引号包裹的 computed path 出现在 source/`.` 上下文」与 ②「先赋值路径、后 `source <var>`」都算 accessor；两份副本必须同时改（否则 `literalReplication()` 与 `replicationTable()` 对同一文件给出分叉读数）。判据必须**双向**：正当引用升为 accessor，而真正硬编码的实例仍留在 hardcoded（不得靠"全算 accessor"把 `flagged = hardcoded >= threshold && hardcoded > accessor` 这条判据架空——那等价于把检测器关掉）。

<!-- dedup-ref -->
本任务一次覆盖**两个**架构评审 cluster：`gate-script-lib.sh`（P2-identity-gate-script-lib.sh）与 `suite-slot-lib.sh`（P2-identity-suite-slot-lib.sh）。评审结论对后者逐字写明 "Covered by the same accessor-regex fix as P2-identity-gate-script-lib.sh; re-run rather than file a separate merge task"——两者是**同一处正则**的两个受害实体，故不另立重复任务，AC 同时覆盖两个实体。相关联但机制不同：[[gap-archguard-p2-identity-replication-checker]]（已 done）落地的是检测器本体；[[gap-routine-semantic-dedup-scan-arg-parsing-helper-family]]（已 done）是参数解析家族的机械去重；都不是本缺陷。

## AC

- [x] AC1（复现固化·零计数也查谓词）：贴出立案读数逐字（`gate-script-lib.sh code=143 accessor=0 hardcoded=143`、`suite-slot-lib.sh code=21 accessor=5 hardcoded=16`）、两种 idiom 各自的真实引用行（`grep -n` 各贴 ≥2 条），**并且**把旧正则对一个【已知为真】的样本干跑一次（对 idiom A 与 idiom B 两行各跑一次，展示零匹配）——零计数与"谓词对真样本命不命中"两半都要（硬规则 2）。
- [x] AC2（修后·位置判定）：修后重跑检测器，`gate-script-lib.sh` 的 `accessor` **> 0** 且 `hardcoded` 相对 143 **显著下降**（贴出修后整行 `code/full/accessor/hardcoded`）；`suite-slot-lib.sh` 的 `accessor` ≥ 现场实测的真实 `source` 调用点数（贴出该实测命令与数字）。两条都贴现场输出，⛔ 不抄本任务读数。
- [x] AC3（负控制·假阳性方向）：放宽正则**不得**把真硬编码一并算成 accessor——指出一个只在**注释/文档/字符串字面量**里提到 basename、从不 source/import 它的文件，修后该文件仍计入 `hardcoded` 而**不**计入 `accessor`（贴出该文件名、该行内容与修后分类结果）。
- [x] AC4（两份副本同改·防分叉）：对**同一个文件**，`literalReplication()` 与 `replicationTable()` 两条路径给出的 accessor/hardcoded 判定一致——用同一实体在 `--json` 的全量表与单实体入口各取一次读数并逐字对比，差值 = 0（贴出两段输出）。
- [x] AC5（负控制·既有真样本不回归）：`gate-script-base.ts` 修后仍 `flagged=false`，且其 `accessor` 不因本次放宽而下降（贴出修后该行；立案读数 231 为对照）。
- [x] AC6（单测）：`node --experimental-strip-types plugin/test/identity-replication-check.test.mjs` exit 0，且新增断言至少覆盖三条 fixture：idiom A 判 accessor、idiom B 判 accessor、纯注释提及判 hardcoded-not-accessor。

## DoD

对**生产载体**（本仓真实 shell 文件）跑过一次修后读数：`gate-script-lib.sh` 的 accessor 由 0 变为非 0、`suite-slot-lib.sh` 的 accessor 反映真实调用点数，贴出修前/修后两行的完整指标与所用命令；AC3 的反向实例与 AC4 的两路一致性读数一并贴出。⛔ 不以"新增单测绿"代替生产读数（fixture 证明"能产出"，不证明"已产出"，hard rule 4 推论三）。

## Touches

- plugin/scripts/identity-replication-check.ts
- plugin/test/identity-replication-check.test.mjs
- tasks/gap-identity-accessor-regex-source-computed-path.md

## Evidence

全部读数 = **修前/修后各现场跑一次**（develop `52d075978530078a583573907b0b2110af147ac9`，工作树 `/home/yale/work/quay-worktrees/gap-identity-accessor-regex-source-computed-path`，实现提交 `a4a11490d`，pre-merge `6b948dd60`）。命令逐条给出。

### AC1 — 复现固化 + 零计数谓词干跑

立案读数（本任务 Proposal 逐字）。**注意它与本树修前读数不同**：本树 develop 比立案时前进了，故 AC2 一律用本树现场读数对照，两套数并列给出。

```
gate-script-base.ts       code=241  full=252  accessor=231  hardcoded=10
gate-script-lib.sh        code=143  full=148  accessor=0    hardcoded=143
suite-slot-lib.sh         code= 21  full= 25  accessor=5    hardcoded=16
```

两种 idiom 的真实引用行（`grep -n`）：

```
$ grep -rn '^\s*\(\.\|source\)\s.*gate-script-lib\.sh' --include=*.sh plugin/ experiments/ | head -4
plugin/scripts/task-schema-check.sh:14:source "$(dirname "$0")/gate-script-lib.sh"
experiments/quay-perpetual-stream/scripts/audit-independence-selfcheck.sh:8:source "$(dirname "$0")/gate-script-lib.sh"
experiments/quay-perpetual-stream/scripts/it0-dod-check.sh:7:source "$(dirname "$0")/gate-script-lib.sh"
experiments/quay-perpetual-stream/scripts/vmeta-lag-selfcheck.sh:9:source "$(dirname "$0")/gate-script-lib.sh"

$ grep -rn '_lib=.*gate-script-lib\.sh' --include=*.sh plugin/ experiments/ | head -3
plugin/scripts/loadbearing-test-gate.sh:21:  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
plugin/scripts/release-branch-finish.sh:80:  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
plugin/scripts/tmux-leak-scan.sh:33:  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"

$ grep -rn '\. "\$_gap_help_lib"' --include=*.sh plugin/ experiments/ | head -2
plugin/scripts/supervisor-bus-identity.sh:21:  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
plugin/scripts/publish-dist-branch.sh:30:  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
```

引用面计数：`grep -rl 'gate-script-lib\.sh' --include=*.sh plugin/ experiments/` = **67**；idiom B `grep -rln '_lib=.*gate-script-lib\.sh' --include=*.sh` = **61**；idiom A = **6**（67−61）。

**零计数谓词干跑**（硬规则 2 的另一半）：把**修前**正则（逐字取自 `git show HEAD:plugin/scripts/identity-replication-check.ts | sed -n '325,329p'`）对上面两条【已知为真】的样本各跑一次：

```
idiom A (plugin/scripts/task-schema-check.sh:14)
  sample: "source \"$(dirname \"$0\")/gate-script-lib.sh\"\n"
  OLD regex: ZERO MATCH   <= 已知为真的样本读不出 ⇒ 零计数是假读
idiom B (plugin/scripts/supervisor-bus-identity.sh:21-22)
  sample: "  _gap_help_lib=\"$(dirname \"${BASH_SOURCE[0]}\")/gate-script-lib.sh\"\n  if [ -f \"$_gap_help_lib\" ]; then . \"$_gap_help_lib\"; tool_help \"$0\"; fi\n"
  OLD regex: ZERO MATCH   <= 已知为真的样本读不出 ⇒ 零计数是假读
```

修后**同一份样本、同一个干跑脚本**（只换来正则）：

```
idiom A: MATCH «source "$(dirname "$0")/gate-script-lib.sh"»
idiom B: MATCH «  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"\n  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"»
```

### AC2 — 修后位置判定（本树现场读数）

```
$ node --experimental-strip-types plugin/scripts/identity-replication-check.ts --limit 400 --json
<entity>                 BEFORE (develop 52d07597)            AFTER (worktree 6b948dd60)
gate-script-lib.sh       code=82 full=86 accessor=0  hardcoded=82   →   code=82 full=86 accessor=76 hardcoded=6
suite-slot-lib.sh        code=18 full=21 accessor=3  hardcoded=15   →   code=18 full=21 accessor=3  hardcoded=15
```

* `gate-script-lib.sh`：`accessor` 0 → **76**（> 0 ✓），`hardcoded` 82 → **6**（相对立案的 143 与相对本树的 82 都**显著下降** ✓）；`code`/`full` 两栏一字未动，证明变化只发生在「访问器 vs 硬编码」这一维。
* `suite-slot-lib.sh` 的真实 `source` 调用点数实测：

```
$ grep -rnE '(^|[;&|{])[[:space:]]*(then[[:space:]]+|do[[:space:]]+|else[[:space:]]+)?(\.|source)[[:space:]]+' \
    --include=*.sh --include=*.ts --include=*.mjs --include=*.js plugin/ experiments/ packages/ scripts/ | grep 'suite-slot-lib'
plugin/scripts/checker-mutation-cases/registry-bare-filename-scan.sh:33:source "${repo_root}/plugin/scripts/suite-slot-lib.sh"
scripts/test.sh:551:source "${repo_root}/plugin/scripts/suite-slot-lib.sh"
plugin/scripts/checker-mutation-cases/suite-slot-ssot-check.sh:32:source "${repo_root}/plugin/scripts/suite-slot-lib.sh"
```

⇒ 真实调用点 = **3**，修后 `accessor` = **3 ≥ 3** ✓。

**如实说明（不粉饰）**：`suite-slot-lib.sh` 的这一栏本次**没有变化**（修前修后都是 3/15），因为它的 shell 引用形态是 `source "${repo_root}/plugin/scripts/suite-slot-lib.sh"`——路径里**没有嵌套引号**，旧正则本来就读得懂。它的 15 个 `hardcoded` 全部是 `.ts`/`.mjs` 侧的路径字面量（`path.join(root, "plugin","scripts","suite-slot-lib.sh")`）与 registry 条目，那些**在结构上不可能**从 TS 走 `source`，本检测器把它们记作 hardcoded 是该指标的定义，不是假读。故该实体按评审结论 "re-run rather than file a separate merge task" 处理：本次修完后它的读数是**可信**的（accessor 恰等于真实 source 调用点数），不再是「同一处正则读不懂」的受害面。

### AC3 — 负控制（假阳性方向）：`plugin/test/workflow-journal.test.mjs`

该文件只在**字符串字面量**里命名 `gate-script-lib.sh`（fixture 路径），从不 source/import 它：

```
$ grep -n 'gate-script-lib\.sh' plugin/test/workflow-journal.test.mjs
46:const REAL_GATE_LIB = path.join(PLUGIN_SCRIPTS, "gate-script-lib.sh");
73:// ── fixture helper (real git + real gate-script-lib.sh for root resolution) ───────────────────────
80:  fs.copyFileSync(REAL_GATE_LIB, path.join(dir, "plugin", "scripts", "gate-script-lib.sh"));

$ grep -nE '(^|[;&|{])[[:space:]]*(then[[:space:]]+|do[[:space:]]+|else[[:space:]]+)?(\.|source)[[:space:]]+' plugin/test/workflow-journal.test.mjs
(no shell source command in this file)
```

修后分类（现场读数）：

```
plugin/test/workflow-journal.test.mjs  ->  full=1 code=1 accessor=0 hardcoded=1  ⇒ HARDCODED
```

⇒ 仍计入 `hardcoded`（第 46 行的字符串字面量落在代码位置），**不**计入 `accessor` ✓。

**全量对照（更宽的同向证据）**：350 行里**只有 3 行**发生变化，`code`/`full` 全表不变：

```
gate-script-lib.sh   accessor 0 -> 76   hardcoded 82 -> 6
quay-init.sh         accessor 1 -> 2    hardcoded 52 -> 51
repo-root.sh         accessor 4 -> 5    hardcoded  6 -> 5
rows changed: 3 / 350 | code/full invariant: true
```

三处翻为 accessor 的都已逐条核实是真 source：`plugin/test/archive-exclusion-wiring.test.mjs:161`（`. "${path.join(SCRIPTS_DIR, "quay-init.sh")}"`，嵌套引号）与 `scripts/worktree-include.sh:62+68`（`REPO_ROOT_SH="${SCRIPT_DIR}/../plugin/scripts/repo-root.sh"` … `. "${REPO_ROOT_SH}"`，idiom B）。

**反向的放宽守卫（写进单测的 fixture ⑤）**：过大放宽会**假阳性**。两种过头写法都实测过，都会把 `. "$CONF"  # loads shared-lib.sh` 这一行升成 accessor（匹配起点是行首的 `.`，落在**代码位置**，位置掩码拦不住，因为被提到的是行尾注释）——① 简单放宽成 `[^\n]*?`；② 只要求「引号成对」（那样 `"$CONF"` 被读成一个引号段、再吃掉后面的 `#`）。故最终形态要求「引号**成对** ∧ 未加引号的片段额外排除 `#`」，两条合起来才同时做到读得懂嵌套引号与不吞掉行尾注释。

### AC4 — 两份副本同改·防分叉

修法：抽出 `accessorRegexSource(stem)`（三族 ①import/require ②source + 内联路径表达式 ③赋值路径到变量后再 source 该变量），`literalReplication()` 与 `replicationTable()` **共用同一份**——原先是两份逐字相同的副本，现在分叉在**结构上不可能**（这比"两处都改对"更强：不是约定，是没有第二个可以改错的地方）。`replicationTable` 顺带把正则从「每 (文件×实体) 编译一次」提到「每实体一次」。

同一实体 `gate-script-base.ts`，`--json` 的全量表 与 单实体入口 各取一次读数：

```
full table row        : {"entity":"gate-script-base.ts","full":248,"code":240,"accessor":230,"hardcoded":10}
literalReplication()  : {"entity":"gate-script-base.ts","full":248,"code":240,"accessor":230,"hardcoded":10}
sharedModuleControl() : entity=gate-script-base.ts accessor(importAccessor)=230 hardcoded=10 flagged=false
diff table vs literalReplication: 0 (identical)
diff table.accessor vs sharedModuleControl.importAccessor: 0  / hardcoded: 0
```

⇒ 差值 = 0 ✓（三条读数路径全一致）。另有单测 `literalReplication vs replicationTable — 同一实体两条路径读数一致` 把这条不变量钉在 fixture 上。

### AC5 — 负控制：既有真样本不回归

```
$ node --experimental-strip-types plugin/scripts/identity-replication-check.ts --limit 400 --json
== 共享模块负控制 (AC4) — gate-script-base.ts ==
  import 单一访问器=230  硬编码=10  flagged=false

gate-script-base.ts   BEFORE code=240 full=248 accessor=230 hardcoded=10
                      AFTER  code=240 full=248 accessor=230 hardcoded=10
```

⇒ 修后仍 `flagged=false` ✓，`accessor` 230 一字未降 ✓（立案读数为 231，本树修前实测 230；对照取**同树修前**的 230，差值 0）。

### AC6 — 单测

```
$ node --experimental-strip-types plugin/test/identity-replication-check.test.mjs ; echo EXIT=$?
✔ literalReplication — 单一访问器的三族形态: 内联 computed path / 赋值后 source 变量 / 非引用不升 accessor
✔ literalReplication vs replicationTable — 同一实体两条路径读数一致 (AC4: 分叉在结构上不可能)
...
ℹ tests 11  ℹ pass 11  ℹ fail 0
EXIT=0
```

新增断言覆盖的 fixture（五条，`ACCESSOR_ENTITY = "shared-lib.sh"`）：

| fixture | 内容 | 期望 | 覆盖 |
|---|---|---|---|
| `idiom-a.sh` | `source "$(dirname "$0")/shared-lib.sh"` | accessor | AC6 第 1 条 |
| `idiom-b.sh` | `_lib="$(dirname "${BASH_SOURCE[0]}")/shared-lib.sh"` + `. "$_lib"` | accessor | AC6 第 2 条 |
| `comment-only.sh` | 只在 `#` 注释里提及 | ignored（位置判定剔除） | AC6 第 3 条 |
| `string-only.sh` | `echo "shared-lib.sh"`，从不 source | hardcoded（非 accessor） | AC3 同向 |
| `comment-tail.sh` | `. "$CONF"  # loads shared-lib.sh` + 一处代码位置提及 | hardcoded（非 accessor） | 放宽守卫 |

整组计数断言 `accessor=2 / hardcoded=2 / code=4 / full=5` —— **双向都非空**，断言不空转（若放宽过头把 `comment-tail.sh` 也算进去，`accessor` 会变成 3 而红）。

### DoD — 生产载体读数 + scoped 门

生产载体（本仓真实 shell 文件，非 fixture）修前/修后两行完整指标见 AC2；所用命令：

```
node --experimental-strip-types plugin/scripts/identity-replication-check.ts --limit 400 --json   # 全表
node --experimental-strip-types plugin/scripts/identity-replication-check.ts                      # 人读表
```

```
$ bash scripts/test.sh --for-task gap-identity-accessor-regex-source-computed-path --allow-thin ; echo $?
SCOPED_GATE_EXIT=0
```

（另记下游影响：`clusterIdentityReport` 的 `P2-identity-<entity>` 簇与 `deletionClosureComponents` 都按 `hardcoded` 排序取候选 ⇒ 修前 `gate-script-lib.sh` 以硬编码 82 顶在架构复核候选簇与 P1 删除闭包候选的前列，两个下游读数一并被这次假读污染；修后回到 6。此为诊断所及，未另立案。）

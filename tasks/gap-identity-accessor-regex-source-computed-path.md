---
id: gap-identity-accessor-regex-source-computed-path
title: identity-replication-check.ts 的 accessor 正则读不出本仓两种主流 source
  idiom——gate-script-lib.sh 143 处正当引用被计成 hardcoded=143/accessor=0
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

- [ ] AC1（复现固化·零计数也查谓词）：贴出立案读数逐字（`gate-script-lib.sh code=143 accessor=0 hardcoded=143`、`suite-slot-lib.sh code=21 accessor=5 hardcoded=16`）、两种 idiom 各自的真实引用行（`grep -n` 各贴 ≥2 条），**并且**把旧正则对一个【已知为真】的样本干跑一次（对 idiom A 与 idiom B 两行各跑一次，展示零匹配）——零计数与"谓词对真样本命不命中"两半都要（硬规则 2）。
- [ ] AC2（修后·位置判定）：修后重跑检测器，`gate-script-lib.sh` 的 `accessor` **> 0** 且 `hardcoded` 相对 143 **显著下降**（贴出修后整行 `code/full/accessor/hardcoded`）；`suite-slot-lib.sh` 的 `accessor` ≥ 现场实测的真实 `source` 调用点数（贴出该实测命令与数字）。两条都贴现场输出，⛔ 不抄本任务读数。
- [ ] AC3（负控制·假阳性方向）：放宽正则**不得**把真硬编码一并算成 accessor——指出一个只在**注释/文档/字符串字面量**里提到 basename、从不 source/import 它的文件，修后该文件仍计入 `hardcoded` 而**不**计入 `accessor`（贴出该文件名、该行内容与修后分类结果）。
- [ ] AC4（两份副本同改·防分叉）：对**同一个文件**，`literalReplication()` 与 `replicationTable()` 两条路径给出的 accessor/hardcoded 判定一致——用同一实体在 `--json` 的全量表与单实体入口各取一次读数并逐字对比，差值 = 0（贴出两段输出）。
- [ ] AC5（负控制·既有真样本不回归）：`gate-script-base.ts` 修后仍 `flagged=false`，且其 `accessor` 不因本次放宽而下降（贴出修后该行；立案读数 231 为对照）。
- [ ] AC6（单测）：`node --experimental-strip-types plugin/test/identity-replication-check.test.mjs` exit 0，且新增断言至少覆盖三条 fixture：idiom A 判 accessor、idiom B 判 accessor、纯注释提及判 hardcoded-not-accessor。

## DoD

对**生产载体**（本仓真实 shell 文件）跑过一次修后读数：`gate-script-lib.sh` 的 accessor 由 0 变为非 0、`suite-slot-lib.sh` 的 accessor 反映真实调用点数，贴出修前/修后两行的完整指标与所用命令；AC3 的反向实例与 AC4 的两路一致性读数一并贴出。⛔ 不以"新增单测绿"代替生产读数（fixture 证明"能产出"，不证明"已产出"，hard rule 4 推论三）。

## Touches

- plugin/scripts/identity-replication-check.ts
- plugin/test/identity-replication-check.test.mjs
- tasks/gap-identity-accessor-regex-source-computed-path.md

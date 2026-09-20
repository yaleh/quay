---
id: gap-identity-pair-scan-skips-symlinks
title: identity-replication-check.ts 的 AC3 字节对扫描跟随软链——59 对"复制"其实是同一 inode
  自己比自己，应与 mirror-pair-drift-check 同规则跳过软链
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

`plugin/scripts/identity-replication-check.ts` 的 `findByteIdenticalPairs()`（约 :234）在比对 `plugin/scripts/*` 与 `experiments/*/scripts/` 的同名文件时用 `fs.existsSync(cand)` + `fs.readFileSync(cand)`——**跟随软链**。而 `experiments/quay-perpetual-stream/scripts/` 下现有 **59 个软链**（`ls -la … | grep -c '^l'` = 59；该目录共 121 个条目，`git ls-files … | wc -l` = 121 —— 即 121 个 tracked 条目里 59 个是软链、62 个是常规文件），全部形如 `X -> ../../../plugin/scripts/X`。于是扫描把 59 个文件**与它自己**逐字节比对、当然相等，报成 59 对"字节完全相同文件对 / 27646 行"。

现场实跑（立案时，逐字）：

```
== 字节完全相同文件对 (AC3) — 59 对 / 27646 行 ==
  plugin/scripts/anti-drift-touches-check.ts  ==  experiments/quay-perpetual-stream/scripts/anti-drift-touches-check.ts  (442 行)
  plugin/scripts/anti-gaming-guard.ts  ==  experiments/quay-perpetual-stream/scripts/anti-gaming-guard.ts  (95 行)
  … 及另外 54 对
```

抽样 5/5 用 `ls -la` 核实：`anti-drift-touches-check.ts`、`anti-gaming-guard.ts`、`audit-independence-check.sh`、`audit-independence-check.ts`、`build-evidence-collector.ts` 在 experiments 侧**全部是软链**（`-> ../../../plugin/scripts/<name>`）。

**同仓已有正本规则，且与本扫描直接冲突**：`plugin/scripts/mirror-pair-drift-check.ts` 头注释逐字写着 ——

> "a REGULAR FILE present in BOTH dirs is a pair (byte-compared). A SYMLINK on either side is NOT a pair — it is a single-source reference (the same file), so it cannot drift; the checker excludes it rather than comparing a file against itself."

**判定**：探针缺陷——报出的"59 对复制"里绝大部分是**自己比对自己**（同一 inode），把"单一来源引用"读成了"复制替代抽象"的最强证据。修法方向：`findByteIdenticalPairs()` 用 `lstat`/`readlink`（或 `Dirent.isSymbolicLink()`）跳过任一侧为软链的条目，与 `mirror-pair-drift-check.ts` 取同一判定；修后对数应落到**真实常规文件副本**的量级（`mirror-pair-drift-check.ts` 头注释记的 61 个同名条目 / 21 软链 / 40 真副本，以修后现场读数为准）。

<!-- dedup-ref -->
相关联但不同机制：[[gap-mirror-pair-drift-policy-plugin-scripts-experiments]]（已 done）泛化的是**通用镜像漂移闸**（`mirror-pair-drift-check.ts`），它的产出恰好是本任务要对齐的规则正本；本任务改的是 `identity-replication-check.ts` 自己的 AC3 扫描，不动那个检查器。[[gap-archguard-p2-identity-replication-checker]]（已 done）落地检测器本体时其 AC3 只要求"报出字节完全相同文件对"，未处理软链语义。

## AC

- [x] AC1（复现固化）：贴出立案读数逐字（59 对 / 27646 行）与 5/5 抽样的 `ls -la` 输出（证明被报的"对"在 experiments 侧是软链），并附两条计数：`ls -la experiments/quay-perpetual-stream/scripts/ | grep -c '^l'` = 59（软链数），`git ls-files experiments/quay-perpetual-stream/scripts/ | wc -l` = 121（tracked 条目总数）。
- [x] AC2（修后·位置判定）：修后重跑检测器，`byteIdentical.pairs[]` 中 **experiments 侧为软链的条目数 = 0**（对每条做 `lstat` 判定后计数，贴出计数与命令），总对数落到真实副本量级（贴出修后精确数字，并与 `mirror-pair-drift-check.ts` 对同一镜像目录给出的真副本数交叉核对，贴出后者输出）。
- [x] AC3（负控制·真副本不许被一并漏掉）：构造一个含两条目的 fixture 目录——`a.ts` 两侧都是**常规文件**且逐字节相同、`b.ts` 在 experiments 侧是**软链**——修后的 `findByteIdenticalPairs()`（或等价可注入 fixture 的测试入口）必须**报 a、不报 b**。贴出该 fixture 的真实输出（两行都要出现，一行是命中、一行是缺席的对照）。
- [x] AC4（与姊妹规则一致）：用一条命令级证据证明两检查器对"软链不是 pair"取同一判定——`node --experimental-strip-types plugin/scripts/mirror-pair-drift-check.ts --json` 与 identity-replication 的 AC3 结果在"软链条目"这一集合上**都没有**条目（贴出两侧输出）。
- [x] AC5（单测）：`node --experimental-strip-types plugin/test/identity-replication-check.test.mjs` exit 0，且新增断言含软链 fixture（不报）+ 真副本 fixture（报）两条。
- [x] AC6（scoped 门）：`bash scripts/test.sh --for-task gap-identity-pair-scan-skips-symlinks` 绿（或等价 scoped 静态门）。

## DoD

修后对**生产载体**（本仓真实的 `experiments/quay-perpetual-stream/scripts/` 镜像目录）跑过一次：AC3 段输出里 59 个软链条目全部消失、真实文件副本对数保留，修前/修后两段输出逐字贴进任务体；并与 `mirror-pair-drift-check.ts` 的真副本读数交叉核对一次（贴出两侧数字）。⛔ 不以"新增 fixture 单测通过"代替生产读数（hard rule 4 推论三）。

## 证据（AC 逐条）

**实现**：`findByteIdenticalPairs()` 改用 lstat 级谓词 `Dirent.isFile()`（符号链接报 false）在**两侧**分类目录条目，任一侧非常规文件即跳过——不依赖链接指向哪里（悬空链同样排除），与 `mirror-pair-drift-check.ts` 取同一判定（但**不共享代码**：那个检查器把镜像目录写死为 quay-perpetual-stream，本检查器扫 `experiments/*/scripts` 全部镜像目录，遍历面不同）。新增 `symlinksSkipped` 计数，使"0 对"与"镜像目录不存在"可区分（hard rule 3b）。

### AC1 — 复现固化

修前读数逐字（`node --experimental-strip-types plugin/scripts/identity-replication-check.ts` 的 AC3 段）：

```
== 字节完全相同文件对 (AC3) — 59 对 / 27646 行 ==
  plugin/scripts/anti-drift-touches-check.ts  ==  experiments/quay-perpetual-stream/scripts/anti-drift-touches-check.ts  (442 行)
  plugin/scripts/anti-gaming-guard.ts  ==  experiments/quay-perpetual-stream/scripts/anti-gaming-guard.ts  (95 行)
  plugin/scripts/audit-independence-check.sh  ==  experiments/quay-perpetual-stream/scripts/audit-independence-check.sh  (41 行)
  plugin/scripts/audit-independence-check.ts  ==  experiments/quay-perpetual-stream/scripts/audit-independence-check.ts  (267 行)
  plugin/scripts/build-evidence-collector.ts  ==  experiments/quay-perpetual-stream/scripts/build-evidence-collector.ts  (674 行)
  … 及另外 54 对
```

5/5 抽样 `ls -la`（cwd = `experiments/quay-perpetual-stream/scripts/`）：

```
lrwxrwxrwx 1 yale yale 51 Sep 20 18:41 anti-drift-touches-check.ts -> ../../../plugin/scripts/anti-drift-touches-check.ts
lrwxrwxrwx 1 yale yale 44 Sep 20 18:41 anti-gaming-guard.ts -> ../../../plugin/scripts/anti-gaming-guard.ts
lrwxrwxrwx 1 yale yale 51 Sep 20 18:41 audit-independence-check.sh -> ../../../plugin/scripts/audit-independence-check.sh
lrwxrwxrwx 1 yale yale 51 Sep 20 18:41 audit-independence-check.ts -> ../../../plugin/scripts/audit-independence-check.ts
lrwxrwxrwx 1 yale yale 51 Sep 20 18:41 build-evidence-collector.ts -> ../../../plugin/scripts/build-evidence-collector.ts
```

两条计数：

```
$ ls -la experiments/quay-perpetual-stream/scripts/ | grep -c '^l'
59
$ git ls-files experiments/quay-perpetual-stream/scripts/ | wc -l
121
```

软链是 git 索引层的事实、不是 checkout 假象：

```
$ git ls-files -s experiments/quay-perpetual-stream/scripts/ | awk '{print $1}' | sort | uniq -c
     30 100644
     32 100755
     59 120000        # 120000 = 符号链接
```

### AC2 — 修后·位置判定（软链条目 = 0）

修后 AC3 段逐字：

```
== 字节完全相同文件对 (AC3) — 0 对 / 0 行 (跳过 59 个软链条目: 单一来源引用, 非 pair) ==
```

对 `byteIdentical.pairs[]` 每条做 `lstat` 判定后计数（`--json` + lstat 逐条）：

```
byteIdentical.count     = 0
byteIdentical.totalLines= 0
byteIdentical.symlinksSkipped = 59
AC2 lstat over pairs[]: experiments-side SYMLINK = 0 | REGULAR = 0 | missing = 0
```

**交叉核对（AC2 要求的"真副本量级"）**：`mirror-pair-drift-check.ts` 对同一镜像目录的输出 ——

```
mirror-pair-drift-check exit=0
evaluated=true totalPairs=0 consistentPairs=0 driftedPairs=0 allowedDrifts=0
```

identity-replication 修后 `count` = 0 **=== ** mirror-pair 的 `consistentPairs` = 0 —— 两检查器的真副本读数一致。

⚠️ **一处与立案预期的偏离（如实记录）**：立案时引用的 `mirror-pair-drift-check.ts` 头注释记"61 个同名条目 / 21 软链 / 40 真副本"，但**现场读数是 59 个同名条目 / 59 软链 / 0 真副本**——即镜像副本已被后续任务全部改为软链（`git log` 见 `5abcd9791 gap-arch-duplicate-copies-zero: 镜像副本改相对符号链接 + 修符号链接引入的两类静默失效`）。故"真实文件副本对数保留"在**生产载体上恰是 0**（没有真副本可保留，也无从丢失）。因此生产读数本身**不足以**证明"真副本仍会被报"——这一条由 AC3 的 fixture 负控制提供（见下），两半互补。`mirror-pair-drift-check.ts` 头注释里那句"21 软链 / 40 真副本"现已过时，但该文件不在本任务 Touches 内，**未改**，仅在此记录。

### AC3 — 负控制（真副本报、软链不报）

fixture：`a.ts` 两侧都是常规文件且逐字节相同；`b.ts` 在 experiments 侧是软链，**指向一个真实存在、内容逐字节相同的文件**（否则负控制空转）。输出：

```
fixture: /tmp/ac3-fixture-J5xbsA
  plugin/scripts/a.ts              regular  (both sides)
  experiments/.../a.ts             regular  (both sides)  -> 命中, 应报
  plugin/scripts/b.ts              regular
  experiments/.../b.ts             SYMLINK -> ../../../plugin/scripts/b.ts  -> 缺席, 不应报

-- FIXED findByteIdenticalPairs() --
pairs       = ["experiments/quay-perpetual-stream/scripts/a.ts"]
totalLines  = 1
symlinksSkipped = 1
命中行:   a.ts REPORTED  ✔
缺席对照: b.ts NOT reported  ✔

-- PRE-FIX predicate (existsSync+readFileSync, follows symlinks) on the SAME fixture --
old would report = ["a.ts","b.ts"]
=> negative control is discriminative: b.ts IS byte-identical through the symlink, so the old code reported it and the fixed code does not.
```

（最后一段是本条非空转的证明：同一 fixture 上旧谓词报 **2** 条、新谓词报 **1** 条 —— 差异正是被修掉的那个软链条目。）

### AC4 — 与姊妹规则一致（软链条目两侧都无条目）

```
same-name entries plugin/scripts <-> mirror : 59
  of which SYMLINK : 59
  of which REGULAR : 0  []

A) mirror-pair-drift-check --json
   evaluated=true totalPairs=0 consistentPairs=0 driftedPairs=0 allowedDrifts=0
   symlink names appearing in pairs[] : 0  []
B) identity-replication-check --json
   byteIdentical.count=0 totalLines=0 symlinksSkipped=59
   symlink names appearing in pairs[] : 0  []

CROSS-CHECK: identity count (0) === mirror consistentPairs (0) -> true
             both exclude ALL 59/59 symlink names -> true
```

即以**名字级**证据（不是仅凭总数）证明：59 个同名软链在两个检查器的输出里都不出现。

### AC5 — 单测

```
✔ findByteIdenticalPairs — 字节相同对计数 + 行数, 漂移副本不算
✔ findByteIdenticalPairs — 软链不是 pair (单一来源引用), 真副本才报 (AC3 负控制)
ℹ tests 9  ℹ pass 9  ℹ fail 0
TEST_EXIT=0
```

新增断言同时含**真副本 fixture（报）** 与**软链 fixture（不报）**两条，并断言 `symlinksSkipped === 1`（跳过被计数、非静默丢弃）。

### AC6 — scoped 门

```
$ bash scripts/test.sh --for-task gap-identity-pair-scan-skips-symlinks --allow-thin
GATE_EXIT=0
```

scoped 静态层含 `mirror-pair-drift-check`（`PASS — every mirror pair matches or is allow-listed with an unchanged signature.`）与 `touches-one-entry-one-path-check` 等；末段为该任务单测 `pass 9 / fail 0`。

## Touches

- plugin/scripts/identity-replication-check.ts
- plugin/test/identity-replication-check.test.mjs
- tasks/gap-identity-pair-scan-skips-symlinks.md

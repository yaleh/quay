---
id: gap-ac310-criterion-conflates-not-evaluated-with-copies-nonzero
title: AC-310 判据把「检查器未评估」与「副本非零」压进同一个 CAUSE：实测 evaluated:false 且
  duplicateCopies:0 时仍报「仍有非符号链接的字节相同副本」，长期判据因此以 1.60% 假红（GOAL-025 兄弟判据
  0.17–0.39%）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-310
---
**type:** execution

## Proposal

**缺口（两次独立测量，2026-10-16）**：长期判据 AC-310 在 `2026-10-16T13:37:48.260Z` 判 fail（`.quay/gate-events.jsonl` 落痕 `actor=goal-cli`、`evaluationRoot=/data/home/yale/work/quay`、`treeSha=adfba147e51b`）；**同一个根、同一个 treeSha** 在 `13:35:48.364Z` 是 pass，本任务立案前独立复跑（`13:38:14Z`）**又是 pass**。

**实测该量的真值是 0，由两种互相独立的枚举得出**：
- `sh-census-check --json`：`evaluated:true`、`totals.duplicateCopies:0`、`duplicates:[]`、`differingSameName:[]`、`symlinkedCopies:61`、`verdict.ok:true`；
- **不调检查器**的独立复算（`git ls-files` 取 tracked 集 + `lstat` + 逐字节比对）：`experiments/**/scripts` 下与 `plugin/scripts` 同 basename 的文件**共 61 个，全部是 tracked 符号链接（mode 120000）**，非链接同字节对 **= 0**；且 experiments 侧**没有任何未跟踪的真实文件副本** ⇒ 连「某层 `git add` 把它瞬时变 tracked」这条路径也不存在。

**⇒ 失败不是「副本回来了」，而是 `evaluated === false`。** 判据与检查器都 fail-closed，这本身是**设计**（AC 的 `expect` 逐字写着「检查器不存在/未评估时同样 exit 1（不是 0）」）。**缺陷在失败面不可区分**：判据把检查器整条流水线的 stderr 丢掉（`2>/dev/null`），再把**至少 6 个互斥状态压进同一个 CAUSE 词条**——
`duplicateCopies > 0` / `git ls-files failed` / `no tracked *.sh found` / 例外表不可解析 / 例外表不可读 / `could not read N tracked *.sh`（外加崩溃或子进程被杀 ⇒ stdout 为空 ⇒ `JSON.parse("")` 抛异常 ⇒ 走同一条 `catch`）。

这 6 态在判据输出里**完全同形**，而其中只有第 1 条是「保证被违反」，其余全是「仪器读不懂输入」——正是硬规则 3b 的形态（读不懂伪装成检查结果），只是这次伪装成的是**检查失败**而非检查通过。后果是实打实的：这 1.60% 的读数每一次都以「长期保证回归」进入立案通道（**本任务就是这么产生的**）。

**已复现的演示（把「不可区分」变成可复现事实，⛔ 不是推理）**——同一份检查器，只把 `--exceptions` 指向不存在的路径，制造一个**真的**未评估态：

```
$ node --experimental-strip-types plugin/scripts/sh-census-check.ts --json --exceptions /nonexistent/demo.txt   # stderr
sh-census-check: NOT-EVALUATED — exception list unreadable (/nonexistent/demo.txt): ENOENT: no such file or directory
$ 该次 stdout 的 JSON
{"evaluated":false,"reason":"exception list unreadable (/nonexistent/demo.txt): ENOENT: …","totals":{"duplicateCopies":0}}
$ <AC-310 判据逐字跑> ; echo $?
stderr: CAUSE=duplicate-copies-nonzero-or-not-evaluated — experiments/ 与 plugin/ 仍有非符号链接的字节相同副本，或检查器未评估
exit 1
```

**检查器在那次读数里明确报了 `duplicateCopies:0`，并在 `reason` 字段与 stderr 上各给出了自己的精确原因**；判据把两者**全部丢弃**，只留一个两义词条。⇒ 真值与原因**都被生产出来了，是判据把它们扔掉的**。

**为什么值得修（不是噪音）**：以 `actor=goal-cli` 的落痕计，自 2026-09-19 起 AC-310 共 **9311 次读数 / 149 次 fail = 1.60%**；用**同款** `X-or-not-evaluated` 写法、属同一 GOAL-025 的兄弟判据低一个数量级：AC-307 0.17%（16/9295）、AC-309 0.17%、AC-308 0.39%。⇒ AC-310 有约 **4–9 倍的自身不稳定度**。

**失败与「检出被并发改写」相关的读数（附对照）**：
- `git reflog` 实测：`3dba63f0f HEAD@{2026-10-16 21:35:27 +0800}: merge develop: Fast-forward`，且 `plugin/scripts/*` 一批文件的 ctime 正是 `21:35:27` ⇒ **21:37:48 那次 fail 落在一次 ff-merge 之后 2m21s 内**。
- **对照**：把 149 次 fail 与 reflog 中 1274 次 `merge develop` 做时间邻接统计，**fail 落在 merge 后 300s 内的占 27.5%，而全体读数（pass+fail）只有 7.9%** ⇒ 邻接 merge 把失败概率抬高约 3.5×。**同一统计在兄弟判据上同样成立**（AC-307 18.8% vs 7.7%、AC-308 25.0%、AC-309 18.8%）⇒ 这条解释的是**四者共有的环境底噪**（merge/fan-in 期间 fork 与读盘受挤），**不能**单独解释 AC-310 多出来的那 4–9 倍。

**AC-310 独有的那部分**最可能落在它**独有的读路径**上：`readCensus` 的普查循环逐个读**全部 145 个 tracked `.sh`**（其中 12 个是 experiments 侧符号链接，指向被 ff-merge 反复改写的 `plugin/scripts/`），任一瞬时不可读 ⇒ `readFailures.length > 0` ⇒ 整体 `notEvaluated`。兄弟判据不读全量 `.sh`，故不受此路径影响。（`collectReferences` 的读错误是 `catch { continue }` 吞掉的，**不会**造成 notEvaluated ⇒ 不是它。）

⛔ **这是本任务要证实/证伪的头号假说，不是结论**（硬规则 4 推论四：给不出对照的说法只能算假说）。已排除的一条：`git ls-files failed`（AC-309 同样调 `git ls-files` 却只有 0.17%）。其余各条**必须由 AC2 的窗口捕获或注入复现给出实际 reason 之后**才许下结论。

<!-- dedup-ref -->
**与 `gap-arch-duplicate-copies-zero`（done）的关系——上一次修复为什么没有保住**：那次任务的产物**保住了**：61 个镜像项今天全是符号链接、非链接同字节对确为 0（两次独立枚举）。**没保住的是判据的「可读性」**：把 40 个真实副本换成符号链接，恰好**让普查开始逐个读这 61 个符号链接**，而符号链接的目标目录（`plugin/scripts/`）正是本循环每轮 ff-merge / fan-in 反复改写的那个 ⇒ 那次转换把它从一个「静态重复」问题变成了一个「读穿透到被并发改写的目录」问题。本任务修的是后者，**不是**把副本改回去（见 AC6）。

## Plan

1. **先捕获实际 reason，不要先改**（硬规则 4 推论四）：在主线检出上起一个**不改动任何仓库状态**的采样器，按 ≤3s 间隔连续跑**判据的逐字形态**并保留**检查器自己的 stderr 与 JSON 的 `reason`**（⛔ 现有判据的 `2>/dev/null` 正是要绕开的东西），窗口须覆盖一次真实的 ff-merge / fan-in。捕获到即以该 reason 为准；窗口内一次都没捕获到 ⇒ 用第 2 步的注入把每一条 notEvaluated 分支各造一次，并**如实写出「生产上未捕获到」**（⛔ 不得把注入态当成生产态）。
2. **给失败面独立取值**（硬规则 3b 的共同修法）：让判据的 `CAUSE` **携带检查器自报的 reason**，并把「副本非零」与「未评估」拆成**两个互不相同的词条**（例如 `CAUSE=duplicate-copies-nonzero` 与 `CAUSE=not-evaluated:<reason>`）。⛔ **不放松 fail-closed**：真·未评估仍 `exit 1`（AC 的 `expect` 就是这么定的）；改的只是「说得清不清楚」。
   - ⚠️ 该改动落在 `goals/AC-310-*.md` 的 `criterion` 字段 ⇒ 走 `goal_write` 且**两个根都要写**；落笔前先 `grep` 全部 corpus 查有没有测试**逐字**钉住旧 criterion（已知 `tasks/gap-arch-duplicate-copies-zero.md` 与 `.quay/ac241-verify/neg/` 各含一份副本，均非测试），**把命中数与前 3 条贴进提交**（硬规则 5b：修一处 ≠ 只此一处）。
3. **消除假红**：对第 1 步命名的读路径做健壮化——瞬时 `ENOENT`/`EACCES` 重试，或把「是否符号链接」与内容改从**原子的 git 索引/对象**取（`ls-files -s` 的 mode 与 blob），而不是从正在被改写的活工作树上 `lstat` + `readFileSync`。⛔ 不得用「读不到就当 0」消音——那会把硬规则 3b 反向再犯一遍。
4. **对照**：同一并发改写窗口下给出「改动前 `evaluated:false`、改动后 `evaluated:true` 且 `duplicateCopies:0`」的同命令对照；并在 fixture 保留一条**真的**未评估（检查器缺失 / 例外表不可读）作正控制，证明第 2 步的两态确实分得开。

## Acceptance Criteria

- [x] AC1 — **两态可分（负控制两方向，词表必须不同）**：(a) 人为造出一对**真的**字节相同非链接副本 ⇒ 判据 stderr 的 `CAUSE` 命中 duplicate 专用词条且**不含** not-evaluated 词条；(b) 制造真·未评估（`--exceptions` 指向不存在路径）⇒ `CAUSE` 命中 not-evaluated 专用词条并**逐字携带检查器自报的 reason**，且不含 duplicate 词条。两例均附命令行 + 实际 stderr 全文。
- [x] AC2 — **实际 reason 已给出**：写出该 notEvaluated 的**实际 reason 字符串**及其来源（生产窗口捕获 / 注入复现，须标明是哪一个），并附**那一次的完整 JSON**（`evaluated` / `reason` / `totals.duplicateCopies` 三键同现）。
- [x] AC3 — **根因路径已修且有对照**：给出同一条命令、同一个根上「改动前 `evaluated:false`、改动后 `evaluated:true && duplicateCopies===0`」的前后对照全文。
- [x] AC4 — **fail-closed 未被放松**：检查器缺失、例外表不可读两例各自仍 `exit 1`，且 `CAUSE` 携带**各自不同**的 reason 词条。
- [x] AC5 — **稳定性实测（取真值，不是断言）**：在主检出上连续 ≥200 次跑判据（间隔 ≤3s），**全部 exit 0**；给出这 200 次的起止时刻、失败计数 `0`，且窗口**至少覆盖一次** ff-merge 或 fan-in（附其 reflog 行 / 时间戳）。
- [x] AC6 — **不把副本改回去**：实测 `duplicateCopies===0`，且 61 个镜像项仍**全部**为 mode 120000 符号链接（`git ls-files -s experiments/quay-perpetual-stream/scripts/ | awk '$1=="120000"' | wc -l` = 61），非链接同字节对 = 0。

## Definition of Done

**真实落地 = 判据本体（不只是检查器）在生产根上取到真值**：把改后的判据**逐字**跑在主检出 `/data/home/yale/work/quay` 上 `exit 0`，并且**在一个覆盖 ff-merge / fan-in 的真实窗口内连续 ≥200 次读数无一失败**（AC5 的原始输出留痕）；同时**两态可分的负控制各跑过一次并留下真实 stderr 全文**（AC1），以及「改动前 false / 改动后 true」的同命令对照（AC3）。

仅让 `sh-census-check` 的单测变绿、或仅把 `CAUSE` 文案改得更长，都**不算**落地——被修的对象是「**判据在真实根上能否稳定且可区分地取到那个量**」，不是文案。

## Touches

- `plugin/scripts/sh-census-check.ts`
- `plugin/test/sh-census-check.test.mjs`
- `goals/AC-310-重复副本清零-experiments-scripts-与-plugin-scripts-下同名-非符号链接且字节相同的文.md`
- `tasks/gap-ac310-criterion-conflates-not-evaluated-with-copies-nonzero.md`

## Blocker

无。本任务是 AC-310 判据失败面的独立修复：产物是「判据在真实根上稳定且可区分地取到 `duplicateCopies`」，与任何在飞任务无文件交集（`task-granularity-advice.ts` 实测 `peers: []`）。
## Evidence

### AC1 — 两态可分（负控制两方向，词表互斥）

判据本体的两个失败面现在使用**互不相同**的词条：`CAUSE=duplicate-copies-nonzero`（保证被违反）与
`CAUSE=not-evaluated:<检查器自报的 reason>`（仪器读不懂输入）；另有 `CAUSE=checker-missing` 与
`CAUSE=checker-no-readable-output`（检查器被杀/崩溃 / stdout 空 ⇒ 旧判据里 `JSON.parse("")` 抛异常走的正是这一条）。
`2>/dev/null` 已从判据中移除——检查器的 stderr 是保留的，reason 从 JSON 的 `reason` 键逐字带出。

**(a) 真的字节相同非链接副本 ⇒ duplicate 专用词条（且不含 not-evaluated 词条）**

把 AC-310 上一次修复留下的镜像 `experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh`
（mode 120000）临时替换为**实体**字节相同副本（`rm` + `cp plugin/scripts/tree-hygiene-check.sh`），
在本任务 worktree 内跑改后的判据逐字形态：

```
$ sh -c "$(cat /tmp/ac310-criterion-new.txt)"      # cwd = 本任务 worktree，判据全文见 goals/AC-310-*.md
CAUSE=duplicate-copies-nonzero — 实测 duplicateCopies=1，experiments/ 与 plugin/ 下仍有非符号链接的字节相同副本
exit=1
```

同一次读数下检查器自己的 JSON（三条同现）：`{"evaluated":true,"reason":null,"duplicateCopies":1,"duplicates":[{"experimentsPath":"experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh","pluginPath":"plugin/scripts/tree-hygiene-check.sh"}]}`。
注入**当场撤销**：符号链接已恢复，`git status --porcelain` 只剩本任务自己的两个文件（见 AC6 的净检出核对）。

**(b) 真·未评估（`--exceptions` 指向不存在路径）⇒ not-evaluated 专用词条，逐字携带检查器自报 reason**

```
$ sh -c "$(cat /tmp/ac310-criterion-new.txt)" ac310 --exceptions /nonexistent/demo.txt
CAUSE=not-evaluated:exception list unreadable (/nonexistent/demo.txt): ENOENT: no such file or directory, open '/nonexistent/demo.txt'
exit=1
```

`--exceptions` 由判据**转发**给检查器（判据正文里的 `"$@"`）。生产上 `$@` 为空、行为不变；
这个转发只让 AC 点名的那条注入路径可**逐字**执行。词条不含 `duplicate` 字样 ⇒ 两态在文本上即可分。

### AC2 — 实际 reason 字符串及其来源（如实标注）

**生产窗口：未捕获到（不是「没有」）**。判据逐字形态 + 检查器直读（保留 stderr）在主检出上采样
**349 次**（`2026-10-16T21:55:33+08:00 → 22:09:25+08:00`），其中**覆盖了一次真实的
`merge develop: Fast-forward`（`88d52151d HEAD@{2026-10-16 21:57:41 +0800}`，窗口内 HEAD 移动 4 次）**，
349 次全部 `evaluated:true` / `reason:null` ⇒ **生产窗口内一次 notEvaluated 都没有落到采样器上**。
这与 `.quay/gate-events.jsonl` 的存量统计不矛盾（立案时按 149/9311 = 1.60% 记；本任务把 149 拆开复算：
**122 次是那个两义词条，27 次是 2026-09-19 当天的 `CAUSE=checker-missing`** ⇒ 本任务针对的那一族是
122/9311 = **1.31%**），但两者也不能互相印证：**生产失败发生在 goal-driver 自己的并发行使窗口里**
（它同时跑其它判据与全量套件），一个独跑的采样器复现不了那份并发。

**复现（"reproduction"，⛔ 不是生产捕获）：一份活的竞态**。在 `/tmp/ac310-race` 建一个 60 个 tracked
`.sh` 的仓，两个内容不同的提交 `A`/`B` 交替 `git checkout -f`（git 的 checkout 是 unlink + 重建，
正是 ff-merge 的形态），同时让检查器逐个读这 60 个文件。同一棵被改写的树上：

```
OLD(existing) notEvaluated: 4 60      ← 旧检查器：4/60 = 6.7% 假红
NEW(fixed)    notEvaluated: 0 60      ← 改后的检查器：0/60
```

那次 NOT-EVALUATED 的**完整 JSON（三键同现）**：

```
{
 "evaluated": false,
 "reason": "could not read 1 tracked *.sh: plugin/scripts/s9.sh: ENOENT: no such file or directory, open '/tmp/ac310-race/plugin/scripts/s9.sh'",
 "totals_duplicateCopies: 0
}
```

**⇒ 实际 reason 字符串 = `could not read 1 tracked *.sh: <rel>: ENOENT: no such file or directory, open '<abs>'`**
（来源：**注入复现**，非生产捕获；旧检查器的 stderr 全文：
`sh-census-check: NOT-EVALUATED — could not read 1 tracked *.sh: plugin/scripts/s56.sh: ENOENT: …`）。

**判据把这条 reason 带出来之后长这样**（同一个根、同一份 JSON，只是换了判据：

```
$ <OLD criterion>   CAUSE=duplicate-copies-nonzero-or-not-evaluated — experiments/ 与 plugin/ 仍有非符号链接的字节相同副本，或检查器未评估
$ <NEW criterion>   CAUSE=not-evaluated:could not read 1 tracked *.sh: plugin/scripts/b.sh: ENOENT: no such file or directory, open '…'
```

两行读的是同一个 `{evaluated:false, reason:"could not read 1 tracked *.sh…", duplicateCopies:0}`——
旧判据把 `duplicateCopies:0` 与那条 reason 全扔掉，只留一个两义词条。这条对照复现了立案时记录的那次
`13:37:48.260Z` fail 的**形态**（`.quay/gate-events.jsonl` 里 `payload.reason` 只有那一个 CAUSE）。

**head 假说的处置（诚实标注为「与证据一致」，不是「已证明」）**：`readCensus` 逐个读全部 145 个 tracked
`.sh`（其中 12 个是指向 `plugin/scripts/` 的符号链接），任一瞬时不可读 ⇒ `readFailures.length>0` ⇒
整体 notEvaluated。上面 4/60 的复现**用同一份代码在这条路径上取到了假红**，并证明改动把它清零；
但「生产上那 122 次全部出自这条路径」**未被直接观测到**（生产未捕获到 reason）。已排除的一条仍成立：
`git ls-files failed`（AC-309 同样调 `git ls-files`，只有 0.17%）。

### AC3 — 根因路径已修，且有同根对照

**对照一（检查器层，确定性）**：临时仓 `/tmp/ac310-ac3-bDOw`，两个 tracked `.sh`，把 `b.sh` 从**工作树**
摘掉（索引仍在——正是 git checkout 的中间态），同一条命令、同一个根：

```
BEFORE: node --experimental-strip-types <old checker> /tmp/ac310-ac3-bDOw --json
        exit=2  {"evaluated":false,"reason":"could not read 1 tracked *.sh: plugin/scripts/b.sh: ENOENT: no such file or directory, open '/tmp/ac310-ac3-bDOw/plugin/scripts/b.sh'","duplicateCopies":0}
AFTER:  node --experimental-strip-types <new checker> /tmp/ac310-ac3-bDOw --json
        exit=0  {"evaluated":true,"reason":null,"duplicateCopies":0,"scripts":2}
```

**对照二（判据层，同一个根、同一份状态）**：`/tmp/ac310-ac3crit-flLT`，只把 `plugin/scripts/sh-census-check.ts`
从旧版换成新版，其余同根同状态：

```
BEFORE: sh -c "$(cat <OLD criterion>)"   ⇒ exit=1  CAUSE=duplicate-copies-nonzero-or-not-evaluated — …
AFTER:  sh -c "$(cat <NEW criterion>)"   ⇒ exit=0
```

**对照三（活的竞态，见 AC2）**：`OLD 4/60` → `NEW 0/60`，同一棵被并发改写的树。

**修的是什么**：读路改为 ①工作树读（语义不变，照旧跟随符号链接）→ ②瞬时错误（`ENOENT/EACCES/EPERM/EBUSY/EMFILE/ENFILE/ESTALE/EIO`）按 `[5,25,75,200]`ms 退避有界重试 → ③回退到**原子的**
git 索引/对象（索引与对象库是写临时文件后 rename，不会被抓到半成品；⛔ 120000 条目会先解析链接再取**目标**的 blob，否则会把「目标文件的 600 行」偷换成「字符串 `../../plugin/scripts/x.sh`」）。
`plugin/sh-census-exceptions.txt` 与 `plugin/sh-census-baseline.json` 也是 tracked 文件、也会被同一窗口改写，走同一条读路。
⛔ **不是「读不到就当 0」**：两处都读不到仍然 NOT-EVALUATED（见 AC4 的反向控制与新增的 `--selftest` 用例 ⑪）。

### AC4 — fail-closed 未被放松（且两例词条不同）

```
① 检查器缺失：CAUSE=checker-missing — plugin/scripts/sh-census-check.ts 不存在，本量无法读取（不是 0）   exit=1
② 例外表不可读：CAUSE=not-evaluated:exception list unreadable (/nonexistent/demo.txt): ENOENT: …        exit=1
```

两条词条不同 ⇒ 修复**提高**了可区分度而**没有**放松 fail-closed。反向控制（新增 selftest ⑪ / 新测试）：
工作树与索引**两处**都读不到时仍是 `evaluated:false` + `exit 2` + `could not read 1 tracked *.sh`。
`--selftest` 11 个注入用例全 PASS（旧 9 个 + 新增 ⑩「工作树摘掉仍取到真读数」与 ⑪「两处都读不到仍 NOT-EVALUATED」）。

### AC5 — 稳定性实测（取真值）

因为本分支尚未落地，主检出的 `plugin/scripts/sh-census-check.ts` 还是旧版，所以跑了**两条腿**，
两条腿的窗口重叠、都覆盖同一次 ff-merge：

| 腿 | 跑什么 | 次数 | exit 0 | 窗口（起 → 止） | 相邻采样最大间隔 |
|---|---|---|---|---|---|
| A（生产形态，控制） | 判据逐字，cwd=主检出（⇒ 主检出的检查器读主检出） | **349** | 349/349 | `2026-10-16T21:55:33+08:00` → `22:09:25+08:00` | 4.00 s |
| B（改动后，AC5 的读数） | 改后的判据逐字，cwd=worktree + `--root /data/home/yale/work/quay`（⇒ 新检查器读**主检出**这棵树） | **200** | 200/200 | `2026-10-16T22:02:18+08:00` → `22:09:23+08:00` | **3.00 s（≤3 s）** |

**窗口覆盖的 ff-merge**：`88d52151d34ecd9a43f5056ab33126351ecb95f6  HEAD@{2026-10-16 21:57:41 +0800}: merge develop: Fast-forward`
——落在两腿窗口内，且它改写的就是主检出这棵树（腿 A 的窗口内 HEAD 共移动 4 次，故窗口真的是「活动的树」）。
失败计数：**A=0，B=0**。

**⛔ 标注与限度（两条都要读）**：
1. 腿 B 比生产多了 `--root` 一个参数——生产传空 argv。加它是因为「改后的检查器」此刻只存在于本分支；
   被读的根（`/data/home/yale/work/quay`）、判据本体、失败面判据三者与生产一致。本条**不**声称「落地后跑过主检出的判据 200 次」；
   落地后的等价读数由 goal-driver 的常规 sweep 继续取（AC-310 是 long-term 判据）。
2. **这条 200 次读数单独不具备区分力**：腿 A（未修的一对）在同一个窗口里也是 0 失败——1.31% 的底噪本就依赖
   goal-driver 自己的并发行使窗口，而两条腿都是独跑。**具备区分力的是 AC2/AC3 的活竞态对照（4/60 → 0/60）与
   两个确定性对照**；本条取的是它要求的真值：改动后在覆盖真实 ff-merge 的窗口内 ≥200 次读数无一失败。

### AC6 — 不把副本改回去

```
$ git ls-files -s experiments/quay-perpetual-stream/scripts/ | awk '$1=="120000"' | wc -l
61
$ node --experimental-strip-types plugin/scripts/sh-census-check.ts --json | jq '.totals.duplicateCopies'
0
```

独立复算（不调检查器）：逐个 `[ -L ]` + `cmp` 枚举 ⇒ 非链接同字节对 = **0**，61 个镜像项全部 mode 120000。
注入 AC1(a) 的那次镜像替换已当场撤销，收尾净检出只有本任务自己的两个文件（`git diff --stat develop...HEAD` = `plugin/scripts/sh-census-check.ts` + `plugin/test/sh-census-check.mjs`）。

### 硬规则 5b —— 修一处 ≠ 只此一处（把命中数与前 3 条贴出来）

改 `CAUSE` 词表之后全 corpus 搜旧词条 `duplicate-copies-nonzero-or-not-evaluated`：**3 个文件命中**
（`goals/AC-310-*.md` 本身、本任务体里对缺陷的引用、`tasks/gap-arch-duplicate-copies-zero.md` 的历史 AC 文本），
**没有测试逐字钉住它**（3 处均是文档/历史记录）。

同一条纪律的**向前**读数（改动后再数一次，谓词 = `criterion` 文本里的机制，不是拼写）：

- **丢弃来源的机制**（`2>/dev/null` + `JSON.parse` ⇒ 检查器的 stderr 与 `evaluated` 的 `reason` 双双被扔掉）：**20 条** `goals/AC-*.md` 命中（前 3 条：AC-304、AC-305、AC-306）。
- 其中**同一个词条的写法**（失败面拼成 `X-or-not-evaluated`）：**6 条**（AC-307、AC-308、AC-312、AC-313、AC-314、AC-315）。
- 其余 14 条的 `CAUSE` 词表本来就是分开的（如 AC-305 的 `not-evaluated-on-real-tree`）⇒ **机制在、缺陷不在**，不作同类计数。

**本任务只修 AC-310 这一条**（实测不稳定度最高的那条：1.31% vs 兄弟 0.17–0.39%，且它是唯一逐读 145 个 `.sh` 的）。
另 6 条同形判据 + 14 条同机制判据**不在本任务 Touches 内**，作为后续候选记在此处，不假装已覆盖。

### 落地面

- `plugin/scripts/sh-census-check.ts` — 读路硬化（工作树 → 有界重试 → git 索引）、新增 selftest ⑩⑪。
- `plugin/test/sh-census-check.test.mjs` — 同一对两向控制（工作树摘掉仍取到真读数 / 两处都读不到仍 NOT-EVALUATED）。
- `goals/AC-310-…md` — 判据本体（`goal_write`，两个根都写；`expect` 未改，它原本的三句仍然为真）。
- 未改：`duplicateCopies` 的读数本身、棘轮基线、例外清单、任何 experiments 镜像项。

---
id: gap-ac310-criterion-conflates-not-evaluated-with-copies-nonzero
title: AC-310 判据把「检查器未评估」与「副本非零」压进同一个 CAUSE：实测 evaluated:false 且
  duplicateCopies:0 时仍报「仍有非符号链接的字节相同副本」，长期判据因此以 1.60% 假红（GOAL-025 兄弟判据
  0.17–0.39%）
status: todo
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

- [ ] AC1 — **两态可分（负控制两方向，词表必须不同）**：(a) 人为造出一对**真的**字节相同非链接副本 ⇒ 判据 stderr 的 `CAUSE` 命中 duplicate 专用词条且**不含** not-evaluated 词条；(b) 制造真·未评估（`--exceptions` 指向不存在路径）⇒ `CAUSE` 命中 not-evaluated 专用词条并**逐字携带检查器自报的 reason**，且不含 duplicate 词条。两例均附命令行 + 实际 stderr 全文。
- [ ] AC2 — **实际 reason 已给出**：写出该 notEvaluated 的**实际 reason 字符串**及其来源（生产窗口捕获 / 注入复现，须标明是哪一个），并附**那一次的完整 JSON**（`evaluated` / `reason` / `totals.duplicateCopies` 三键同现）。
- [ ] AC3 — **根因路径已修且有对照**：给出同一条命令、同一个根上「改动前 `evaluated:false`、改动后 `evaluated:true && duplicateCopies===0`」的前后对照全文。
- [ ] AC4 — **fail-closed 未被放松**：检查器缺失、例外表不可读两例各自仍 `exit 1`，且 `CAUSE` 携带**各自不同**的 reason 词条。
- [ ] AC5 — **稳定性实测（取真值，不是断言）**：在主检出上连续 ≥200 次跑判据（间隔 ≤3s），**全部 exit 0**；给出这 200 次的起止时刻、失败计数 `0`，且窗口**至少覆盖一次** ff-merge 或 fan-in（附其 reflog 行 / 时间戳）。
- [ ] AC6 — **不把副本改回去**：实测 `duplicateCopies===0`，且 61 个镜像项仍**全部**为 mode 120000 符号链接（`git ls-files -s experiments/quay-perpetual-stream/scripts/ | awk '$1=="120000"' | wc -l` = 61），非链接同字节对 = 0。

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

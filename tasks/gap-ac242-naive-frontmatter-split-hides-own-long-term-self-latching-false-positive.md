---
id: gap-ac242-naive-frontmatter-split-hides-own-long-term-self-latching-false-positive
title: AC-242 判据用朴素三横线切分取 frontmatter，看不见自己的 long-term ⇒ 自报为冻结、且红了不会自愈
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Finding

**AC-242 的判据用朴素三横线切分取 frontmatter，看不见自己的 `long-term` 声明，于是把自己列为「冻结的 achieved 却失败」——一旦它因任何原因红过一次，就永久红下去。**

机理（逐字）：AC-242 的判据里 `for line in s.split("---",2)[1].splitlines()` 在**字段值内部**的三横线处截断。AC-242 自身的字段顺序是 `id, title, status, kind, goal, criterion, expect, origin, activatedAt, statusLog, long-term, fidelity` —— **`long-term` 排在 `criterion` 之后**，而 criterion 正文含三横线 ⇒ 切分只拿到 631 字符（真实 frontmatter 3250 字符），可见键只有 `id/title/status/kind/goal/criterion`。

于是它的豁免集 `longterm` 系统性缺项。而 `status`/`goal` 恰好排在 `criterion` 之前、读得到 ⇒ 误判方向是**假阳性**（把已声明常设的 AC 报成冻结）。

**自锁**：AC-242 红 ⇒ 它自己的台账尾事件变 `fail` ⇒ 它看不见自己的 `long-term` ⇒ 把自己算进「achieved ∧ 尾事件 fail ∧ 不在豁免集」⇒ 继续红。⛔ 这条不会自愈。

## Evidence（立案时读数，2026-09-12）

- 标了 `long-term: true` 的 AC 共 **17** 条；AC-242 的朴素切分**看得见 14 条**，**看不见 3 条**：`AC-214`、`AC-242`、`AC-244`（正是判据正文含三横线的那几条）。
- AC-242 当前实跑 `exit 1`，输出 `frozen achieved-but-failing, no mechanism re-runs them: AC-147,AC-149,AC-172,AC-228,AC-242` —— 前 4 条是真问题（另有任务承接），末一条 `AC-242` 是本缺陷造成的假阳性。
- **自锁对照**：把那 4 条真问题的尾事件模拟为 `pass` 后重跑同一逻辑，仍报 `['AC-242']` ⇒ 即便真问题全修好，它也不会自己恢复。
- 同一写法的分布（5b 扫兄弟实例）：`goals/AC-*.md` 里用朴素切分的**只有 AC-242 一条**；`AC-214`、`AC-244`、`AC-246` 已是**行首锚定**写法 ⇒ 修法有同仓先例可抄，⛔ 不必新造解析器。

## Disposition —— 立案依据已过期：**该缺陷的对象已被 `4caeb454e` 消除**

立案后的实测推翻了这个前提的一半，先记在这里，⛔ 不要让下面的勾选把它读成「本条把解析器改好了」：

- 该缺陷已被 **`4caeb454e`**（`gap-achieved-ac-rot-invisible-when-ledger-tail-is-stale-pass`，**2026-09-12T01:51:44Z**）在构造上消除——它把 AC-242 的判据正文**整体换成** `node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts check --stale-pass`，**零 frontmatter 解析**。
- 而本任务立案于 **2026-09-12T01:55:34Z**（`53804ef81`，随后 `00c2c0cdf` 机械晋 ready）——**晚于修复落地约 4 分钟**。⇒ 立案依据是过期读数；本条是一个 stale duplicate，由 `4caeb454e` 在构造上取代（那一条的任务体 `:110` 自己也这么写，并建议 manager 裁定）。
- 5b 扫兄弟实例：`grep -rn 'split("---"' goals/*.md` = **0 命中** ⇒ 该写法在判据里已无第二处实例。

⇒ 因此本条**不改任何解析器**（AC3 的「⛔ 不新造第四种解析器」照守，AC3 的**条件**已由 `4caeb454e` 的整段移除满足——比「改行首锚定」更强）。本条**实际落地的是**：把该**类**钉住——给 goal 记录唯一的解析器 `frontmatter-store-base.parseFrontmatter`（行首锚定 + 真 YAML）补一条**边界回归测试**（`packages/quay/test/goal-store.test.mjs`）。`goals/AC-242-*.md` **未改动**（无需改动）。

## Readings（本次逐条实测，命令 + 原始输出）

**R1 — 改后生产活载体读数（活判据实跑，⛔ 非 fixture）**
```
$ node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts check --stale-pass
{ "frozenScope": 78, "evaluated": true, "failing": [], "staleUnverified": [], "notEvaluated": [],
  "verifiedFresh": [ ...78 条... ], "neverGated": [],
  "rotation": { "sweptEver": 78, "lastSweepAt": "2026-09-12T02:30:15.767Z", ... } }
EXIT=0     ;  grep -c '"AC-242"' = 0   ⇒ AC-242 不在任何一个桶里
```

**R2 — AC1（改前读数，可取假）**：取 `4caeb454e^` 的 `goals/` 快照 + 从改前判据**逐字提取**的解析器（不含任何改写；提取边界 = `last={}` 之前，含 `fm()` 与 `longterm` 累加循环）：
```
PRE-FIX parse (naive split) longterm n=13: AC-161,AC-188,AC-189,AC-190,AC-202,AC-204,AC-206,AC-233,AC-235,AC-236,AC-237,AC-241,AC-243
ACTUAL  (line-anchored)  longterm n=16: AC-161,...,AC-214,AC-233,...,AC-242,...,AC-244
INVISIBLE to the pre-fix parse: AC-214,AC-242,AC-244
```
⇒ 两个集合**不相等**，差集逐条列出，与 Finding 点名的三条**逐字相同**。（绝对数 13/16 vs 立案时 14/17——期间又落了一条常设 AC；**差集不变**，故机理与方向被复现。）

**R3 — AC2（自锁复现）**：改前判据**逐字**跑一份台账，其中 `AC-147/AC-149/AC-172/AC-228` 的尾事件被模拟为 `pass`、只留 `AC-242` 为 `fail`：
```
frozen achieved-but-failing, no mechanism re-runs them: AC-242
EXIT=1
```
⇒ 真问题全修好后它**仍然红** ⇒ 不自愈，自锁成立。

**R4 — AC4（改后读数，与 R3 同一份台账）**：把同一份台账喂给**改后**判据：
```
{"frozenScope":78,"evaluated":true,"failing":[],"staleUnverified":[],"notEvaluated":[]}  EXIT=0
grep -c '"AC-242"' = 0
```
⇒ 改前 `['AC-242']` / 改后**不含** ⇒ 同输入两次结果不同。并（结构性半边）：
```
$ ... goal-store.ts check --reverify-scope
scopeSize: 17  evaluated: True
AC-242 in inScope: [{"id":"AC-242","goal":"GOAL-009","goalStatus":"achieved","longTerm":true}]
long-term ACs in inScope: 17
```
⇒ AC-242 因 `long-term: true` 落在 `inAchievedReverifyScope` 内 ⇒ `frozenAchievedAcs` **恒不含**它 ⇒ 自锁在构造上不可能。

**R5 — 解析器边界的直接读数**：同一朴素解析器跑**改后**树 = 15/17，看不见 `AC-214`、`AC-244`（其判据正文仍含 `---`）；AC-242 因判据正文不再含 `---` 而顺带可见。这条边界**已由解析器写法关闭**：`AC-244` 自己的行首锚定 `frontmatter()` 读自己文件 ⇒ `AC-244 sees its own long-term: True`。

**R6 — AC5（双向控制，⛔ 防止把检测能力一起改没）**：独立夹具（goal 非 active ∧ AC achieved ∧ criterion 非空 ∧ 尾事件 fail），同一判据跑两次：
```
未标 long-term: {"frozenScope":1,"evaluated":true,"failing":["AC-900"]}   EXIT=1
标上 long-term: {"frozenScope":0,"evaluated":false,"failing":[]}          EXIT=0
```
⇒ 两次结果**不同**。同形双向控制也进了回归测试（`goal-store.test.mjs` 新增用例的 (c)/(d) 两段）。
**红控制（已跑，随后还原，`git diff` 为空）**：把 `parseFrontmatter` 临时换回**改前的朴素解析** ⇒ 该测试在
`AssertionError: long-term 声明在含 \`---\` 的 criterion 之后仍被读到` 上**红** ⇒ 它是测量，⛔ 不是恒真。
该测试第 (a) 段是**夹具的牙齿**：断言朴素切分**确实**在这条记录上丢 `long-term`，若夹具不再触发该边界则红。

**R7 — AC6（真问题不被掩盖）**：改后判据今天 `failing` 为空；`AC-147`/`AC-149` = `superseded`（已独立处置），`AC-172`/`AC-228` = `achieved` 且判据已收敛/钉根、实跑为真（在 `verifiedFresh` 内）⇒ 属「**已被独立处置**」那一支，⛔ 未被顺手去掉。检测能力未减由 R6 的双向控制单独证明。

**R8 — AC3（修法）**：见 Disposition——AC-242 的判据侧解析已由 `4caeb454e` 整段移除；`goals/*.md` 里 `split("---"` 命中 **0**；本条**没有新造解析器**。

## AC

- [x] AC1（改前读数，可取假）：解析出的 `longterm` 集合与实际声明集**不相等**，差集逐条列出 ⇒ **R2**（13 vs 16，差集 = `AC-214`/`AC-242`/`AC-244`，与 Finding 逐字相同）。
- [x] AC2（自锁复现）：4 条真问题尾事件模拟为 `pass` 后仍报含 `AC-242` ⇒ 自锁成立 ⇒ **R3**。
- [x] AC3（修法）：AC-242 的判据侧解析已**整段移除**（`4caeb454e`，比「改行首锚定」更强的同一方向），`goals/*.md` 朴素切分命中 **0**，⛔ **未新造解析器** ⇒ **R8 / Disposition**；本条把既有唯一解析器的边界钉进回归测试。
- [x] AC4（改后读数）：与 R3 同一份台账喂改后判据 ⇒ **不再含** `AC-242`，`failing` 为空、EXIT=0；且 `check --reverify-scope` 显示 AC-242 在复验域内（`longTerm: true`）⇒ 自锁构造上不可能 ⇒ **R4**。
- [x] AC5（双向控制）：同一夹具「未标 `long-term` ⇒ 报出 / 标上 ⇒ 不再报出」，两次 `failing` 不同（`["AC-900"]` vs `[]`）⇒ **R6**（含把解析器换回改前写法的红控制）。
- [x] AC6（真问题不被掩盖）：`AC-147`/`AC-149` = `superseded`，`AC-172`/`AC-228` = 已收敛且实跑为真（`verifiedFresh`）⇒ 属「已被独立处置」支；检测能力未减由 R6 双向控制证明 ⇒ **R7**。
- [ ] AC7（全量绿）：`scripts/test.sh` 全量绿（由 driver 机械 fan-in 的 suite 步执行 —— 外层全量验证）。

## DoD

生产读数可验证：AC-242 在真实仓库上实跑，其输出不再含自身；且它对真正冻结的 AC 仍能报出（AC5/AC6 的双向控制在生产数据上各给一条读数）。⛔ 「解析器改好了」不算——判定输出必须在真实 goal 记录上取到两种值。fixture 与单测是必要不充分条件（DIR-026 Reading A）。

## Touches

- goals/AC-242-台账不得留下-已离开复验域却尾事件为-fail-的-ac-否则下游判据-ac-241-结构上永不通过-被误读成-还有真缺.md
- packages/quay/test/goal-store.test.mjs
- tasks/gap-ac242-naive-frontmatter-split-hides-own-long-term-self-latching-false-positive.md

---
id: gap-prose-prereq-exemption-paragraph-scoped-not-sentence
title: "反向依赖 + 散文引用 = 永久互堵——prose-prereq 豁免是段落作用域，够不着落在 ## AC 块内的单句"
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

**机制**：`plugin/scripts/ready-pool-check.ts:3075` 把 `prosePrereqGap` 非空的 ready 任务排除出池
（理由串 `prose-prereq-no-edge`）。判定链：`prosePrereqRefs`（`ready-pool-check.ts:1443`）按
`/\r?\n\s*\r?\n/` 切**段落**；一个段落只有**开头**是 `<!-- dedup-ref -->`（`isDedupExemptParagraph`，
标记常量 `DEDUP_REF_MARKER` 在 `:1384`）才被**整段**豁免；否则在段落内**逐句**判 `declaresPrereq`（前置关键词 + 极性），同句的反引号 id 被算成一条前置声明。

**生产实例（立案直接量，2026-09-24 实测，生产 root `/data/home/yale/work/quay`）**：
`gap-superseded-dependency-blocks-dispatch-forever`（status=ready，实现已完成、worktree 保留、delta 与
其声明 Touches 逐条一致）被**永久排除**出可派池，`ready-pool-check.ts --json` 的 excluded 原文：

    { "id": "gap-superseded-dependency-blocks-dispatch-forever",
      "reasons": ["prose-prereq-no-edge (前置无边: gap-ac194-production-criterion-owner)"] }

触发点经探针**逐段、逐句**定位（调用真判定函数 `prosePrereqGap(body, frontmatterRaw, tasksDir)`，
⛔ 非目测）：**`## AC` 整块构成一个段落**，其中 AC3 的 ⛔ 说明句逐字为

<!-- dedup-ref -->
    且 `gap-ac194-production-criterion-owner` 的生产 `depends_on` 里现在还有**第二条活边**

`depends_on` 命中前置关键词，同句的反引号 id 遂被算成前置声明。而该句的语义是**描述对方任务的依赖边**
（traceability），⛔ 不是声明自己的前置。作者**已经**在该任务的 Proposal 段与 DoD 段两处加了
`<!-- dedup-ref -->`，仍不足以让它回到可派池。

<!-- dedup-ref -->
**后果（互堵，双向往返）**：被引用的 `gap-ac194-production-criterion-owner` 的 `depends_on` **包含引用方
自己**（commit `e40c77779`，2026-09-24T02:42:20Z 加）⇒ 引用方派不出去 ∧ 被引用方 `depsReady=false` ⇒
双方永久停摆。生产读数：`.quay/worker-round.jsonl` round 48 @ `2026-09-24T03:57:31.948Z` 逐字为
`{"action":"stop","in_flight":0,"pool":0,"stop_reason":"pool-empty (no dispatchable candidate in the ready pool)"}`，
且同一读数连续 40+ 轮不变（round 43→48 全部同形）。

**为什么现有豁免手段够不着（这是本条要修的那条臂）**：`dedup-ref` 只能**整段**豁免，而触发句落在
`## AC` 那一整块里 —— 给整段加标记会把 AC 列表**一并**豁免，等于让 AC 里真正的前置声明也失去判定
（AC 恰恰是最常写前置的地方）。⇒ **单句豁免在 `## AC` 这种位置上不可达**，而它又是引用最密集的位置。

**与既有条目的分工（⛔ 不是重复立案）**：`gap-prose-prereq-negation-blind-and-paragraph-scoped` 修的是
**作用域（段落→句子）**与**极性（否定不算声明）**两条轴。本条是它修完后**新暴露**的形态：
作用域收到了句子，但**豁免手段（段落级）没有跟着收到句子级** —— 于是"一句引用落在 AC 列表里"这个
最常见的位置**恰好**落在豁免的盲区。⇒ 判定精度提高了一半，豁免能力没跟上，两半不对称。

**修法方向（⛔ 不是给这一条任务改字了事）**：豁免要能作用于**单句 / 单条**（例如同句内联标记、
或让 `## AC` / `## Evidence` 这类**引用密集但非前置声明**的区块有独立的判定档位），同时：
- ⛔ **不得放宽真前置声明** —— AC 里逐字写着"依赖 `gap-x` 未 done 前不落地"的句子必须仍 fail-closed；
- ⛔ **不得与"合格"同形**（硬规则 3b）—— "被单独豁免的引用句"与"无前置"两种情形必须**取值可区分**，
  不得都退化成空集（否则"未评估"与"查过且合格"再次不可分）。

## AC

- [x] AC1（现状固化·生产载体）在生产 root 贴出三处原文：①`ready-pool-check.ts --json` 中
      `gap-superseded-dependency-blocks-dispatch-forever` 的 excluded 条目（含 `prose-prereq-no-edge` 字面）；
      ②`.quay/worker-round.jsonl` 最近 2 轮的 `stop_reason: pool-empty` 原文；③探针定位到的触发句原文
      （`## AC` 块内、AC3 的 ⛔ 说明句），并注明该段落内**其余**句子均不触发（证明定位到了唯一那条）
      —— 见 ## Evidence E1
- [x] AC2（归因 + 对照，硬规则④推论四）贴 `prosePrereqRefs` / `isDedupExemptParagraph` / 调用点 `:3075`
      三处原文，并给出**一条若该归因为假则读数会不同的对照**：把触发句临时改写成不含前置关键词的措辞后，
      同一生产 root、同一 ref 上该任务**重新进入 `ready` 数组**（唯一变量 = 那句话的措辞）—— 见 ## Evidence E2
- [x] AC3（修法落地·生产载体）修复后，该形态（引用句落在 `## AC` 块内 + 被引用方反向依赖引用方）
      在生产 root 上重新可派：`ready` 数组包含该 id，贴 `--json` 原文与时间戳 —— 见 ## Evidence E3
      ⚠️ **如实登记（⛔ 不是没做，也⛔ 不是放宽判据）**：本任务立案后约 4 小时，引用方（即上条那个 id）被
      driver **fan-in 翻 done**（commit `5f0efa024`，2026-09-24T04:11:15Z，落在本会话期间）⇒ `done` 任务
      结构上永不进 `ready`，故「该 id 出现在**活** `ready` 数组里」这一读数**已不可复现**。E3 取的是同一生产
      root、同一 ref（= AC1 立案读数所在 ref `7a850f64a`）、生产 `tasks/` 全量、**唯一变量 = 触发句是否带
      豁免标记**；其中 as-is 分支的 `reasons` 与 AC1 的活读数**逐字相同**（方法自证）。另附修复后**活** root 的读数。
- [x] AC4（负控制·真前置不得放宽）往 `## AC` 块内注入一条**真前置声明句**（形如"本任务依赖
      `gap-x` 未 done 前不落地"）⇒ `prosePrereqGap` 非空、该任务**仍被排除**（贴读数，⛔ 不得为绿而放宽）
      —— 见 ## Evidence E4。⚠️ 注意：裸 `依赖` 故意**不在** `PREREQ_KEYWORD_RE` 里（否则"无代码依赖"会误报），
      故 AC 里那个形如句**本身不构成声明**；E4 用的是同形但带真关键词（`依赖前序`）的句子。
- [x] AC5（可区分·硬规则 3b）"被单独豁免的引用句"与"该任务确无前置"两种情形的判定输出**取值可区分**
      （不是都输出 `[]`），贴两条并列读数 —— 见 ## Evidence E5
- [x] AC6（5b 姊妹实例）grep 同一原则的其它适用点（还有哪些"引用密集但非声明"的区块被整块判定、
      或还有哪些豁免手段是段落级而判定已收到句子级），贴命中数与前 3 条 —— 见 ## Evidence E6
      （含**本条实测的自咬**：E6 第一次落笔即被判 `parked`，见 E6-4）
- [x] AC7（本任务自身的门）`bash scripts/test.sh --for-task gap-prose-prereq-exemption-paragraph-scoped-not-sentence` 绿
      —— 见 ## Evidence E7

## DoD

真实落地：生产 root 上**已经出现过**的互堵形态不再出现（AC3 读数取真），且真前置声明仍 fail-closed
（AC4 读数取假）、豁免与无前置取值可区分（AC5 两条读数不同）。⛔ 只给这一条任务改字了事、
或把 `prosePrereqRefs` 整体放宽到"AC 块内引用一律不判"（等于让 AC 里的真前置也失效）、
或造一个只能被 fixture 满足的判据 ⇒ 均不算完成。

## Evidence

### E1 — AC1 现状固化（立案活读数，生产 root `/data/home/yale/work/quay`）

① `ready-pool-check.ts --json` 的 excluded 条目（本会话开工读数，与 round 60/61 同一时间窗）：

```
{ "id": "gap-superseded-dependency-blocks-dispatch-forever",
  "reasons": ["prose-prereq-no-edge (前置无边: gap-ac194-production-criterion-owner)"] }
```

② `.quay/worker-round.jsonl` 最近 2 轮 `stop_reason` 原文（round 60 / 61）：

```
{"ts":"2026-09-24T04:08:22.421Z","round":60,"action":"stop","in_flight":0,"pool":0,"stop_reason":"pool-empty (no dispatchable candidate in the ready pool)"}
{"ts":"2026-09-24T04:09:28.273Z","round":61,"action":"stop","in_flight":0,"pool":0,"stop_reason":"pool-empty (no dispatchable candidate in the ready pool)"}
```

③ 探针逐段逐句定位（调用真判定函数 `prosePrereqGap`，⛔ 非目测）：`## AC` 整块 = **一个段落**，
其 **38** 条句子片段中**恰好 1 条**触发，其余 **37** 条 `declaresPrereq=false`（探针逐条打印）⇒ 定位到唯一那条：

```
      **此刻尚未落地**；且 `gap-ac194-production-criterion-owner` 的生产 `depends_on` 里现在还有**第二条活边**
```

### E2 — AC2 归因 + 对照

三处原文（`plugin/scripts/ready-pool-check.ts`，修后行号）。(a) 豁免只认**段落开头**（`:1389`）：

```
function isDedupExemptParagraph(para) {
  return para.trimStart().startsWith(DEDUP_REF_MARKER);
}
```

(b) 判定本体 —— 关键词→id 关联是**句子**级（`prosePrereqScan` 的句子循环，`:1553` 起）：

```
if (isDedupExemptParagraph(para)) continue;
if (!PREREQ_KEYWORD_RE.test(para)) continue;
for (const sent of splitSentences(inlinePara)) {
  if (!declaresPrereq(sent)) continue;
  ...
}
```

(c) 调用点（立案时 `:3075`，修后 `:3237` —— 行号下移是因为本条在它上方新增了 ~160 行）：

```
const proseGap = prosePrereqGap(t.body, t.frontmatterRaw, tasksDir);
if (proseGap.length > 0) reasons.push(`prose-prereq-no-edge (前置无边: ${proseGap.join(",")})`);
```

差异点名：(a) 的豁免作用域是**段落**，(b) 的判定作用域是**句子** —— 两半不对称，而
「一整块是一个段落、触发句只是其中一个句子」的 `## AC` 恰好落进这个盲区。

对照（若归因为假，则读数会不同；**唯一变量 = 那一句话的措辞**）：同一生产 root、同一 ref `7a850f64a`、
生产 `tasks/` 全量，把触发句里的 `depends_on` 换成不含关键词的 `依赖边清单`（时间戳 2026-09-24T04:24:37Z）：

```
as-is    ⇒ excluded: [{"id":"gap-superseded-dependency-blocks-dispatch-forever","reasons":["prose-prereq-no-edge (前置无边: gap-ac194-production-criterion-owner)"]}]
reworded ⇒ ready 含该 id，excluded: []
```

⇒ 归因成立：翻盘的唯一变化是那句话的措辞。

### E3 — AC3 修法落地（生产载体）

同一生产 root、同一 ref `7a850f64a`、生产 `tasks/` 全量，**唯一变量 = 触发句是否带豁免标记**
（时间戳 2026-09-24T04:24:37Z）：

```
annotated ⇒ ready 含该 id，excluded: []
```

修复后**活** root 的读数（同一份修复代码，时间戳 2026-09-24T04:24:59Z）：

```
ready    : ["gap-ac194-production-criterion-owner","gap-prose-prereq-exemption-paragraph-scoped-not-sentence"]
excluded : []
pool     : 2
```

⚠️ **该 id 在活 `ready` 数组里这一读数已不可复现**：它在本会话期间被 driver fan-in 翻 `done`
（commit `5f0efa024ecd62ac2c730184588adae84d0f29df`，`2026-09-24T12:11:15+08:00` = `04:11:15Z`），
而 `done` 任务结构上永不进 `ready`。上面两条读数是同一 root、同一 ref、同一生产 store 下该文件回到
**立案字节**的读法 —— 其中 as-is 分支与 AC1 的活读数（E1①）`reasons` 逐字相同，方法自证。

### E4 — AC4 负控制（真前置不得放宽）

Gate 级（`plugin/test/ready-pool-check-s19.test.mjs:401`，走池子自己的 `analyzeTasks`）：`## AC` 块内
**只**给引用句加标记 ⇒ `checks.prosePrereqGap == ["gap-real-y"]` ∧ `eligible == false`；把**真前置句**
也加标记才 `[]` ∧ `eligible == true` —— 两分支之间真前置句的措辞**逐字节相同**。

裸字节级（生产载体立案字节，唯一变量 = 注入的句子）：

```
AC4-a 立案 bytes，未改            ⇒ {"declared":["gap-ac194-production-criterion-owner"],"exempted":[],"gap":["gap-ac194-production-criterion-owner"]}
AC4-b 只给引用句加标记            ⇒ {"declared":[],"exempted":["gap-ac194-production-criterion-owner"],"gap":[]}
AC4-c 引用句加标记 + 注入真前置句 ⇒ {"declared":["gap-ac194-production-criterion-owner"],"exempted":["gap-ac194-production-criterion-owner"],"gap":["gap-ac194-production-criterion-owner"]}
```

⇒ AC4-c 的 `gap` 非空、该任务**仍被排除** ✓：标记只豁免它标注的那一句，⛔ 没有把真前置一起吞掉。

### E5 — AC5 可区分（硬规则 3b）

两条并列读数（生产字节 / 真实生产任务，时间戳同上）：

```
(i)  生产载体 + 引用句带标记 ⇒ {"evaluated":true,"declared":[],"exempted":["gap-ac194-production-criterion-owner"],"gap":[]}
(ii) 真实生产任务自身无散文前置 ⇒ {"evaluated":true,"declared":[],"exempted":[],"gap":[]}
```

⇒ 两者 `gap` 同为 `[]`（⇒ 只读 `gap` **不可分**），但 `exempted` 是**分开的一个取值** ⇒ 取值可区分 ✓
（硬规则 3b：豁免不是"没查"，也不是"查过且合格"）。配套单测 `plugin/test/ready-pool-check-s19.test.mjs:375` 逐字钉住。

### E6 — AC6 5b 姊妹实例（命中 3 处 + 1 次**活的自咬**）

同一原则的适用点 grep（豁免/判定的**作用域粗于**它所代表的标注）：

```
$ grep -rn --include=*.ts -E 'isParked|isDedupExemptParagraph|strategicTraceable' plugin/scripts/
plugin/scripts/ready-pool-check.ts:1118:  return PARKED_MARKER_RE.test(task.body);   ← 命中 1
plugin/scripts/ready-pool-check.ts:1389:function isDedupExemptParagraph(para) {      ← 命中 2（本条已修）
plugin/scripts/ready-pool-check.ts:1627:  return STRATEGIC_REF_RE.test(body);        ← 命中 3
```

前 3 条逐条：

1. `isParked`（`:1118`）—— `PARKED_MARKER_RE`（`:327`，正则逐字 `/\*\*PARKED\b/i`）**无行首锚**：与
   `SUPERSEDED_MARKER_RE` / `RETREATED_MARKER_RE` 那两条带 `^\s*(?:>\s*)?` 的不同，它扫的是**整篇 body**，
   故该加粗标记出现在**句子中间**（而非行首）时同样命中。**实测**：把该标记放在句子中间喂给
   `isParked` 仍返回 `true`；全量 `tasks/*.md` 命中 5 个文件，其中 **2** 个
   （`gap-addressedtasks-…` / `gap-priority-has-no-mechanism-reader`）**不带行首形式** ⇒ 作用域盈余 2/5。
2. `isDedupExemptParagraph`（`:1389`）—— 豁免段落级 vs 判定句子级；本条修的就是它，已补句子级
   `DEDUP_REF_INLINE_MARKER`。
3. `strategicTraceable`（`:1627`）—— `STRATEGIC_REF_RE.test(body)`，**整篇 body 任一命中**即判真，同一形状。

4. **（本条实测的自咬 —— 不是推演）** 本条自己的第一次 `task_write`（commit `f4c712a5b`）把那个加粗标记
   的**字面**写进了本节正文 ⇒ **本条任务当场被池子判 `parked` 并排除**，固定代码 + 活 root 的读数：

```
excluded: ["gap-prose-prereq-exemption-paragraph-scoped-not-sentence :: parked"]
```

   ⇒ 作用域盈余在**同一次会话内**造成了一次真实误判，且被误判的正是**记录该缺陷的这一条**。随后把字面
   改为转义写法（源串不再含连续的 `**`+标记名），读数恢复为 `ready`。这是 AC6 想要的最强证据形态：
   ⛔ 不是"grep 到一处可疑"，而是**该可疑处在生产上真的咬了一口，有 excluded 原文与时间戳**。

⛔ AC6 只要求 grep + 贴命中数与前 3 条，未要求修 1/3；本次不改 1/3（不在本任务 `## Touches` 内）。

### E7 — AC7 本任务自身的门

```
$ bash scripts/test.sh --for-task gap-prose-prereq-exemption-paragraph-scoped-not-sentence --allow-thin
⇒ EXIT=0（scoped 静态检查全绿 + ℹ tests 22 / pass 22 / fail 0）
```

新增测试：`plugin/test/ready-pool-check-s18.test.mjs`（`Plan 4 scope` `:209`、`Plan 4 splitter` `:261`、
`Plan 4 quoting` `:282`）、`plugin/test/ready-pool-check-s19.test.mjs`（`AC5` `:375`、`AC4` `:401`）。
worktree 改动面（`git diff --name-only develop`，⛔ 与 `## Touches` 一致）：

```
plugin/scripts/ready-pool-check.ts
plugin/test/ready-pool-check-s18.test.mjs
plugin/test/ready-pool-check-s19.test.mjs
```

（`## Touches` 的第 4 条 = 本任务体，由 `task_write` 落在 author 写面，不进 worktree delta。）
scoped-gate cache 已按契约写入（`--develop-sha 9a069f0ff…`，merge 时刻的 develop）。

## Touches

- plugin/scripts/ready-pool-check.ts
- plugin/test/ready-pool-check-s18.test.mjs
- plugin/test/ready-pool-check-s19.test.mjs
- tasks/gap-prose-prereq-exemption-paragraph-scoped-not-sentence.md
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

- [ ] AC1（现状固化·生产载体）在生产 root 贴出三处原文：①`ready-pool-check.ts --json` 中
      `gap-superseded-dependency-blocks-dispatch-forever` 的 excluded 条目（含 `prose-prereq-no-edge` 字面）；
      ②`.quay/worker-round.jsonl` 最近 2 轮的 `stop_reason: pool-empty` 原文；③探针定位到的触发句原文
      （`## AC` 块内、AC3 的 ⛔ 说明句），并注明该段落内**其余**句子均不触发（证明定位到了唯一那条）
- [ ] AC2（归因 + 对照，硬规则④推论四）贴 `prosePrereqRefs` / `isDedupExemptParagraph` / 调用点 `:3075`
      三处原文，并给出**一条若该归因为假则读数会不同的对照**：把触发句临时改写成不含前置关键词的措辞后，
      同一生产 root、同一 ref 上该任务**重新进入 `ready` 数组**（唯一变量 = 那句话的措辞）
- [ ] AC3（修法落地·生产载体）修复后，该形态（引用句落在 `## AC` 块内 + 被引用方反向依赖引用方）
      在生产 root 上重新可派：`ready` 数组包含该 id，贴 `--json` 原文与时间戳
- [ ] AC4（负控制·真前置不得放宽）往 `## AC` 块内注入一条**真前置声明句**（形如"本任务依赖
      `gap-x` 未 done 前不落地"）⇒ `prosePrereqGap` 非空、该任务**仍被排除**（贴读数，⛔ 不得为绿而放宽）
- [ ] AC5（可区分·硬规则 3b）"被单独豁免的引用句"与"该任务确无前置"两种情形的判定输出**取值可区分**
      （不是都输出 `[]`），贴两条并列读数
- [ ] AC6（5b 姊妹实例）grep 同一原则的其它适用点（还有哪些"引用密集但非声明"的区块被整块判定、
      或还有哪些豁免手段是段落级而判定已收到句子级），贴命中数与前 3 条
- [ ] AC7（本任务自身的门）`bash scripts/test.sh --for-task gap-prose-prereq-exemption-paragraph-scoped-not-sentence` 绿

## DoD

真实落地：生产 root 上**已经出现过**的互堵形态不再出现（AC3 读数取真），且真前置声明仍 fail-closed
（AC4 读数取假）、豁免与无前置取值可区分（AC5 两条读数不同）。⛔ 只给这一条任务改字了事、
或把 `prosePrereqRefs` 整体放宽到"AC 块内引用一律不判"（等于让 AC 里的真前置也失效）、
或造一个只能被 fixture 满足的判据 ⇒ 均不算完成。

## Touches

- plugin/scripts/ready-pool-check.ts
- plugin/test/ready-pool-check-s18.test.mjs
- plugin/test/ready-pool-check-s19.test.mjs
- tasks/gap-prose-prereq-exemption-paragraph-scoped-not-sentence.md
---
id: gap-prose-prereq-negation-window-is-before-keyword-only-and-sibling-markers-are-chinese-only
title: 'prosePrereqGap 否定词窗口只往关键词前找、sibling 标记词表纯中文——英文"Depends_on: none
  (...related-but-not-duplicate of `gap-x`...)"两处盲区叠加误判为真前置'
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Finding

`plugin/scripts/ready-pool-check.ts` 的散文前置依赖检测器（`prosePrereqGap()` → `prosePrereqRefs()` → `declaresPrereq()`）有两个独立的盲区，都用真实函数调用验证过（不是理论推断），且两者共同造成了一次真实的生产误判：

**盲区①：否定词窗口只往关键词前面找，检测不到关键词后面的否定**。`isNegatedPrereqKeyword()`（约 :1257）的 `NEGATION_MARKER_RE` 只检查关键词出现位置**之前** ≤16 字符内有没有否定标记（如"⛔ 不另立 depends_on 边"这种"否定词在前"的写法）。但英文里"Depends_on: none"这种否定词（"none"）出现在关键词**后面**的写法，结构上永远检测不到——`Depends_on` 本身就命中 `PREREQ_KEYWORD_RE`，而它前面往往是句首（没有字符可供否定词窗口匹配），于是被判成"声明了前置依赖"。

**盲区②：`SIBLING_MENTION_RE`（约 :1201）的标记词表是纯中文**（`同族于|已另立|另立|此外|参见|类似|参照|产物|实证对象|架构性任务|遗漏的调用点|遗漏调用点`），没有任何英文对应词。一句英文的"related-but-not-duplicate of `gap-x`"在语义上和"同族于 `gap-x`"完全等价（都是"提及但不是前置依赖"的溯源性引用），但因为词表是中文专属，这句英文完全逃过 sibling-mention 过滤，被当成真前置依赖。

**真实复现（生产事故，2026-09-15）**：任务 `gap-driver-restart-unreliable-legacy-to-anchor-migration` 的正文里有这句（逐字）：
```
Depends_on: none (independent finding; related-but-not-duplicate of `gap-driver-status-misreports-anchor-hosted-kind-as-down`, filed moments earlier this same session — that one is a read-side status-reporting defect, this one is a write-side restart-execution-reliability defect; do not merge the two).
```
直接调用 `declaresPrereq()` 对这句返回 `true`，`prosePrereqGap()` 对整篇正文返回 `['gap-driver-status-misreports-anchor-hosted-kind-as-down']`（该被指认的任务其实早已 `done`，且这句话本意就是"这不是前置依赖"）。`promotion-driver` 因此连续多轮（round 378-382+，日志 `.quay/promotion-round.jsonl`）拒绝把该任务从 `todo` 晋升到 `ready`，理由 `"prosePrereqGap=[gap-driver-status-misreports-anchor-hosted-kind-as-down]"`——一条已经全部四件套齐全、`task_check` 本身判 `ok:true` 的任务，被这条散文误判卡死。

<!-- dedup-ref -->
**与已有任务的关系（已查重确认不是同一条）**：`gap-prose-prereq-negation-blind-and-paragraph-scoped`（status: done）修的是"关键词在前、否定词也在前但隔太远/跨段落"的形状（该任务自己的 Plan 1/Plan 2 分别是"句子级作用域"和"否定词在关键词前 16 字符内"）——**本任务是它的镜像盲区（否定词在关键词后）+ 一个完全独立的轴（sibling 标记词表是中文专属）**，不是重复，是同一根因下两个此前没被覆盖的方向。另查 `gap-prose-prereq-detector-blind-to-repo-own-conventions`（done）修的是关键词表缺"阻塞"+ 只认 wikilink 不认反引号，与本任务机制不同（那条是漏检扩面，本任务是误报收窄），也非重复。

**已有的官方豁免机制（不是本任务要解决的问题，只是记录旁路存在）**：同文件的 `DEDUP_REF_MARKER = "<!-- dedup-ref -->"` 段落级豁免可以手工绕开这个具体误判（本会话已经用它临时解决了上面那条任务），但这只是个案 workaround，不修检测器本身，任何其他英文撰写的、用类似措辞的任务体还会重蹈覆辙。

## Requested action

- `isNegatedPrereqKeyword()` 增加一个镜像检查：关键词出现位置**之后** ≤N 字符内（N 与现有前向窗口 `NEGATION_WINDOW=16` 同量级，或按语料实测调整）若出现否定标记（"none"、"not"、"no" 等，需做词边界，避免"nonetheless"这类误命中——参考现有 `(?<![A-Za-z0-9_-])(?:not|no)(?![A-Za-z0-9_-])` 的词边界写法），也判为否定。⛔ 不要求发生率数字才能立案（本条已有一次真实生产复现），但落地前应先按硬规则2的纪律核对语料中是否存在"关键词后紧跟一个真正的前置依赖内容"从而被误伤的反例（即成功案例的负控制）。
- `SIBLING_MENTION_RE` 补充英文对应词——具体词表应先 grep 现有任务语料里实际出现过的英文溯源短语（同族先例：现有中文词表本身就是"corpus-derived from the AC-207 body"，本条应同样先取证再定词表，不要凭空造词），候选起点包括但不限于 "related-but-not-duplicate of" / "not a duplicate of" / "unrelated to" / "see also" / "同 `sibling`" 等实际语料命中。
- 两处修法都必须保持现有的**位置判定纪律**（sentence-scoped、per-occurrence polarity），不得退化回段落级或全文级判定。

## Acceptance Criteria

### 落地说明（供验收者定位证据）

- 实现提交：`cc8627f73`（worktree `quay-worktrees/gap-prose-prereq-negation-window-is-before-keyword-only-and-sibling-markers-are-chinese-only`，分支 `task/<本 task id>`）。
- 改动两处，**都在 `plugin/scripts/ready-pool-check.ts` 内，且都保持 sentence-scoped + per-occurrence polarity**：
  - ① `NEGATION_MARKER_AFTER_RE = /^[\s:：=]*(?:none|nothing|not|no)(?![A-Za-z0-9_-])/`，`isNegatedPrereqKeyword()` 增加第二个参数 `keywordEnd` 并加一段镜像检查。关键词与否定标记之间只允许**字段分隔符** `[\s:：=]*`——这正是 `Depends_on: none` 命中而 `depends_on (not just via …)` 不命中的原因（`(` 不是分隔符）；分隔符类刻意收窄（`，`/`；`/`。` 不在其中），后置子句里的否定无法回溯解除本次出现。
  - ② `SIBLING_MENTION_EN_RE = /duplicate of|sibling of|counterpart|see also|unrelated to/i`，**词表取证自语料**（grep `tasks/*.md`），不是中文表的翻译；英文臂**只往前看**（非中文臂的 ±16）。
- 测试：`plugin/test/ready-pool-check.test.mjs` 新增 `AC3c`（镜像否定臂）与 `AC3d`（英文 sibling 臂）；该文件全量 **176 tests / 176 pass / 0 fail**。

- [x] AC1（能取假，双向对照）：给定本任务 Finding 里那句真实生产原文（"Depends_on: none (... related-but-not-duplicate of `gap-x` ...)"），修复前 `declaresPrereq()` 返回 `true`、修复后返回 `false`；同时给一条**真正**在关键词后写"否定词"但整体仍是真前置依赖的反例句子（若语料里找不到自然样本，构造一条并说明），确认它修复后仍正确判定为"声明了前置依赖"（不被误伤）。
      **实跑（对同一份谓词，把工作树文件换回 `HEAD` 版再换回修复版，两遍同一脚本）**：
      - 生产原句：修复前 `declaresPrereq()=true` → 修复后 `=false`（唯一翻转项）。
      - 7 条负控制**修复前后全部不变**（即未被误伤）：真实语料行 `tasks/gap-unified-frontmatter-parser.md:30` 的 `… lists depends_on (not just via extra escape hatch)`=true（语料里找到了自然样本，无需构造）；构造样本 `先完成 \`gap-x\` not optional。`=true；后置子句否定 `先完成 \`gap-x\`；none of the other tasks matter。`=true（不跨子句）；词边界 `depends on \`gap-x\` nonetheless we proceed.`=true、`阻塞 not-yet-landed 的 \`gap-x\`。`=true、`阻塞 note 里的 \`gap-x\`。`=true；惯用语 `不得不先完成 \`gap-x\``=true；`do not dispatch until \`gap-x\` lands`=true（英文关键词自带的 `not` 不被镜像臂误读）。
      已固化为测试 `AC3c`。

- [x] AC2（能取假，双向对照）：给定一条英文 sibling 短语的真实或语料代表性样本，修复前该 id 被判为 prereq（出现在 `prosePrereqGap` 结果里），修复后被正确过滤（不出现）；同时保留至少一条中文 sibling 标记的既有测试断言其行为不变（回归）。
      **实跑（ref 级，句子形如 `阻塞 \`gap-real-prereq\`；<marker> \`gap-sib-en\`。`，`；` 不分句 ⇒ 同一句带**非否定**关键词，过滤器是唯一能滤掉 sibling 的因素）**：6 个英文标记**逐条可证伪**——`related-but-not-duplicate of` / `not a duplicate of` / `sibling of` / `counterpart` / `see also` / `unrelated to` 修复前均为 `["gap-real-prereq","gap-sib-en"]`，修复后均为 `["gap-real-prereq"]`（恰好滤掉它引出的那个 id、保留真前置）。
      取假半边：去掉标记后同形句仍回收两个 id（`["gap-real-prereq","gap-sib-en"]`），证明夹具非空转。
      **交叉绑定安全**：`阻塞 \`gap-real-prereq\`；unrelated to \`gap-sib-en\`, then 阻塞 \`gap-cross-binds-next\`。` ⇒ `["gap-real-prereq","gap-cross-binds-next"]`——某 id 之后的标记**不会**滤掉另一个 id（这正是英文臂取"只往前看"而非 ±16 的原因：对称窗口会在此处产生假阴性）。
      **中文回归**：`同族于 \`gap-sib-en\`，阻塞 \`gap-real-prereq\`。` ⇒ `["gap-real-prereq"]`（具体可判别值，非 `x===x` 的同义反复）；且既有测试 `同族于 / 参见`、`sibling / heritage` 断言全绿（见 176/176）。
      已固化为测试 `AC3d`。

- [x] AC3（生产验证）：修复落地后，直接对 `tasks/gap-driver-restart-unreliable-legacy-to-anchor-migration.md`（若届时该文件仍带着本会话加的 `<!-- dedup-ref -->` workaround，去掉该 marker 后）重跑 `prosePrereqGap()`，确认检测器**独立于那个 marker**也能正确判定为空——即修复的是检测器本身，不是依赖那次手工 workaround。
      **实跑**：该文件确实仍带着 marker（`tasks/…-anchor-migration.md:47`），故取全量 `tasks/` 的一份副本、用 `sed '/^<!-- dedup-ref -->$/d'` 去掉该行（复核 `grep -c dedup-ref` = 0），再对**同一份副本**分别用修复前/修复后代码跑：
      - 修复前：`prosePrereqRefs = ["gap-driver-status-misreports-anchor-hosted-kind-as-down"]`，`prosePrereqGap` 同，`promotion-blocking? YES`——**精确复现了事故**（round 378-382+ 的拒绝理由）。
      - 修复后：`prosePrereqRefs = []`，`prosePrereqGap = []`，`promotion-blocking? NO (promotes)`。
      同时打印被指认方状态 `status = done`，佐证原判据指认的"前置"早已完成、本句本意就是"不是前置依赖"。
      ⛔ **未改动 `tasks/gap-driver-restart-unreliable-legacy-to-anchor-migration.md` 本身**：该文件不在本任务 `## Touches` 内，改它属越界。本 AC 的原文要求的也正是"去掉 marker 后重跑"，而非删除该文件里的 marker。marker 保留是无害的（它只是让该段被豁免）；本 AC 证明的是**检测器自身已修好**，不再依赖它。

- [x] AC4：全量语料回归——对当前 `tasks/*.md` 全量跑一次改动前后的 `prosePrereqGap` 结果对拍，逐条列出发生变化的任务 id（同族先例：`gap-prose-prereq-negation-blind-and-paragraph-scoped` 落地时贴过"105 refs across 82 tasks"这类全量对拍数字），确认变化都是"移除误报"方向、没有新增假阳性/假阴性。
      **实跑，两个语料，同一脚本、同一份 `parseTask` 读法（= 生产调用点 `ready-pool-check.ts` 的读法）**：
      - **(a) 原样语料（2202 个 task）**：修复前 64 条非空、修复后 **64 条，逐条比较 changed = 0**。原因清楚且已核实：唯一带这个误判形状的那条任务正被 `<!-- dedup-ref -->` 豁免遮住（全仓共 **48** 个任务带该 marker）。
      - **(b) 剥掉全部 48 个 `dedup-ref` marker 的语料**（= 检测器凭自身本事的读数）：修复前 **70** 条非空 → 修复后 **69** 条；**changed = 1**，逐条列出就是：

        | 任务 id | 修复前 | 修复后 | 方向 |
        |---|---|---|---|
        | `gap-driver-restart-unreliable-legacy-to-anchor-migration` | `["gap-driver-status-misreports-anchor-hosted-kind-as-down"]` | `[]` | **整条误报移除**（removed 1, added 0） |

        `whole-entry REMOVED = 1`，`whole-entry ADDED = 0`，`shrunk = 0`，**新增 id = 0 ⇒ 严格收窄**，且这唯一一条被移除的 id 已单独核实为真误报（其指认对象 `status = done`，且原句完整语义是"这不是前置依赖"）⇒ 无假阳性、无假阴性。
      **正控制（防"检查恒不报变化"的空转，硬规则 3b/4）**：同一对拍脚本在"(b) 但只剥这一条任务的 marker"上**确实报出变化**（恰好检出这 1 条，65 → 64）；且脚本内置 canary 会打印 `declaresPrereq(生产原句)`，修复前打印 `true`、修复后打印 `false`，证明对拍加载的确实是修复版而非被静默替换的旧版。两个控制都通过，故 (a) 的"0 变化"是真读数而非哑检查。

## Definition of Done

代码落地 + AC1-AC4 全部满足并贴出实跑输出（不是转述）+ 该文件所属 scoped 静态门/测试绿 + `gap-driver-restart-unreliable-legacy-to-anchor-migration` 不再需要 `<!-- dedup-ref -->` workaround 也能正常晋升。

## Touches

- plugin/scripts/ready-pool-check.ts
- plugin/test/ready-pool-check.test.mjs
- tasks/gap-prose-prereq-negation-window-is-before-keyword-only-and-sibling-markers-are-chinese-only.md（自身）

origin: 2026-09-15，用户问"gap-driver-restart-unreliable-legacy-to-anchor-migration 为什么还在 todo"引发的会话内直接函数调用取证。
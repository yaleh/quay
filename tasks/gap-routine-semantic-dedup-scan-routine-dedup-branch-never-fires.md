---
id: gap-routine-semantic-dedup-scan-routine-dedup-branch-never-fires
title: "semantic-dedup-scan: The gate documents dedup 'by a stable finding key'
  (routine-file-gate.ts:5) but across 6 semantic-dedup-scan rounds 0 of 264
  rejections carry the 'dedup:' reas"
status: ready
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
The gate documents dedup 'by a stable finding key' (routine-file-gate.ts:5) but across 6 semantic-dedup-scan rounds 0 of 264 rejections carry the 'dedup:' reason (238=rate, 26=action) while the SAME clusters recur every round under a regenerated slug (manifest.ts: provider-manifest-clone/readmanifest-byte-identical/readmanifest-provider-twin/readmanifest-triplicated/readmanifest), so findingKey()'s normalized-finding-text key never matches across rounds and only the rate cap throttles.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790118332027` · ts `2026-09-22T23:05:32.027Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`findingKey`、`gateFinding`
- 涉及文件：
- `plugin/scripts/routine-file-gate.ts:45`
- `plugin/scripts/probe-routine.ts:365`
- `.quay/routine-findings.jsonl`
- kind：`other`
- verdict：`divergent-implementation`

## Requested action
stabilize the cross-round finding key so the dedup branch can fire

## Disposition（复核与处置）
**结论：修掉 —— 机制缺陷，⛔ 不是观测误报。** 修复落在 `plugin/scripts/routine-file-gate.ts` **一处**：
只换键的**来源**，三道闸的结构、以及 `probe-routine.ts` 的调用面一行未改（它的四个键位
`probe-routine.ts:363/364/370/376` 全部经由共享函数 ⇒ 单点修复即全链生效）。

### 复核：每一步都取了读数，⛔ 不靠「我认为是因为」
1. **现象**（复现本 finding 的描述）：`.quay/routine-findings.jsonl` 中 `semantic-dedup-scan` 的每一次
   filing-round，`dedup:` 拒绝数 = **0**（`rate:` 277、`action:` 36）。**同一载体、同一道闸**下
   `freshness-refresh` 有 2 条 `dedup:` 拒绝（2026-09-18）⇒ **不是闸坏了，是这条例程喂给它的键不稳**。
2. **根因读数**（实跑该例程 476 条 finding 记录）：按**机械主语**（symbols 集合）分组 ⇒ 86 个跨轮复现的主语；
   逐对比较两个轮次的候选文本 ⇒ **旧散文键 160/160 全不同；新主语键 160/160 全同**。
   旧键 = `## Finding` 正文前 200 字，而这段正文由 fresh-context LLM 每轮重新措辞 ⇒ 无跨轮持久性。
   旁证：23/23 已立案任务的 `## Finding` 正文都 >200 字 ⇒ 机械事实（files/symbols）**从未进入过键**。
3. **为什么键不是文件集**（同语料实测）：跨轮文件集只有 42/76 稳定（`walk` 集群 12 文件→6，交集为 0），
   且**纯文件集作键会把 121 个不同主语吞进 40 个键值** ⇒ 过度压制。

### 处置（可核的落点，⛔ 不以「已注意到」结案）
- **修复**：`findingKey` 改为**主语优先** —— 键 = `symbols:<排序去重小写>`（探针从清单机械抽取，跨轮稳定）；
  散文键降级为**无 symbols 时的回退**（`freshness-refresh` 的散文由主语 id 模板化、其 dedup 本就在工作，
  删掉回退会让那条轨道失去去重）。两来源带不同前缀（`symbols:` / `prose:`）⇒ 两种键形不共用输出（硬规则 3b）。
- **生产载体实跑**（`node --experimental-strip-types .quay/sds-dedup-key-verify.mjs <root>`，只读载体与板）：
  `readJsonLines` 集群在板上的任务（第 4 轮立案）现在把**另外三轮**的重新发现判为 dedup —— **6 条真实记录**，
  修复前 0 条；理由点名命中的键（`matched key: symbols:readjsonlines`）⇒ 压制可审计，过度压制不再与正确压制同形。
- **旧任务免迁移**：既有任务体里的 `- 观测符号：` 拼写被同一个解析器读取 —— 对上真实既有板任务
  `tasks/gap-routine-semantic-dedup-scan-readjsonlines-seven-defs-three-behaviors.md` 得 `symbols:readjsonlines`。
- **未修的边界（写明，不留给读者猜）**：键是**精确** symbols 集合 ⇒ 探针在更宽意义上的漂移
  （`readjsonlines` vs `readjsonlines,readjsonllines` 这类 346 对子集/超集）**不被去重**，仍由 rate 闸限流，
  即**退化为修复前行为，⛔ 不会更差**。没有引入子集匹配：那会把 360 个主语中的 **161 个**置于「被同族宽条目
  压制」（近半数）的位置 —— 静默过度压制是比漏判更坏的失效。
- **负对照**（可复跑）：把 `findingKey` 改回忽略主语，`plugin/test/routine-file-gate.test.mjs` **7 条中 6 条失败**
  （第 7 条是 quality 闸，本就不该受影响）⇒ 对照证明这些测试咬的是本条修复，不是别的东西。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `routine-dedup-branch-never-fires`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790118332027`）所描述的问题被复核并处置（见 §Disposition：机制缺陷已修；载体实测 dedup 命中 0 → 6 条真实记录）
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案（已修；未修边界已写明：键为精确 symbols 集合，漂移的超集仍走 rate 限流、退化为修复前行为）

## DoD
- [x] 上面的判据实跑通过（`plugin/test/routine-file-gate.test.mjs` 7 passed / 0 failed；负对照 6 failed；同一模块的旧位置测试 4 passed；既有消费方 meta-driver 131、probe-routine 22、external-dogfooding 17 全绿）
- [x] ⛔ 探针只立案不执行：本任务由例程经 `routine-file-gate.ts` 机械立案，修复由派发链（worker）在本任务自己的 worktree 内执行 —— 例程本身一行都没跑

## Touches
- `plugin/scripts/routine-file-gate.ts`
- `plugin/test/routine-file-gate.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-routine-dedup-branch-never-fires.md`
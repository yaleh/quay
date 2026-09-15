# 「谁先发现它」的分布：把 n=5 的定性观察扩成 1,669 例

**任务**：`tasks/gap-who-discovered-it-first-sample-is-only-five.md`
**读数日期**：2026-09-15
**语料**：`tasks/gap-*.md` 全量 **1,669** 条真实任务体 + 真实 git 立案历史（⛔ 无 fixture、无注入数据）
**develop tip**：`be12f1118bce458af07ef26d29a78419594b2380`
**机件**：`plugin/scripts/discovery-path-classify.ts`（分类器，`method` 恒为 `rule`）
**抽样种子**：`20260915`（第 4 节的人工复核样本）

---

## 0. 结论先说

**不支持。** `docs/references/维度边界与结晶——从熔融实现中发现原则.md` §2.1 ① 的
「**人是唯一的样本外探测器**」建立在 `FINDING-tool-crystallization-quantified-2026-08-09.md`
的 **n=5**（3 例首揭来自人的追问）之上，比例是 3/5 = **0.60**。扩大到 **1,669** 例后：

| 口径 | human 占比 |
|---|---|
| 判得出的部分里（n=1,346，`other` 不计入分母） | **0.203** |
| **上界**：把**全部** 323 条判不出的（`other`）都当成 human | **0.357** |
| 原结论 | 0.60 |

**上界 0.357 < 0.60 —— 这一条不依赖分类器的准确率。** 它的意思是：**即便我们错判了每一个
判不出的任务、把它们全部算成「人先发现的」，也够不到 3/5。** 要推翻它，需要证明
`other` 里至少有 0.60×1669 − 273 = **729 条**是人先发现的，而 323 条 `other` 全算上也只有
323 条——**差了 2.3 倍**。

**这个结论说的是什么、不是什么**（防止被过度解读）：

- 它**不是**「人没用」或「人不是 OOD 方向的来源」。§0 / §3 的两体结构（问题从实践涌现、
  **形变的意图由人供给**）**没有**被本次读数触及——本次量的只是**「谁先说出这个问题」**，
  不是「谁决定往哪个方向改」。§3.1 的出处调查（`*-driver` 替代 inner/outer、分支模型的
  **方案**逐字由人提出）与本节结论并不冲突：**发现与方案是两件事，本次量的只有发现。**
- 它**是**：在 `tasks/gap-*.md` 这个语料里，「自主循环对自身的盲区结构上不可见」这个推论
  所依赖的前提——**循环不会自己发现问题，只有人能从样本外指出它**——**没有数据支持**。
  超过一半（0.509）的任务体把首次揭发归给循环自己的一次读取/测量/巡检。

---

## 1. 为什么要先量分类器：一个标注准确率未知的分类器给出的占比，既不能推翻也不能支持原结论

任务体里**没有「发现路径」字段**（`docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md`
§7 第 6 条已把它列进「需要先补仪器」）。要从正文与立案上下文抽取，就必须**先量出抽取本身的
准确率**——否则 0.203 与 0.60 的比较只是两个都不可信的数的比较。本节给出分类口径（§2）
与**人工复核的真读数**（§4）。一致率 **0.833**，高于任务设定的 0.7 门槛，故 §0 的占比结论成立。

---

## 2. 分类口径（四类，互斥穷尽）

| 类 | 含义 |
|---|---|
| `human` | ① 人的追问 / 裁定 —— 人先说出这个问题 |
| `loop-patrol` | ② 自主循环的主动巡检 —— 管理者 / 外层 / 内层 / driver / meta-driver 先发现 |
| `suite-gate` | ③ 测试套件 / 闸门报红 —— 红先于任何人注意到 |
| `other` | ④ 其它 / **判不出** |

**`other` 是「没有证据可判」，不是「都不是」。** 它的 `evidenceSpan` 恒为空串，
**绝不静默并进任一实质类**（硬规则 3b/6）。这是本机件最重要的一条性质：把判不出的并进
`loop-patrol` 会把「未知」印成「循环发现了」，方向恰好偏向结论。

### 2.1 证据窗口 = 触发描述段，不是整篇（硬规则 2「按位置判定」）

窗口取 `## Finding` / `## Proposal` / `## Resolution` / `## Requested action` / `## Setup`
中**第一个出现**的段；无叙事段时才退回正文前 2,000 字符。

**为什么必须是窗口而不是整篇**：`## Acceptance Criteria` 与 `## Definition of Done` 里经常
**引用**被检验的那条结论本身（例如「人的追问是唯一…」）。扫全篇时，那些引用会把任务判成
`human` —— 这正是硬规则 2 说的「注释里提到不算命中」。测试文件里有这条的专门负控制
（`AC 与 DoD 段里【引用】原结论的句子不得把任务判成 human`）。

### 2.2 窗口内两级规则 + 一级兜底

| 档 | 规则 | 说明 |
|---|---|---|
| **T1** `provenance-label` | 显式出处标签（`**来源**：` / `**触发**：` / `**投递说明**：` / `**背景（…）**：` …）里**最左**出现的责任主体名词 | 语料里最强的出处声明形式（170 条带 `**来源**：`）。主体可写在标签名的括号里（`**背景（manager 实测…）**：`） |
| **T2** `attribution` | 全窗口内**最早**出现的「主体 + 动作」短语 | 主体与动作之间允许一段**日期/时刻**（`管理者 2026-08-13 读实现`、`manager 2026-08-24 07:0xZ 定位`）——这是本语料写出处的固定形态，要求主体紧邻动词会整族漏检 |
| **T3** `generic-measurement` | **无主语的测量自述**（`实测` / `读数` / `逐行核` / `读码` / `生产载体` …） | 任务体由循环侧撰写（人不会去写任务体的 method 段）⇒ 无主语的测量词，施动者就是循环侧。**必须排最后**：`实测` 出现率极高，若与具名规则同场按偏移量竞争，`**实测（… SUITE-RED）**` 这类「先实测再报出套件红」的句子会被读成 `loop-patrol` |
| — | 三档都不命中 | ⇒ `other`，`evidenceSpan` 为空串 |

**方法字段**：`method ∈ {rule, llm}`。**本批 1,669 条 100% 由规则产出（`method: rule`）** ——
本机件不含任何 LLM 调用（LLM 标注不可复跑，且与「抽样复核一致率」是两个不同的量）。
该字段保留是为了让将来若引入 LLM 标注能与本批读数区分开，在本批读数里它是一个**恒值字段**。

### 2.3 「否定 / 待办」上下文必须排除（硬规则 3b）

任务体里每一句「⛔ 自行 superseded **需人裁定**」「**供**人裁定」「今天全部**无人**报告」
都不是「人先发现」。命中短语的紧邻前文出现 `需 / 要 / 供 / 待 / 等 / 须 / 若 / 无 / 没 / 任何`
⇒ 该命中作废。**修正前 `human` 类里约 1/4 是这类假阳性。**

---

## 3. 分布读数（1,669 条真实任务体）

```
语料: <root>/tasks/gap-*.md  n=1669
  human          273  16.4%
  loop-patrol    849  50.9%
  suite-gate     224  13.4%
  other          323  19.4%
判得出的部分 (n=1346): human 20.3% / loop-patrol 63.1% / suite-gate 16.6%
判定档: {"none":323,"T2-attribution":915,"T1-provenance-label":187,"T3-generic-measurement":244}
method: {"rule":1669}
```

**读法**：

- `other` **19.4%**（323 条）—— 绝大多数是**英文撰写的早期任务体**（`prepare-milestone` 时代的
  feature-request 形，完全没有责任主体的叙述）与**纯现象陈述**（只写「X 与 Y 不一致」而不写
  谁发现的）。
- 判得出的部分里，**`loop-patrol` 63.1%** 是压倒性多数。这与原结论的方向**相反**。
- `suite-gate` 16.6% —— 套件/闸门报红是第三大来源，而它在原 `FINDING` 的分类里没有位置
  （原文只有「人的追问」与「自主巡检」两类）。

---

## 4. 仪器准确率：人工复核 30 条（真读数，不是脚本自评）

**样本**：`stratifiedSample(recs, 30, seed=20260915)` —— **分层**随机抽样（按四类在语料中的
占比分配名额，类内随机）。用分层而不是均匀随机，是因为 `loop-patrol` 占一半，均匀抽样会让
`human` 类**一条都抽不到**，一致率就只反映大类的准确率。

**复核标准**（落笔前先定，免得事后往结论上调）：判定的是**窗口里记录的第一次揭发是谁做的** ——
`human` = 正文把最初的追问/裁定/需求归给人；`suite-gate` = 正文把触发写成一次套件/检查器/闸门
报红；`loop-patrol` = 循环侧某一层（管理者/外层/内层/driver/meta-driver/worker/director）
做的一次读取、测量、审计或巡检；`other` = 正文没有给出任何可判的依据。

**一致率 = 25/30 = 0.833**（≥ 0.7 门槛）。

| # | taskId | 脚本判定 (tier) | 证据片段 | 人工判定 | 一致 |
|---|---|---|---|---|---|
| 1 | `gap-dashboard-fanin-card-hide-reason` | human (T2) | 人裁定 | loop-patrol | ❌ |
| 2 | `gap-supervisor-base-layer-outside-sessions-architecture` | human (T2) | 人裁定 | loop-patrol | ❌ |
| 3 | `gap-git-history-vertical-graph-thirdparty-lib` | human (T2) | 人 2026-08-23 裁定 | human | ✅ |
| 4 | `gap-retire-inner-state-one-observer-targets-by-parameter` | human (T2) | 人问 | human | ✅ |
| 5 | `gap-test-detail-timeline` | loop-patrol (T1) | **来源**：manager | loop-patrol | ✅ |
| 6 | `gap-session-identity-index-vs-explicit` | loop-patrol (T2) | manager 实测 | loop-patrol | ✅ |
| 7 | `gap-suite-tiering-kind-heavy-not-a-mechanism` | loop-patrol (T2) | outer 复核 | loop-patrol | ✅ |
| 8 | `gap-session-liveness-hashes-the-token-counter-as-if-it-were-work` | loop-patrol (T2) | 管理者 2026-08-03 报 | loop-patrol | ✅ |
| 9 | `gap-capability-catalog-declarations-not-enforced-at-script-creation` | loop-patrol (T2) | 外层全量验证才暴露 | loop-patrol | ✅ |
| 10 | `gap-reduce-sync-spawn-floor-suite-slowdown` | loop-patrol (T2) | manager 2026-08-12 第三轮实测 | loop-patrol | ✅ |
| 11 | `gap-rework-multiplier-predictors` | loop-patrol (T3) | 实测 | loop-patrol | ✅ |
| 12 | `gap-fan-in-workflow-lock-stale-runid-detached-holder` | loop-patrol (T3) | 逐行核 | loop-patrol | ✅ |
| 13 | `gap-meta-syncdeveloptodoc` | loop-patrol (T2) | 本轮读 | loop-patrol | ✅ |
| 14 | `gap-the-finding-shape-still-requires-a-plan-section` | loop-patrol (T2) | 外层实测 | loop-patrol | ✅ |
| 15 | `gap-suite-floor-two-longest-files-bound` | loop-patrol (T2) | outer 复核 | loop-patrol | ✅ |
| 16 | `gap-quay-init-closure-ratchet-manual-reanchor-recurs` | loop-patrol (T2) | 已定位 | loop-patrol | ✅ |
| 17 | `gap-resource-gate-psi-does-not-capture-load-flake-driver` | loop-patrol (T2) | outer 复核 | loop-patrol | ✅ |
| 18 | `gap-delivery-critical-mechanical-axis-orphaned-needs-ruling` | loop-patrol (T1) | **背景（worker | loop-patrol | ✅ |
| 19 | `gap-skill-allowed-tools-plugin-namespace` | loop-patrol (T3) | 实测 | loop-patrol | ✅ |
| 20 | `gap-worker-worktree-continue-reuse` | loop-patrol (T2) | manager 实测 | loop-patrol | ✅ |
| 21 | `gap-criterion-attribution-ratchet-blind-to-trailing-computed-exit` | suite-gate (T2) | gate fail | suite-gate | ✅ |
| 22 | `gap-suite-fix-workflow-no-load-sensitive-branch` | suite-gate (T2) | gate**：不判「这红 | loop-patrol | ❌ |
| 23 | `gap-full-suite-state-red-no-failure-detail-static-check-invisible` | suite-gate (T2) | 静态检查拦下 | suite-gate | ✅ |
| 24 | `gap-goal-closure-freezes-failing-ac-outside-reverify-scope` | suite-gate (T2) | 判据每轮 exit 1 | suite-gate | ✅ |
| 25 | `gap-fan-in-materialize-check-false-positive-non-bootstrap` | other (none) | (空) | suite-gate | ❌ |
| 26 | `gap-prepare-milestone-task-epoch-budget-reset` | other (none) | (空) | other | ✅ |
| 27 | `gap-ac60-coverage-denominator-excludes-dead-prereqs` | other (none) | (空) | other | ✅ |
| 28 | `gap-prepare-milestone-noisy-agent-raw-json-parse` | other (none) | (空) | other | ✅ |
| 29 | `gap-cli-quay-init-collides-with-the-canonical-slash-quay-init` | other (none) | (空) | other | ✅ |
| 30 | `gap-suite-knobs-config-file-priority` | other (none) | (空) | loop-patrol | ❌ |

### 4.1 失败模式（全部 5 个不一致，逐条归因）

| 模式 | 实例 | 机制 |
|---|---|---|
| **M1 —— 把「人裁定**修法**」读成「人先发现」**（2 例） | #1、#2 | 任务体先由循环做出现象分析，后写「修法（人裁定…）」。T2 按偏移量取最早，若循环的测量词不在具名规则里，人裁定就会成为最早命中。**方向：高估 human** |
| **M2 —— 把「描述一道闸缺什么」读成「闸报红了」**（1 例） | #22 | 正文里出现「fix-scope **gate**：不判「这红…」」——这是**在描述一个不存在的判据**，而 `suite-red` 规则只看到「gate + 红」。**方向：高估 suite-gate** |
| **M3 —— 循环的读取没有具名主体时落 `other`**（2 例） | #25、#30 | #25 由 `fan-in-materialize-check` 报 RED（是闸，该判 suite-gate）但正文没写「套件」；#30 写「director 2026-08-31 实证」而主体表里没有 `director`。**方向：低估实质类、抬高 `other`** |

**M1 与 M3 的方向相反**，这一点对 §0 的结论重要：**两类偏差不会同向叠加去制造一个假的不支持**
——M1 抬高 human，M3 压低实质类。§0 的上界论证（0.357 < 0.60）同时对 M1 免疫：M1 只会让
human 更高，而它已经够不到 0.60。

### 4.2 一致率的使用边界

- 抽样是**分层**的，所以 30 条里各类比例**不代表**语料里各类比例（§3 的占比来自全量分类，
  与本节抽样无关）。本节的数只回答一个问题：**这套规则判得准不准**。
- 30 条的一致率 0.833 的标准误约 ±0.068（二项），故真值区间大致 **[0.70, 0.97]**。
  **它足以支撑「分类器可用」这个判断**（门槛 0.7），但不足以支撑对某一类占比做 ±1 个百分点的
  精细论断——本报告没有做那种论断。

---

## 5. 时间趋势

按**立案提交时刻**（`git log --diff-filter=A -- tasks/<id>.md`）分组。1,669 条里 **6 条**
无立案时刻（0.4%），它们**不进入任何分组**，也没有被当成任何类。

```
—— 按立案月份 ——
分组                 n   human    loop   suite   other        human/判得出      human上界
2026-07           46       0       0       3      43             0.0%        93.5%
2026-08         1101     168     589     128     216            19.0%        34.9%
2026-09          516     103     257      92      64            22.8%        32.4%

—— 按 08-11 前后两窗 ——
分组                 n   human    loop   suite   other        human/判得出      human上界
2026-08-11..now  1191     206     616     159     210            21.0%        34.9%
pre-2026-08-11   472      65     230      64     113            18.1%        37.7%
```

**怎么读**：

- **两个对照窗的差距很小**（18.1% vs 21.0%，上界 37.7% vs 34.9%）。**08-11 这个分界在
  本读数上不是一个拐点** —— 本报告不声称它是（08-11 之所以被选作分界，是因为
  `docs/analysis/suite-got-5x-faster…` §7 明写「08-11 之前无遥测」，不是因为它被先验地
  认为改变了发现路径）。
- **2026-07 那一格（n=46）不能读**：43/46 是 `other`（那个月是 `prepare-milestone` 的
  feature-request 形任务体，英文、无责任主体），human 上界 93.5% 是**样本量太小 + 判据不适用**
  的产物，**不是「那时人发现了 93.5%」**。
- **趋势解读的限制（任务体的要求）**：样本量随时间**极度不均**（46 / 1,101 / 516），
  而且**任务体的撰写风格本身随时间变过**（07 月是英文 feature request，08 月之后是中文
  现象陈述 + 出处标注）。**风格的迁移与发现路径的迁移在这个语料里不可分离** ——
  08 月之后 human 判定更多，可能是循环真的更常引用人的裁定，也可能只是**任务体开始写出处**。
  **本报告不主张任何趋势性的因果读法。**

### 5.1 「语料越往后越大」本身就是对原结论的一次检验

原 `FINDING`（08-09）的 n=5 取自**自主循环刚跑起来的头两周**。到 2026-09-15，语料是 1,669 条，
其中 **1,191 条（71%）立案于 08-11 之后**。也就是说：**本次扩样不是在同一分布上多抽几个点，
而是覆盖了一个原结论从未见过的、大得多的窗口** —— 而 human 占比在更早的窗口（18.1%）
与更晚的窗口（21.0%）上几乎一样低。**原结论在它自己的外推区上没有复现。**

---

## 6. 对原结论的判定（三选一）

**结论：不支持。**

理由分三层，按**对分类器准确率的依赖程度**从低到高：

1. **（不依赖准确率）上界论证。** 即便把 323 条 `other` 全部算成 human，human 占比也只有
   **0.357**，低于 0.60。要到达 0.60 需要 729 条，超出 `other` 总量 2.3 倍。**任何一致率下
   这个论证都成立。**
2. **（弱依赖，一致率 0.833）判得出的部分里 human 只有 0.203。** 复核发现的 5 个不一致里
   2 个是 human 的假阳性（M1），**即 0.203 偏高而非偏低**。
3. **（弱依赖）两个对照窗分别 0.181 / 0.210，均远低于 0.60**，且趋势不朝向 0.60。

**同时明确不支持的边界**：本次读数**不触及** §3 的两体结构。`§3.1` 的出处调查说的是
**方案**由人逐字提出（`*-driver` 族、分支模型），那是**形变方向**由人供给——
**本次量的是「谁先说出问题」，与「谁决定往哪改」没有关系。** 把本报告的「不支持」
读成「§3 的两体结构被推翻」是**过度解读**。

---

## 7. 可复跑锚点

```bash
cd <repo root>            # develop tip be12f1118bce458af07ef26d29a78419594b2380

# 全量分类：条数 + 四类占比 + other 占比（AC2 的 stdout 读数）
node --experimental-strip-types plugin/scripts/discovery-path-classify.ts --counts

# 加时间趋势（按月 + 按 08-11 前后两窗；读立案提交时刻）
node --experimental-strip-types plugin/scripts/discovery-path-classify.ts --trend

# AC1 的机器接口：四键数组 {taskId, class, method, evidenceSpan}
node --experimental-strip-types plugin/scripts/discovery-path-classify.ts --emit-json

# 本文第 4 节的人工复核样本（种子 20260915，分层，n=30）—— 逐条打印证据窗口
node --experimental-strip-types plugin/scripts/discovery-path-classify.ts --sample 30 --seed 20260915
```

- **读数日期**：2026-09-15；**develop tip**：`be12f1118bce458af07ef26d29a78419594b2380`
- ⚠️ **tip 钉的是【读数那一刻】的语料。** `tasks/` 是活的（本报告写下的同一小时里
  语料就从 1,669 变成 1,668 条）——**要复现本文的每一个数，就必须在 `be12f111` 上跑**；
  在更晚的 tip 上跑会得到略有差异的 n，这是**语料在长大**，不是分类器变了。
  §0 的结论对这个漂移不敏感：上界与 60% 之间隔着 24 个百分点。
- **抽样种子**：`20260915`（`mulberry32`，同一 seed 在任何机器上给同一序列）
- **一致性测试**：`node --experimental-strip-types --test plugin/test/discovery-path-classify.test.mjs`
- ⚠️ **本报告里的每一个占比都是从盘上真实任务体与真实 git 历史读出来的**，关掉测试 fixture 后
  `--counts` / `--trend` 给出的仍是同一组数（测试文件只对契约与非 fixture 的真实语料取样做断言）。

---

## 8. 这条读数没有回答的问题（留给下一次）

1. **「方案谁提出的」没有被量。** 本机件读的是任务体的触发描述，而 §3.1 那张表要的是
   **方案出处**（SPEC 逐字引人的原话）。要对齐那张表，需要的是**第二根轴**，落点在
   `docs/proposals/`、`orchestration/SPEC-*.md`、`adr/` 的出处行，不是 `tasks/`。
2. **`other` 里那 323 条没有进一步分解。** 其中英文撰写的早期任务体是一整族（M3 之外的
   一个可机械识别的子集）；把这一族单独抽出来量，是提高覆盖率的下一步，而不是靠加规则硬猜。
3. **趋势不可因果读**（§5）。要把它变成可因果读的，需要**固定任务体撰写模板**之后的前后对照
   —— 那是一个**写侧**的改动，不是读侧的。

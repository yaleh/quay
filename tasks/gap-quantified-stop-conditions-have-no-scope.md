---
id: gap-quantified-stop-conditions-have-no-scope
title: "Driver-doc prose hygiene: quantified thresholds must name set and
  window; named paths must resolve"
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

> **交叉标注（2026-08-09，`gap-loop-shipping-threshold-scope-check-old-path-regression`）**：本检查器
> 初版 `SCAN_DOCS` 引用**旧部署副本路径**（`docs/analysis/fast-mode-loop-tick.md` +
> `orchestration/orchestrator-loop-tick.md`），不在 loop-shipping 排除表内 → round-200 全量套件在
> loop-shipping AC1b（176 绿仅此 1 红）。修复：`SCAN_DOCS` 改为 `plugin/loop/` **规范路径**
> （`plugin/loop/fast-mode-loop-tick.md` + `plugin/loop/orchestrator-loop-tick.md` + `CLAUDE.md`），
> ratchet 经 `--write-ratchet --reset-baseline` 重锚到新扫描面（baseline 3→5：2 条旧
> `orchestration/` 键解析，新增 `注册表 ≥2`、`last-pane.txt` 两条 canonical 文档真实违规）。扫描面
> 不丢（CLAUDE.md + 有效 tick-doc 面仍在），既有 checker 不回归。

> **生成器标注（AC4，`gap-axis-generator-question-what-range-every-standing-criterion`）**：本条是轴
> 生成器在**作用域轴**上的一个投影。生成器问句：「『needs-human 积压 ≥ 3』量化的是哪一个范围？」
> ⇒ 无命名集合、无窗口（全局一刀切）⇒ **作用域轴未打开**。本任务即该未打开轴的一个实例，与
> `gap-quality-criteria-are-point-in-time-no-trend-criteria`（时间轴投影）同属一个生成器——两投影
> **交叉标注、不合并**；系统化发现由生成器负责（`plugin/scripts/axis-generator.ts --criteria`），本
> 任务不再一条条捡实例。

2026-08-03 内层停止派发，理由是 `needs-human 积压 ≥ 3`。实际情况：那 7 个任务全部是历史遗留
（最后改动 07-29 至 08-02 05:54，**全部早于窗口起点 ≥12 小时**），窗口内新增为 **0**。

**这句话的意图**是「内层产出 needs-human 的速度超过消解速度，该停」；
**它被读成**「仓库里 needs-human 的总数，有史以来」。
按后者，**7 个历史任务永久卡死派发——因为解开它们需要派发**。

缺的不是执行者，是**范围**：`≥ 3` 没说**哪个集合**、**什么窗口**。

### 这不是孤例

`docs/analysis/normative-prose-audit.md` 对内层 tick 文档 49 条规范性语句逐条判定：
**36 条决策性语句，落地时只有 7 条有真执行者**。而带量词的停止条件是其中**歧义代价最高**的一类——
一条就卡死了派发，且症状是「系统看起来在正常等待」，不会自己暴露。

### 为什么只查这一类，不查全部

审计明确否掉了通用检查：36 条里 **1 条有意不机械化**（ADR-021 明示，覆盖判断边界表整块）、
**3 条本质不可机械化**（思维纪律，今晚由其中一条挡住过一次掩盖式修复）。
通用检查会对它们持续报假警，**而一个持续报假警的检查会被忽略**——正是
`docs/analysis/instrument-failure-mode.md` 记录的失效模式。

这两类现已在文档里用 `<!-- unmechanized: -->` / `<!-- unmechanizable: -->` 显式标记
（2026-08-03 外层直接编辑），**本检查必须跳过被标记的段落**——标记的存在就是为了让范围可判定。

### 第二类缺陷：点名了已不存在的东西（人 2026-08-03 指出）

人指出 CLAUDE.md 里的 `quay.js` 是**阶段性文本，应当在合适的时候删除**，并且这属于同一个检查。

**外层实测**：CLAUDE.md 里被反引号点名的路径中，**5 条真过期**，全是 `.js`→`.ts` 迁移遗留
（`packages/quay/bin/quay.js`、`quay-native.js`、`src/serve.js`、`src/mcp-server.js`、
`it0-dod-check.mjs`、`lifecycle.js`）。已由外层直接修掉。

**为什么它和阈值检查是同一类**：两者都是**散文声称的东西与真实情况不符**，
都可机械判定，且都是**读者按字面执行就会出错**。

**但这个判定极易过度报告**——外层第一版检查把 18 条**局部路径**（`OUTER-LOOP.md` 这种
在文中作为简称提到、实际位于子目录的）误判为过期。正确判据分三层：

| 情形 | 判定 |
|---|---|
| 精确路径存在 | 通过 |
| 精确路径不存在，但 basename 在仓库中存在 | **局部引用，通过**（这是合法文风） |
| basename 不存在，但同名不同扩展名存在 | **过期**——扩展名已变 |
| 都不存在，且不含占位模式 | **过期** |
| 含占位模式（`NNN`、`<...>`、`*`） | **跳过**（如 `tasks/DIR-NNN.md`） |

最后一行是实测得出的：不排除占位模式，CLAUDE.md 会永远剩一条假阳性。

## Contract

```
measure  unscoped_count = `node plugin/scripts/threshold-scope-check.ts --json` 输出的 violations 字段长度
measure  stalepath_count = `node plugin/scripts/threshold-scope-check.ts --json` 输出的 stalePaths 字段长度
measure  marked_count   = `node plugin/scripts/threshold-scope-check.ts --json` 输出的 skippedByMarker 字段长度
band     ceiling = 0 新增                                          # 与 contract-violations 同款 shrink-only
invariant 被扫描的文档集合在改前后一致                                # 变了则计数不可比
invoke   `node plugin/scripts/threshold-scope-check.ts --json`
control  `needs-human ≥ 3`（无集合无窗口）必须报出，`窗口内新增 needs-human ≥ 3` 必须不报——双向
resume   每扫完一个文档即写盘                                        # 文档数少，但保持一致
```

## Chosen mechanism

**只查一类：带量词的停止/触发条件。判据是「有没有说清集合与窗口」。**

### 扫描对象

`docs/analysis/fast-mode-loop-tick.md`、`orchestration/orchestrator-loop-tick.md`、`CLAUDE.md`。
**不扫 `tasks/`**——那是 `task-contract-check.ts` 的地盘，两者共用判定但对象不同
（Contract 管任务体的阈值，本检查管驱动文档的阈值）。

### 判定

一行如果含**量词模式**（`≥N` / `>= N` / `超过 N` / `N 次以上` / `N 分钟`），必须同时满足：

| 要求 | 反例（今晚的） | 正例 |
|---|---|---|
| 说明**集合** | `needs-human 积压 ≥ 3` | `needs-human ≥ 3` **的哪些**：窗口内新增的 |
| 说明**窗口** | 同上——没有窗口即默认「有史以来」 | `窗口内新增` |

**跳过**被 `<!-- unmechanized: -->` 或 `<!-- unmechanizable: -->` 标记的段落。

### 报出而不阻断

违规名单是数据文件 `docs/analysis/threshold-scope-violations.md`，**只能变短**——
与 `contract-violations.md`、`test-framework-policy-exemptions.txt` 同款棘轮。

**不做**：不检查阈值的**取值是否合理**（3 该不该是 3 是判断，不是格式）；
不扫 `tasks/`；不阻断任何流程。

## Acceptance Criteria

- [x] AC1: `threshold-scope-check.ts` 实现，输出 `violations` 与 `skippedByMarker` 两个字段
- [x] AC2: **双向负控制**——`needs-human ≥ 3`（无集合无窗口）必须报出；
      `窗口内新增 needs-human ≥ 3` 必须不报。两条实跑输出都贴进任务体
- [x] AC3: 被 `<!-- unmechanized: -->` / `<!-- unmechanizable: -->` 标记的段落**不报**；
      用文档里现有的 3 处标记验证，并在输出里报 `skippedByMarker` 的数量（**跳过必须可见**——
      静默跳过与「没发现问题」不可区分）
- [x] AC4: 匹配按**行内容**，剥离代码块与 HTML 注释内容
      （本仓库今晚已有 7 次「匹配到提到它的文本而非它本身」的教训）
- [x] AC5: 在当前三份文档上实跑，违规清单贴进任务体；名单落盘为
      `docs/analysis/threshold-scope-violations.md`
- [x] AC6: 名单是 shrink-only 棘轮，新增即失败；与 `contract-violations.md` 同款
- [x] AC7: 报出而不阻断；接进 `scripts/test.sh` 的 governance 组
- [x] AC9: 过期引用判定按上表**三层**实现；用 CLAUDE.md 实跑，
      **18 条局部路径必须不报**（外层第一版检查正是在这里过度报告）
- [x] AC10: 含占位模式（`NNN`/`<...>`/`*`）的路径**跳过**；用 `tasks/DIR-NNN.md` 验证
- [x] AC11: **负控制**——人为在扫描的文档里加一条指向不存在文件的引用 ⇒ 必须报出；
      改成真实存在的路径 ⇒ 必须不报
- [x] AC8: 测试带 `// @test-group governance` 声明

## Definition of Done

- [x] AC2 的双向负控制与 AC5 的违规清单贴进任务体
- [ ] `scripts/test.sh` 连跑 2 次全绿
- [x] 明确记录：**缺的从来不是执行者，是范围**。`≥3` 本身没有歧义，
      「≥3 个什么、在什么窗口内」才是歧义所在——而正是这个歧义卡死了一次派发

## Touches

- plugin/scripts/threshold-scope-check.ts
- plugin/test/threshold-scope-check.test.mjs
- docs/analysis/threshold-scope-violations.md
- scripts/test.sh
- plugin/scripts/capability-catalog.sh   # 内层新增：新 checker 必须在 catalog 声明其问题（AC1c 门）
- plugin/scripts/checker-mutation-cases/threshold-scope-check.sh   # 内层新增：mutation case（AC1b 门）

## Dispatch review

reviewer: outer
at: 2026-08-03T03:26:00Z
changed: 范围两次调整。(1) 从「所有决策性散文都要有执行者」收窄到「只查带量词的停止条件」——
  依据是 `normative-prose-audit.md` 的逐条判定：36 条里 4 条不该被修（1 条 ADR-021 有意不机械化、
  3 条是本质不可机械化的思维纪律），通用检查会对它们持续报假警而被忽略；
  并要求 AC3 显式报出 `skippedByMarker` 数量，因为静默跳过与「没发现问题」不可区分。
  (2) 人指出 CLAUDE.md 的 `quay.js` 是阶段性文本、属同一个检查，故加入第二类判定「点名的路径必须解析」，
  并把外层第一版检查的过度报告（18 条局部路径误判）写成 AC9 的显式反例——判据必须分三层，不是简单的存在性检查

## Evidence（内层实现 2026-08-09）

### AC2 双向负控制（--judge 实跑）

```
$ node plugin/scripts/threshold-scope-check.ts --root . --judge <fixture1> --json
{ "violations": [ { "line": 1, "hit": "≥ 3", "snippet": "停止条件：needs-human 积压 ≥ 3" } ],
  "stalePaths": [], "skippedByMarker": 0, "flagged": true }        # exit 1 —— 必须报出 ✓

$ node plugin/scripts/threshold-scope-check.ts --root . --judge <fixture2> --json
{ "violations": [], "stalePaths": [], "skippedByMarker": 0, "flagged": false }   # exit 0 —— 必须不报 ✓
```
（fixture1 = `停止条件：needs-human 积压 ≥ 3`；fixture2 = `停止条件：窗口内新增 needs-human ≥ 3`）

### AC3：现有 3 处标记全部跳过且可见

`docs/analysis/fast-mode-loop-tick.md` 的三处 `<!-- unmechanized: -->` / `<!-- unmechanizable: -->`
（L96 判断句、L739 ADR-021 判断边界表、L855 思维纪律）所在段落（及孤立标记的相邻段）全部不报，
且 `skippedByMarker` 在输出里报 **3** —— 跳过是可见的，与「没发现问题」不可区分。

### AC5：当前三份文档实跑违规清单（已落盘 `docs/analysis/threshold-scope-violations.md`）

```
violations (count-threshold stop-condition without a window): 2
  orchestration/orchestrator-loop-tick.md:248  [≥3]  超 90 分钟 / needs-human 积压 ≥3」就停下等人……
  orchestration/orchestrator-loop-tick.md:925  [≥3]  | needs-human 积压 ≥3 | 分诊：真阻塞的攒给人……
stalePaths: 1
  CLAUDE.md:262  [stale-path] .claude/workflows/execute-milestone.js   # 外层 08-03 修掉的 5 条之外第 6 条
skippedByMarker: 3
```

两份 orchestrator 违规正是本任务要抓的原始形状 `needs-human 积压 ≥3`（无集合无窗口）；fast-mode 同款
`窗口内新增 needs-human ≥3`（L454/L736）因命名窗口而不报。CLAUDE.md 的 18 条局部路径（basename 存在
的简称引用）全部不报（AC9），`tasks/DIR-NNN.md` 等占位路径跳过（AC10）。

### AC11 负控制（--judge 实跑）

```
$ node plugin/scripts/threshold-scope-check.ts --root . --judge <bad> --json   # 加 `nowhere/exists.js`
{ "stalePaths": [ { "path": "nowhere/exists.js", "kind": "stale-path" } ], "flagged": true }  # exit 1 ✓
$ node plugin/scripts/threshold-scope-check.ts --root . --judge <good> --json  # 改成 `scripts/test.sh`
{ "stalePaths": [], "flagged": false }                                          # exit 0 ✓
```

### 收尾记录（DoD 第 3 条）

**缺的从来不是执行者，是范围。** `≥3` 本身没有歧义；「≥3 个什么、在什么窗口内」才是歧义所在——而
正是这个歧义卡死了一次派发（2026-08-03 内层把「窗口内新增」读成「有史以来总数」）。本检查把「量词
停止条件必须说明集合与窗口」变成机械判据：报出但不阻断（AC7），违规名单 shrink-only（AC6），
`<!-- unmechanized/unmechanizable -->` 标记的段落显式跳过并计数（AC3）。

内层实现备注：mutation case（`checker-mutation-cases/threshold-scope-check.sh`）与 capability-catalog
声明（AC1b/AC1c 门）随本任务一起补齐，二者是本任务 `## Touches` 之外的必要新增文件。

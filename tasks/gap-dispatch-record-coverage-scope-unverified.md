---
id: gap-dispatch-record-coverage-scope-unverified
title: dispatch-record.jsonl / semantic-face-dispatch-record.jsonl
  的记录条数远低于机械派发实际发生次数，需先核实覆盖范围是否符合设计意图（不要直接当缺陷修）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: finding
---
## Finding

一次用量定量核实发现 `orchestration/dispatch-record.jsonl` 只有 301 行、`orchestration/semantic-face-dispatch-record.jsonl` 只有 6 行，而在 27111-commit 的完整历史中「机械 fan-in」落地归因单独出现 1160+ 次、「机械晋升」（mechanical promotion）归因出现 1111+ 次。`plugin/scripts/dispatch-record.ts:108` 的 `appendRecord` 与 `plugin/scripts/semantic-face-dispatch-record.ts:126` 的 `appendSemanticFaceRecord` 是全库唯一找到的写入方。

**当前未知**这两个记录是否*意图*覆盖每一次派发决策（若是,这个低计数就说明大多数派发没有被记录——真实缺陷），还是*有意*窄范围（例如只覆盖 LLM 中介的「selector 挑选」路径，刻意排除每一次机械批量晋升/fan-in 事件）——这一点**尚未被判定**，按本项目自己宣称的纪律（不把未经验证的前提当缺陷处理），本任务必须定位为**调查**，不是预设方案的修复。

Proposed action：本任务的 AC 应是判定每个记录的设计意图覆盖范围（阅读与这两个机制绑定的设计文档/spec——别处提到的 `fast-mode-tick-core.md` A16b 给 dispatch-record，以及一份 manager 语义派发的「C30/AC145」spec 给 semantic-face 的那个——并对比 `appendRecord`/`appendSemanticFaceRecord` 的实际调用点与那些**不**调用它们的机械晋升/fan-in 调用点），得出结论**二选一**：「确认是非预期的覆盖不足 → 立一个后续修复任务」或「窄范围是设计意图 → 记录为已阅无需动作，关闭」。⛔ 不要把本任务的 AC 写成「给所有派发路径加日志」——那是在调查完成前就预设了修复方案。

## Investigation result (2026-10-07)

**结论：窄范围属设计意图。** 两份记录都是【LLM 决策账本】，按其设计只覆盖 LLM 中介的选择动作；机械晋升 / fan-in 从来不在其对象内，且它们**已有各自的结构化载体**（比这两份账本大两个数量级）。dispatch-record.jsonl 的低计数另有第二个已记录的成因：**载体迁移**（inner 退役后功能由 worker-outcome.jsonl 承接，实测 100% 覆盖）。

### 1. 设计意图原文（AC1）

**A16b —— dispatch-record 的对象是【inner 的任务派发】**

`orchestration/fast-mode-tick-core.md:37`（A16b 行，逐字）：
> 派发记录·AC55 产物·承重——派发前**先于** `--task-start` 调 `dispatch-record.ts --add --task-id <id> --reason "<一句为什么选它>" --root …` ……写 ①倾向文件**内容指纹**(`git blob hash`,回答"用的是哪一版") ②一句「为什么选它」(回答"按倾向选还是随便选")……**不要求解释每一次「不选」**(SPEC §7 逐字)

模块头（`plugin/scripts/dispatch-record.ts:1-27`，比 tick 文档更精确，逐字）：
> "The dispatch record is **inner's** COMPLIANCE PRODUCT — the 承重 part of SPEC-dispatch-ordering-semantic-2026-08-13 §4.3 (C17). Each dispatch **inner** performs MUST carry: ① the dispatch-preference file's CONTENT FINGERPRINT (git blob hash — answering 「用的是哪一版」) ② a ONE-SENTENCE 「为什么选它」…"
> "This script is the WRITE POINT: **inner calls it at the dispatch moment** (before --task-start / Agent spawn, same tick step as A16)."
> "SPEC §7 (verbatim): inner does NOT explain every 「不选」 — only WHAT was chosen."

能力目录（`plugin/scripts/capability-catalog-declarations.json`，逐字）：
- QUESTION: "Did **inner** record a dispatch with the dispatch-preference file's content fingerprint …"
- INVALIDATION：「失效前提：SPEC §4.3 的三分设计仍生效（正本=倾向文件 / 通知=SendMessage / 产物=带指纹+理由的派发记录）；若产物机制废除（不再要求派发记录带指纹与理由），本条退休」

⇒ 对象 = **inner 的「先派谁」选择**（产物回答「倾向文件读过没读」）。**未**声明覆盖机械事件。

**C30 —— semantic-face-dispatch-record 的对象是【manager 的八类语义职责派发】**

`orchestration/manager-tick-core.md:134`（C30 行，逐字）：
> 语义职责一律派后台 subagent 执行 + 留派发记录（AC145）——**八类语义职责**（任务撰写/立案 · 需求分析 · 升级判断 B11 · 学习 B10 · AC65 快修判断 · B16-C 类冲突意图 · B18 止损 · **跨层纠错（单列）**）……每次派发前先调 `semantic-face-dispatch-record.ts --add --kind <八类之一> --reason "…"`（fail-closed：类别非法/理由过薄 ⇒ exit 1 不写不派）……**八类职责机器正本 = 脚本 `SEMANTIC_DUTY_KINDS`（closed enum）**。

模块头（`plugin/scripts/semantic-face-dispatch-record.ts:11-15`，逐字）：
> 与 A16b `dispatch-record.ts` 的分工（不是重造，是另一个对象）：A16b 记录的是【任务派发】——倾向文件指纹 + 一句「为什么选它」……本文件记录的是【语义职责的 subagent 派发】——职责类别（dutyKind）+ 一句「这轮语义 subagent 产出/判断什么」。**语义职责不经 dispatch-preference 的「先派谁」选择，故不带倾向文件指纹**；它带的是【职责类别】这个 A16b 没有的维度。

⇒ 对象 = **manager 的八类语义职责派发**（closed enum `SEMANTIC_DUTY_KINDS`，`semantic-face-dispatch-record.ts:52-61`）。**未**声明覆盖机械事件。

**两份原文都对范围有明确声明**（非「未声明」），且都把自己定义为 **LLM 决策账本**。

### 2. `appendRecord` / `appendSemanticFaceRecord` 的全部实际调用点（AC2）

`appendRecord`（定义 `plugin/scripts/dispatch-record.ts:108`）：
- `plugin/scripts/dispatch-record.ts:172` —— **唯一生产调用点**，位于该脚本自己的 CLI `--add` 处理分支内。
- `plugin/test/dispatch-record-fingerprint-reason-check.test.mjs:36`（import）、`:222`（调用）—— 仅测试。

`appendSemanticFaceRecord`（定义 `plugin/scripts/semantic-face-dispatch-record.ts:126`）：
- `plugin/scripts/semantic-face-dispatch-record.ts:270` —— **唯一生产调用点**，位于该脚本自己的 CLI `--add` 处理分支内。
- `plugin/test/semantic-face-dispatch-record.test.mjs:34`（import）、`:99`/`:103`/`:104`（调用）—— 仅测试。

**全库模块引用普查**（谓词 `dispatch-record\.ts`；先跑正控制验证谓词：两个测试文件命中 4 / 2，负控制七个 driver 文件全 0 ⇒ 该 0 是真零而非谓词失效）：除两个模块自身与其测试外，全库**只有两处**引用，且都不是派发路径——
- `plugin/scripts/dispatch-record-fingerprint-reason-check.ts:31`（注释）
- `plugin/scripts/runner-static-gate.ts:911`（`@static-object` 声明行）

⇒ **没有任何 dispatcher / driver / fan-in 路径 import 或调用这两个模块。** 调用面**纯 CLI**，而调用这两个 CLI 的文档全部是 **LLM tick / selector 提示面**：`orchestration/fast-mode-tick-core.md:37`（A16b）、`plugin/loop/fast-mode-loop-tick.md:956`、`orchestration/manager-tick-core.md:134` + `orchestration/manager-tick-sending.md:63`（C30）；另 `orchestration/context-slimming/v-validation.md:55` 把「selector 手搓一行 jsonl vs 调 `dispatch-record.ts`」列为 selector 角色的 S1 验证场景 ⇒ **selector 是该 CLI 的预期调用者**。

### 3. 机械晋升 / fan-in 中【不】调用这两个函数的调用点（AC3，「潜在未覆盖」清单）

**机械晋升（零 LLM）：**
| 调用点 | 载体（各自的记录面） | 规模 / 活性 |
|---|---|---|
| `plugin/scripts/promotion-driver.ts:628` `appendRoundRecord` | `.quay/promotion-round.jsonl`（`:86` `ROUND_LOG_REL`） | 74,726 行，末次 2026-10-07T07:08Z |
| `plugin/scripts/promotion-driver.ts:725` `appendOutcomeRecord` | `.quay/promotion-outcome.jsonl`（`:90` `OUTCOME_LOG_REL`） | 49,846 行，末次 2026-10-07T07:06Z |
| `plugin/scripts/ready-pool-check.ts:3755` `applyPromotions` → `:3782` `setTaskStatus(…, READY)` | 盘上 `tasks/<id>.md` frontmatter（机械批量 todo→ready 状态写） | 每次 `--apply` |
| `plugin/scripts/driver-filters.ts:299` `writeDocDevelopSyncEvent` | `.quay/doc-develop-sync.jsonl`（`:292`） | 7,793 行，末次 2026-10-07T07:05Z |

**机械 fan-in（零 LLM）：**
| 调用点 | 载体 | 规模 / 活性 |
|---|---|---|
| `plugin/scripts/worker-fan-in.ts:1664` `runMechanicalFanIn`（步链） | `.quay/worker-round.jsonl`（`worker-driver.ts:416`） | 42,862 行，末次 2026-10-07T07:08Z |
| `packages/quay/src/fan-in/ff-merge.ts:811` `ffMerge`（→ `:935` `git merge --ff-only`） | git 本身（develop 提交历史） | 1,221 条「机械 fan-in」提交 |
| `plugin/scripts/fan-in-push-lag-check.ts:392` `appendPushLagEvent` | `.quay/fan-in-push-lag.jsonl`（`:51`） | 1,066 行，末次 2026-10-07T04:29Z |
| `plugin/scripts/worker-driver.ts:416` / `:420` 载体常量 | `.quay/worker-round.jsonl` / `.quay/worker-dispatch.json` | 见上 |

**A16b 的承接载体（LLM selector 路径，迁移后）：** `plugin/scripts/worker-driver.ts:619` `selector_reason` → `.quay/worker-outcome.jsonl`（`driver-filters.ts:763` `WORKER_OUTCOME_REL`）。`worker-driver.ts:29-32` 逐字把它声明为「gitignored 运行时日志，**dispatch-record.jsonl 同族**……字段 = SPEC §4③ {task, **selector 理由**, worker exit code, 墙钟, 终态, 失败原因}」。

### 4. 结论与判断依据（AC4）

**结论：「窄范围属设计意图」**（且 dispatch-record.jsonl 的低计数另有一个已记录的成因：功能已由承接载体 100% 覆盖，见下）。

判断依据四条，各自独立可取假：

1. **两份设计意图原文都点名了自己的对象**，且都是 LLM 决策：A16b = inner 的「先派谁」任务派发（倾向指纹 + 为什么选它）；C30 = manager 的八类语义职责派发（closed enum）。**没有任何一份声称覆盖机械事件。**
2. **机械晋升在定义上就是「无意志」的**——`ready-pool-check.ts:126` 逐字 "no volition (AC1)"；它**从不读 `dispatch-preference.md`**，故 SPEC §4.3 那个「证明倾向文件被读过」的产物**没有对象**（写它只会是恒真的回声，硬规则 4）。
3. **机械路径并非「未记录」，而是记录在各自的结构化载体里**，且那些载体**比这两份 LLM 账本大两个数量级**（74,726 / 49,846 / 42,862 / 7,793 / 1,066 vs 302 / 6，全部在本轮数分钟内仍在写入）。「未覆盖」这个说法本身不成立。
4. **被比较的是两类不同的事件**：1,221 条「机械 fan-in」与 1,134 条「机械晋升」提交，抽样三条均为**任务状态翻转提交**（`tasks: 翻 <id> done（driver 机械 fan-in）` / `tasks: <id> todo→ready（promotion-driver 机械晋升）`）——那是**落地/晋升事件**，不是**派发决策**。把事件数与决策数并列，是谓词与被问问题不匹配（同 C28 方向 A）。

**载体迁移（第二个成因，独立于范围问题，实测）：** `orchestration/dispatch-record.jsonl` **不是冻结的**——它是活的（本轮调查期间 07:07:21Z 又落了一条）。但迁移后流量极低，且 A16b 的功能已被承接载体完整覆盖：

| 载体 | 记录总数 | 2026-09-04（inner 退役日）以来 |
|---|---|---|
| `.quay/worker-outcome.jsonl`（承接载体，`AC148:35`） | 2,813 | **1,818 次派发，1,818 条带非空 `selector_reason`（100%）** |
| `orchestration/dispatch-record.jsonl`（原文件） | 302 | **5 条**（4 条在退役当日、全部属 `gap-retire-session-liveness`；1 条为 2026-10-07T07:07:21Z） |

承接去向已逐字记录在 `orchestration/AC148-inner-core-itemized-attribution.md:35`：「A16b（`dispatch-record.ts --add`）→ ① 已由 worker-driver 承接：「为什么选它」= selector 真实理由落 `selector_reason` 进 worker-outcome.jsonl」。⇒ 迁移后 **1,818 次派发中 A16b 的「为什么选它」100% 有记录**；原文件在 33 天里只收到 1 条，即 **A16b 的功能被完整覆盖，原文件本身近乎休眠（vestigial）**——既不是「冻结」，也不是「仍在增长却长不大」。

### 5. 后续修复任务（AC5）

**无。** 结论为「设计意图」⇒ 按 AC5 直接作为调查记录关闭，不新开修复任务。

### 观察项（⛔ 非缺陷断言，不计入本任务结论，不阻塞）

- **O1**：`semantic-face-dispatch-record.jsonl` = 6 行（2026-08-30 → 2026-10-03）。低，但与「八类 closed enum + manager tick 稀疏」相符；该载体仍活（末次写入 2026-10-03）。判为**符合设计**，非缺口。
- **O2（本调查的副产品，供人决定是否另开任务）**：`CLAUDE.md:158` 至今把 `dispatch-record.ts --add` 写成「**单任务派发记录接口**」，其正本指针指向 `fast-mode-tick-core.md` A16b ——**即已退役的 inner 层**；`capability-catalog-declarations.json` 中该行的 QUESTION 也仍写 "Did **inner** record a dispatch…"、CADENCE「每轮」。这**很可能是迁移后那 5 条 stray 记录（尤其 2026-10-07 那条，理由文本是典型 selector 理由）的成因**：任一读了 CLAUDE.md:158 的 LLM（selector / worker / v-validation S1 场景）都会认为该 CLI 仍是当前派发记录接口。**对本工作区而言这是指针过期；对随 `plugin/loop/` 出货的下游 fast-mode 项目该描述仍正确**（`plugin/loop/fast-mode-tick-core.md:51`、`plugin/loop/fast-mode-loop-tick.md:956` 仍在教 inner 调它）。按 AC5 的设计意图分支，**本任务不新开修复任务**，仅记录为观察项。

## Acceptance Criteria

- [x] 读取并引用 `fast-mode-tick-core.md` A16b（dispatch-record 的设计意图段落）与 manager 语义派发的「C30/AC145」spec（semantic-face-dispatch-record 的设计意图段落），摘录其对覆盖范围的原文声明（若原文未明确声明范围，记录为「未声明」而非猜测）
- [x] 列出 `appendRecord`/`appendSemanticFaceRecord` 的全部实际调用点（文件+行号）
- [x] 列出全库机械晋升/fan-in 的调用点中，**不**调用上述两个记录函数的那些（文件+行号），作为「潜在未覆盖」清单
- [x] 基于以上两份清单与设计文档声明，得出明确结论：「覆盖不足属非预期缺陷」或「窄范围属设计意图」，并写明判断依据
- [x] 若结论为「非预期缺陷」，在本任务体中列出后续修复任务的 id/标题（可另开新任务，不在本任务范围内直接实现修复）；若结论为「设计意图」，本任务可直接作为调查文档关闭,不新开修复任务

## Definition of Done

调查完成，结论二选一且有证据支持（调用点清单 + 设计文档引用）；若判定为缺陷,后续修复任务已登记（但不要求在本任务内实现）；若判定为设计意图,任务作为调查记录关闭。

## Touches

- plugin/scripts/dispatch-record.ts
- plugin/scripts/semantic-face-dispatch-record.ts
- orchestration/dispatch-record.jsonl
- orchestration/semantic-face-dispatch-record.jsonl
- tasks/gap-dispatch-record-coverage-scope-unverified.md

---
id: gap-crystallization-half-life-rule-to-enforcement
title: 量「结晶半衰期」——规则从落笔到有可执行强制要多久、多少条至今没有（把 ADR-004 从轶事变成分布）
status: ready
labels:
  - gap
  - analysis
  - methodology
parent: null
children: []
extra: {}
---
## Finding

ADR-004（`adr/ADR-004-hard-over-soft-load-bearing-rules-become-executable-checks.md`）主张：
只以散文存在的承重规则会被密度先验反复侵蚀，必须变成 fail-closed 的可执行检查（硬形变 / Π_{S→E}）。
这条是本项目方法论的支柱之一，但它目前**只有轶事支撑**（CLAUDE.md 里若干「同日再犯三次」的
记述），没有分布。

git 历史足以把它变成分布：每条 ADR 有 `date` / `accepted-date`，其 `enforcement:` 字段指向的
检查器有首次落地提交时刻；CLAUDE.md 的硬规则有落笔提交时刻，其中一部分**自标「靠自觉」**
（= 至今无产物）。

已知的定性观察（待量化验证）：`docs/references/维度边界与结晶——从熔融实现中发现原则.md` §5
称「带产物的规则活下来、标『靠自觉』的反复再犯」，并举硬规则 2 立条当天同形四次为例。
ADR-007 的 enforcement 注释自 2026-07-20 起标 "STILL FUTURE WORK"，两个月后仍未兑现——
这是**单点**证据，需要变成全样本的分布。

## 要算的那个量

对全部 ADR（ADR-001~036+）与 CLAUDE.md 硬规则逐条测量「规则落笔 → 其可执行强制落地」的间隔：
中位、p90、至今无产物的条数与清单。

## Touches

- `plugin/scripts/crystallization-half-life.ts` (new)
- `plugin/test/crystallization-half-life.test.mjs` (new)
- `plugin/scripts/capability-catalog.sh`
- `docs/analysis/crystallization-half-life.md` (new)
- `tasks/gap-crystallization-half-life-rule-to-enforcement.md`

## Acceptance Criteria

- [x] 脚本输出每条 ADR 的 `{id, 落笔日期, enforcement 字段值, 强制首次落地提交 SHA 与日期,
      间隔天数, 状态}`，`状态 ∈ {已强制, 无产物, 无法判定}`；**无法判定必须是独立取值**，
      不得与「无产物」或「已强制」合并（硬规则 3b）。
- [x] 至少覆盖全部现存 ADR（读真实 `adr/` 目录，条数与目录实际文件数一致），
      并单独处理 `enforcement: N/A`（如 ADR-006 明确判定不可机械强制）——这类不算「无产物」。
- [x] 给出间隔的中位 / p90 / 最大值，以及「至今无产物」的条数与完整清单（不是抽样）。
- [x] CLAUDE.md 硬规则侧：逐条判定有无产物（该文件本身对多条自标「靠自觉」，可作为真值锚），
      报出自标「靠自觉」的条数，并与脚本判定做一致性核对——不一致的逐条列出。
- [x] 验证 ADR-007 这个已知单点：脚本对它的判定必须是「enforcement 已接线但 per-milestone
      判据无产物」这一类，与人工核对结论一致；这是谓词有效性的正控制。
- [x] `bash scripts/test.sh --for-task gap-crystallization-half-life-rule-to-enforcement` 全绿，
      新测试在该轮被实际选中执行（按测试名核对）。

## Definition of Done

读数取自**真实 `adr/` 目录与真实 git 历史**，不接受 fixture（关掉注入 seam 后 AC 仍应成立）。
`docs/analysis/crystallization-half-life.md` 落地 develop，含可复跑锚点
（命令行 + 日期 + develop tip SHA）。结论若显示「带产物与无产物的规则在再犯率上没有差别」，
如实写反向结论——这会直接削弱 ADR-004，必须照写不得裁剪，并在文档里点明该结论对 ADR-004 的影响。

## Resolution

产物：`plugin/scripts/crystallization-half-life.ts`（读数产出者）+
`plugin/test/crystallization-half-life.test.mjs` + `docs/analysis/crystallization-half-life.md` +
`plugin/scripts/capability-catalog.sh` 六行声明。

复跑锚点（读数日期 2026-09-14 UTC，develop tip 读数时刻 `1dc1eeda69b0c22b4b40c1f0afcebd01154c56f0`）：

```
node --experimental-strip-types plugin/scripts/crystallization-half-life.ts --root /home/yale/work/quay
node --test plugin/test/crystallization-half-life.test.mjs
```

读数（真 `adr/` 36 条 + 真 git 历史）：

- 状态分布：`已强制` 6 / `部分` 2 / `无产物` 25 / `N/A` 3 / `无法判定` 0
- 按 ADR 自身生命周期：accepted 21（`无产物` **12**、`N/A` 3、`部分` 2、`已强制` 4）、proposed 15（`无产物` 13、`已强制` 2）
- 间隔 n=9：中位 **1 d**、p90 **14 d**、最大 **14 d**；负值（机制先于规则）1 条（ADR-021）
- CLIAAUDE.md 硬规则 18 条：自标「靠自觉」**7** 条（`1, 3b, 4, 4b, 5, 10, 11b`），未标注 2 条（`9, 12b`），一致性核对**不一致 0 条**
- ADR-007 正控制：状态 `部分`，caveats =〔`enforcement 已接线但 per-milestone 判据无产物`〕+〔`声明的产物是断链符号链接`〕
  —— 前者的结构事实是 `gates.adr` 已声明 `ADR-007` 而 `.quay/gate-events.jsonl` 的 103765 条
  GateEvent 里 `adr-007` 计数为 0（同一读法对 `goal`=103072 / `complete`=420 / `dod`=77 有命中，
  故是真零而非仪器故障）。

**AC1 的口径声明（不静默重解释）**：AC1 列出三值，实装为五值 —— `N/A` 由 AC2 自己要求单列，
`部分` 由 AC5 自己要求「这一类」；AC1 的实质要求（字段齐备 + `无法判定` 独立取值、不与
`无产物`/`已强制` 合并）由 fixture 正控制守着（`无法判定` 落 `undetermined` 桶，且断言它
不在 `noArtifact` 清单里）。这三条要求不能同时用三值枚举满足，故取五值超集。

**AC3 的口径声明**：间隔含负值 1 条并计入中位/p90/最大（如实全样本），负值另计数单列；
不静默裁剪。

**AC6 口径声明**：实跑用的是 driver scoped 门同一条命令（多带 `--allow-thin`，
该 flag 只放宽「选择集偏薄」的判定，不改测试结果）：exit 0、29 tests / 29 pass / 0 fail，
新测试按测试名被选中执行（`AC1: every record carries …`、`AC5: declared in gates.adr + zero
GateEvents ⇒ the per-milestone-no-artifact class`、`硬规则 3b control: an UNREADABLE GateEvent
carrier is NOT reported as zero events`、`real repo: corpus size, ADR-007 positive control …`）。

**反向结论（DoD 要求，已写进文档 §5，不裁剪）**：本仓库没有机械的再犯率载体，唯一的再犯信息
是规则散文自陈。读数是：带产物**且**自陈再犯的规则 6 条（`1, 2, 4, 4c, 5b, 11`），
自标靠自觉**且**自陈再犯的 4 条（`1, 3b, 4, 4b`）—— **两个类别都出现同形再犯 ⇒ 观测不到
「带产物 ⇒ 无再犯」的差别**。对 ADR-004 的影响已点明：①它的因果半边在本仓库是**未被检验**
（缺载体），不是被证否；②**ADR-004 自己的 enforcement 字段是 `E3, deferred`** ——
要求「承重规则必须有可执行检查」的主规则自己没有可执行检查，所以全库 ADR 从未被它筛过一遍，
这直接解释了 12/21；③在造出再犯载体之前，不要用 ADR-004 论证「某条新规则必须立刻机械化」
（它能论证成本，不能论证收益）。

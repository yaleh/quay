---
id: gap-crystallization-half-life-rule-to-enforcement
title: 量「结晶半衰期」——规则从落笔到有可执行强制要多久、多少条至今没有（把 ADR-004 从轶事变成分布）
status: todo
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

- `plugin/scripts/crystallization-half-life.ts`
- `plugin/test/crystallization-half-life.test.mjs`
- `plugin/scripts/capability-catalog.sh`
- `docs/analysis/crystallization-half-life.md`
- `tasks/gap-crystallization-half-life-rule-to-enforcement.md`

## Acceptance Criteria

- [ ] 脚本输出每条 ADR 的 `{id, 落笔日期, enforcement 字段值, 强制首次落地提交 SHA 与日期,
      间隔天数, 状态}`，`状态 ∈ {已强制, 无产物, 无法判定}`；**无法判定必须是独立取值**，
      不得与「无产物」或「已强制」合并（硬规则 3b）。
- [ ] 至少覆盖全部现存 ADR（读真实 `adr/` 目录，条数与目录实际文件数一致），
      并单独处理 `enforcement: N/A`（如 ADR-006 明确判定不可机械强制）——这类不算「无产物」。
- [ ] 给出间隔的中位 / p90 / 最大值，以及「至今无产物」的条数与完整清单（不是抽样）。
- [ ] CLAUDE.md 硬规则侧：逐条判定有无产物（该文件本身对多条自标「靠自觉」，可作为真值锚），
      报出自标「靠自觉」的条数，并与脚本判定做一致性核对——不一致的逐条列出。
- [ ] 验证 ADR-007 这个已知单点：脚本对它的判定必须是「enforcement 已接线但 per-milestone
      判据无产物」这一类，与人工核对结论一致；这是谓词有效性的正控制。
- [ ] `bash scripts/test.sh --for-task gap-crystallization-half-life-rule-to-enforcement` 全绿，
      新测试在该轮被实际选中执行（按测试名核对）。

## Definition of Done

读数取自**真实 `adr/` 目录与真实 git 历史**，不接受 fixture（关掉注入 seam 后 AC 仍应成立）。
`docs/analysis/crystallization-half-life.md` 落地 develop，含可复跑锚点
（命令行 + 日期 + develop tip SHA）。结论若显示「带产物与无产物的规则在再犯率上没有差别」，
如实写反向结论——这会直接削弱 ADR-004，必须照写不得裁剪，并在文档里点明该结论对 ADR-004 的影响。

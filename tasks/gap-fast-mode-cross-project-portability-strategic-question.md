---
id: gap-fast-mode-cross-project-portability-strategic-question
title: Phase 3's strategic question — is the fast-mode two-layer loop truly
  portable cross-project, or overfit to quay — is being answered ad-hoc via
  meta-cc cold-start with no written reference; pin it explicitly
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者调查（`orchestration/FINDING-roadmap-predates-ADR-022-retirement-2026-08-05.md`）发现路线图
Phase 3 想回答的战略问题**本身仍然成立、仍然重要**：

> **这套机制（fast-mode 双层循环）是真的能跨项目迁移，还是只是在 quay 自己的任务格式上过拟合了？**

- 经典 milestone 管线的 Phase 3 机制（把 kernel 部署到 archguard、影子模式跑 10 个 milestone、拟合
  policy profile）已随 ADR-022 不存在。
- **但问题是同一个**：今晚推的 **meta-cc 冷启动**本质上就是在回答这个问题——用双层 fast-mode 循环
  这个新机制，不是路线图描述的那套。
- **现状是临场推的**：回答一个正确的战略问题，但没有对照任何写下来的路线图。问题隐式散落在管理者
  与外层的对话里，没有显式钉住。

### 选定机制

**把问题钉成显式战略文档 + 证据收集容器**：

1. 新文档（或路线图替换文档的一节）陈述问题 + 为什么重要 + 判据；
2. **判据**：什么证明「可迁移」vs「过拟合」——
   - 可迁移证据：meta-cc/archguard 冷启动用同一 fast-mode 机制装出循环、跑通任务、机制行为不依赖
     quay 特有约定；
   - 过拟合证据：机制依赖 quay 任务格式/目录布局/约定，换项目即失效或需大量定制；
3. meta-cc/archguard 冷启动的证据逐条记录到该容器（每次冷启动结果回写）。

## Acceptance Criteria

- [ ] AC1: 新战略文档存在——陈述「fast-mode 双层循环能否真跨项目迁移，还是过拟合 quay」+ 为什么
      重要 + 可迁移/过拟合判据
- [ ] AC2: 文档显式链接 meta-cc/archguard 冷启动为证据收集载体（不是孤立文档）
- [ ] AC3: 判据可判——「可迁移」与「过拟合」各有 ≥2 条具体、可测的证据形状（实跑输出贴任务体）
- [ ] AC4: 至少一条 meta-cc 或 archguard 冷启动的真实结果已记录到容器（非空，DIR-026 real-object）
- [ ] AC5: 与 superseded 路线图交叉引用（`gap-roadmap-silently-stale-...` 的 AC3 提取）
- [ ] AC6: 测试用 `node:test` 且带 `// @test-group governance`（若适用）

## Definition of Done

- [ ] AC1–AC6 全部勾上；AC3/AC4 的实跑输出逐字贴任务体
- [ ] 战略问题不再隐式散落——文档/任务显式承载，未来 outer/管理者可引用
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- docs/proposals/quay-harness-crystallization-roadmap.md（或替换文档）
- orchestration/FINDING-roadmap-predates-ADR-022-retirement-2026-08-05.md
- （meta-cc/archguard 冷启动的证据回写位置）

## Contract

measure   portability_evidence_count = `grep -c '^- \[' <战略文档> |` 已记录的可迁移/过拟合证据条目数字段
band      portability_evidence_count = ≥1（至少一条真实冷启动结果已记录，DIR-026）
invariant question_is_pinned = 1（文档陈述问题 + 判据，可被未来会话引用）
invoke    `cat <战略文档路径>`
control   判据可判（过拟合/可迁移各有 ≥2 条具体形状）；无真实证据不判方向
resume    文档与证据回写分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T02:0xZ
changed: 外层读调查全文后立案。三处收紧：
(1) **问题是战略层、不是缺陷**——「跨项目可迁移 vs 过拟合」是 fast-mode 机制本身的生死问题，
meta-cc 冷启动正在回答它，值得显式钉住而非隐式散落；
(2) **AC3 判据可判**——可迁移/过拟合各 ≥2 条具体形状，防止「会迁移」变成嘴上说；
(3) **AC4 要求真实证据**——至少一条 meta-cc/archguard 冷启动结果已记录，不能是空文档。
status: todo——人最关心的战略问题，排高优先（与 superseded 路线图任务并行）。

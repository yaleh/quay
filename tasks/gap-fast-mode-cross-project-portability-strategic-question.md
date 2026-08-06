---
id: gap-fast-mode-cross-project-portability-strategic-question
title: Phase 3's strategic question — is the fast-mode two-layer loop truly
  portable cross-project, or overfit to quay — is being answered ad-hoc via
  meta-cc cold-start with no written reference; pin it explicitly
status: done
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

- [x] AC1: 新战略文档存在——陈述「fast-mode 双层循环能否真跨项目迁移，还是过拟合 quay」+ 为什么
      重要 + 可迁移/过拟合判据
      → `docs/proposals/fast-mode-cross-project-portability.md`（§1 问题陈述、§2 为什么重要、
      §3 判据）
- [x] AC2: 文档显式链接 meta-cc/archguard 冷启动为证据收集容器（不是孤立文档）
      → 文档 §4「证据收集容器：meta-cc / archguard 冷启动」，每条冷启动结果回写为 `- [x]` 条目；
      §6 交叉引用冷启动规格 `orchestration/SPEC-cold-start-one-liner.md`
- [x] AC3: 判据可判——「可迁移」与「过拟合」各有 ≥2 条具体、可测的证据形状（实跑输出贴任务体）
      → 文档 §3.1 可迁移 P1/P2/P3（≥2）、§3.2 过拟合 O1/O2/O3（≥2），每条带「可测判据」；
      实跑输出见下「AC3/AC4 实跑输出」
- [x] AC4: 至少一条 meta-cc 或 archguard 冷启动的真实结果已记录到容器（非空，DIR-026 real-object）
      → 文档 §4 已录 7 条 `- [x]`（meta-cc 4 + archguard 3），含遥测 JSON、workflow 事件、
      config 实读、git 历史；CONTRACT measure `portability_evidence_count` = 7（band ≥1）
- [x] AC5: 与 superseded 路线图交叉引用（`gap-roadmap-silently-stale-...` 的 AC3 提取）
      → 文档 §6 引用 `docs/proposals/quay-harness-crystallization-roadmap.md`（SUPERSEDED）§6
      Phase 3 的战略问题转交；路线图自身也已交叉引用本任务（该任务 AC3 已提取）
- [x] AC6: 测试用 `node:test` 且带 `// @test-group governance`（若适用）
      → `plugin/test/portability-strategy-check.test.mjs`（`// @test-group governance`，
      实跑输出见下）

### AC3/AC4 实跑输出（2026-08-05，`gap-fast-mode-cross-project-portability-strategic-question`）

**CONTRACT measure（portability_evidence_count）** = 7（band ≥1；文档 §4 已录 7 条真实冷启动证据）：

```text
$ grep -c '^- \[' docs/proposals/fast-mode-cross-project-portability.md
7
```

**CONTRACT invoke（`cat <战略文档路径>` 头部）**：

```text
$ head -12 docs/proposals/fast-mode-cross-project-portability.md
# 战略文档：fast-mode 双层循环能否真正跨项目迁移，还是过拟合了 quay？

**日期**：2026-08-05
**性质**：战略问题钉住 + 证据收集容器（本文件不是路线图，无 AC/DoD——它是承载问题的容器；
任务体 `tasks/gap-fast-mode-cross-project-portability-strategic-question.md` 驱动本容器的执行与回写）
**关联**：
- 原路线图 Phase 3：`docs/proposals/quay-harness-crystallization-roadmap.md`（**SUPERSEDED by
  ADR-022 2026-08-03**；其 §6 把跨项目可迁移性战略问题转交本容器）
- 调查：`orchestration/FINDING-roadmap-predates-ADR-022-retirement-2026-08-05.md`
- 冷启动规格：`orchestration/SPEC-cold-start-one-liner.md`（安装/冷启动 8 步现状）
- 执行任务：`tasks/gap-fast-mode-cross-project-portability-strategic-question.md`
```

**meta-cc（Go 项目）真实冷启动结果**：

```text
$ cat /home/yale/work/meta-cc/.quay/config.yml | grep -A5 loop:
loop:
  repo_root: /home/yale/work/meta-cc
  test_command: go test ./...
  tmux_session: meta-cc-3
  worktree_root: /home/yale/work/meta-cc-worktrees

$ cat /home/yale/work/meta-cc/milestones/fast-mode-telemetry/2026-08-05.json
{"generatedAt":"2026-08-05T07:31:28.575Z","tasks":[
  {"taskId":"DIR-102","minutes":22.03865,"outcome":"done"},
  {"taskId":"DIR-103","minutes":12.021916666666666,"outcome":"needs-human"}], ...}

$ tail -1 /home/yale/work/meta-cc/.workflow-events/fm-DIR-102-1785803348909-jfvc26.jsonl
{"commandIdentity":"fast-mode-telemetry:task-end","eventKind":"end","executionCwd":"/home/yale/work/meta-cc","outcome":"done","taskId":"DIR-102",...}
```

**archguard（TypeScript 项目）真实冷启动结果**：

```text
$ grep -A4 'loop:' /home/yale/work/archguard/.quay/config.yml
loop:
  repo_root: /home/yale/work/archguard
  test_command: npx vitest run
  tmux_session: archguard-4
  worktree_root: /home/yale/work/archguard-worktrees

$ for f in /home/yale/work/archguard/.workflow-events/fm-*.jsonl; do tail -1 "$f" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('taskId'), d.get('eventKind'), d.get('outcome'))"; done
TASK-53 end done
TASK-54 end done
TASK-55 end done
TASK-56 end done
TASK-57 end done
TASK-58 end done
TASK-59 end done
TASK-60 start None
TASK-61 start None
```

**AC6 测试**（`plugin/test/portability-strategy-check.test.mjs`，`node:test` + `// @test-group governance`）：

```text
$ node --experimental-strip-types --test plugin/test/portability-strategy-check.test.mjs
✔ AC1/AC3/AC5: strategic doc pins the question, carries >=2 shapes per side, and cross-references the SUPERSEDED roadmap
✔ AC2/AC4: doc names meta-cc/archguard as the vehicle and records >=1 real cold-start result
✔ AC4 negative control: stripping all evidence entries makes the evidence audit go RED (empty container is caught)
✔ task AC boxes (this task's own file) reference the strategic doc path for invoke evidence
ℹ tests 4  ℹ pass 4  ℹ fail 0
```

## Definition of Done

- [ ] AC1–AC6 全部勾上；AC3/AC4 的实跑输出逐字贴任务体
- [ ] 战略问题不再隐式散落——文档/任务显式承载，未来 outer/管理者可引用
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches
- tasks/gap-fast-mode-cross-project-portability-strategic-question.md（自身文件：勾 AC + 贴 invoke 证据授权）

- docs/proposals/fast-mode-cross-project-portability.md（新增：战略问题钉住 + 证据收集容器）
- docs/proposals/quay-harness-crystallization-roadmap.md（交叉引用：SUPERSEDED 路线图 §6）
- orchestration/FINDING-roadmap-predates-ADR-022-retirement-2026-08-05.md（引用）
- plugin/test/portability-strategy-check.test.mjs（新增：AC1–AC5 机械检查，`// @test-group governance`）
- （meta-cc/archguard 冷启动的证据回写位置 = 容器 §4）

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

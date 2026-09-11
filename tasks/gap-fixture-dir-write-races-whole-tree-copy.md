---
id: gap-fixture-dir-write-races-whole-tree-copy
title: 测试往已签入的 fixtures 目录里建/删临时目录 —— 与任何整树拷贝并发即产生假红
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`plugin/test/workflow-replay.test.mjs` 在**已签入的** `plugin/fixtures/workflow-replay/` 内用 `fs.mkdirSync` / `fs.rmSync` 建删三个临时目录（`_tmp-bad-schema` / `_tmp-missing-field` / `_tmp-bad-class`，自 `plugin/test/workflow-replay.test.mjs:181` 起）。任何在同期做整树拷贝的调用者，会在 `cp` 对该目录 readdir 之后、stat 之前撞上刚被删掉的条目。

**已实测的受害者**：`test/cold-start-oneliner-e2e.sh` 的 `cp -r "$PLUGIN_SRC" "$QUAY_DEV/plugin"`。**受害者一侧的一半已经修掉**（任务 `gap-promotion-admission-reads-goal-layer-field`，commit `fc67bfd06`：把 `--count-inputs` 的 mode 分派上移到任何文件系统动作之前，因为该 measure 只读一个静态数组、本就不需要文件系统动作）——但那只是让 `--count-inputs` 这一条路径不再做拷贝，**根因仍在**。

**实测读数（判别性对照）**：并发臂（e2e × 400 与 workflow-replay × 40 同时跑）失败 **2/400**，报错逐字节等于 suite 日志里的 `cp: cannot stat '<worktree>/plugin/fixtures/workflow-replay/_tmp-bad-schema': No such file or directory`；单跑臂（e2e × 25，无并发）失败 **0/25**。⇒ 失败依赖「并发」这个自变量，不是环境噪声。独立佐证：`.quay/worker-driver.log:48502` 记录了任务 `gap-goal-driver-gap-semantic-filing-ring` 的 worker 在同一形状上撞到同一失败、得出同一根因。

**为什么这是缺陷（而不是"测试写得随意"）**：一个测试**修改仓库树**，而仓库树同时是别的测试与工具的输入——共享可变状态。更贵的一点是：失败**落在受害者身上**（`cp` 报错、受害测试变红），不落在施害者身上 ⇒ 归因成本高，本仓库已因此烧掉至少两轮 fan-in（两次都被误判为"任务自己的 delta 有问题"，需实跑复现才能排除）。

**残留暴露面**：任何做整树拷贝的调用者——FULL 模式的 e2e（`--plugin-src` / `--from-build`）、未来的打包/发布步骤、任何"对检出做快照"的工具。

## Plan

1. **先取证再改**：读 `runWorkflowReplay` 的路径解析，判定它是否依赖「fixture 目录位于 `FIXTURES_DIR` 之内」。判定结果写进 Evidence，⛔ 不预设。
2. 把那三个临时目录从**已签入路径**移出，改用进程私有临时目录（如 `fs.mkdtempSync(path.join(os.tmpdir(), ...))`）。若第 1 步证明 `runWorkflowReplay` 依赖相对位置，则改为「把该用例需要的文件复制进私有临时目录」而不是移动它，并说明理由。
3. 加一条**能取假**的防回退判据：断言 `plugin/test/**` 不在已签入路径下创建条目。须为**位置判定**（硬规则 2，不看关键词），且「读不懂输入」必须有独立取值、不与合格同形（硬规则 3b）。
4. 若第 3 步落地为脚本，登记进 `plugin/scripts/capability-catalog.sh`（唯一清单），并读它自报的 `summary: N scripts` 确认 +1。

## Acceptance Criteria

- [ ] AC1 **取证**：贴出 `runWorkflowReplay` 路径解析的实际代码片段与结论——它是否依赖 fixtures 根？两种结论都可接受，但必须由读码得出，⛔ 不得推测。
- [ ] AC2 **位置判定**：三个临时目录不再创建于任何已签入路径下。判据 = 跑 `plugin/test/workflow-replay.test.mjs` 前后 `git status --porcelain` 均为空（**不是** grep `_tmp-` 关键词）。
- [ ] AC3 **判别性对照**：以本任务 Proposal 记录的复现口径（与 `test/cold-start-oneliner-e2e.sh` 的整树拷贝并发跑）两臂各贴读数：修复后 0 失败；且须证明该口径**能**取假（修复前的同一复现读数，或把临时目录人为放回后在同样并发下可复现 ≥1 失败）。只给修复后的 0 不构成证据。
- [ ] AC4 防回退判据存在且**能取假**：注入一个在 `plugin/fixtures/` 下 `mkdir` 的夹具 ⇒ 判据红；未注入 ⇒ 绿；输入读不懂 ⇒ 独立取值。三种取值各贴一条真实输出。
- [ ] AC5 原语义不回退：`plugin/test/workflow-replay.test.mjs` 全绿（贴 tests/pass/fail 三行）。

## Definition of Done

- [ ] AC1–AC5 全绿，Evidence 里每条都贴**真实读数**（退出码/计数/原文），⛔ 不贴"预期值"。
- [ ] ⛔ **不得用「给 `cp` 加重试」或「让 `cp` 忽略错误」作为替代修法**——那会把一次真实的树变更静默吞掉（硬规则 3b：读不懂输入不得返回与合格同形的值）。
- [ ] ⛔ **不得靠改 `test/cold-start-oneliner-e2e.sh` 去迁就**：受害者侧已经改过一次（见 Proposal），再改就是把责任继续留在受害者身上；修的是施害者（谁写了仓库树）。
- [ ] 未来边界写进代码注释或判据文档（一条不变式）：**测试不得在已签入路径下创建或删除条目；一切临时产物落在进程私有临时目录。**

## Touches

- plugin/test/workflow-replay.test.mjs
- tasks/gap-fixture-dir-write-races-whole-tree-copy.md

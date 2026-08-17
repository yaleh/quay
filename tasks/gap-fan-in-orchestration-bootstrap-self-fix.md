---
id: gap-fan-in-orchestration-bootstrap-self-fix
title: "fan-in 编排自举缺口：改 fan-in 编排文件的任务，其 fan-in 必用主检出旧版脚本，自己的修复永远不被自己验证（结构性暴露 8 次 / 可观察错判 1 次）"
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：outer 2026-08-17 01:43Z 发现（delta-scope 复现实证）+ manager 独立核实 + 裁定（准立案，低优先级，**不阻塞 delta-scope 落地**）。

**问题**：fan-in 编排管线的脚本（`.claude/workflows/fan-in-execute.js` 等）以 scriptPath 从**主检出**调用（inner cwd=/home/yale/work/quay，非 worktree）。当一个任务自己修改 fan-in 编排文件（如 delta-scope 改 fan-in-execute.js + select-static-checks-for-touches.ts），其 fan-in 运行时用的是主检出的**未含自己修复**的旧版脚本 ⇒ **修工具的任务无法用自己的修复被验证**（bootstrap/自引用）。

**实证（delta-scope，2026-08-17 01:31:23）**：delta-scope 的 fan-in 被旧逻辑判 `doc-only-delta`（fullSuiteRan=false, durationMs=9）跳过全量——而分支实际改的 4 个代码文件（.claude/workflows/fan-in-execute.js、plugin/scripts/select-static-checks-for-touches.ts、plugin/test/fan-in-execute-paths.test.mjs、plugin/workflows/fan-in-execute.js）对旧逻辑不可见（旧 step2 `git diff fork ${mergeTarget}` 只看 develop 侧）。**负对照（分支数据实测）**：旧逻辑看 `fork..develop`=空 ⇒ 判 doc-only；分支新逻辑 `select-static-checks --classify-delta` 对同一 delta 返回 4 个代码文件 ⇒ 会判需全量。⇒ **修法本身正确，只是跑 fan-in 的脚本是主检出旧版**（52cc982b 在分支未 merge）。AC97 那个洞在 delta-scope 自己的 fan-in 上复发，且修复无法验证自己。

**⚠️ 发生率两个数，别只写一个（manager 硬规则 12b 补层，未采信 outer 的 n=1，直接查的代码）**：
- **结构性暴露 = 8**：历史上改 `.claude/workflows/fan-in-execute.js` 的提交 = 8（62f44395/409388a0/57825d11/d645c1f9/a822345a/3159cf32/5e54bb37/d4d225cd）——这 8 个提交都踩在同一个自举结构下（自己的 fan-in 用不到自己的修复），只是未被观察到。
- **可观察错判 = 1**：只有 delta-scope 这次显形，因为只有它恰好在修 classify-delta 自己的判定逻辑；其余 7 个改的是别的段落（telemetry bracket / anti-drift 接入 / AC 完成闸 / full-suite-runner 入账…），不影响"旧脚本怎么判自己的 delta"，所以没触发同一种错判。
- **⛔ 8 ≠ "同一 bug 发生过 8 次"**：8 = "暴露在同一自举结构下的次数"，1 = "真被这个结构坑过的次数"。写进 AC/DoD 时两个数都要有。

**⊢ 范围（manager 建议，写进本任务）**：⛔ 不得只锁定 `fan-in-execute.js` 和 `select-static-checks-for-touches.ts` 两个文件——它对**任何构成 fan-in 编排本身的文件**都成立（`fan-in-ff-merge.sh`、`per-task-suite-record.ts`、`full-suite-runner.ts` 若也从主检出路径调用而非 worktree）。**范围定义 = 「fan-in 编排管线自身的文件集合」**，不列举当前踩到的这两个——否则下一个改 `full-suite-runner.ts` 的任务撞同一墙时会被当新发现，而非同类已知问题的第 2 例。

**⊢ 自愈半边（manager 认但要求写清）**：delta-scope 落地后新逻辑对后续 fan-in 生效 ⇒ **自愈的是「delta-scope 这次的具体 bug」**；**不自愈的是「下一个改 fan-in 编排文件的任务仍然用不到自己的修复」这个结构本身**。⛔ 别让「自愈一半」被读成「问题解决了大半」。

**⊢ 同族形态参考区（manager 2026-08-17 认，不另立案）**：**拆分出「推迟的后继」时用 sibling + depends_on，不用 parent-child**——parent-child 的 done-iff-children 语义与「推迟的后继」天然冲突（父不能 done ⇒ 恒在飞 ⇒ 子若 Touches 目录级自锁则恒被锁 ⇒ 死锁）。实例：gap-fan-in-delta-scope-inventory-annotate 对 delta-scope 只有 depends_on 无 parent（有意的，见其任务体「为什么是 sibling 不是 child」）。

## Acceptance Criteria

- [x] AC1: **枚举 fan-in 编排管线自身文件的完整集合**（从主检出路径调用、非 worktree 解析）——至少含 fan-in-execute.js、select-static-checks-for-touches.ts、fan-in-ff-merge.sh、per-task-suite-record.ts、full-suite-runner.ts，逐一确认调用路径来源，产出清单（文件:行 + 调用来源）。
- [x] AC2: **修法**——fan-in 编排文件的调用改为从**任务 worktree 解析**；或在 fan-in 启动时检测「任务 Touches 含编排文件自身」⇒ 强制用 worktree 版执行。取假一：构造一个改 fan-in-execute.js 的任务，其 fan-in 必须用【含该任务修改】的版本跑（step2 判定反映分支代码）。取假二：旧版判 doc-only、worktree 版判 code，两条路径可区分（负对照）。
- [x] AC3: 修法后，改 fan-in 编排文件的任务其 fan-in 的 step2 判定基于 worktree 版脚本；且对 AC1 枚举集合中每个文件验证同一调用路径来源（范围整体生效，不是只堵一处）。
- [x] AC4: 本任务的 DoD 引用结构性暴露 8 / 可观察错判 1 两个数（⛔ 不只写一个）；修法落地后，可观察错判发生率为 0（改编排文件的任务不再有 doc-only 误跳过）。

## Definition of Done

- [x] 改 fan-in 编排文件的任务，其 fan-in 用 worktree 版脚本执行；结构性自举缺口关闭；结构性暴露 8 / 可观察错判 1 两个数都在任务体留档。

## Evidence

**AC1 — 枚举 + 调用路径来源（文件:行 + 调用来源）**

| 文件 | 调用来源（修前） | 修法 |
|---|---|---|
| `.claude/workflows/fan-in-execute.js` | 内层 A6 派发 `Workflow({scriptPath:'<repo>/.claude/workflows/fan-in-execute.js'})`，`plugin/loop/fast-mode-tick-core.md:41` / `orchestration/fast-mode-tick-core.md:27`；basename 由 `fan-in-workflow-check.ts` 判据2(a) 核对 | A6 派发规则：`--bootstrap-orchestration` 命中 ⇒ scriptPath 用 `<worktree>/.claude/workflows/fan-in-execute.js`（worktree 版） |
| `plugin/workflows/fan-in-execute.js` | 双拷贝镜像（`workflows-dual-copy-drift-check.ts`），quay-init 铺装目标；必须与 `.claude/` 逐字节一致 | 同步（已 `cp`，byte-identical 保持） |
| `plugin/scripts/select-static-checks-for-touches.ts` | fan-in-execute.js step 2 `node ... --classify-delta $delta`，**cwd 依赖**（subagent 会话 cwd，非显式 worktree） | `${worktree}/plugin/scripts/... --classify-delta --root ${worktree}`（脚本与 registry 都从 worktree 解析）；新增 `--bootstrap-orchestration` 检测机件 |
| `plugin/scripts/fan-in-ff-merge.sh` | fan-in-execute.js step 5 `bash ${root}/plugin/scripts/fan-in-ff-merge.sh --root ${root}` | `bash ${worktree}/plugin/scripts/fan-in-ff-merge.sh --root ${root}`（脚本逻辑从 worktree，操作对象仍 root） |
| `plugin/scripts/per-task-suite-record.ts` | fan-in-execute.js step 4.5 `node ... plugin/scripts/per-task-suite-record.ts`，**cwd 依赖** | `${worktree}/plugin/scripts/...`（记录文件经 git common-dir 仍写主检出） |
| `plugin/scripts/full-suite-runner.ts` | fan-in-execute.js step 4 `cd ${worktree} && bash scripts/test.sh`（**已 worktree 解析**，经 test.sh 调用） | 确认无需改；`cd ${worktree} &&` 显式保留 |

另确认同为 fan-in 调用面、同样改为 `${worktree}` 解析（超出枚举 5 件但同属 fan-in 编排管线自身）：`anti-drift-touches-check.ts`（step 1）、`fan-in-ts-typecheck-gate.ts`（step 3）、`fan-in-ac-completion-gate.ts`（step 5，新增 `--worktree ${worktree}`）、`closure-lag-check.sh`（step 5.5）。

**AC2 — 修法 + 取假**

- 修法两半：① **派发侧**——A6 规则命中（分支改编排文件）⇒ scriptPath 用 worktree 版 fan-in-execute.js（step 2 判定逻辑来自分支自己的修复）；② **workflow 内**——step 0 自举检查（`--bootstrap-orchestration`）echo `FAN-IN-BOOTSTRAP=hit/miss` + 运行 workflow 与 worktree 版不一致时 WARN；每个编排脚本调用显式 `${worktree}` 前缀（不再 cwd 依赖 / `${root}`）。
- 取假一（`plugin/test/fan-in-execute-paths.test.mjs` ⑦）：分支改 `.claude/workflows/fan-in-execute.js` ⇒ step-0 判 hit + WARN（root 版 ≠ worktree 版）——若 A6 未用 worktree scriptPath，缺口在运行时可见。
- 取假二（⑦ + 既有 ① AC2 取假二）：旧手写 `[.]md$` 正则把 `orchestration/manager-tick-core.md` 判 doc ⇒ 跳全量；worktree 版 registry 判定判 code。测试断言改编排文件的分支其 step-2 对该 .md 输出 code。

**AC3 — 范围整体生效**

- `⑦ worktree-resolution` 测试断言 prompt 中每个 fan-in 编排脚本调用都是 `${worktree}/plugin/scripts/...`（7 处：step 1/2/3/4.5/5×2/5.5），classify 带 `--root ${worktree}`，step 4 `cd ${worktree} && bash scripts/test.sh` 保留。枚举集合 + 同面 4 件全部覆盖，非只堵 fan-in-execute.js 一处。

**AC4 — 两个数 + 发生率**

- 结构性暴露 8 / 可观察错判 1 两个数都在本任务 Proposal 留档（manager 硬规则 12b，`git rev-list --count` 可复算：62f44395/409388a0/57825d11/d645c1f9/a822345a/3159cf32/5e54bb37/d4d225cd）。
- 修法落地后：改 fan-in 编排文件的任务其 fan-in 用 worktree 版执行，doc-only 误跳过发生率归零（结构性关闭，非仅本例）。

## Touches

- .claude/workflows/fan-in-execute.js（改 worktree 解析 + step 0 自举检查）
- plugin/workflows/fan-in-execute.js（双拷贝镜像，同步）
- plugin/scripts/select-static-checks-for-touches.ts（补 --bootstrap-orchestration 机件；classify 改 worktree 解析）
- plugin/scripts/fan-in-ff-merge.sh（同源确认）
- plugin/scripts/per-task-suite-record.ts（同源确认）
- plugin/scripts/full-suite-runner.ts（同源确认）
- plugin/test/fan-in-execute-paths.test.mjs（取假对照 ⑦ 组 + 运行时树 symlink）
- plugin/loop/fast-mode-tick-core.md（A6 派发自举规则）
- orchestration/fast-mode-tick-core.md（A6 派发自举规则）
- tasks/gap-fan-in-orchestration-bootstrap-self-fix.md（自身）

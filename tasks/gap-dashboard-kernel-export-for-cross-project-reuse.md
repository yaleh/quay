---
id: gap-dashboard-kernel-export-for-cross-project-reuse
title: 发布 Loop-pulse 甘特图内核（packLanes/区间合并/5 车道语义）为外部项目可复用的 dashboard-kernel
  子路径——claudecodeui 是首个待接入方
status: done
labels:
  - gap
  - design
  - cross-project
parent: null
children: []
extra: {}
---
## Proposal

<!-- dedup-ref -->
**去重（按机制，非症状，立案时实测）**：`task list --search` 对 `gantt`/`packLanes`/`kernel`/`export kernel`/`publish`/`reusable`/`consume`/`npm package`/`shared kernel`/`cross-project`/`CloudCLI`/`claudecodeui`/`live-inflight` 逐一检索（含 todo/ready 态单独过滤），命中的全部是症状相邻但机制不同的任务：
- `gap-dashboard-live-swimlane-fixed-lane-gantt-timeline`（done）——实现了 dashboard 自己的 5 泳道甘特图，是**消费方**，不是导出方。
- `gap-no-readonly-surface-for-live-inflight-workers`（done）——解决的是"在飞任务**数据**读不到"（已新增 `quay driver live --json`），不是"**装箱/渲染算法**能不能被外部复用"。
- `gap-webui-tests-page-missing-rounds-timeline-bar`（done）——`renderTimelineBarSvg` 已 export 却只被 dashboard 消费，但那是**quay 自己的 `/tests` 页**没调用已导出的函数，不是面向外部项目的发布面问题。
- `gap-ready-check-duplicated-algorithm-store-vs-ready-pool-check`（done）——"算法有两份实现"的机制是 quay 自己内部的 `store.ts`/`ready-pool-check.ts`，与本任务"要不要把一份实现发布给外部消费"无关。

没有任何任务认领"把 `packLanes`/区间合并算法发布成外部项目可依赖的稳定 API 面"这个具体机制。本任务不重复。

**上下文（跨项目，来自消费方已完成的设计记录）**：claudecodeui（`/data/home/yale/work/claudecodeui`）的 Quay tab 想要镶嵌一份与 quay 自己 dashboard "Loop pulse" 卡语义一致的 5 车道在飞任务甘特图，而不是一个信息量打折的列表替代品。该项目已经：

1. 验证了数据侧阻碍已解除：`quay driver live --kind worker --json --root <path>`（本任务上面提到的 `gap-no-readonly-surface-for-live-inflight-workers` 产出）在 claudecodeui 自己的工作区上实测可用,返回真实的在飞任务区间数据（`taskId`/`startedAtMs`/`phase`/... ）。
2. 写了一份完整的消费侧设计记录（claudecodeui 任务 `gap-quay-tab-loop-pulse-gantt-cross-project-interface-design`，status: done），把甘特图必须保留的语义逐条列清楚（见下），并明确提出两条实现路径,倾向 **路径 A：请 quay 发布可复用 kernel**，而非在 claudecodeui 里重新写一份算法。
3. claudecodeui 当前**零 quay npm 依赖**（只经 CLI 子进程调用），本任务若做成，会是 claudecodeui 第一条真实的 quay 包依赖。

**现状（已读源码核实）**：`packages/quay/src/serve-dashboard.ts` 里 `export const FIXED_GANTT_LANES = 5`、`export function packLanes(intervals, maxLanes)`、`export function renderLiveGanttSvg(...)` 已经是模块级 `export`，但：
- 这个文件只在 quay 自己的 `dist/quay.js`（单文件 CLI 打包产物）里被引用，`packages/quay` 的 `package.json` 的 `exports`/`main` 字段**没有**任何指向这个文件或其中函数的发布面——外部项目即便 `npm install quay` 也 import 不到它们。
- `packLanes`（排序 + 贪心装箱，纯函数，入参是区间数组，出参是车道分配 + overflow 计数）与 `renderLiveGanttSvg`（纯 SVG 字符串模板拼接，内嵌 `var(--color-*)` CSS 自定义属性、`fillLabel`/i18n 文案）两者**依赖层级不同**：前者零 DOM/SVG 依赖，后者耦合了 quay 自己 dashboard 的视觉系统（CSS 变量命名、配色 token），外部消费者大概率要用自己的组件库重新渲染（claudecodeui 是 React + Tailwind + dark mode，不会直接吃一段裸 SVG 字符串模板）。

## 必须保留的语义（消费方设计记录逐条列过，此处是权威来源，供实现时对照，不要凭记忆简化）

| 语义 | 源码位置 | 说明 |
|---|---|---|
| 固定 5 车道 | `FIXED_GANTT_LANES = 5` | 不是消费方可配置项，是 dashboard 的既定视觉契约 |
| 贪心区间装箱 | `packLanes(intervals, maxLanes)` | 按 `startMs` 排序，分配给最早释放的车道；超过 5 条并发时计入 `overflow`，不丢弃数据 |
| 历史+在飞合并 | `mergeLiveAndHistoryIntervals(liveInFlight, historyRecords, windowStart, now)` | 当前在飞（`driver live` 的 `inFlight`）与近期完成记录（`worker-outcome.jsonl`）合并进同一时间窗口 |
| 时间窗口可切换 | dashboard 路由的 `?hours=` 参数，1/3/6/12，默认 3 | 改变窗口即重新过滤两类记录源，不是纯前端视觉缩放 |
| 按 phase/outcome 着色 | `ganttIntervalColorVar(iv)` | `implementing`/`fan-in`/`landed`/`awaiting-land` 四在飞态 + `failed`/`killed`/`timed-out`/`exited-not-landed`/`completed` 历史终态,各自固定色值 token |
| hover tooltip | `<title>{taskId · state · duration · start→end}</title>` | 原生 tooltip,内容格式固定 |

## Plan

1. **拆分依赖层级，只发布纯函数那一半**：新建 `packages/quay/src/dashboard-kernel.ts`（或等价位置，由实现者按现有模块划分惯例定），把 `FIXED_GANTT_LANES`、`packLanes`、`mergeLiveAndHistoryIntervals`、区间/状态相关的 TypeScript 类型（`LiveInterval`、`PackedLane`、`IntervalPhase`/`FinalState` 枚举）从 `serve-dashboard.ts` 迁过去（纯函数+类型，零 DOM/SVG/i18n 依赖）。`serve-dashboard.ts` 改为 import 这个新模块，不得产生第二份算法实现（`serve-dashboard.ts` 自己的行为不得变化，既有 dashboard 测试必须继续绿）。
2. **发布面**：`packages/quay/package.json` 的 `exports` 字段新增一条子路径（如 `"./dashboard-kernel": "./dist/dashboard-kernel.js"`，具体路径名由实现者按包内既有子路径发布惯例定），使外部项目可以 `import { packLanes, mergeLiveAndHistoryIntervals, FIXED_GANTT_LANES } from "quay/dashboard-kernel"`（或该包实际发布名）。颜色 token（`ganttIntervalColorVar`）**不**跟着发布——那是 quay 自己 dashboard 的 CSS 变量体系，外部消费者（claudecodeui 是 Tailwind + 自己的 dark/light token）需要自己把 `phase`/`finalState` 映射到自己的配色，本任务只发布"该用什么状态值"的类型/枚举，不发布"状态值对应什么颜色"。
3. **版本/发布策略**：这是 quay 包的**第一次**面向外部消费者的公开 API 承诺（之前所有导出要么是 CLI 内部用，要么是未声明的模块级 export）。需要：
   - 把这个子路径的类型签名当作需要 semver 纪律的公开契约——改变 `packLanes`/`mergeLiveAndHistoryIntervals` 的入参/出参形状是 breaking change，要走 major（或该包目前的版本纪律约定的等价升级），不能像内部函数一样随便改。
   - 在包的 README/CHANGELOG（或该包现有的面向使用者的文档位置）里新增一节，说明这个子路径的用途、稳定性承诺范围、谁在用（至少记录 claudecodeui 是首个已知消费者）。
4. **跨项目一致性测试（两侧都要，缺一不可）**：
   - **quay 侧**：`packages/quay/test/dashboard-kernel.test.mjs`（或等价位置），对 `packLanes`/`mergeLiveAndHistoryIntervals` 的公开行为做窄测试（装箱顺序、overflow 计数、历史+在飞合并的时间窗口过滤），作为该子路径契约的回归锚点。
   - **留给消费方的等价性钩子**：发布一份固定的测试向量（fixture：一组输入区间 + 期望的车道分配/overflow 输出，JSON 格式，版本化），供 claudecodeui（或任何外部消费者）在自己仓库里喂给"自己的渲染层 + 这个导出的 `packLanes`"做集成测试，断言拿到的车道分配与这份向量一致——这不是本任务要在 claudecodeui 里实现的（那是 claudecodeui 自己的后续集成任务),但本任务要**产出**这份向量文件并说明它的用途，否则消费方没有办法验证"我真的吃到了同一个算法"。
5. **不做的事（明确排除，防止范围蔓延）**：不发布 `renderLiveGanttSvg`（SVG 字符串模板，与 quay 自己视觉系统耦合，不是可直接复用的候选，见上）；不改变 `serve-dashboard.ts` 对外的 HTTP 行为；不在本任务里实现 claudecodeui 侧的 React/SVG 组件（那是 claudecodeui 自己的后续任务,由其自行立案并引用本任务的发布版本号）。

## AC

- [x] AC1 `packLanes`/`mergeLiveAndHistoryIntervals`/`FIXED_GANTT_LANES`/相关类型从 `dashboard-kernel` 子路径可被一个**真实的外部 import**拿到——判据：在 `packages/quay` 之外（例如一个临时的 `/tmp` 测试项目，或包测试里模拟外部消费场景）`npm install` 该包的本地构建产物后 `import { packLanes } from '<package>/dashboard-kernel'` 成功，而不是只在包内部 import 成功（包内部 import 不能证明发布面真的暴露了）。
- [x] AC2 `serve-dashboard.ts` 改为消费新模块后，既有 dashboard 测试（`gap-dashboard-live-swimlane-fixed-lane-gantt-timeline`/`gap-dashboard-gantt-runid-dedup-collapses-driver-round-shared-id` 等任务锁定的既有判据）逐字不回归——跑一遍相关现有测试文件，退出码 0，且输出数量/内容与改动前一致。
- [x] AC3 新增的 `dashboard-kernel` 窄测试覆盖：装箱顺序（多个重叠区间按 `startMs` 排序分配车道）、超 5 车道的 `overflow` 计数、`mergeLiveAndHistoryIntervals` 对时间窗口边界的过滤（窗口外的历史记录不出现）。
- [x] AC4 跨项目等价性测试向量文件已产出（版本化 JSON，输入区间 + 期望输出），并在任务体/README 里说明文件路径与用途。
- [x] AC5 `exports` 子路径的 semver/稳定性承诺已写进包文档，且记录 claudecodeui 为已知消费者。
- [x] 本任务其余机械判据（typecheck/lint/既有测试不回归）按本仓库既有惯例执行，具体命令由实现者按 `packages/quay` 当前的脚本配置选定（不要凭记忆照抄其他仓库的命令字面量）。

## DoD

- 真实验证：在一个独立于 `packages/quay` 源码树之外的临时目录，`npm install` 本次构建产出的包，真实 `import` 该子路径并调用 `packLanes` 处理一组真实区间（例如从 `quay driver live --json` 的真实输出转换而来），得到正确的车道分配——不是只在包自己的测试里 import 自己。
- `serve-dashboard.ts` 的既有行为（dashboard "Loop pulse" 卡的渲染）用真实 `quay serve` 实例人工核对一次，确认重构后外观与数据未变。
- claudecodeui 一侧的后续集成任务（届时新建）能够引用本任务产出的包版本号 + 等价性测试向量文件路径，而不需要重新调查"这个函数到底能不能被拿到"。

## Touches

- packages/quay/src/dashboard-kernel.ts (new)
- packages/quay/src/dashboard-kernel-vectors.json (new)
- packages/quay/src/serve-dashboard.ts
- packages/quay/scripts/build-dist.mjs
- packages/quay/package.json
- packages/quay/test/dashboard-kernel.test.mjs (new)
- packages/quay/test/package-json-bin.test.mjs
- packages/quay/README.md
- tasks/gap-dashboard-kernel-export-for-cross-project-reuse.md (self-touch)

## Notes（给评审/promote 该任务到 ready 的人）

这是 quay 第一次要对外发布一个"稳定 API"承诺，不是常规内部重构——建议在 promote 到 ready 之前由人工/高优先级会话过一遍"是否真的要在此刻承诺这个发布面、子路径命名是否符合包现有发布惯例"，而不是直接丢给机械 worker 循环自动摘取。消费方（claudecodeui）那边已经把需求和语义讲得很完整（见上文引用的两份设计记录），本任务卡住的只是"quay 这边要不要/怎么发布"这个产品判断。


## Update（status 被机械流程拽回 ready，已核实并退回 todo）

本任务创建后约 21 秒（`updatedAt` 从创建时的 2026-10-09T05:46:56 变为 05:47:17），status 被从 `todo` 改成了 `ready`——`gate-log` 对本任务为空数组，即这次变更**没有**经过正常的 `lifecycle_promote` 判据流程，像是某个机械的 pool/ready 质量巡检（例如按结构完整性自动判定 ready 的那一类）直接写的状态，而不是任何人/会话对"quay 现在要不要承诺这个外部发布面"做过实质评审。

与此同时，quay 工作区里一个以架构审查为职责的常驻会话（`Quay 架构审查与 ArchGuard 能力评估`）收到本任务的协调消息后回复：明确表示不会在它的会话里做这个 `exports`/API 决定——它的人类把它限定在 GOAL-033（core-root⇄cli）这一个重构切片，"不碰无关的 todo" 是其人类的明确指示，且认为首次公开 `exports` 子路径承诺本就该是人类的产品判断，会把本任务汇报给其人类。

两边（我方 + 该架构审查会话）独立得出同一个结论：本任务需要人工评审才能进入可执行状态。机械流程把它拽成 `ready` 并不代表这次评审已经发生——`ready` 在 quay 的机械 worker 循环里意味着"随时可能被派发实现"，这正是我们都想避免的（一个没人真正拍板过的公开 API 面被自动摘取实现）。因此把 status 退回 `todo`，并把这个退回理由和下面的架构笔记一起写进任务体，供真正评审时参考；不删除、不改写上面已有的设计内容。

**架构笔记（来自该架构审查会话，非绑定，供最终实现者参考）**：`packages/quay/src/serve-dashboard.ts` 目前是正在被该会话收缩的同一个包级 SCC（强连通分量）里的根级文件；如果真的要抽出纯函数那一半（`packLanes`/`mergeLiveAndHistoryIntervals`），应该把它做成一个**零 import 的叶子模块**（不 import `serve-render`/`serve-i18n` 等渲染/文案层），参照本仓库已有的 `packages/quay/src/kernel/*.ts` 与 `driver-vocab.ts` 的写法——这样发布出去的面才不会把 web 层的传递依赖图拖进消费方（claudecodeui 不需要也不应该因为引入这个 kernel 子路径就连带拉进 quay dashboard 的渲染/i18n 依赖）。

## Evidence（实现记录，2026-10-09）

- **AC1 的硬发现（实测，非假设）**：把子路径指向 `./src/dashboard-kernel.ts` 在**外部真实安装**下必然失败——Node 拒绝对 `node_modules` 下的文件做类型擦除（`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`）。仓内既有四个子路径能指向 `.ts`，只因为 npm workspaces 把包**符号链接**了（realpath 落在 node_modules 之外）；`npm install` 的产物是 node_modules 里的真实目录。故本子路径 runtime 目标是**构建产物** `dist/dashboard-kernel.js`，`exports` 用 `types` 条件把类型指回 `.ts`。`build-dist.mjs` 新增该输出（`package.sh` 的构建步骤一并产出）。
- AC1 判据（`packages/quay/test/dashboard-kernel.test.mjs`）：真 `npm pack` 本包 → `npm install` 进 `/tmp` 下的独立 consumer → 裸 `import ... from "quay/dashboard-kernel"` → 断言解析到 `node_modules/quay/dist/dashboard-kernel.js` 且调用结果正确。9/9 绿。
- AC2 判据：`serve-dashboard.test.mjs` 本任务未改动（`serve-dashboard.ts` 以 re-export 保持旧导入面）；`serve-dashboard.test.mjs + gap-dashboard-*.test.mjs + build-dist.test.mjs + build-dist-smoke.test.mjs + package-json-bin.test.mjs + dashboard-kernel.test.mjs` 共 174 tests / 0 fail；`npm-pack-e2e.test.mjs`（真 `package.sh`）11/11 绿；`npx tsc --noEmit` 退出 0。
- AC4 向量：`packages/quay/src/dashboard-kernel-vectors.json`（随包发布，亦可经 `quay/dashboard-kernel/vectors` 解析），3 条向量覆盖顺序装箱 / 超载 overflow / 窗口过滤+跨源去重，由 `AC4:` 测试逐条回放。
- AC5 文档：`packages/quay/README.md` § "Public API: `quay/dashboard-kernel`"（用途、明确非目标、semver 承诺、已知消费者 claudecodeui）。
- 实现提交：分支 `task/gap-dashboard-kernel-export-for-cross-project-reuse`，见本任务 worktree 的 `feat(quay): publish the gantt packing kernel as quay/dashboard-kernel`。

## 独立复核 + 契约加固（2026-10-09，后续会话）

**复核结论：本任务已在 `develop` 落地且可复现**（不是"done 未落地"中间态）。独立取证：

- 实现提交 `2a894daf4` 同时在 `develop` 与 `author`（`git merge-base --is-ancestor` 双绿）；任务 worktree/branch 已清理。
- `packages/quay/test/dashboard-kernel.test.mjs` **9/9 绿**——含真 `npm pack` → `npm install` 到 `/tmp` 独立 consumer → 裸 `import ... from "quay/dashboard-kernel"`，断言解析到 `node_modules/quay/dist/dashboard-kernel.js`。
- 既有面不回归：`serve-dashboard.test.mjs` + `package-json-bin.test.mjs` **17/17 绿**；worktree 内 `npx tsc --noEmit` 退出 0。
- **差异执行复核（本次新增的最强证据）**：从 `2a894daf4^` 抽出重构前的 `mergeLiveAndHistoryIntervals` / `packLanes`（esbuild 转译），与新模块做差分 fuzz——**410 个用例**（含 9 个对抗边界：NaN 起始 / 未来起始 / 窗口端点 / `end < start` / 跨源去重）+ **2904 条真实 `worker-outcome.jsonl` 记录**，`maxLanes ∈ {默认, 5, 1, 3, 100}`，**0 处不一致**。「serve-dashboard 行为不变」由此实测坐实，而非仅靠既有测试。

**契约加固（3 处面向消费方的缺口，均已修）**——分支 `task/gap-dashboard-kernel-export-for-cross-project-reuse`，提交 `d1e3464ed`（doc/comment only；26/26 绿 + tsc 0）：

1. `packLanes` 把超出 `FIXED_GANTT_LANES` 的区间从 `lanes` 中**剔除**并计入 `overflow`；画 "+N more" 徽章的渲染器属于 Core 且**未发布** ⇒ 只渲染 `lanes` 的消费方会**静默丢数据**。README 已写明该义务（求和不变式本身已由 AC3 测试钉住）。
2. `quay/dashboard-kernel/vectors` 是 JSON，Node 要求 `with { type: "json" }` 导入属性；缺失即 `ERR_IMPORT_ATTRIBUTE_MISSING`（对真实外部安装实测）。README 已补该写法。
3. `dashboard-kernel.ts` 原注释称与 `FIXED_DISPATCH_CAP` "never drift apart"——该常量实读 `drivers.yml` 的 `worker.cap`（可覆盖），本字面量无法跟随，且无任何检查断言二者相等。已改为陈述真实关系：默认相等，cap 提高时 5 车道不变、超出部分由 `overflow` 如实呈现。

**未落地**：`d1e3464ed` 目前只在任务分支上（`develop` 由循环持有），是否合入由人工/驱动决定。

**剩余依赖**：claudecodeui 侧集成尚未开始（其 Quay tab 消费本 kernel + 等价性测试向量），需与该会话协调。

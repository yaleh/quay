---
id: gap-dashboard-fanin-timestamp-timeline-anchor
title: Dashboard Fan-in 卡补时间戳 + 测试/Fan-in 分段时间轴 bar 窗口终点锚定到最后一次事件结束时刻（而非
  wall-clock now）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
> **RETREATED / 搁置（独立重跑 gap-dashboard-fanin-panel-and-timeline-bars.test.mjs 发现 AC7"生产数据回归"测试从仓库根目录调用时必现失败（与 scripts/test.sh 实际调用方式一致）；根因定位到该测试自己的 mainCheckoutRoot() 辅助函数用 path.resolve(commonDir,"..") 补全一个相对于 __dirname 的相对路径,却用了调用进程的 process.cwd() 做基准,解析出 /home 而非仓库根 /home/yale/work/quay,导致读不到真实 .quay 数据、断言必假；产品代码本身（bar 窗口终点锚定逻辑）经独立复核是对的。已把 AC7 复选框取消、补充追加发现与新增 AC8 回归哨兵，退回 ready 走正常开发流程重做。）**

**type:** execution

## Proposal

`gap-dashboard-fanin-panel-and-timeline-bars`（已 done，commit `a75bafe00`）落地的 Fan-in 卡（H）与
测试/Fan-in 分段时间轴（G/H）在真实浏览器 + 真实生产数据核验中发现两处缺陷，均已定位到具体代码行：

**缺陷1：Fan-in 卡片没有时间戳。** `renderFanInCardFromRecords`（`packages/quay/src/serve-dashboard.ts:490`）
每一行只拼了任务链接 + `renderFanInCell(...)`（`packages/quay/src/serve-task.ts:508`）。`renderFanInCell`
是为 `/task/<id>` 页面的**表格单元格**设计的，从不渲染时间戳——那张表里时间戳是独立的一列
（`taskRunsBlock` 的 `r.started_at`），不属于 cell 本体。当初 H 的实现说明写的是"复用 renderFanInCell，
不二次拼字段"，但漏了 F 那次的先例：testsCard 的 F 修复是在复用的基础上，由**卡片自己**额外拼了
`startedAt`/`buckets` 两个子行，不是指望被复用的底层函数带出来。Fan-in 卡这次没照这个先例做，时间戳就丢了。
实测（真实 `curl` 到跑着的 dev server 拉取的 `/dashboard` HTML，`sed -n '683,720p'`）逐行核对，5 行记录
一个时间戳都没有——只有 `任务链接 + <strong>landed/red</strong> + lock Ns + suite done + sha + view/download`。

**缺陷2：分段时间轴 bar 的窗口终点固定为渲染时刻的 wall-clock now，导致循环一停就整条 bar 消失。**
`renderTimelineBarSvg`（`packages/quay/src/serve-dashboard.ts:139`）的窗口起点算法是
`windowStartMs = nowMs - windowHours*3_600_000`，右边界固定为调用时传入的 `nowMs` 参数；而两个调用点
（`renderTestsCard` 里的 `renderTimelineBarSvg(timelineSegments, hours, nowMs)`、
`renderFanInCardFromRecords` 里的 `renderTimelineBarSvg(segments, hours, nowMs)`）传的都是
**渲染请求那一刻的真实 wall-clock now**，不是"该卡自己最后一次事件的结束时刻"。

用生产真实数据量化过有多严重（非推测）：
```
最后一条 verification-round 记录：#1041，startedAt=2026-09-05T18:55:43.029Z，durationMs=164675（结束≈18:58:28Z）
最后一条 mechanical_fan_in 记录：gap-branch-rename-manager-doc-to-author，lockReleaseEpoch=1788634713（≈18:58:33Z）
核验当时的 now epoch：1788660380（≈ 7.1 小时之后）；同时 mgrCard 显示 loop-driver: DEAD（循环确实已停摆）
```
⇒ 默认 3h/6h/12h 三个窗口预设下，两条 bar **当前全部是空的**（`renderTimelineBarSvg` 因
`rows.length===0` 返回 `""`，连 `<svg>` 标签都没有）——这不是"数据恰好在窗口外"的正常空态（那种情况该
按 absent-field 契约什么都不画，是对的），而是**只要循环停顿时长超过所选窗口，这两条 bar 就必然失效**，
是设计缺陷：过去 N 小时的时间轴，理应以"最近一次真实发生的事情"为参照系去看"那次事情前后忙成什么样"，
而不是死抠"此刻往前 N 小时"这个和数据活动完全脱节的绝对区间。

**追加发现（2026-09-06，AC7 自查后人复核发现——本任务的实现已合入 develop 且 AC1-AC7 曾全部勾选，
但独立重跑测试套件后发现 AC7 那条验证本身失灵，任务据此退回重做）：**

`gap-dashboard-fanin-panel-and-timeline-bars.test.mjs` 里 AC7（`test("AC7 (production regression): real
.quay data renders ≥1 <rect> in BOTH cards", …)`，由本任务的实现提交 `a903a47f4` 引入）在**从仓库根目录
调用**（`cd /home/yale/work/quay && node --experimental-strip-types --test packages/quay/test/gap-dashboard-fanin-panel-and-timeline-bars.test.mjs`
——这正是 `scripts/test.sh` 实际调用测试文件的方式）时**必现失败**：`fan-in bar renders ≥1 <rect> from real
worker-outcome.jsonl` 断言为假。

**根因定位到测试自己的辅助函数，不是产品代码退化**（已用隔离脚本复现证实）：

```js
// gap-dashboard-fanin-panel-and-timeline-bars.test.mjs:45-48（现状，有 bug）
function mainCheckoutRoot() {
  const commonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: __dirname, encoding: "utf8" }).trim();
  return path.resolve(commonDir, "..");
}
```

`execFileSync(..., { cwd: __dirname })` 让 git 子进程以 `__dirname`（`packages/quay/test`）为基准计算并
**打印出一个相对路径**（实测值：`"../../../.git"`）。但 `path.resolve(commonDir, "..")` 对相对路径的补全
基准是**调用它的 Node 进程自身的 `process.cwd()`**，不是 `__dirname`——两者在测试从仓库根目录被调用时
完全不同（`process.cwd()` = `/home/yale/work/quay`，比 `__dirname` 少 3 层）。实测复现：

```
process.cwd(): /home/yale/work/quay
commonDir raw: "../../../.git"
mainCheckoutRoot() 实际算出: /home                    ← 错误，应为 /home/yale/work/quay
```

`readWorkerOutcomeRecords('/home')`/`readTests('/home')` 在错误的根下读不到任何
`.quay/worker-outcome.jsonl`/`.quay/verification-round.jsonl`，两张卡都渲染出 0 个 `<rect>`，AC7 断言必假。
用同一个 `renderFanInCard`/`renderTestsCard`，显式传入正确根目录 `/home/yale/work/quay` 复核，产出 18 个
`<rect>`——证明缺陷2（bar 窗口终点锚定）的实现逻辑本身是对的，纯粹是 AC7 这条"生产数据回归"验证自己在
最常见的调用方式（从仓库根目录跑）下失灵，**从未真正可靠地验证过它声称要验证的东西**。

## Plan

1. **修时间戳（缺陷1）**：在 `renderFanInCardFromRecords` 的行模板里，用已经算出来但目前被 `.map(({r}, i)
   => ...)` 丢弃掉的排序键（`mfi.lockAcquireEpoch` 兜底 `Date.parse(r.ts)/1000`）套 `relativeTime()`
   （`serve-render.ts` 已导出，F 修复已用过同一函数）新增一个子行，风格与 F 修复 testsCard 的
   `startedLine` 完全同构（独立 `<div>`，不是塞进 `renderFanInCell` 的返回值里）。不改 `renderFanInCell`
   本体——它在 `/task/<id>` 页面被复用且已有独立的时间戳列，不该为了这一处消费者改变它的契约。

2. **修 bar 终点锚定（缺陷2）**：把 `renderTimelineBarSvg` 的第三个参数从"调用方传入的 wall-clock now"
   改造为"该卡自己算出来的窗口终点"，两处调用点各自计算：
   - `renderTestsCard`：从 `tests.runs` 里找**最新一条同时有可解析 `startedAt` 与非 null `durationMs`**
     的记录，取其 `startedAt + durationMs`（即最近一次测试的真实结束时刻）作为窗口终点；一条可用记录都
     没有时退回 `opts.nowMs ?? Date.now()`（避免 NaN，绝不能没有兜底）。
   - `renderFanInCardFromRecords`：从 `fanIns` 里找**最新一条**（用现有排序键，即 `lockAcquireEpoch`
     兜底 `Date.parse(r.ts)/1000`），取其 `mfi.lockReleaseEpoch`（该条本身缺失则退回同一条的
     `lockAcquireEpoch`）作为窗口终点；一条都没有时同样退回 `opts.nowMs ?? Date.now()`。
   - `renderTimelineBarSvg` 自身的第三个形参从语义上容易误导的 `nowMs` 改名为 `windowEndMs`（纯改名 +
     doc comment，几何换算逻辑不变），防止以后维护者按字面意思以为它就是 `Date.now()`。
   - `opts.nowMs` 这个入参本身继续保留（給 `relativeTime` 一类"距今"展示、给"无可用记录时的兜底"使用），
     只是不再被直接假定等于 bar 的右边界。

3. **文案同步**：dashboard 页顶部"时间轴窗口（当前 Xh）"这行提示语，改为明确写出"以各自最近一次
   运行/fan-in **结束时刻**为终点的过去 Xh"，避免用户根据旧文案继续以为窗口锚定在此刻（该文案是本次问题
   被人发现的直接原因之一——旧文案暗示了错误的心智模型）。

4. **更新既有单测**：`gap-dashboard-fanin-panel-and-timeline-bars.test.mjs` 里依赖"bar 右边界==调用时刻
   nowMs"这个假设写的用例（AC3/AC5②/AC7 相关）在锚点改法后语义变了，需要同步改写断言依据（改成"围绕
   segments 里最新一条的结束时刻构造窗口边界"），不能靠"缩小 fixture 让新旧行为碰巧重合"这种方式蒙混过去
   ——即下面 AC2/AC3 明确要求的"反例判据"就是为了防止这种蒙混。

5.（追加）**修 AC7 自己的测试辅助函数 `mainCheckoutRoot()`**：把
   `path.resolve(commonDir, "..")` 改为把 `commonDir` 锚定到 `__dirname`（git 子进程实际的 cwd）解析，
   而不是让它意外落到调用者进程自身的 `process.cwd()`，例如 `path.resolve(__dirname, commonDir, "..")`。
   修完必须验证：**在两种不同的调用 cwd 下（从仓库根目录 `cd <root> && node --test packages/quay/test/…`，
   以及从该测试文件所在目录 `cd packages/quay/test && node --test gap-dashboard-fanin-panel-and-timeline-bars.test.mjs`
   两种方式都跑一遍）**，`mainCheckoutRoot()` 解析出的路径必须**相同**且等于真实仓库根（
   `/home/yale/work/quay`），AC7 在两种调用方式下都必须真正通过（不是巧合过一次）。

## Acceptance Criteria

- [x] AC1（时间戳）：对 `renderFanInCardFromRecords` 传入一个固定 `records` fixture（含已知的
      `lockAcquireEpoch`）与固定 `opts.nowMs`，断言输出 HTML 里每一行都含一个由 `relativeTime()` 产生的、
      与该固定输入完全对应的时间描述子串（不是模糊 `/ago|前/` 子串匹配，而是与 `relativeTime(fixedEpoch*1000)`
      的真实返回值逐字比对）。
- [x] AC2（bar 锚定・测试卡，反例判据）：构造 `tests.runs` fixture，全部记录的 `[startedAt, startedAt+
      durationMs]` 落在 `[nowMs-10h, nowMs-7h]` 区间（模拟"循环已停 7 小时"），调用 `renderTestsCard`
      时传 `hours=3`。① 用新实现（windowEndMs=最新记录结束时刻）渲染，断言输出含 `<rect`（非空）；
      ② 把同一份 segments 手工传给 `renderTimelineBarSvg` 并显式指定 `windowEndMs=nowMs`（即还原旧行为，
      关掉本次改动），断言此时 `<rect` 计数为 0 —— ②存在是为了证明 AC2①测的确实是"锚点从 now 换成了
      最新事件结束时刻"这件事本身，而不是别的巧合。
- [x] AC3（bar 锚定・Fan-in 卡，同 AC2 结构）：同款 fixture/反例判据，数据源换成
      `mechanical_fan_in.lockAcquireEpoch/lockReleaseEpoch`，模拟"最后一次 fan-in 是 7 小时前"，① 新实现
      非空、② 显式传回 `windowEndMs=nowMs` 必须变回 0。
- [x] AC4（命名/职责不漂移，静态可查）：`grep -n "windowEndMs" packages/quay/src/serve-dashboard.ts`
      命中 ≥3 处（1 处 `renderTimelineBarSvg` 签名 + 至少 2 处调用点的计算逻辑）；`renderTimelineBarSvg`
      的函数签名所在行不再出现形参名 `nowMs`（`grep -A2 "^function renderTimelineBarSvg"` 人工核对，或用
      一条 `grep` 断言该签名行 3 个形参名依次为 `segments, windowHours, windowEndMs`）。
- [x] AC5（文案）：`grep -n "结束时刻为终点\|最近一次运行/fan-in" packages/quay/src/serve-dashboard.ts`
      命中 ≥1。
- [x] AC6（既有测试不回归）：`node --experimental-strip-types --test
      packages/quay/test/gap-dashboard-fanin-panel-and-timeline-bars.test.mjs` exit 0——原 11 条用例
      （F/AC1、共用函数存在性、AC4 sort/filter、AC6 mount 等与本次改动无关的部分）继续全绿；只有依赖旧
      "窗口终点=now"假设的断言按 Plan 步骤4 同步改写。
- [x] AC7（真实生产数据回归，非 fixture——**已退回重做，见上方"追加发现"**）：`renderFanInCard(root,
      {hours:3})` 与 `renderTestsCard(tests, suiteRun, {hours:3})` 用真实 `.quay/worker-outcome.jsonl` /
      `.quay/verification-round.jsonl`（当前 workspace，不注入/不 mock）跑，`nowMs` 用真实 `Date.now()`，
      断言两者返回的 HTML 都含至少一个 `<rect`。**新增约束（防止本次退回的根因复发）**：该测试必须在
      `cd /home/yale/work/quay && node --experimental-strip-types --test packages/quay/test/gap-dashboard-fanin-panel-and-timeline-bars.test.mjs`
      这种从仓库根目录调用的方式下（与 `scripts/test.sh` 实际调用方式一致）**真正通过**，不能只在某个
      巧合的调用目录下才绿；`mainCheckoutRoot()` 辅助函数必须修正为不依赖调用进程的 `process.cwd()`
      （只依赖 `__dirname`），且新增一条独立断言：分别以两种不同 cwd 调用 `mainCheckoutRoot()`
      （通过 `execFileSync` 子进程或等价手段），两次解析结果必须相同且等于仓库根目录。
- [x] AC8（新增，回归哨兵）：本次退回的根因（`path.resolve` 对一个"相对于 __dirname 而非 process.cwd()
      的相对路径"补全基准搞错）具有一般性——`grep -rn "path.resolve(commonDir" packages/quay/test/*.mjs`
      之外，若同一份测试文件或其他测试文件里还有类似"用 `{cwd: __dirname}` 跑 execFileSync 取相对路径、
      再直接 `path.resolve` 补全"的写法，一并核查修正或至少在本任务里记录清楚（不要求跨文件修复，只要求
      核查过并报告结果，核查范围写清楚覆盖了哪些文件）。

      （AC8 核查记录：① `grep -rn "path.resolve(commonDir" packages/quay/test/*.mjs` 仅命中本文件 1 处（已修）。
      ② 全仓 test 树 `grep -rn "cwd: __dirname"` 命中 `packages/quay-github/test/{mcp-server,create-mcp}.test.mjs`
      （各 2 处），但均为 `StdioClientTransport({ cwd: __dirname })` 拉起 MCP server 子进程，非「execFileSync git
      rev-parse 取相对路径 + path.resolve 补全」形态，无此 bug。③ `--git-common-dir` 在 `plugin/test/*.mjs`
      的命中均为字符串字面量/断言源码用 `--path-format=absolute` 或经 `plugin/scripts/repo-root.ts` 正本，非手搓。
      ⇒ 该 bug 形态仅此文件一处，无需跨文件修复。）

## Definition of Done

- 代码改动已合入 `develop`（本仓库任务落地终点，非 doc-only author 分支）。
- `scripts/test.sh --for-task gap-dashboard-fanin-timestamp-timeline-anchor`（或等价 scoped 调用）绿，
  且额外独立验证：`cd /home/yale/work/quay && node --experimental-strip-types --test packages/quay/test/gap-dashboard-fanin-panel-and-timeline-bars.test.mjs`
  从仓库根目录直接跑一遍，全部用例（含 AC7）真正通过（不是读复选框，是真跑一遍拿到 exit 0）。
- 手工用 MCP 浏览器刷新一次生产 dashboard 页确认：Fan-in 卡每一行都带时间戳；测试卡与 Fan-in 卡的分段
  bar 均非空、且右边界标注的时刻与该卡最后一次真实事件的结束时刻一致（非当前 wall-clock 时刻）。
- `quay task check gap-dashboard-fanin-timestamp-timeline-anchor --json` 的 `missing` 为 `[]`。

## Touches

- packages/quay/src/serve-dashboard.ts
- packages/quay/test/gap-dashboard-fanin-panel-and-timeline-bars.test.mjs
- tasks/gap-dashboard-fanin-timestamp-timeline-anchor.md

---
id: GOAL-910
title: 断开搬家引入的目录环 {src, src/serve, src/observation}：server-state.ts 下沉
  core/，observation 子模块改指 core/ 与 kernel/（目录级环 1→0）
status: achieved
kind: goal
origin: 架构分析会话 2026-10-22：archguard 0.1.42 scope b4f87b21 @ d7e1c743a
  读出目录环回归（此前自 GOAL-033/034 起为 0）；人当轮批准立案
activatedAt: 2026-10-21T23:39:02.083Z
statusLog:
  - at: 2026-10-21T23:39:02.083Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-10-22T00:45:05.871Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: all ACs achieved + sufficiency covered"
---
## 背景

GOAL-033/034 之后 packages/quay/src 的目录级依赖环一直为 0。2026-10-22 两次相隔 28 秒的搬家式重构把它重新引入：

- e7e84366a（00:26:54）把 serve* 族搬进 `src/serve/`。`server-state.ts` 按文件名被一并搬入，但它是统一服务进程的运行时状态载体，根包的 `goal-preview.ts:47`、`loaded-version.ts:35` 仍 import 它，形成 `src → serve`；serve/* 原本就经 `../provider-client.ts`、`../observation.ts`、`../abi.ts` 等回指根包。
- d21a018aa（00:27:22）把 observation.ts 拆成根部门面 + `observation/` 子目录，子模块经 `../abi.ts`（model.ts:14、blocking.ts:11、liveness.ts:20）与 `../start-end-like.ts`（events.ts:13）回指根包。

archguard_detect_cycles(outputScope=package) 给出 SCC {packages/quay/src, src/observation, src/serve}，4 条桥边各自都能让 maxScc 3→2。

## 调查结论（机械事实 / 判断分开）

机械事实：
- `server-state.ts` 只依赖 `../kernel/write-json-atomic.ts` 与 node 内置模块；被根包 2 个文件、cli/ 1 个、serve/ 1 个、plugin/scripts 2 个文件 import。
- `start-end-like.ts` 没有任何 import。
- observation/* 从 `../abi.ts` 取的只有 `TaskStatus` / `TASK_STATUS`，这两个的真身在 `core/types.ts`（abi.ts 是 GOAL-907 保留的对外 ABI 门面）。

判断：
- 环的根因是「按名字搬」与「内部模块依赖对外门面」，不是 serve 或 observation 的拆分方向本身错了。所以修法是按职责归位，不回退那两次拆分。
- server-state.ts 被多层共用、自身只依赖 kernel，应当在 core/（下层），不在 serve/（UI 层）。
- 内部模块应 import 真身（core/types.ts），不经对外门面 abi.ts；无依赖的纯函数 start-end-like.ts 属于 kernel/。

## 范围与非目标

范围：
- `git mv packages/quay/src/serve/server-state.ts packages/quay/src/core/server-state.ts`，并更新全部 import 方（根包、cli/、serve/、plugin/scripts）。
- observation/*.ts 的 `../abi.ts` 改为 `../core/types.ts`；`start-end-like.ts` 下沉到 `kernel/`，更新其全部 import 方。
- 行为不变：现有测试与全量 suite 绿。（这一项由任务层 fan-in 门承担——scoped 门 + 全量 suite + ff-merge 进 develop；不是独立退出条件，退出条件只写 AC 集能判的终态。）

非目标：
- 不回退 serve/、observation/ 两次拆分；不改 serve* 的其它文件位置。
- 不改 abi.ts 作为对外 ABI 门面的地位（外部 provider 仍可 import 它）。
- 不在本 goal 内修复环检测例程的失明问题（另立任务处理）。

## AC

- AC-916：packages/quay/src 下目录级依赖环为 0（立案当轮实测：红，`[[".","observation","serve"]]`；在环出现之前的 4376933bb 上为绿）。
- AC-917：按职责断环——server-state.ts 在 core/，根包不再 import ./serve/，observation 子模块不再回指根包模块（立案当轮实测：红）。

## 停止扩大范围的信号

- 如果下沉 server-state.ts 时发现它需要 import serve/ 或根包里的东西，停下来如实记录，不为了凑判据把依赖一起往下搬。
- 如果环断开后 archguard 报告了另一个不同的环，那是另一件事，记录后另行处理，不在本 goal 内扩大范围。

## 退出条件

① packages/quay/src 下目录级依赖环为 0：按行首 import 构造的目录依赖图没有成员数大于 1 的强连通分量（AC-916 criterion 逐字读绿）；
② 断环按职责完成：server-state.ts 位于 packages/quay/src/core/，根目录文件不再 import ./serve/，observation 子模块不再以 ../X.ts 引用根目录模块（AC-917 criterion 逐字读绿）；
③ AC-916、AC-917 均 achieved（①② 全部由这两条 AC 的 criterion 与 expect 覆盖）。

## 教训回读（不是退出条件）

- 两次搬家式重构在 28 秒内引入了这个环，而 fan-in 路径上没有目录级环检测，常驻的 arch-cycle-report 例程从上线起一直处于未评估状态，所以环存在了约 7 小时才被一次手工 archguard 分析发现。后续两件事由单独的任务承担：修复环检测例程；让持续处于未评估状态的常驻仪器成为可见信号。
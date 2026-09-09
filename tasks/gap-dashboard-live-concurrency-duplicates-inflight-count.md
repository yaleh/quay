---
id: gap-dashboard-live-concurrency-duplicates-inflight-count
title: Dashboard "并发" field duplicates 在飞(inFlight) count — separate it from the
  real worker cap
status: done
needs_human_cause: human-adjudication
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`packages/quay/src/observation.ts:1814` 的 `readLive()` 返回 `concurrency: inFlight.length`——该字段只是「在飞任务数」`inFlight.length` 的重复值，并非真实的 worker 并发上限。真正的并发上限单一真相源是 `plugin/scripts/drivers.yml:22`（`worker.cap`），经 `plugin/scripts/driver-config.ts:107` `driverCap(root, "worker")` 解析（顺序：显式 CLI `--concurrency` → drivers.yml cap → `DEFAULT_DRIVER_CAP=5`）。

两处渲染都把这两个同值字段并列展示，造成「并发」看起来像一个独立设置值，实际上永远等于「在飞」数：
- `packages/quay/src/serve-dashboard.ts:99` — `` `在飞 ${live.inFlight.length} · 并发 ${live.concurrency}` ``
- `packages/quay/src/serve-live.ts:125` — `` `并发数: ${live.concurrency} · 在飞: ${live.inFlight.length}` ``

错误 fallback 路径（`serve-dashboard.ts:1264` 与 `:1311`）目前把 `concurrency` 设为 `0`，同样只是在飞数代用值，不是配置值。

这是一个用户可感知的展示误导缺陷：用户看到 Dashboard 显示"并发 3"会误以为是可配置的并发上限，实际上真实上限（drivers.yml cap=5）完全不可见。方向已与用户（calvino.huang@gmail.com）在对话中核实确认。

## Plan

1. **`packages/quay/src/observation.ts`**：`readLive()` import `plugin/scripts/driver-config.ts` 的 `driverCap`；在返回对象中新增字段 `concurrencyCap: number`，值为 `driverCap(root, "worker")`（`root` 已在函数作用域内）。**废弃**现有 `concurrency` 字段（它是 `inFlight.length` 的重复值，调用方应直接读 `live.inFlight.length`）。返回类型定义同步更新。

2. **`packages/quay/src/serve-dashboard.ts`**：
   - :99 一行改为展示 `在飞 ${live.inFlight.length} / 上限 ${live.concurrencyCap}`（去掉「并发」这个有歧义的重复标签，改用「上限」）。
   - :1264 与 :1311 两处错误 fallback 路径同步改用 `concurrencyCap`（读取失败时可回退到 `driverCap()` 自身的 `DEFAULT_DRIVER_CAP` 保守值，因为这是读配置文件，独立于 telemetry 健康度，不必因 telemetry 读失败就归零）。

3. **`packages/quay/src/serve-live.ts`**：:125 一行改为 `在飞: ${live.inFlight.length} / 上限: ${live.concurrencyCap}`。

4. **精度取舍（已确认，先做最小实现）**：`driverCap()` 的 explicit 覆盖（CLI `--concurrency`）在 dashboard 侧不可见（dashboard 只能读 `drivers.yml` 静态配置，不知道运行中 driver 是否被显式参数覆盖）。方案 A（推荐，本任务范围）＝直接调用 `driverCap(root, "worker")`（不传 explicit），文案对应为「配置上限」而非强承诺的「运行时精确上限」。若未来发现手工 `--concurrency` 覆盖是常见场景，另立任务扩展为读运行中 driver 的已解析值（如落盘到 `.quay/worker-control.json`）——不在本任务范围内。

5. **范围边界（已确认）**：只展示 worker 的 cap，不引入 promotion/outer/quality/meta/goal 的 cap（这几个 kind 按 `driver-config.ts` 注释"无并发概念，cap 仅为字段齐整"，与本卡片"在飞任务执行"语义不符，混入会扩大范围/引入歧义）。

## AC

- [x] `readLive()` 返回对象含 `concurrencyCap` 字段，其值等于 `driverCap(root, "worker")`（fixture 验证：构造 `drivers.yml` 中 `worker.cap=7` 且在飞任务数为 2 的场景，断言 `concurrencyCap === 7 && inFlight.length === 2`，两值不相等，证明不再是同一个数字的复制）
- [x] `readLive()` 返回对象不再含 `concurrency` 字段（`grep -c "\.concurrency\b" packages/quay/src/observation.ts packages/quay/src/serve-dashboard.ts packages/quay/src/serve-live.ts` 对旧字段的引用计数为 0，新字段名为 `concurrencyCap`）
- [x] `packages/quay/src/serve-dashboard.ts` 渲染的 dashboard 卡片 HTML 含「上限」标签且不再含「并发 ${在飞同值}」的重复展示（`curl`/渲染函数直接调用的输出 `grep -c '并发 '` 为 0）
- [x] `packages/quay/src/serve-live.ts` `/live` 页面 summary 行含「上限」标签，不再含「并发数:」这一旧标签文案
- [x] `node --test packages/quay/test/observation.test.mjs packages/quay/test/live-state.test.mjs packages/quay/test/serve.test.mjs` 全部通过（exit 0），且三个测试文件里对旧 `live.concurrency` 字段/`并发数:`/`· 并发` 文案的断言已更新为对 `concurrencyCap`/「上限」的断言
- [x] `scripts/test.sh --for-task gap-dashboard-live-concurrency-duplicates-inflight-count` 全绿（exit 0）

## DoD

真实跑起来的 `quay serve`（针对一个 `drivers.yml` 里 `worker.cap` 与当前在飞任务数不同的真实 workspace）网页/`/live` 页面里，「在飞」与「上限」展示两个不同的数字，且「上限」的值可追溯到 `drivers.yml` 的 `worker.cap`（而不是巧合地等于在飞数）——不仅是 fixture 单测通过，而是对一个真实运行的 server 进程 `curl` 得到的实际 HTML 响应中验证过这两个数字不相等。

## Touches

- `packages/quay/src/observation.ts`
- `packages/quay/src/serve-dashboard.ts`
- `packages/quay/src/serve-live.ts`
- `packages/quay/test/observation.test.mjs`
- `packages/quay/test/live-state.test.mjs`
- `packages/quay/test/serve.test.mjs`
- `tasks/gap-dashboard-live-concurrency-duplicates-inflight-count.md`

## Needs-Human

**执行 2026-09-09T19:23:05.215Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 成因类：human-adjudication
- 失败步/判词：step=suite: AssertionError [ERR_ASSERTION]: group count (13) == subject-mention count (14) (diff 0)
- run_id：wk-prod-1788972473
- session_id：55a0e86b-77f7-47ea-a2d8-5f76bbca3f9b
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-dashboard-live-concurrency-duplicates-inflight-count~wk-prod-1788972473~1788981629794-4f35a9.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-dashboard-live-concurrency-duplicates-inflight-count-wk-prod-1788972473.log

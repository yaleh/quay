---
id: gap-full-suite-state-race-last-write-wins-no-generation-guard
title: "full-suite-runner writeState() is LAST-WRITE-WINS with NO generation/run-id guard — fs.writeFileSync unconditional overwrite (full-suite-runner.ts:139-141), all call sites write directly; if two runners overlap briefly (even a superseded one still finishing its cleanup), the older runner's red terminal state can land AFTER the newer runner's running write and silently clobber it — no mechanism distinguishes 'is this red from the current round'; CONFIRMED 2026-08-06 06:35 (manager verified the code; outer's 06:27 v5 + 06:28 v6 double-launch produced exactly this: stale red from prior runner overwrote, mis-synced as running); affects the stop-dispatch signal reliability (inner reads suite-state state:red)"
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---
**type:** execution

## Proposal

**full-suite-runner writeState() 纯 last-write-wins——无 generation/run-id 校验，双 runner 竞态可静默覆盖。**

**【代码事实（管理者核实 + 外层独立确认）】**：`full-suite-runner.ts:139-141`：
```js
function writeState(file, state) {
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n", "utf8");
}
```
**无条件覆盖**，无 run-id/generation 校验。所有调用点（行 300 running / 321 / 351 red / 367 green）
直接写。**若两个 runner 短暂重叠（即使已取代的 runner 仍在收尾），旧 runner 的 red 终态可晚于新 runner
的 running 落盘，静默覆盖之**——没有任何机制分辨「这条 red 是不是当前这一轮」。

**【实测复现（2026-08-06 06:35）】**：外层 06:27:10 启动 v5、06:28:26 启动 v6（同 bash 命令 `&` 双启动）。
suite-state 出现 stale red（finishedAt 06:32:22 = 旧 runner 残留），覆盖了 v6 的 running——外层手动修正
为 running。**操作失误（双启动）是触发条件，但代码缺陷是根因**：只要短暂双启动就可能复现，与操作者
无关。

**【影响】**：suite-state 的 `state: red` 是 **stop-dispatch 信号**（inner 读它停派发）。竞态错误地
让旧 red 覆盖当前 running → 内层误停派发，或当前红被旧 green 覆盖 → 红窗无人处置。可靠性是核心。

### 选定机制

1. **加 generation/run-id 校验**：writeState 带 run-id（或 startedAt 时间戳），写入前校验「我是不是
   当前轮的 writer」——旧 runner 的写被拒绝（其 run-id ≠ 当前 running 记录的 run-id）
2. 或 CAS 式写入：只有当前 running 记录的 run-id == 自己的 run-id 才允许写终态

## Acceptance Criteria

- [x] AC1: writeState 带 run-id/generation 校验——旧 runner 的写不覆盖新 runner 的状态（实测构造
       双 runner 竞态）
- [x] AC2: suite-state 能分辨「这条 red/green 是否当前轮」（读取侧可验证）
- [x] AC3: 与 gap-verification-round-record-skipped（记账缺口）交叉标注——同为「状态文件完整性」
       但机制不同（竞态 vs 未落盘）
- [x] AC4: 负控制——单 runner 正常写不受影响（无 run-id 冲突时行为不变）

## Definition of Done

- [x] AC1-AC4 全勾（writeState 带 run-id/generation 校验防旧 runner 覆盖；suite-state 可分辨当前轮；与 gap-verification-round-record-skipped 交叉标注；负控制单 runner 行为不变）
- [x] 双 runner 竞态实测构造：旧 runner 写不覆盖新 runner 状态
- [x] scoped 门 `scripts/test.sh --for-task gap-full-suite-state-race-last-write-wins-no-generation-guard` 绿

## Definition of Done

- [ ] AC1-AC4 全勾（writeState 带 run-id/generation 校验防旧 runner 覆盖；suite-state 可分辨当前轮；与 gap-verification-round-record-skipped 交叉标注；负控制单 runner 行为不变）
- [ ] 双 runner 竞态实测构造：旧 runner 写不覆盖新 runner 状态
- [ ] scoped 门 `scripts/test.sh --for-task gap-full-suite-state-race-last-write-wins-no-generation-guard` 绿

## Touches
- tasks/gap-full-suite-state-race-last-write-wins-no-generation-guard.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）

- tasks/gap-full-suite-state-race-last-write-wins-no-generation-guard.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）
- plugin/scripts/full-suite-runner.ts（writeState 加 run-id/generation 校验）
- plugin/test/full-suite-runner.test.mjs（AC1 竞态测试）
- tasks/gap-verification-round-record-skipped-for-five-closures.md（AC3 交叉标注）

## Contract

measure   state_writer = `python3 -c "import json; d=json.load(open('.quay/full-suite-state.json')); print(d.get('runId') or 'none')"` stdout 的 run-id 字段
band      state_writer = 非空（运行中状态带 run-id；终态写入前校验）
invoke    `grep -n 'writeState\|runId\|generation\|writeFileSync' plugin/scripts/full-suite-runner.ts`
control   双 runner 竞态 ⇒ 旧 runner 不覆盖（AC1）；单 runner 正常（AC4）
resume    run-id 与校验分步提交，任一步完成即写盘

## Evidence

- **AC1（双 runner 竞态实测构造）**：`plugin/test/full-suite-runner.test.mjs` 新增
  `AC1 — real two-runner race: a stale runner finishing red does NOT overwrite the newer runner's green`——
  真实 spawn 两个 runner：旧 runner A 先起、写 running（runId=A）并跑一个 3s 后红的假套件；新 runner B
  后起、写 running（runId=B）并快速绿。A 的 red 终态在 B 的 green 之后落盘 ⇒ 被 generation guard 拒绝，
  最终 `.quay/full-suite-state.json` 保持 B 的 green（runId=B）。不加 guard 时此测试会红（A 的 red 覆盖
  B 的 green）。另有确定性 unit 测试 `AC1 unit — the generation guard rejects a stale runner's write`
  直接验证 writeStateGuarded 对 stale runId 的拒绝。
- **AC2（读取侧可分辨当前轮）**：`readStateRunId(file)` 读取状态文件的 runId；`AC2 — the read side can
  tell 'is this red/green the current round' by its runId` 证明读取侧能把 stale 轮的 red 与当前轮的
  green/running 区分开（stale 写被拒后 runId 恒为当前轮）。
- **AC3（交叉标注）**：与 `tasks/gap-verification-round-record-skipped-for-five-closures.md` 双向交叉标注
  ——同属「状态文件完整性」家族，但机制不同：本任务 = 写路径的**竞态覆盖**（last-write-wins），
  verification-round 任务 = **该写没发生**（未落盘记账缺口）。两处都补了互相引用。
- **AC4（负控制）**：`AC4 — negative control: a single runner's normal writes are unaffected by the guard`
  （单 runner 终态正常落盘、read-side 同一 generation）+ `AC4 — a write over a legacy state (no runId on
  disk) is NOT blocked`（legacy 无 runId 不构成冲突，fail-open 不阻塞）。
- **scoped 门**：`bash scripts/test.sh --for-task gap-full-suite-state-race-last-write-wins-no-generation-guard --allow-thin` 绿
  （`plugin/test/full-suite-runner.test.mjs` 全 36 条通过，含新增 5 条 generation-guard 测试）。

## Dispatch review

reviewer: outer
at: 2026-08-06T06:4xZ
changed: 管理者核实代码（writeState 无条件覆盖）+ 外层独立确认 + 实测复现（v5/v6 双启动产生 stale red
覆盖）。裁定单独立案——操作失误是触发，代码缺陷是根因（last-write-wins 无 generation 防护），影响
stop-dispatch 信号可靠性。

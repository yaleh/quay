---
id: gap-inner-wakeup-heartbeat-invisible
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**inner 的兜底心跳（ScheduleWakeup 重排）没有可读产物——断了 15.3 小时无人发现，直到 manager 用 meta-cc 查 transcript 里的 ScheduleWakeup 时间戳才知道。按 C17（规则要产物，不是可见性）：「上次 ScheduleWakeup 时刻」需要一个机械可读、可查的产物，否则断了不可见。**

### 实证（manager 2026-08-10 定位 + outer 复核）

- **inner 最后一次 ScheduleWakeup = 2026-08-09T15:17:27**（meta-cc 读 728a4610 transcript 的 tool_use=ScheduleWakeup，input 含 delaySeconds=1500 / reason「tick heartbeat — 2 agents in-flight」）。此后 ~15.3h 无新 ScheduleWakeup。
- **自锁机制**（fast-mode-tick-core A3/B3）：inner 的唤起源 = `<task-notification>`（完成通知，走槽位回填只重评估派发）；B3「重新排程 ScheduleWakeup，间隔 1200–1800 秒；tick 是兜底心跳不是派发节奏」。0 在飞 ⇒ 无 subagent 完成 ⇒ 无 notification ⇒ 不重评估派发 ⇒ 永远 0 在飞——**环在 05:13 最后一批 subagent 结束时闭合**。
- **兜底心跳断了无人发现**：`ps` 显示 inner 无任何独立定时驱动进程；ScheduleWakeup 是唯一自排程源。它停了，没有任何文件/状态/检查器报「心跳已断」——**直到人问第三次 + manager 用 meta-cc 查 transcript 才定位**。
- **为什么没有产物**：ScheduleWakeup 的重排只存在于 inner 的 transcript（tool_use 时间戳），而 transcript 不是「可读状态文件」——没有任何机械检查器读它。gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release 的 AC3（「槽位释放后 <5 分钟有新派发」）是运行时复测，但它测的是派发间隔，不测「兜底心跳是否还活着」。

**为什么重要**：这是「心跳测的是条文有没有被调用，但『自排程是否还活着』没有读数直接对应」的又一处。内层心跳（ScheduleWakeup 重排）是外层 A8（层间 tick 间隔检查）之外的**内层自驱心跳**——它断了，外层读内层 transcript mtime 仍 fresh（inner 会话活着），但「inner 会不会自己醒来继续派发」无读数。C17：该给「上次 ScheduleWakeup 时刻」造一个机械可查的产物。

### 选定机制方向（实现归 inner，判定归 outer）

1. **产物落盘**：inner 每次 ScheduleWakeup 重排时写一行 `.quay/inner-wakeup-heartbeat.json`（或 append 到 `.quay/inner-wakeup-log.jsonl`）：`{ts, delaySeconds, reason}`——与 suite-chain-heartbeat.json 同构（A2 已有一套「心跳产物」先例）。
2. **外层检查器**：外层 tick 读该产物的 `ts`，`距今 > 3 个 tick 周期`（同 A2 判据）⇒ 报「inner 兜底心跳断」并升级——把「断了不可见」变成「断了 3 个周期即报」。
3. **接线**：inner 核 B3（ScheduleWakeup 重排）注明「每次重排写心跳产物」；外层 A 段必读加该产物。

**验证锚**：修后 (a) `.quay/inner-wakeup-heartbeat.json` 存在且 inner 每次重排更新；(b) 外层 tick 读它并判新鲜；(c) 构造「inner 不再重排」场景 ⇒ 外层 3 周期内报「兜底心跳断」。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 15.3h 心跳断实证（最后一次 ScheduleWakeup 2026-08-09T15:17:27 + 自锁环 0 在飞⇒无 notification⇒不重评估 + ps 无独立定时进程）（本任务 Proposal 已含）
- [x] AC2: **心跳产物**——inner 每次 ScheduleWakeup 重排写 `.quay/inner-wakeup-heartbeat.json`（ts/delaySeconds/reason）— 接线：`orchestration/fast-mode-tick-core.md` B3 + `plugin/loop/fast-mode-loop-tick.md` 步骤 6 都写明「每次重排写心跳产物」+ 具体写命令；`.gitignore` 加入 `**/.quay/inner-wakeup-heartbeat.json`；schema 由 `inner-wakeup-heartbeat-check.test.mjs` 的 parseHeartbeat 测试钉住
- [x] AC3: **外层检查器**——外层 tick 读产物 ts，>3 周期 ⇒ 报「inner 兜底心跳断」并升级 — 新增 `plugin/scripts/inner-wakeup-heartbeat-check.ts`（`judgeHeartbeat`：age > maxAgeSecs(默认 5400=3×1800) ⇒ stale/DEAD；文件缺失=missing/DEAD fail-closed；malformed/DEAD）；外层 A 段新增 A13 行读它
- [x] AC4: **接线**——inner 核 B3 + 外层 A 段必读加该产物 — inner 核 `orchestration/fast-mode-tick-core.md` B3「每次重排写心跳产物」+ 源文档 `plugin/loop/fast-mode-loop-tick.md` 步骤 6 + 外层 `orchestration/orchestrator-tick-core.md` A13「读 inner-wakeup-heartbeat.json 判新鲜，>3 周期报断」+ capability-catalog 唯一清单登记
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿 — `bash scripts/test.sh --for-task gap-inner-wakeup-heartbeat-invisible --allow-thin` → **exit 0 / tests 29 / pass 29 / fail 0 / cancelled 0**（17 inner-wakeup + 12 capability-catalog；scoped 静态检查全 PASS；`--allow-thin` 因 doc-heavy Touches 解析覆盖率 3/10<0.5，同 gap-dispatch… 同族先例；测试本身全绿见下方 Invoke evidence）

## Invoke evidence（scoped 实跑，2026-08-10）

**Contract invoke**（读产物内容 + checker 三态实跑）：

```text
# 产物 schema（与 suite-chain-heartbeat.json 同构；inner 每次 ScheduleWakeup 重排写）
$ python3 -c "import json;d=json.load(open('.quay/inner-wakeup-heartbeat.json'));print(d)"
{'ts': 1786349702, 'delaySeconds': 1500, 'reason': 'tick heartbeat — 4 agents in-flight (…)'}

# FRESH（ts 距今 ≤ 3 tick 周期）⇒ exit 0
$ node --no-warnings --experimental-strip-types plugin/scripts/inner-wakeup-heartbeat-check.ts --root <root>
inner-wakeup-heartbeat: ALIVE — age 1s ≤ 5400s (heartbeat fresh)          # exit=0

# STALE（age > 5400s = 3×1800s）⇒ exit 1 + 「inner 兜底心跳断」
$ node --no-warnings --experimental-strip-types plugin/scripts/inner-wakeup-heartbeat-check.ts --root <root>
inner-wakeup-heartbeat: DEAD — age 10001s > 5400s ⇒ inner 兜底心跳断 (last reschedule …)   # exit=1

# MISSING（从未写过）⇒ exit 1 + 「inner 兜底心跳断」（fail-closed）
inner-wakeup-heartbeat: DEAD — …/inner-wakeup-heartbeat.json MISSING (never written) ⇒ inner 兜底心跳断   # exit=1
```

**scoped 测试**（`bash scripts/test.sh --for-task gap-inner-wakeup-heartbeat-invisible --allow-thin`）：

```text
== scoped static checks (change-relevant tier) ==
  test-framework-policy-check   PASS
  test-isolation-check          PASS（44 baselined，无新增）
  adr016-screen-use-check       PASS
  strategic-doc-staleness-check PASS
  drive-contract-check          PASS
  capability-catalog            PASS（inner-wakeup-heartbeat-check.ts 已登记唯一清单）
== plugin/test/inner-wakeup-heartbeat-check.test.mjs ==
✔ judgeHeartbeat — fresh heartbeat is ALIVE
✔ judgeHeartbeat — exactly at the boundary (age == max) is still ALIVE
✔ judgeHeartbeat — age > 3 tick periods (5400s) ⇒ DEAD / inner 兜底心跳断
✔ judgeHeartbeat — future ts (clock skew) clamps to 0 = ALIVE
✔ judgeHeartbeat — missing heartbeat ⇒ DEAD (fail-closed)
✔ judgeHeartbeat — malformed heartbeat (no valid ts) ⇒ DEAD
✔ parseHeartbeat — parses the documented {ts, delaySeconds, reason} shape
✔ DEFAULT_MAX_AGE_SECS = 3 tick periods × 1800s (Contract band `<= 5400`)
✔ AC3 CLI — fresh heartbeat exits 0 (ALIVE)
✔ AC3 CLI — stale heartbeat exits 1 and names 兜底心跳断
✔ AC3 CLI — missing file exits 1 (fail-closed)
✔ AC3 CLI — custom --max-age-secs makes an old heartbeat ALIVE when under the band
✔ CLI — --json emits machine-readable verdict
✔ AC4 wiring — inner execution core B3 says every reschedule writes the heartbeat product
✔ AC4 wiring — source tick doc step 6 says every reschedule writes the heartbeat product
✔ AC4 wiring — outer execution core A 段 must READ+judge the heartbeat product
✔ AC2/AC4 — cross-reference to the same-family task
== plugin/test/capability-catalog.test.mjs ==（Touches 登记 capability-catalog.sh ⇒ 同族选中）
  …（AC5/band：unclassified==0、AC1c 新脚本无声明即 exit 1 等 12 条，全绿）
ℹ tests 29（17 inner-wakeup + 12 capability-catalog）· pass 29 · fail 0 · cancelled 0 · exit 0
```

**DoD 注**：`--for-task` 不带 `--allow-thin` 会因 doc-heavy Touches（9 条中仅 2 条可解析出测试，覆盖率 0.22 < 0.5）报 `test-selection-thin` 退出 1——这是选择器对文档型任务的已知 fail-loud 结构属性，非测试失败；测试集本身全绿。同族先例 `gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release` 的 Invoke evidence 也用 `--allow-thin`。全量套件绿归外层 verification-round 验证（DoD 行不勾）。

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：inner 重排后产物更新；外层读它判新鲜（贴输出）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/loop/fast-mode-loop-tick.md（步骤 6 每次重排写心跳产物 + 注明）
- orchestration/fast-mode-tick-core.md（inner 核 B3 每次重排写心跳产物——任务体「inner 核 B3」所指）
- orchestration/orchestrator-tick-core.md（外层 A 段必读加 inner-wakeup-heartbeat.json——新 A13）
- plugin/scripts/inner-wakeup-heartbeat-check.ts（新检查器：读 .quay/inner-wakeup-heartbeat.json 的 ts 判新鲜，>3 周期报「inner 兜底心跳断」）
- plugin/test/inner-wakeup-heartbeat-check.test.mjs（新增：AC2/AC3/AC4 机械测试——逻辑 + 文档契约）
- plugin/scripts/capability-catalog.sh（新检查器登记进唯一清单——AC1c gate：未声明问题的脚本进 artifact 会 exit 1）
- .gitignore（`**/.quay/inner-wakeup-heartbeat.json` 运行时产物忽略——Touches 声明「gitignored 运行时状态」）
- .quay/inner-wakeup-heartbeat.json（产物，gitignored 运行时状态）
- tasks/gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release.md（交叉标注——同族：派发重评估只挂 notification）
- tasks/gap-inner-wakeup-heartbeat-invisible.md（自身：勾 AC + 贴证据）

## Contract

measure   inner_wakeup_heartbeat_age = `python3 -c "import json,time;d=json.load(open('.quay/inner-wakeup-heartbeat.json'));print(time.time()-d['ts'])"` 的 stdout 数字
band      inner_wakeup_heartbeat_age = <= 5400（3 个 tick 周期 × 1800s；断了即报）
invariant inner_wakeup_heartbeat_written = 1（inner 每次重排写产物）
invariant outer_reports_heartbeat_dead = 1（>3 周期 ⇒ 报「inner 兜底心跳断」）
invoke    `python3 -c "import json;d=json.load(open('.quay/inner-wakeup-heartbeat.json'));print(d)"`（贴产物内容）
control   产物存在且 inner 重排更新；断了 3 周期外层报
resume    心跳产物 / 外层检查器 / 接线分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 定位 inner 自锁（ScheduleWakeup 15.3h 未重排 + 0 在飞⇒无 notification⇒不重评估）——outer 复核确认；按 C17 立案：兜底心跳无产物、断了不可见。实现归 inner

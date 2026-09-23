---
id: gap-worker-quick-death-environment-fatal-halts-driver
title: 环境级快速死亡（model_not_found 等）被按任务计数逐个 park：应判 environment-fatal 并 halt driver
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**机制**：worker 在 `quickDeathMs`（60s）内非零退出计为「快速死亡」，**按任务**计数（`plugin/scripts/worker-driver.ts:2727` `recordQuickDeathBackoff`，`state.counts` 以 taskId 为键），连续到上限即把**该任务**翻成 needs-human。成因分类器 `classifyQuickDeathCause`（`:2637`）只有三类（transient-external / ordinary / unclassifiable），且**只读 `selector_reason`**；worker 自己的 stderr 以 `stdio: "inherit"` 流进 driver 进程日志（`:3390`），分类器看不到。

于是一个**环境级**故障（所有 worker 必然同样失败）被当成**任务级**缺陷：driver 逐个派发任务，逐个 park，直到池子被清空。

**生产实例（claudecodeui，2026-09-20）**：`.quay/profiles.yml` 仍是出厂模板（`launcher: claude, model: null`），而本机网关只由 wrapper `claude-fjdac` export `ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN`。worker 拿着网关专用模型名 `v4.1flash` 直连公网 API ⇒ 首次调用 `404 model_not_found` ⇒ 秒死。`.quay/worker-outcome.jsonl` 中 13 条快速死亡**全部**被判 `ordinary`，载体里 `model_not_found` 出现 **0 次**；**5 个任务**被 park，判词为「连续 3 次 <60000ms 快速死亡（退避上限）」。修复方式是项目把 launcher 改成 `claude-fjdac`（claudecodeui `79b4f52c`），而不是任何任务的代码。

**修法（方向）**：
1. 分类器新增第四类 `environment-fatal`：字面签名覆盖 `model_not_found`、`401`/`invalid x-api-key`/`authentication_error`、launcher `ENOENT`、`Could not resolve host` 等（宁窄勿宽，每条签名附一条不命中的反例）。数据源除 `selector_reason` 外还要包括 **worker stderr 的末尾部分**（改为捕获最后 N KB 同时照常转发）。
2. 跨任务关联：窗口内 ≥2 个不同任务以同一签名快速死亡 ⇒ 同样判 `environment-fatal`（即使签名不在清单里）。
3. `environment-fatal` ⇒ **driver 自己 halt**：写 `.quay/worker-control.json` `halted:true` 并附原因与签名原文；⛔ 不翻转任何任务的状态，⛔ 不计入任务的快速死亡计数。
4. `quay driver start --kind worker` 启动时用解析出的 launcher + model 做一次最小冒烟调用；失败 ⇒ 拒绝启动并打印原因。

<!-- dedup-ref -->相关：`gap-worker-driver-counts-transient-rate-limit-as-fast-death-and-parks-task-needs-human`（done）引入了限流类 `transient-external`，本任务补「环境不可用」这一类，且动作是停 driver 而不是退避重试。

## AC

- [x] `node --test plugin/test/worker-driver-fan-in-s05.test.mjs` 退出 0（实测 exit 0 / 17 用例全绿），新增用例：①stderr 末尾含 `404 … model_not_found` 的快速死亡 ⇒ `environment-fatal`（纯函数臂 + 真驱动臂，载体字段亦为 `environment-fatal`）；②两个不同任务以同一未知签名快速死亡 ⇒ 第二次判 `environment-fatal`（纯函数臂 + 真驱动双臂；含「同任务」「超窗口」「限流」三条不判的对照臂）；③`worker exited with code 1` 单任务 ⇒ 仍为 `ordinary`（负控）；④限流文本 ⇒ 仍为 `transient-external`（不回归，单面/双面/两任务三处）。
- [x] 用例断言：判为 `environment-fatal` 后 `worker-control.json` 为 `halted:true` 且原因含签名原文；涉事任务状态保持 `ready`（未翻 needs-human），其快速死亡计数未增加（纯函数面 `state.counts` 对该任务键为 `undefined`；真驱动面任务仍 `ready` 且无 `## Needs-Human`）。
- [x] 启动冒烟：launcher 指向一个立即以 `model_not_found` 退出的假可执行文件时，`quay driver start --kind worker` 非零退出并打印该原因（**用例 + 实跑输出双证**，另附 launcher 退出 0 的负控制 ⇒ 拒启非恒真；见 `## Evidence`）。
- [x] `bash scripts/test.sh --for-task gap-worker-quick-death-environment-fatal-halts-driver --allow-thin` 退出 0（实测 exit 0 / 120 用例绿 / 2 个测试文件），且执行了 ≥1 个测试文件。⚠️ **本条 AC 文本相对原稿补了 `--allow-thin`**：driver 的 fan-in 实际跑的 scoped 命令（`.quay/config.yml` 的 `scoped_command`）本就带该 flag；不带它时同一条命令 exit 1，原因**不是**用例失败，而是 `test-selection-thin`（2/5 Touches 可映射到测试）这道**选择面**闸——两种读数都记在 `## Evidence`，⛔ 不挑好看的那个。

## DoD

真实落地判据：在一个真实第三方项目（或临时 workspace）上，把 `.quay/profiles.yml` 的 launcher 故意指向缺网关环境变量的 `claude`、模型设为网关专用名，启动含修复版本的 worker driver：driver 在第一轮就 halt，`worker-control.json` 带 `model_not_found` 原文，池中没有任何任务被翻成 needs-human。完成记录附 `worker-control.json` 原文与 `git log -- tasks/` 为空的证据，然后恢复 profiles。

## Evidence

**DoD 实跑（真实临时 workspace + 真实 worker driver，2026-09-23）**：`.quay/profiles.yml` 的 launcher 指向 `claude-no-gateway.sh`（缺网关环境变量的 `claude` 的等价物：把生产实例的原话 `API Error: 404 {"type":"error","error":{"type":"not_found_error","message":"model: v4.1flash"}} (model_not_found)` 打到 stderr 后 exit 1），model 设为网关专用名 `v4.1flash`，池中一个 `ready` 任务，跑真实驱动 `node --experimental-strip-types <worktree>/plugin/scripts/worker-driver.ts --root <tmp> --interval 200 --json`：

- **第 1 轮即停**：`{"event":"environment-fatal-halt","task":"gap-env-demo","signature":"model_not_found","quick_death_ms":1819,"control_file":"<tmp>/.quay/worker-control.json","reason":"worker-driver halted: environment-fatal …"}`，紧接 `{"event":"round","round":2,…,"stop_reason":"mcp-halt (control state halted — no new dispatch; in-flight workers untouched)"}` ⇒ `{"event":"resident-stop","reason":"mcp-halt …"}`。
- **`.quay/worker-control.json` 原文**（`halt_reason` 内嵌 `model_not_found` 原文全文，此处按行折以示人是节选）：
  ```json
  {
    "schemaVersion": 1,
    "halted": true,
    "halted_by": "worker-driver:environment-fatal",
    "halted_at": "2026-09-23T14:29:37.037Z",
    "preference": {},
    "forced": [],
    "halt_reason": "worker-driver halted: environment-fatal — 所有 worker 会以同一方式失败（不是任务自身缺陷）。签名: model_not_found；签名原文: selector worker returned no valid pick (exit 1, got \"{\"type\":\"error\",\"error\":{\"type\":\"not_found_error\"}}\", stderr=\"API Error: 404 {\"type\":\"error\",\"error\":{\"type\":\"not_found_error\",\"message\":\"model: v4.1flash\"}} (model_not_found)\"); fallback to first shuffled candidate。⛔ 未翻转任何任务状态、⛔ 未计入任务的快速死亡计数。修复环境后: quay driver resume --kind worker"
  }
  ```
- **池中没有任何任务被翻 needs-human**：任务仍 `status: ready`；`grep -c 'Needs-Human' tasks/gap-env-demo.md` = 0；`git -C <tmp> log --oneline -- tasks/` 在 run 前后**同为 1 条 init 提交（同 sha）**，`git -C <tmp> status --porcelain -- tasks/` **为空** ⇒ 驱动一个字节都没写进任务体。
- **生产载体**（硬规则 4 推论三：读生产载体，不是只读单测）`.quay/worker-outcome.jsonl`：`{"task":"gap-env-demo","final_state":"failed","quick_death_cause":"environment-fatal","worker_stderr_tail":"API Error: 404 {\"type\":\"error\",\"error\":{\"type\":\"not_found_error\",\"message\":\"model: v4.1flash\"}} (model_not_found)\n"}` ⇒ 生产实例「载体里 `model_not_found` 出现 0 次」这一条被直接修掉（判定面与载体字段同源）。
- **恢复 profiles**：本次故意配坏只发生在**临时 workspace** 的 `.quay/profiles.yml` 上；主仓与任何真实项目的 profiles 未被触碰，无需回滚（临时 workspace 已整体删除）。

**AC3 实跑（真 CLI，⛔ 不是只靠单测）**：同构造夹具下 `QUAY_DRIVER_LEGACY_SUPERVISOR=1 node --experimental-strip-types <worktree>/plugin/scripts/driver-runtime.ts start --kind worker --root <tmp>` ⇒ exit **1**，stderr：

```
quay driver: environment smoke check FAILED — refusing to start the worker driver (nothing was spawned).
  environment-fatal signature "model_not_found": API Error: 404 {"type":"error","error":{"type":"not_found_error","message":"model: v4.1flash"}} (model_not_found)
  这是【环境级】故障：所有 worker 都会以同样方式失败，逐个派发只会把池子里的任务逐个 park。
  修好环境后重试：quay driver start --kind worker
```

且**没有 spawn 任何东西**：`.quay/` 下只有 `config.yml` + `profiles.yml`（无 pid / anchor-desired / control 写入）。**负控制（同构造，launcher 改成 exit 0）**：stdout `environment-smoke: ok — launcher+model resolved and callable` + `started: supervisor pid=… confirmed_ms=501`（exit 0），随后 `stop --kind worker` ⇒ `stopped` ⇒ 「拒启」不是恒真，两臂取值不同。

**AC4 读数（两种跑法都记）**：

- 生产 scoped 命令（= `.quay/config.yml` 的 `scoped_command`，带 `--allow-thin`）：`bash scripts/test.sh --for-task gap-worker-quick-death-environment-fatal-halts-driver --allow-thin` ⇒ **exit 0**，120 用例全绿（含本任务新增的全部用例）。
- ⚠️ 不带 `--allow-thin` 的同一条命令 ⇒ **exit 1**，原因**不是**任何用例失败（同一份 120 用例仍全绿），而是 `test-selection-thin: resolved tests for 2/5 Touches entries (0.40) < 0.5` 这道**选择面**闸。3 条 Touches 无对应测试：`plugin/scripts/driver-runtime.ts`（其测试是拆分片 `driver-runtime-s05.test.mjs`，选择器按 basename 精确配对 ⇒ 不认 `X.test.mjs → X-sNN.test.mjs` 这一拆分约定）、`plugin/test/helpers/worker-driver-fan-in-harness.mjs`（同形，消费方是 `worker-driver-fan-in-s*.test.mjs`）、`tasks/<id>.md`。⇒ 这是选择器的**机制盲点**（硬规则 5b：缺陷成簇——凡 Touches 落在拆分族/harness 上的任务都会撞），**与本实现无关**；本任务未改选择器（越出 Touches，且修它属于另一件事）。

**其它实测读数**：
- `npx tsc --noEmit -p tsconfig.json` ⇒ exit 0。
- `anti-drift-touches-check --task gap-worker-quick-death-environment-fatal-halts-driver --worktree <wt> --merge-target develop` ⇒ `ANTI-DRIFT OK: 4 actual file(s), all within declared Touches (5 glob(s))`。
- `import-graph-check` 棘轮 valueSccs / typeSccs / reverseEdges 仍全 0 —— 环境级签名表放在 Layer 0（driver-runtime.ts）正是为了不造新 value SCC（`worker-driver.ts` 已 import 它，反向会成环 ⇒ 棘轮红）。
- `plugin/test/worker-driver-fan-in-s*.test.mjs`（109）、`worker-driver-resident-s*.test.mjs` + `worker-driver-retry-classification`（63）、`worker-driver.test.mjs`（103）、`driver-runtime-s05.test.mjs`（4）单独跑均全绿。

**本轮补记（2026-09-24，worker 续做轮：修一处假红 + 复跑读数）**：实现与四项 AC 均已在分支上（`be3174fc6`），本轮**未改任何判定逻辑**，只修掉一处**负载相关的假红**并复跑读数：

- **假红成因（约 9 次全文件运行中实测 1 次）**：AC1② 在 `waitFor(载体出现 environment-fatal)` 之后**立即**断言 `drv.events()`，而载体 `worker-outcome.jsonl` 由 `runOneWorker` 落盘（`worker-driver.ts:3873`）、`environment-fatal-halt` 事件要到 `onWorkerFinished`（`:4300`）才写 stdout ⇒ 载体一可见就断言事件 = 与 stdout 管道送达赛跑（**判定与事件都是对的**，只是事件还没到父进程）。AC1① 早已是正确顺序（先等 driver 侧停机控制态，控制态与事件写在同一段代码且在其前）。
- **修法（⛔ 不弱化断言）**：AC1② 的事件断言移到「等停机控制态」之后；两处事件断言都改成有界 `waitFor`。事件若根本不发 ⇒ waitFor 超时返回假 ⇒ 照常红。
- **非空转双向实测（真驱动，⛔ 非 fixture）**：**正臂**——真实驱动事件流里恰有 1 条 `{"event":"environment-fatal-halt","task":"gap-env-b","signature":"cross-task:flaky unknown signature E42"}`，停机原因含签名原文，outcome 为 `gap-env-a=ordinary / gap-env-b=environment-fatal`；**负臂**——把 emit 的前缀临时改成 `xtask:` ⇒ AC1② 在 20.6s（waitFor 预算）干净失败、判词正确；改回后 17/17 全绿。
- **复跑读数（合并 develop 80 个提交之后）**：`node --test plugin/test/worker-driver-fan-in-s05.test.mjs` ⇒ exit 0 / 17 全绿（连跑 5 次不变）；`bash scripts/test.sh --for-task gap-worker-quick-death-environment-fatal-halts-driver --allow-thin` ⇒ **exit 0 / 120 用例绿**（与上表同）；merge 后 `git rev-list --count HEAD..develop` = 0 且无 unmerged path。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/scripts/driver-runtime.ts
- plugin/test/worker-driver-fan-in-s05.test.mjs
- plugin/test/helpers/worker-driver-fan-in-harness.mjs
- tasks/gap-worker-quick-death-environment-fatal-halts-driver.md

**本轮补记（2026-09-24，worker 续做轮 2：诊断上一轮 suite 红）**：上一轮 `step=suite` 红（`goal-driver-s02/s04/s10/s12/s13` + `goal-invariants-standing` 六个文件，形如「缺口立案侧：违反且无在飞任务 ⇒ standing-violated（可立案）」实际得 `standing-ok`；`sweepFrozenAcs` 读数落 `not-evaluated`）**既不是本任务 delta，也不是用例缺陷**，而是**环境泄漏造成的陈旧读数**：driver anchor 把 `QUAY_GOAL_ACCEPTANCE_ACTIVE=1` 继承进 suite 子树，goal 族判据因此执行不出结论 ⇒ 落到三态里的 `not-evaluated`。真因已由独立任务 `gap-goal-acceptance-active-leaks-into-suite-via-driver-anchor-env` 修复（`e1a1f1b1b`：`scripts/test.sh:216` 入口 `unset FORCE_COLOR QUAY_GOAL_ACCEPTANCE_ACTIVE`，2026-09-24 03:14 落地 develop）；上一轮 suite 日志时间戳为当日 00:56 ⇒ **早于该修复**，故读到的是修复前的环境。三方取证：① 把本任务 delta 四个文件全部回退到 develop 版本后，同文件**照旧红**（⇒ 与本 delta 无关）；② 在**主检出**（非本分支）跑同文件**同样红**（⇒ 是 develop 级，不是分支级）；③ 在**泄漏仍存在于当前 shell** 的前提下经 `bash scripts/test.sh plugin/test/goal-driver-s13.test.mjs plugin/test/goal-driver-s12.test.mjs` 跑 ⇒ **7/7 全绿**（入口 unset 对真实 fan-in 路径生效——`suite-driver.ts:378` 正是 `bash <wt>/scripts/test.sh --buckets <task>`）。本轮**未改任何判定逻辑、未改实现**（分支 7 提交原样保留）。合并 develop（`24f59dd22f9163ee267738f6f41ba9a9e781ee3d`，落后 0、无 unmerged path）后复跑 `bash scripts/test.sh --for-task gap-worker-quick-death-environment-fatal-halts-driver --allow-thin` ⇒ **exit 0 / 126 用例全绿 / 0 失败**（上轮读数 120，增量来自 develop 新并进来的用例），scoped-gate 缓存已按 merge-time develop sha 写入。
## Needs-Human

**执行 2026-09-23T19:46:23.096Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：suite 红但归因不出任何失败测试文件（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (parser attributed no failing file (failure-line count unavailable on this judgment)); stopping instead of spending another worker session
- 失败步/判词：adopted orphan worker exited (exit code unobservable) — task status=ready (not done) and leftover worktree task/gap-worker-quick-death-environment-fatal-halts-driver still present
- run_id：wk-prod-anchor




**本轮补记（2026-09-24，worker 续做轮 3：AC 逐条复验 + 上一轮红测的双面对照归因）**：本轮**未改任何实现**（分支 11 提交原样保留），只做 AC 逐条复验与上一轮 fan-in suite 红的归因对照。

- **AC1 复验**：`node --test plugin/test/worker-driver-fan-in-s05.test.mjs` ⇒ **exit 0 / 17 用例全绿 / 0 失败**。
- **AC4 复验**：`git merge develop` ⇒ `Already up to date`（`git rev-list --count HEAD..develop` = 0，无 unmerged path）；随后 `bash scripts/test.sh --for-task gap-worker-quick-death-environment-fatal-halts-driver --allow-thin` ⇒ **exit 0 / 126 用例绿 / 0 失败**。`test-selection-thin: 2/5 Touches (0.40) < 0.5` 告警仍在（**选择面**闸，非用例失败，与本实现无关，见上文 AC4 读数）。scoped-gate 缓存已按 **merge 时刻** 的 develop sha `74def5f8`（实测是 HEAD 的祖先）写入。
- **上一轮 suite 红（`goal-driver-s02/s04/s10/s12/s13` + `goal-invariants-standing`）双面对照 ⇒ 复现的是环境泄漏，不是本 delta**：本 worker shell 实测 `QUAY_GOAL_ACCEPTANCE_ACTIVE=1`（泄漏正在飞）——① 直接 `node --test plugin/test/goal-driver-s13.test.mjs plugin/test/goal-driver-s12.test.mjs` ⇒ **exit 1**，判词逐字复现上一轮红（`actual: 'not-evaluated'` vs `expected: 'violated'`）；② **同一 shell、同一对文件**，只把入口换成 `bash scripts/test.sh <同两文件>` ⇒ **exit 0 / 7 用例全绿**。两臂只差入口 ⇒ 差异来自 `scripts/test.sh:216` 的 `unset … QUAY_GOAL_ACCEPTANCE_ACTIVE`（即 `e1a1f1b1b`，已是本分支祖先），与本任务 delta 无关。
- **AC3** 的四态由 s05 用例覆盖并通过（真跑 `runEnvironmentSmoke`；含「读假 launcher 实际收到的 argv 以证明用的是解析出的 launcher+model」这条非空转条，与「四态两两不同形」断言）；其**真 CLI 臂**读数见上文（`driver-runtime.ts start --kind worker` 拒启 + launcher exit 0 的负控制）。
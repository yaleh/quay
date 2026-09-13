---
id: gap-watchdog-killed-round-writes-no-verification-round-record
title: 静默看门狗杀死的轮在 verification-round.jsonl 一行都不写（实证 9 次 / 6 天）——已宣告「轮次不落记录」族的第三个子类
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**来源**：2026-09-13 本会话对「worker 退出时未落地率 62%」的实证调查。本条是调查中**判定载体侧**的发现。

**读数（发生率：9 次 / 6 天，逐条交叉核对过）**：
`.quay/fan-in-step-trace.jsonl`（11080 行）的 `suite-end` 步里，`reason` 为 `silence watchdog killed the suite (no output ≥ silence timeout)` 共 **9 次**（2026-09-07 ~ 2026-09-12，**9 个不同任务**，`wall_ms` 90 万 ~ 143 万 ≈ 15–24 分钟）。
逐条用 taskId 交叉核对 `.quay/verification-round.jsonl`：**9 次全部在「被杀那一轮」的时间窗内没有任何记录。**
举一个可复核的例：`gap-ac168-criterion-sh-incompatible` 的看门狗触发于 20:51:39Z（21.8 分钟），而该任务在 `verification-round.jsonl` 里唯一的记录是 **21:00:34Z 的 green —— 那是【后一轮】**，不是被杀的这一轮。

**危害形态（硬规则 3b 的镜像半边，这是本条的理由而不只是「少了个日志」）**：
任何以 `verification-round.jsonl` 为输入的判定器，会把**「没评估」读成「没问题」**。
硬规则 3b 的原话：判定机件在读不懂输入时，不得返回与**合格**同形的值；而**「没有检查」是已知的空白，「一个恒绿的检查」是一个假的保证，后者更贵**。
本仓库已有三个同形前例，全部退出码 0、结构完整、数字合理：`task-status-drift-check.ts:126`（读不到 AC 段 ⇒ 返回零未勾 ⇒ 判为完成）、`slot-refill.ts:373`（`total===0` ⇒ 第一行就判 landed）、`outer-tick-log-check.sh`（解析不出 ACTION ⇒ 每条分支跳过 ⇒ 打印 `PASS — is self-consistent`）。
**现实后果已经在发生**：判这种情形当前只能**手工**做——记录在案的诊断手法是「找**缺 `__PERFILE__` 行**的那个文件 + 查进程树是否仍活着，别重跑碰运气」⇒ 而一条写下来的记录正是让这套手工取证不必要的东西。

**⇒ 本条是一个【已被宣告的族】的第三个子类（⚠️ 立案时必须写明，否则会被判重）**：
`gap-verification-round-static-fail-no-record`（**done**）正文里自己就写下了这个**族**名——**「未完整跑完的轮次结构性不落记录」**，并修了其中两个子类（静态闸 fail / 动态测试 fail），落法是 `pre-verified-round-record.ts --state red` + 两个调用方在 suite 红时写红轮记录。
**但它没有覆盖本子类，原因是机制性的两条**：
① 它的触发条件是 `sr.outcome === "red"`，而**看门狗杀产生的是独立取值 `hung`**；
② 该分支的红轮写入被 `recordDelegatedRound` 的 `if (!suiteRunsOutsideRunner(worktree)) return` **提前返回** —— quay 自身路径靠 runner 写记录，而 **runner 被 SIGKILL 整组杀死后写不成**。
`gap-fan-in-realsuite-bypasses-verification-round-ledger`（**done**）是同族第二实例（真跑 suite 分支零入账）。
**⇒ 本条 = 该族第三成员，是硬规则 5b（在某处修好 X ≠ X 只在那一处；缺陷是成簇的、兄弟实例常在同一文件甚至同一行）的经典形态。**

**⚠️ 前提负控制：一个我原本写进来的半边已被证伪，特此记下以免它被再次提出。**
原假设含「`reason:"infra-error"` 的轮也一行都不写」⇒ **为假**。`verification-round.jsonl` 里**确有 4 条** `state=red / reason=infra-error`，其中 **3 条是 worktree-scope 带 taskId 的**（round 1031 `gap-quay-init-closure-assertion-first`、1115 `gap-writestate-torn-read-assertion-load-sensitive-flaky`、1412 `gap-dashboard-workprogress-row-paired-columns`，均带 `void:true`）。
⇒ **infra-error 半边不属于本条范围。** 若要追问，剩下的问题是另一个形状——「`void:true` 是否被下游消费者正确读为 NOT-EVALUATED」——⛔ 那需要先量它的实际误读发生率，本条不承担。

**与相邻已落地任务的分工（均非重复）**：
- `gap-mech-fan-in-suite-silence-watchdog-fired`（done）修的是**同一个看门狗**的另一个轴：「suite 真挂死 vs 看门狗误杀正常静默」的**可分性**（漏传 env 导致误杀），⛔ 不碰记账。本条是「杀掉之后载体上一行都没有」。两条互补。
- `gap-suite-state-has-no-reason-axis-failed-aborted-infra`（done）确立了 `failed / aborted / infra-error` 词表，但在**另一个载体**（`full-suite-state.json`，见 `plugin/scripts/suite-state-trigger.ts:97` 的 `SuiteStateReason`）⇒ 它是本条的**词表来源**，不是本条的解。
- `gap-not-evaluated-checkers-never-persisted` / `gap-not-evaluated-harness-third-state`（均 done）= 同一认识论根（硬规则 3b），不同对象（checker 层），⛔ 不是同机制。

## Plan

1. 定位轮记录的写入点与两条绕过路径：`plugin/scripts/suite-driver.ts:211-234`（看门狗判定与 `error` 文本，`SILENCE_MS_DEFAULT` 见 `:45`，缺省 15 分钟）→ 记录写入侧（`pre-verified-round-record.ts` / `recordDelegatedRound` 的 `suiteRunsOutsideRunner` 提前返回）。搞清「runner 被整组 SIGKILL 之后，谁还活着能写这条记录」——**这是本条的真实设计问题，不是加一行 append 就完**。
2. 让看门狗路径**也写一条记录**，`reason` 取**独立值**（如 `watchdog-killed`）且带 `evaluated:false`：⛔ 不与 `failed`/`gate-failed` 共用取值，⛔ 也不伪装成绿。
3. ⛔ **不改为 fail-closed 阻塞在飞任务** —— 参照同族既定裁定：当场改 fail-closed 会立刻让套件红并挡住在飞任务，**而「说实话」零代价**（退出码不变，取值可区分）；fail-closed 留到该判据真正具备输入之后。
4. 按硬规则 5b 在同一载体里枚举**还有哪些取值/路径**同样不落记录（`hung` 之外是否还有第四、第五个），把命中数与清单贴进提交。

## Acceptance Criteria

- [x] AC1（与合格不同形·可取假·核心）：人为触发一次看门狗杀死（用 `QUAY_TEST_SUITE_DRIVER_SILENCE_MS` 传小值，或等价 seam），断言写出的记录与一次正常绿轮**结构上可区分**。判据：两条记录的 `evaluated` 字段取值不同（`false` vs 缺省/`true`），且 `reason` 为 `watchdog-killed`；两条记录原文贴进读数段。⛔ 取假形态：两者同形、或看门狗路径仍然一行不写 ⇒ 未达成。〔取证见 Readings/AC1：同 writer 的两条原文 + 真实生产绿轮原文 + 正常红轮负控制〕
- [x] AC2（runner 被杀后仍有人写·可取假·本条的真实设计判据）：在**被 SIGKILL 的是整个 runner 进程组**这一前提下，记录仍然出现。判据：干跑一次真实的整组杀（⛔ 不是只杀子进程），事后载体中存在该轮记录。⛔ 取假形态：整组杀后记录缺席，而只杀子进程时才出现 ⇒ 说明写入点仍在被杀的一侧，未达成（这正是既有 `recordDelegatedRound` 提前返回没能覆盖本子类的根因）。〔取证见 Readings/AC2：孙进程 pid 死亡 + 台账原文 + 双向控制 + 两个方向的可失败控制〕
- [x] AC3（缺行数对账·可取假·⚠️ 零计数要走正样本干跑）：对同一窗口做两个计数——①`fan-in-step-trace.jsonl` 里 `step` 含 suite ∧ `ok=false` ∧ `reason` 含 `silence watchdog` 的条数；②`verification-round.jsonl` 里同窗口 `reason=watchdog-killed` 的条数。判据：落地后窗口内**差值 = 0**，或差值的每一条都有显式解释；两个计数与差值写进读数段。⚠️ **若差值算出来是 0，必须把谓词 ② 对着一个【已知存在的看门狗轮】干跑一次**证明它确实命中（硬规则 2 的零计数配套动作：非零查「命中的是不是我要的」，零查「谓词对真样本命不命中」；否则 0 可能来自谓词不命中任何东西）。〔取证见 Readings/AC3：9 vs 0，差值 9（修前缺口，与立案读数吻合）；② 的零计数已走正样本干跑（命中 1/3）；另附 worker-outcome 长窗口 19 的对账说明〕
- [x] AC4（生产载体验证·读产物，⚠️ 允许 not-evaluated）：落地后窗口内，`verification-round.jsonl` 含 ≥1 条**实现落地时刻之后**产生的 `evaluated:false` 记录。⚠️ 若窗口内**未自然发生**看门狗杀死（历史发生率 9 次 / 6 天，但不保证）⇒ 该 AC 记 **not-evaluated** 并写明窗口长度，⛔ 不得用注入数据记为通过（硬规则 4 推论三：一个只能被 fixture/注入 seam 满足的判据只证明「能产出」，不证明「已产出」；⊢ 反例判据：把注入 seam 关掉后仍能通过，它才是测量）。〔取证见 Readings/AC4：**not-evaluated**，窗口 ≈20 分钟，窗口内无自然看门狗杀〕
- [x] AC5（⛔ 不引入阻塞，可取假）：判据：落地后窗口内 `mfi-` 轮的 `exited-not-landed` 比例**未因本改动上升**（给出落地前后两个读数）。⛔ 取假形态：比例上升且无法排除本改动 ⇒ 必须说明并回退到「只记录、不影响控制流」。〔取证见 Readings/AC5：落地前七日读数 591/301=0.509；落地后窗口 0 长度 ⇒ not-yet-observable；控制流逐字不变的对照见同段〕
- [x] AC6（硬规则 5b 的族成员枚举，⛔ 非布尔）：枚举该族**还有哪些「轮未完整跑完」的取值/路径不落记录**（`hung` 之外）。判据：产出一张表，每行（取值或路径 / 是否落记录 / 若不落则该不该修），并给出**命中数**；标为「该修而未修」的须实际立案并附任务 id。⛔ 写不出这个数 ⇒ 视为只修了被报出来的那一个（本族前两次就是这么一个一个被发现的）。〔取证见 Readings/AC6：8 行表，每行带生产命中数；「该修而未修」仅 1 条，已立案 `gap-crash-watchdog-round-ledger-not-written`〕

## Readings（AC 逐条取证 — 2026-09-13）

**实现落地提交**：`8426ef65a` + `6b905415b`（task 分支）；develop 落地由本轮 fan-in ff 完成。
**被测文件**：`plugin/scripts/{pre-verified-round-record,worker-driver,suite-driver}.ts` + 两个测试文件。

### AC1 — 与绿轮结构上可区分（两条原文）
```
GREEN  (同 writer)：{"state":"green","evaluated":true,"reason":null,"failures":null}
KILLED (同 writer)：{"state":"red","evaluated":false,"reason":"watchdog-killed","failures":null}
```
真实生产绿轮（`.quay/verification-round.jsonl` 原文抽字段，**无 `evaluated` 键**——那是另一个 writer）：
```
{"round":21,"state":"green","reason":null,"commit":"fe90447949eac17e4c2f49f7f0ff265192286c21","scope":"main"}
```
⇒ `evaluated` 取值不同（`true` / `false`），而真实生产绿轮是**缺省**——两种形态都与 `false` 可区分；`reason=watchdog-killed` 且 ⛔ 不等于 `failed` / `gate-failed`；`failures` 缺席（⛔ 空数组会读成「跑了、什么都没失败」）。
**负控制**：正常红轮仍是 `evaluated:true + reason=failed`（单测 `AC1 负控制` 钉住）——⛔ 若 NOT-EVALUATED 形状把红轮也吞掉，就再分不出「没评估」与「评估了、失败」。
**可失败控制**：见 AC2（两个方向实测报红）。

### AC2 — 整组 SIGKILL 之后记录仍出现（本条的真实设计判据）
干跑（真实 git worktree 夹具 + 真实 `runMechanicalFanIn`；suite = 起一个孙进程记 pid 后转静默）：
```
fan-in outcome: red | step: suite
grandchild pid: 3638197 | still alive after the kill: false   ← 被杀的是整组，不是只杀直接子进程
ledger exists: true
RAW LEDGER LINE:
{"round":1,"startedAt":"2026-09-13T05:58:13.859Z","durationMs":2023,"laneCount":16,"load":9.32,"state":"red","evaluated":false,"runner":"inner","scope":"worktree","commit":"02124207280262daa6919ce177c221fb5c129f57","preverified":false,"taskId":"gap-wdk-ac2-probe","runId":"mfi-gap-wdk-ac2-probe-1789279091683-fecf27","cpu_time_s":null,"cpu_source":"not-wired","reason":"watchdog-killed","phase_overlap":false,"nproc":16,"concurrentSuiteSlots":1,"concurrentSuitesRunning":1}
driver pid: 3636339  （writer —— 在【被杀组之外】）
```
**双向控制**（`worker-driver-fan-in.test.mjs` 新增 1 条测试；同一夹具，只换 suite 命令）：
- 绿轮（quay 形态）⇒ 台账**不存在**（runner 是它的 writer；本层补写 = 双写）；
- 看门狗杀（quay 形态）⇒ 台账**存在**且恰好 1 行。
**可失败控制（两个方向，均实测报红，之后 `git checkout` 归位并核过 `git status` 干净）**：
```
去掉 hung 分支的写入（回到修前形态）  ⇒ ✖ 「看门狗杀死的这一轮【必须】留下台账行」  fail=1
去掉 force（写者仍留在被杀的一侧）    ⇒ ✖ 同一断言失败                          fail=1
```

### AC3 — 两个计数与差值（同一窗口）
```
窗口 = fan-in-step-trace.jsonl 的覆盖窗：2026-09-04T06:18:05Z .. 2026-09-13T05:53:01Z
① trace : step 含 suite ∧ ok=false ∧ reason 含 "silence watchdog"  = 9
          （看门狗子窗 2026-09-07T20:51:39Z .. 2026-09-12T14:43:35Z，9 个不同任务，3 个 runId）
② ledger: reason == "watchdog-killed"                             = 0
差值 = 9   ← 修前缺口，与本条立案读数（9 次 / 6 天）逐字吻合
```
⚠️ **② 是零计数 ⇒ 执行了零计数配套动作**（把谓词对着已知存在的样本干跑）：
```
样本 = 2 条真实生产绿轮原文 + 1 条经【真 writer 的 CLI】写出的 watchdog-killed 行
谓词 'reason == "watchdog-killed"' 命中 1 / 3 行
⇒ 这个 0 的含义是「落地以来没有再发生看门狗杀」，不是「谓词命不中任何东西」
```
**⚠️ 两个读数的对账（不留给读者自己 reconcile）**：`worker-outcome.jsonl` 上同形计数在**更长窗口**（2026-08-23..09-13）为 **19**（13 个任务：08-27 11、08-28 4、08-29 2、09-02 1、09-11 1）——多出的 10 条落在 `fan-in-step-trace.jsonl` 窗口（09-04 起）**之前**，两读数一致、不矛盾。
**修后归零**要等下一次自然看门狗杀（见 AC4）。

### AC4 — 生产载体验证：**not-evaluated**
```
窗口 = [实现落地 2026-09-13T05:56Z , 提交本读数 2026-09-13T06:1xZ]  ≈ 20 分钟
窗口内 verification-round.jsonl 最新行：state=red / reason=failed
        （taskId=gap-quay-server-lightweight-peer-identity-spike，startedAt 05:21Z）
窗口内无自然发生的看门狗杀 ⇒ 无 evaluated:false 行可读
```
⇒ 记 **not-evaluated**，窗口长度 ≈ 20 分钟。⛔ 未用注入数据记为通过：AC2 的注入干跑只证明「能产出」（硬规则 4 推论三），「已产出」要等生产自然发生——历史发生率 9 次 / 6 天 ≈ 每 16 小时一次，可复核。

### AC5 — 未引入阻塞（落地前读数 + 结构对照）
```
落地前（.quay/worker-outcome.jsonl，mechanical_fan_in 为对象的行）：
  2026-09-06..09-12 七日合计  total=591  exited-not-landed=301  ratio=0.509
  最近三个整日：09-10 61/18=0.295 · 09-11 64/31=0.484 · 09-12 30/10=0.333
  看门狗成因子集：19 行，全部 exited-not-landed（本就如此，且正是本改动要记账的对象）
落地后：窗口 0 长度，尚不可观测 ⇒ 该半记 not-yet-observable（同一脚本可重算）
```
**结构对照（控制流逐字不变）**：改动只在该行**增加一次 best-effort 记录写入**（`appendDelegatedSuiteRound` 全程 try/catch，永不抛），`return failSuite(...)` 逐字未动。既有测试 `AC4 (gap-fan-in-subprocess-hang-timeout-recovery)` 对**同一夹具**断言 `outcome=red / step=suite`，修前修后都绿；新增测试同样断言 `r.outcome === "red" && r.step === "suite"` ⇒ 控制流未变，退出码路径未变。

### AC6 — 族成员枚举（硬规则 5b 的产物）
族 = 「轮未完整跑完 ⇒ `verification-round.jsonl` 不落记录」。命中数为**生产实测**（同一批载体）：

| # | 取值 / 路径 | 落记录？ | 该不该修 | 命中数 |
|---|---|---|---|---|
| 1 | `outcome=hung`（driver 静默看门狗 SIGKILL 整组） | 修前**不落** → **修后落**（`evaluated:false` + `reason=watchdog-killed`） | **本任务已修** | 9（trace 窗口）；worker-outcome 长窗 19 / 13 任务 |
| 2 | `spawnFailed`（suite 从未起来） | 修前不落（quay 形态）→ **修后落**（`reason=spawn-failed`） | **本任务一并修**（同一行、同根：预定 writer 不在路径上） | 0（生产未发生；结构上可达） |
| 3 | runner 被**不可捕获地**杀死（外部 SIGKILL / OOM）⇒ crash-watchdog 写 `full-suite-state.json` `reason=crashed` | **不落**（round 台账零行） | **该修而未修 ⇒ 已立案** | state 载体 1 次（08-12）；round 载体 0 行 |
| 4 | runner **自己的**静默看门狗（进程内；runner 存活） | **落**（`roundReason = finalState.reason` ⇒ `hung` / `timeout`，`full-suite-runner.ts:3514`） | 不需要——与 #1 是两条不同的看门狗（这条只杀子进程、runner 活着写得到） | — |
| 5 | suite 之前的闸失败（merge-develop 21 / anti-drift 20 / scoped-gate 26 / typecheck 1） | 不落 | **不修**——这一轮根本没有 suite 轮；且已有可区分载体（`fan-in-step-trace` 的 per-step `ok=false` + `worker-outcome.mechanical_fan_in.step/reason`） | 68 |
| 6 | suite 真红（测试失败 / 静态闸 / perfile / tmux-leak） | **落** | 不需要 | 352 failed + 111 gate-failed + 1 static-check |
| 7 | `infra-error` / `aborted` 红轮 | **落** | 不需要（其下游 `void:true` 误读问题已被前提负控制排除，见 Proposal） | 4 + 2 |
| 8 | doc-only delta / reuse skip（`suite-skip`） | 不落（设计如此） | 不修——没有 suite 轮，且 suite-capture 显式 `full_suite_ran=false`，与「跑了没记录」可分 | — |

⇒ 命中数与前 3 条（#1/#2/#3）已在表内。标为「该修而未修」的**仅 #3**，已实际立案：**`gap-crash-watchdog-round-ledger-not-written`**（status=todo，labels=[gap]，AC 5 条；`task_check`：shape=plan、proposal/plan/ac/dod 四件套齐、`eligible to move to ready`）。该条的落法正是复用本任务新增的 `--not-evaluated <token>` 形状（token 取 `runner-died`）。

### 测试读数
```
plugin/test/pre-verified-round-record.test.mjs             69 tests  0 fail  （新增 4 条）
plugin/test/worker-driver-fan-in.test.mjs                  85 tests  0 fail  （新增 1 条，双向控制）
plugin/test/worker-driver.test.mjs                         92 tests  0 fail
plugin/test/suite-driver.test.mjs                          14 tests  0 fail
plugin/test/third-party-capability-degradation.test.mjs     7 tests  0 fail
plugin/test/fan-in-driver-mechanical-orchestration.test.mjs 13 tests  0 fail
```

## Definition of Done

- 看门狗路径的记录写入落地；纯函数部分有单测，且单测含**可失败控制**（把写入去掉即红——⛔ 一个不可能报红的测试等于没接线，同族第二实例的教训：「不产生新红」被当成接线成功的证据，而那正是恒绿检查会给出的结果）。
- AC1 的两条记录原文、AC2 的整组杀干跑读数、AC3 的两个计数与差值（含零计数时的正样本干跑）、AC6 的族成员表，全部落进任务体读数段。
- ⛔ **不把看门狗路径改成 fail-closed**（那需要先具备输入，是另一件事）；⛔ 不动 `gap-mech-fan-in-suite-silence-watchdog-fired` 管的「误杀可分性」那个轴；⛔ 不承担 `infra-error` / `void:true` 的下游误读问题（前提已证伪，见 Proposal）。
- ⚠️ **Touches 补充义务**：Plan 1 定位出的记录写入侧文件（`pre-verified-round-record.ts` / `recordDelegatedRound` 所在文件等）必须在提交前追加进本任务 `## Touches`——fan-in 的 anti-drift 是 HARD-FAIL 步，读 worktree 内任务文件且只算已提交 delta，提交了未声明的文件即红。

## Touches

- tasks/gap-watchdog-killed-round-writes-no-verification-round-record.md
- plugin/scripts/suite-driver.ts
- plugin/scripts/pre-verified-round-record.ts
- plugin/scripts/worker-driver.ts
- plugin/test/pre-verified-round-record.test.mjs
- plugin/test/worker-driver-fan-in.test.mjs

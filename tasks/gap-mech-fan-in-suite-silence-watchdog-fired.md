---
id: gap-mech-fan-in-suite-silence-watchdog-fired
title: 机械 fan-in suite 步 15min 静默看门狗触发——suite 真挂死 vs 看门狗对正常静默误杀未分（web-session
  生产任务 15:15 suite 步 red；旧看门狗任务方向相反已作废）
status: ready
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

机械 fan-in step 7（suite）跑 `scripts/test.sh --buckets <task>`（全量 suite，实测 19+ min），由 `suite-driver.ts` 的静默看门狗兜底（`SILENCE_MS_DEFAULT = 15 * 60_000`，即 15min 无输出 ⇒ 判挂死 ⇒ SIGKILL）。首个机械 fan-in 生产任务 `gap-web-session-drops-queue-operation-records`（15:15）在 suite 步 red：`worker-outcome.jsonl` 记 `mechanical_fan_in:{outcome:red,step:suite,reason:"suite hung: silence watchdog killed the suite (no output ≥ silence timeout)"}`。

**两个可能方向（未分，须先分再修，硬规则 3b：不得与「真挂死」同形）**：
- **A. suite 真挂死**（看门狗正确兜住）→ 有底层挂死根因待查。前身任务 `gap-fan-in-per-task-suite-no-silence-timeout-watchdog` 已诊断出同类根因（`--test-timeout=0` + 某 `waitFor()` 只保护一种 await 写法），但那是 ac143 的；web-session 是不同任务，未必同根。
- **B. 看门狗误杀**（suite 在跑但 ≥15min 输出不可见）→ 阈值/观测面对全量 suite 的正常静默段不适用。对照：已退役 `full-suite-runner.ts` 用 `SUITE_SILENCE_MS=15min` + `SUITE_MAX_RUNTIME_MS=45min`，即「15min 静默判挂」本就是给「最长可跑 45min」的外层全量套件设计的；把它平移到 per-task `--buckets` 套件，静默段语义未必成立。

**B 方向子形态（2026-08-27 补，fan-in suite watchdog 新证据）**：不只「测试长静默被误杀」，还有「**等锁/启动段静默被判挂**」——hung 判定不携带成因，**排队等单飞槽、启动阻塞、真挂死三者同形**（硬规则 3b / cause-carrier 有损投影）。实测 serial-install-copy 机械 fan-in 第一轮（17:07–17:37）：scoped 门后 spawn suite 无声排队等单飞槽（槽被 poll-timeout 的 suite 占——**该占槽 suite 是 `gap-full-suite-lock-hold-watchdog-threshold-shorter-than-fan-in` 缺陷的受害者**：16:48:12 被 1800s 切锁后无锁空跑、占槽 960s），最后输出 17:22:21 拿到槽、随后 900s 静默 load 仅 2–4/16 核 → 17:37:21 被 15min 静默看门狗 SIGKILL；决定性读数 = 该 worktree `.quay/suite-bucket-effective.jsonl` 今天 0 条 ⇒ suite 死在锁后、跑任何测试之前。两个看门狗缺陷在此处**连环**：1800s 切锁 → 僵尸 suite 占槽 → 排队的 serial-install 被 15min 静默杀。代码可证 `scripts/test.sh` 等锁循环（`flock -w 1`）零输出——排队对静默看门狗不可见。同 trap 险些二连：poll-timeout 自己的 suite 16:51:32 起无声排队 880s（<900s，20s 余量险过）。

**⊢ 无人覆盖（立案前按机制词 dedup 核实）**：`gap-fan-in-per-task-suite-no-silence-timeout-watchdog` 已 `superseded`（`superseded_by: gap-fan-in-driver-mechanical-orchestration`），且方向相反——旧 bug = detached suite 完全没看门狗 → 无限等；新 bug = 有看门狗之后仍 15min 触发。`gap-suite-lifecycle-driver-kind`（引入 suite-driver 的 feature 任务）已 done，非 bug 任务。

**案卷留嫌疑（2026-08-27）**：拿锁后 15min 静默段的首要嫌疑是 install-copy 启动段（该任务自己改的代码区；round-2 同 head 跑过 ⇒ 间歇竞态非必挂）。今天三例同签名（web-session 15:15、本立案任务自己 ~16:4x、serial-install 17:37）**大概率不同根**——hung 判定不携带成因，故每例需单独取证，⛔ 不得用一个根因概括三例。

## Plan

1. **先分方向**：取 15:15 那次 suite 的日志/进程态（`suite-driver.ts` 的 `logFile` / `--buckets` 输出），判定是「进程真的卡住零输出」还是「进程活着但输出没被看门狗看到」。**附加现场证据（B 嫌疑加重）**：本任务（gap-mech-fan-in-suite-silence-watchdog-fired）自己的机械 fan-in 也死在 suite 步同一静默杀——worker-outcome 记 outcome=red step=suite reason="silence watchdog killed"、final_state=exited-not-landed，修复 commit 931fdc4dd 未进 develop。「连修静默看门狗的任务都过不了它」的自锁现场。
2. **按方向修**：A → 查底层挂死根因（复用前身 ①② 诊断，⛔ 不假设与 ac143 同根），⛔ 不动阈值；B → 修观测面（非换数字）——`suite-driver.ts:197-226` 静默检测只读 stdout/stderr + 日志 mtime，若 `--buckets` suite 实际写第三条流（别的 log 文件 / 输出缓冲未 flush），观测面漏读 ⇒ 假杀。修法：读 suite 真实写的那条流 + 一个「仍在推进」的直接量（子进程 CPU 时间 rusage 在涨、或测试计数在涨），非只读 mtime。**两条具体修法（2026-08-27 补，B 方向等锁/启动段子形态）**：(a) `scripts/test.sh` 等锁循环每 30s 向 stdout 打一行 `still waiting for suite slot (Ns)` 心跳——有输出即活，排队者不再被判 hung；(b) `/tmp/fan-in-suite-<task>.log` 轮转保留 ≥2 代——本次 `.prev` 只留 1 代导致断口，无法区分「等锁静默」vs「拿锁后启动段挂死」。⛔ 不盲设数值（硬规则 4 推论）；数字是止血不是结论（落笔当轮取真实读数，硬规则 4c）。**相位分离 + 失败归类拆分（2026-08-27 inner 补，机制级）**：等单飞槽段（`test.sh` flock 循环心跳）由槽调度器管、suite 看门狗**不武装**（等槽超时 ≠ 槽内挂死）；跑测试段活性 = 测试计数递增 + 子进程 CPU 时间递增（窗口内无推进才杀）。失败归类拆三独立取值——**等槽超时 / 槽内挂死 / 测试失败 exit N**，⛔ 不得压平成一个 `hung` 标签（cause-carrier 有损投影）。
3. 修完给负控制：一个「真挂死」样本仍被看门狗杀（A 方向）或一个「长静默但正常」样本不被杀（B 方向）。

## Acceptance Criteria

- [x] AC1（能取假，方向已分）：A/B 由一条可区分的读数判定（读日志/进程态，⛔ 非「看门狗触发了」这一同形结论）；（⛔ 仍只有「看门狗 fired」而无 A/B 证据 ⇒ 假）。
- [x] AC2（能取假，修对方向）：修后 mechanical fan-in suite 步对「非挂死」suite 不再 red at suite（若 B），或「真挂死」不再无限等（若 A）；含负控制（修的方向正确，另一方向不误伤）；（⛔ 仍 red at suite 且无方向证据 ⇒ 假）。

## Definition of Done

A/B 方向已分；根因已修；机械 fan-in suite 步不再因静默看门狗误杀/漏杀而 red（负控制通过）。

## Evidence

**方向判定 = A（suite 真挂死），根因 = 机械 fan-in 路径的自我死锁，非测试挂死、非看门狗误杀。**

AC1 可区分读数（读生产载体 + 代码 + 现场复现，⛔ 非「看门狗 fired」同形结论）：

- 生产日志 `/tmp/fan-in-suite-gap-web-session-drops-queue-operation-records.log` 末行停在静态检查失败
  `checker-mutation-check exit=1`，`.exit` 记 `exit=1`、`wall_ms=82358`（82s 快速失败）——但那是【旧
  workflow tee 的那次 suite】，不是机械路径那次。机械路径那次 suite 的输出（driver 的 stdout/stderr
  pipe）不进日志、被丢弃，只在 `worker-outcome.jsonl` 留下 `mechanical_fan_in:{step:suite,reason:"…
  silence watchdog killed …"}`。故「看门狗 fired」本身不区分 A/B——需要进程态/代码读数。
- **可区分的代码读数**：`spawnSuiteAndWait` 的 slot-holder 在 `exec` 前【总是】取单飞槽（`flock -n`），
  随后 `exec bash scripts/test.sh --buckets <task>`；`test.sh` 的 `full_suite_lock_acquire`（test.sh:675）
  在【没有】`QUAY_TEST_SUITE_DRIVER_HOLDS_SLOT=1` 时会对【同一把槽】用自己的新 FD 再 `flock -n`。
  flock 按 open-file-description（同进程不同 FD 也互斥），故再取被 slot-holder 继承下来的 FD 拒绝 ⇒
  卡进 `full_suite_lock_acquire` 的无界 `while` 等槽循环（test.sh:723-729）⇒ **零输出** ⇒ 15min 静默。
  **可区分点 = 「`== single-flight lock … ==` 已打印、而 `acquired … slot` 永不打印」**——正是
  现场复现 CASE A 的末行（见下）。
- 现场复现（负控制的一半）：预持槽 + `env -u QUAY_TEST_SUITE_DRIVER_HOLDS_SLOT bash test.sh --buckets
  <本任务>` ⇒ 末行停在 `== single-flight lock (1 slots …) ==`、exit=124（卡死）；同一预持槽 +
  `QUAY_TEST_SUITE_DRIVER_HOLDS_SLOT=1` ⇒ 打印 `skipping re-acquire` 后正常进入静态检查。两个方向
  相反 ⇒ 读数能区分「真挂死」与「跳过」。

AC2 修对方向（根因修，非阈值修——⛔ 不盲设数值，硬规则 4 推论）：

- 根因：机械 fan-in 路径（`worker-driver.ts` `runMechanicalFanIn`）调 `spawnSuiteAndWait` 时【漏传】
  `env:{QUAY_TEST_SUITE_DRIVER_HOLDS_SLOT:"1"}`，而常驻 loop（suite-driver.ts:394）与 `--run`
  （suite-driver.ts:507）两调用点都传了——不对称即缺陷。
- 修法：把「driver 持槽」从【caller 的选择】上收为【`spawnSuiteAndWait` 的结构不变式】——slot-holder
  总是取槽后才 `exec`，故 `spawnSuiteAndWait` 在 spawn env 里强制注入
  `QUAY_TEST_SUITE_DRIVER_HOLDS_SLOT:"1"`（放在 `...(env ?? {})` 之后，⛔ 不被 caller 覆盖），
  并删除常驻 loop / `--run` 两处冗余传参（单一真相源）。
- 负控制（修的方向正确，另一方向不误伤）：① 现场复现 CASE B（`HOLDS_SLOT=1`）不再死锁、正常跳过；
  ② 既有 AC3 测试「活着但无输出 ≥N 秒 ⇒ hung」（suite-driver.test.mjs）仍绿——真挂死样本仍被杀，
  看门狗未被误禁用；③ 新增两条测试钉死强制注入（caller 漏传也有、caller 传 `"0"` 也不可覆盖）。

## Touches

- plugin/scripts/suite-driver.ts（静默看门狗阈值/观测面，B 方向；或挂死根因侧，A 方向）
- plugin/scripts/worker-driver.ts（suite 步 silenceMs 透传，如涉）
- plugin/test/suite-driver.test.mjs（静默看门狗 + 长静默负控制）
- tasks/gap-mech-fan-in-suite-silence-watchdog-fired.md（自身）

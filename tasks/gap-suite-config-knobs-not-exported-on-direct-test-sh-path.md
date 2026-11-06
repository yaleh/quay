---
id: gap-suite-config-knobs-not-exported-on-direct-test-sh-path
title: "scripts/test.sh 的 suite: 配置提升没有 export，直接路径上 QUAY_* 旋钮对子进程不可见"
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

**根因（逐行可核）**：`scripts/test.sh:649` 执行 `eval "${suite_cfg}"`，其中 `suite-params.ts --shell` 吐出的形状是 `QUAY_MAX_OVERSUBSCRIPTION="${QUAY_MAX_OVERSUBSCRIPTION:-0.1875}"` 这类**普通赋值**。脚本只有 `set -euo pipefail`（`:165`），**没有 `set -a`** —— 于是这些赋值创建的是 **shell 局部变量**，不是导出的环境变量。

**实测（2026-11-06）**：`eval` 之后该 shell 自己看得见 `QUAY_MAX_OVERSUBSCRIPTION=0.1875`，但

```text
$ node -e 'console.log(process.env.QUAY_MAX_OVERSUBSCRIPTION)'
undefined
```

⇒ 子进程完全看不到它。直接后果：`runner-concurrency.ts --default-test-concurrency` 仍然返回 **128**，而不是配置意图的 **24**。

**影响面（关键，别夸大也别缩小）**：`full-suite-runner` 路径**不受影响** —— 它在进程内把值提升进 `process.env`（`plugin/scripts/full-suite-runner.ts:3109-3113`），所以**生产 fan-in 是正常工作的**。受影响的是**任何直接 `bash scripts/test.sh` 的调用**，包括 scoped 门 `test.sh --for-task` —— 那条路径上 `.quay/config.yml` 的 `suite:` 段**被静默忽略**。这正是硬规则 3b 的形态：配置被读到了、被打印了、看起来生效了，实际对被测对象不可见。

### Proposed fix

把提升段包进 `set -a` / `set +a`，或让 `suite-params.ts --shell` 直接吐 `export VAR="${VAR:-…}"`；并加测试：一个**只在 config 里**设的值能到达子进程（正控），一个已经存在的 env 值仍然胜出（负控）。

**实际修法（取后者，唯一改动点 = 发射器）**：`suite-params.ts --shell` 每行改为 `export QUAY_X="${QUAY_X:-<value>}"`。理由：`--shell` 的输出契约本来就是「可被 `eval` 的提升行」，导出语义属于发射器而不是每个消费者；`scripts/test.sh` 因此不需要第二个 `set -a` 机制（单一定义点，不叠两套）。test.sh 侧只改注释，把「export 是承重的」写在校验点旁。

### Dedup / merge 决定

<!-- dedup-ref -->与 `gap-suite-knobs-config-file-priority`（done）是同一机制的前后两段：那条建立 config < env < CLI 的三级优先并把读面接通到 `test.sh`/`full-suite-runner`，本条修的是它在**直接路径上**的导出缺口（config→shell 的赋值不是 export）。⛔ 不是重新开工那条。按机制去重（`suite-params` / `test_concurrency` / `SUITE` 旋钮）在 todo/ready 池内命中均为 **0** ⇒ 无 open peer；merge-candidate 无 open 任务声明 `scripts/test.sh` 为 Touches ⇒ **独立立案**。

## AC

- [x] 正控（子进程可见）：workspace 只设 `.quay/config.yml` 的 `suite:`（**无**同名 env），从 `test.sh` 内 spawn 的子进程读到配置值 —— `node -e 'console.log(process.env.QUAY_MAX_OVERSUBSCRIPTION)'` 打印配置值，⛔ 不是 `undefined`（贴输出）。
  **读数（修后，子进程是 test.sh 亲自 spawn 的 `node:test` 文件，`.quay` 下同名的临时探针已删）**：
  ```text
  $ bash scripts/test.sh .quay/ac-knobs-child-probe.test.mjs
  [probe] child QUAY_MAX_OVERSUBSCRIPTION=0.1875
  ```
  **同一条命令、把 `plugin/scripts/suite-params.ts` 退回裸赋值的 HEAD~1 版本（负对照，证明读数取假）**：
  ```text
  [probe] child QUAY_MAX_OVERSUBSCRIPTION=undefined
  ```
  ⇒ 修后由 `plugin/test/suite-params.test.mjs` 的常设测试守（`--shell POSITIVE control` + `direct path: … exports every config-declared knob`；后者在 `--for-task` scoped 门里实跑，非 skip：19 tests / 19 pass / 0 skipped）。
- [x] 端到端读数：同一条件下，经 `test.sh` 环境调 `node --experimental-strip-types plugin/scripts/runner-concurrency.ts --default-test-concurrency`，返回**配置推导值**（本机配置下应为 24），⛔ 不是 128（贴两个数）。
  **两个数**：修后 **24**（`RESOURCE_GATE_TEST_NODE_PROCS=0` 把 in_use 固定为 0，隔离掉宿主上别家 suite 的抖动）／ 修前 **127**（同一条命令，`suite-params.ts` 退回裸赋值）。不固定 in_use 的实时读数是 23（当时 `process-budget.sh` 报 in_use=1，`floor((128−1)×0.1875)=23`），同样远低于 128。
  **test.sh 自己的调度头（同一环境的第二个读数）**：
  ```text
  $ RESOURCE_GATE_TEST_NODE_PROCS=0 QUAY_TEST_PLAN_ONLY=1 bash scripts/test.sh
  scheduler: unified group-budget scheduler (serial≤16 lowconc≤16 main≤24)
  ```
  ⇒ main≤24（配置推导）、serial/lowconc≤16（配置值，修前会是宿主推导的 64）。
- [x] 优先级不变（负控）：同时设 env 与 config ⇒ 子进程看到 **env** 值 —— 证明修法不是无条件覆盖。
  **读数**：
  ```text
  $ QUAY_MAX_OVERSUBSCRIPTION=3.5 bash scripts/test.sh .quay/ac-knobs-child-probe.test.mjs
  [probe] child QUAY_MAX_OVERSUBSCRIPTION=3.5
  [probe] child-derived --default-test-concurrency=444
  ```
  常设负控测试：`--shell NEGATIVE control: an already-set env value still wins over the config`（把发射器退回裸赋值时这条**仍绿**，说明它测的不是同一个方向 —— 两个方向各有其测）。
- [x] FAIL-CLOSED 保持：`suite:` 段含非法键 ⇒ `test.sh` exit **2**（贴 exit code），且不跑任何测试。
  **读数**（在 worktree 的 `.quay/config.yml` 的 `suite:` 下临时插入 `bogus_knob: 1`，跑完立刻还原）：
  ```text
  $ bash scripts/test.sh .quay/ac-knobs-child-probe.test.mjs
  test.sh: FAIL-CLOSED reading suite: config — FAIL-CLOSED: .quay/config.yml 'suite:' has unknown key 'bogus_knob' — valid keys are suite_scheduler, phase_overlap, serial_concurrency, lowconc_concurrency, max_concurrent_suites, max_oversubscription, main_tail_stall_pct, memory_max, heavy_threshold_mb, heavy_max_concurrent
  EXIT=2
  ```
  输出里没有任何测试执行行（探针的 `[probe]` 一条都没有）⇒ 退出点在被测对象之前。
- [x] 两条路径取同一真值：直接 `bash scripts/test.sh` 路径与 `full-suite-runner` 路径派生的 `--test-concurrency` **相同**（贴两个数 + 两条命令）。
  **两个数（同为 in_use 固定 0 的可比条件）**：直接路径 **24** ／ runner 路径 **24**。
  ```text
  # 直接路径（读数取自 test.sh 环境里的子进程）
  $ RESOURCE_GATE_TEST_NODE_PROCS=0 bash scripts/test.sh .quay/ac-knobs-child-probe.test.mjs
  [probe] child-derived --default-test-concurrency=24

  # runner 路径（复刻 full-suite-runner.main() 的两步：readSuiteParams → promote-where-env-unset → defaultLaneCount）
  $ RESOURCE_GATE_TEST_NODE_PROCS=0 node --no-warnings --experimental-strip-types --input-type=module -e '
    const sp = await import("./plugin/scripts/suite-params.ts");
    const runner = await import("./plugin/scripts/full-suite-runner.ts");
    for (const [k, v] of Object.entries(sp.suiteParamsToEnv(sp.readSuiteParams(process.cwd())))) {
      if (process.env[k] === undefined || process.env[k] === "") process.env[k] = v;
    }
    console.log(runner.defaultLaneCount(), process.env.QUAY_MAX_OVERSUBSCRIPTION);'
  24 0.1875
  ```
- [x] `bash scripts/test.sh --for-task gap-suite-config-knobs-not-exported-on-direct-test-sh-path --allow-thin` exit 0。
  **读数（merge develop 之后、在 worktree 里实跑）**：`ℹ tests 19 / pass 19 / fail 0 / cancelled 0 / skipped 0`，`EXIT=0`。
- [x] 全量 `bash scripts/test.sh` 绿（由 driver 机械 fan-in 验证）（待外部）。
  ⇒ **本条由紧随本 worker 的机械 fan-in 全量套件裁决**（worker 按规程不跑全量；勾选表示「交棒给 fan-in」，若全量红则 fan-in 拒绝落地）。

## DoD

在真实 workspace（只有 `.quay/config.yml` 的 `suite:` 段、无相关 env）上**直接**跑 `bash scripts/test.sh`，从被 spawn 的 node 进程里读到的 `QUAY_*` 值等于配置值，且 scoped 门的并发不再是 128 —— 两个读数逐字贴进任务体。⛔ 只改 `suite-params.ts` 的输出字符串、或只证明 `full-suite-runner` 路径仍然工作，都不算（那条路径本来就没坏）；判据必须在**直接路径**上取假。

**达成**：直接路径子进程读到 `QUAY_MAX_OVERSUBSCRIPTION=0.1875`（修前 `undefined`），直接路径派生值 24（修前 127），scoped 门 `test.sh --for-task` 在**同一改动**上绿；反方向对照（把发射器退回裸赋值）只让正控变红、负控仍绿 ⇒ 判据在直接路径上取假。

## L_D / L_G（ADR-007 暗轴）

该轴仍暗,理由:本改动是 suite-params.ts 的一词 shell 导出修正（外加一处注释与三条测试），无模块边界或依赖结构变化，archguard L_D/L_G 上没有可读增量。

## Touches

- scripts/test.sh
- plugin/scripts/suite-params.ts
- plugin/test/suite-params.test.mjs
- tasks/gap-suite-config-knobs-not-exported-on-direct-test-sh-path.md

## Blocker

**2026-11-06T10:13:15.655Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=ff: fan-in-ff-merge: suite 证书 — suite_head..tip 恰为本任务的单个 flip-done 提交（身份判定：仅 M tasks/gap-suite-config-knobs-not-exported-on-direct-test-sh-path.md）⇒ 判惰性，⛔ 未调分类器
fan-in-ff-merge: FF FAILED — ! [rejected]            task/gap-suite-config-knobs-not-exported-on-direct-test-sh-path -> develop (non-fast-forward); not a fast-forward. Retry record written (attempt 1). Return to 无锁段 step 1 (merge develop again — 必须 merge 不得 rebase, AC75), re-judge the delta (step 2) and re-run.
fan-in-ff-merge: measure ff_only_locked=false
- run_id：wk-prod-anchor
- session_id：126be5cd-cada-4157-ad7f-150c0ab57068

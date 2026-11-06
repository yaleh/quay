---
id: gap-suite-config-knobs-not-exported-on-direct-test-sh-path
title: "scripts/test.sh 的 suite: 配置提升没有 export，直接路径上 QUAY_* 旋钮对子进程不可见"
status: ready
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

### Dedup / merge 决定

<!-- dedup-ref -->与 `gap-suite-knobs-config-file-priority`（done）是同一机制的前后两段：那条建立 config < env < CLI 的三级优先并把读面接通到 `test.sh`/`full-suite-runner`，本条修的是它在**直接路径上**的导出缺口（config→shell 的赋值不是 export）。⛔ 不是重新开工那条。按机制去重（`suite-params` / `test_concurrency` / `SUITE` 旋钮）在 todo/ready 池内命中均为 **0** ⇒ 无 open peer；merge-candidate 无 open 任务声明 `scripts/test.sh` 为 Touches ⇒ **独立立案**。

## AC

- [ ] 正控（子进程可见）：workspace 只设 `.quay/config.yml` 的 `suite:`（**无**同名 env），从 `test.sh` 内 spawn 的子进程读到配置值 —— `node -e 'console.log(process.env.QUAY_MAX_OVERSUBSCRIPTION)'` 打印配置值，⛔ 不是 `undefined`（贴输出）。
- [ ] 端到端读数：同一条件下，经 `test.sh` 环境调 `node --experimental-strip-types plugin/scripts/runner-concurrency.ts --default-test-concurrency`，返回**配置推导值**（本机配置下应为 24），⛔ 不是 128（贴两个数）。
- [ ] 优先级不变（负控）：同时设 env 与 config ⇒ 子进程看到 **env** 值 —— 证明修法不是无条件覆盖。
- [ ] FAIL-CLOSED 保持：`suite:` 段含非法键 ⇒ `test.sh` exit **2**（贴 exit code），且不跑任何测试。
- [ ] 两条路径取同一真值：直接 `bash scripts/test.sh` 路径与 `full-suite-runner` 路径派生的 `--test-concurrency` **相同**（贴两个数 + 两条命令）。
- [ ] `bash scripts/test.sh --for-task gap-suite-config-knobs-not-exported-on-direct-test-sh-path --allow-thin` exit 0。
- [ ] 全量 `bash scripts/test.sh` 绿（由 driver 机械 fan-in 验证）（待外部）。

## DoD

在真实 workspace（只有 `.quay/config.yml` 的 `suite:` 段、无相关 env）上**直接**跑 `bash scripts/test.sh`，从被 spawn 的 node 进程里读到的 `QUAY_*` 值等于配置值，且 scoped 门的并发不再是 128 —— 两个读数逐字贴进任务体。⛔ 只改 `suite-params.ts` 的输出字符串、或只证明 `full-suite-runner` 路径仍然工作，都不算（那条路径本来就没坏）；判据必须在**直接路径**上取假。

## Touches

- scripts/test.sh
- plugin/scripts/suite-params.ts
- plugin/test/suite-params.test.mjs
- tasks/gap-suite-config-knobs-not-exported-on-direct-test-sh-path.md

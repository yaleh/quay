---
id: AC-915
title: 扩展点：新的 worker 结局处理单元可从 worker-driver.ts 之外注册到 WorkerPool 并生效（开闭原则可取假验证）
status: active
kind: criterion
goal: GOAL-909
criterion: "t=plugin/test/worker-pool-extension-point.test.mjs; if [ ! -f \"$t\"
  ]; then echo \"CAUSE=missing extension-point test $t\" >&2; exit 1; fi; if
  grep -q 'worker-driver' \"$t\"; then echo \"CAUSE=$t references worker-driver;
  a new outcome handler must register through WorkerPool without touching the
  core file\" >&2; exit 1; fi; if ! node --no-warnings
  --experimental-strip-types --test \"$t\" >/dev/null 2>&1; then echo
  \"CAUSE=extension-point test failed: $t\" >&2; exit 1; fi; echo \"OK: a new
  outcome handler registers from outside worker-driver.ts\""
expect: 扩展点判据（DIR-133 裁定 2）：新代码以后落在哪里。正向：WorkerPool 提供结局处理单元的注册面（按 worker 结局 /
  决策种类分派，例如 exited-not-landed 的各决策分支、快速死亡退避、needs-human 终态）；测试文件
  plugin/test/worker-pool-extension-point.test.mjs 只 import
  worker-pool.ts，从外部注册一个合成的结局处理单元，向 WorkerPool
  喂一条合成结局，断言该单元被调用、且它声明的状态转移被应用。该测试文件不得引用
  worker-driver（扩展不靠改中心文件）。反向（能取假）：①立案当轮该测试不存在，判据 exit 1，stderr 为 `CAUSE=missing
  extension-point test`；②测试内必须自带负对照——不注册该单元（或绕过注册表直接调用）时同一断言必须失败，否则视为测试本身空转（硬规则
  4：结构上不可能取假的量不是测量）。⛔ 不以「抽出了一个文件」为达成：判据问的是新结局种类能否不改 worker-driver.ts
  就接入，不是代码被搬到了哪里。
origin: DIR-133（人 2026-10-22 裁定）裁定 2：设计切片必须含扩展点判据；依据 serve（分发器）增量落回中心文件 1% vs
  worker（区域抽取）88%
activatedAt: 2026-10-21T18:56:51.504Z
statusLog:
  - at: 2026-10-21T18:56:51.504Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-21T18:56:51.504Z
---

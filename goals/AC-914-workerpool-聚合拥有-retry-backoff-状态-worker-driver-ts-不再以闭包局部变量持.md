---
id: AC-914
title: WorkerPool 聚合拥有 retry/backoff 状态：worker-driver.ts 不再以闭包局部变量持有
  retryState/backoffState，由 worker-pool.ts 的 class WorkerPool 封装
status: draft
kind: criterion
goal: GOAL-909
criterion: "f=plugin/scripts/worker-driver.ts; n=\"$(grep -cE '^\\s*(const|let)
  (retryState|backoffState)\\b' \"$f\" || true)\"; if [ \"$n\" -ne 0 ]; then
  echo \"CAUSE=worker-driver.ts still declares $n retry/backoff state local(s);
  want 0 (owned by WorkerPool)\" >&2; exit 1; fi; if ! grep -qE '^export class
  WorkerPool\\b' plugin/scripts/worker-pool.ts 2>/dev/null; then echo
  \"CAUSE=plugin/scripts/worker-pool.ts has no 'export class WorkerPool'\" >&2;
  exit 1; fi; echo \"OK: retry/backoff state owned by WorkerPool\""
expect: 正向：runResidentLoop 不再声明 retryState / backoffState 两个闭包局部变量（立案时实测 2
  处：worker-driver.ts:6040 `const retryState`、:6058 `const backoffState`）；二者成为
  plugin/scripts/worker-pool.ts 中 `export class WorkerPool`
  的私有状态，状态转移（计数、needs-human、快速死亡退避）经该类的方法完成，而不是在 onWorkerFinished 闭包里直接改
  Map/Set。反向（能取假）：立案当轮在当前树上运行本判据得 exit 1，stderr 为 `CAUSE=worker-driver.ts still
  declares 2 retry/backoff state local(s)`；把任一变量留回 runResidentLoop，或删掉 `export
  class WorkerPool`，判据即回到红。⛔ 不以「移动了代码」为达成：状态必须由类拥有（私有字段 +
  方法），不是把同样的闭包变量换个文件继续以模块级变量存在。
origin: DIR-133（人 2026-10-22 裁定）裁定 1、2 下的 R2 第一刀；触发读数 = worker-driver.ts
  并发争用（派发器改选 5 次 + 真实合并冲突 6 次）
---

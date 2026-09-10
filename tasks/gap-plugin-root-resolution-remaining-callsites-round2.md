---
id: gap-plugin-root-resolution-remaining-callsites-round2
title: worker-driver.ts 剩 3 处 + cap-from-gate.ts 一处仍锚在
  root/worktree/plugin/scripts——同族第三次撞坑，round2 补齐
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`gap-promotion-driver-ready-pool-check-path-third-party`（ready，worker 在飞）修的是 `promotion-driver.ts:defaultPromotionCheckArgv` + `worker-driver.ts` 三处（`worker-driver.ts` 自引用/`dispatch-worktree-setup.sh`/`suite-slot-lib.sh`）——但**同一份 `worker-driver.ts` 里还有 3 处同形锚点没被那条任务的判据覆盖到**（判据 `grep -n 'path.join(root, "plugin"'` 用的是裸 `root,`，下述三处变量名不同，字面不命中），另有 `cap-from-gate.ts` 一处独立文件：

```
plugin/scripts/worker-driver.ts:3391  path.join(opts.worktree, "plugin", "scripts", "full-suite-runner.ts")
plugin/scripts/worker-driver.ts:3543  path.join(worktree, "plugin", "scripts")            (opts.scriptsDir 缺省值)
plugin/scripts/worker-driver.ts:3924  path.join(opts.root, "plugin", "scripts", "worker-driver.ts")
plugin/scripts/cap-from-gate.ts:258   path.join(repoRoot, "plugin", "scripts", "process-budget.sh")
```

（这些行号是主检出/develop 当前未修状态；`gap-promotion-driver-ready-pool-check-path-third-party` 落地后前 3 个已知锚点消失，本任务剩余 3 处的行号会相应上移，实现时以 `grep` 现读为准，不要硬编行号。）

**根因同族，但实测严重度不同（硬规则 4，不整体假定）**：
- `:3391`/`:3543` 用 `opts.worktree`/`worktree`（第三方项目若走 per-task worktree 分发实现，同样无 `plugin/scripts/` ⇒ `full-suite-runner.ts` 找不到 ⇒ 与 ready-pool-check 同形的 exit 127/Cannot find module，**fail-closed**，会挡住任务落地）。
- `:3924` 是 worker-driver 自身重启/续做时的入口锚点（`opts.root`），第三方项目下同理不可达。
- `cap-from-gate.ts:258` 不同：`readBudgetFromGate` 在 `spawnSync` 失败时返回 `null`，调用方按注释是**fail-open**（"cpu-pressure 带宽上限仍生效，只是没有 budget 上界"）——**不阻塞派发**，只是让跨层进程预算这个次要约束在第三方项目里静默不生效。已实测复现（orangevps `ready-pool-check` 直跑时的 stderr）：`bash: .../process-budget.sh: No such file or directory`，但当时 promotion 仍能继续跑到下一步 ⇒ 印证是软失效不是硬阻塞。

**背景（为何这是第三次独立发现，不是重复立案）**：`gap-plugin-root-resolution-non-skill-entrypoints`（done）修了 `cli/driver.ts` 一处；`gap-plugin-root-resolution-remaining-callsites`（done）逐一分类迁移了另外 11 处（`serve-sessions.ts`/`fan-in/ff-merge.ts`/`mcp-server.ts`/`precommit-guard.ts`/`cli/manager.ts`/`observation.ts`/`serve-send.ts`/两个 `os-anchor-*.sh`）——**但两次枚举都没有覆盖 `promotion-driver.ts`/`worker-driver.ts`/`cap-from-gate.ts` 这一簇**，直到 AC-207 端到端在真实第三方项目上跑起来才第三次撞到（先撞 `driver-shared.ts` 的 resource-gate.sh 锚点、已修，再撞 `promotion-driver.ts` 的 ready-pool-check.ts 锚点、修复中，现在是本任务列的第三批）。⇒ 每次都是"跑到才发现"，从未有人做过针对 driver 家族的全量枚举——本任务范围明确限定在已实测/已读代码确认的这 4 处，不再扩大猜测其他文件。

## Plan

1. `worker-driver.ts:3391`（`opts.worktree` 场景）与 `:3543`（`opts.scriptsDir` 缺省值）改用 `resolveKernelSibling`/等价 kernel-sibling 解析（fail-closed，同 `gap-promotion-driver-ready-pool-check-path-third-party` 的手法，复用它落地的 helper，不再造第二份）。
2. `worker-driver.ts:3924`（`opts.root` 自引用入口锚点）同法迁移。
3. `cap-from-gate.ts:258` `readBudgetFromGate` 的 `process-budget.sh` 路径改用 `resolveKernelPluginRoot()` 拼接（shell 兄弟文件解析，同 resource-gate.sh 修复手法）——⛔ 不改变现有 fail-open 语义（`res.status !== 0` 仍返回 `null`），只改「找不到脚本」这一失败模式的根因。
4. 补双向负控制：无 `plugin/` 的第三方项目场景下 4 处均解析到 shipped `dist/*.js`/`scripts/*.sh`，非 `root|worktree/plugin/scripts/*`；有 `plugin/` 的本仓库场景下行为不变（回归）。
5. 全量 `scripts/test.sh` 绿；在已修复的第三方项目（orangevps `/home/yale/work/ac207-third-party`，或等价新建的无 plugin/ 项目）上重装验证 4 处均不再报错。

## Acceptance Criteria

- [x] AC1（位置判定，四处齐修）：`grep -n 'plugin", "scripts"' plugin/scripts/worker-driver.ts plugin/scripts/cap-from-gate.ts` 归零（不含注释里提到文件名的行——按位置判定，非关键词）。
- [x] AC2（双向负控制）：构造一个无 `plugin/scripts/` 的第三方项目根，`readBudgetFromGate`/`opts.worktree` 场景下的 full-suite-runner 解析/worker-driver 自引用入口解析均命中 shipped `dist/*.js`（或对应 `.sh`），非 `Cannot find module`/`No such file`；反向：本仓库场景（有 `plugin/`）解析结果与迁移前逐字一致（回归不变）。
- [ ] AC3（生产复跑，读真实第三方项目）：在 orangevps `/home/yale/work/ac207-third-party`（或等价项目）重装本次修复后的安装物，`.quay/promotion-round.jsonl`/`.quay/worker-round.jsonl` 不再出现本任务列出的 4 类报错字样。（待外部）
- [x] AC4（全量绿）：`scripts/test.sh` 全量绿（含 `worker-driver.test.mjs`/新增 `cap-from-gate-process-budget-path.test.mjs` 负控制）。

## Definition of Done

- 4 处锚点全部迁移完成，`grep` 归零可复核；真实第三方项目上重装验证通过（AC3）；全量 suite 绿。
- 完成后知会/续做 `gap-ac207-e2e-target-driver-driven-real-commit-task-done` 的 AC2/AC3/AC5——本任务落地是它端到端复跑不再撞第 4/5 个同族坑的前提之一。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/scripts/cap-from-gate.ts
- plugin/test/worker-driver.test.mjs
- plugin/test/worker-driver-fan-in.test.mjs
- plugin/test/fan-in-driver-mechanical-orchestration.test.mjs
- plugin/test/cap-from-gate-process-budget-path.test.mjs
- tasks/gap-plugin-root-resolution-remaining-callsites-round2.md
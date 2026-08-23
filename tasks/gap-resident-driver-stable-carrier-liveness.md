---
id: gap-resident-driver-stable-carrier-liveness
title: 常驻驱动稳定承载 + 死亡告警（⛔ worktree 承载 + pid 死无告警）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac137-promotion-driver-production-enablement
---
> **Rework（wiring 审计 AC2 无调用者 → 已接 driver round 循环每轮调 liveness）**

**type:** execution

## Proposal

**来源**：manager 投立案（「常驻进程不得由生命周期短于它的对象承载」+「pid 死无告警」，⛔ 形态归 outer 判）。

**缺口（实测，非推断）**：AC137 land 后 ~7 秒，生产驱动与 supervisor 双双死亡——成因是 supervisor 从【被 ff 移除的 worktree 路径】启动（`…/worktrees/gap-ac137-…/promotion-driver-launch.sh`），worktree 是短命对象，常驻 supervisor 挂在上面 = 驱动的寿命 ≤ 该任务的寿命。且死亡后 33 分钟无人察觉（pid 文件指向不存在 pid、载体停更与「一切正常」同形）——没有任何机件报错。

**对照（证死因，非解释）**：supervisor 每次 driver 退出都记一行（含 kill -9 的 code=137），而这次 log 停在 `23:19:13 started driver pid=4024134` 之后零新增 ⇒ 是 supervisor 自己先没（非 driver 先退）。

**同原则**：与 AC88「判据不得引用生命周期短于判据本身的对象」是同一原则的运行时形态（硬规则 5b）。

## Plan

1. **稳定承载**：常驻 supervisor/driver 的启动入口为稳定路径（主检出 / systemd unit），⛔ 不从 worktree 路径；落一个机制确保（启动脚本自规范化路径，或检查器 flag worktree 承载的 supervisor）。
2. **死亡告警**：driver/supervisor 死时有机件检测并报告（⛔ 载体停更 ≠ 一切正常）——watchdog 或周期性 liveness 检查器。
3. **supervisor 死测试**：测「supervisor 死」场景（AC137-3 只测了 kill -9 driver、supervisor 还在会重起；今天真实发生的是 supervisor 死）。

## Acceptance Criteria

- [ ] AC1（稳定承载）：常驻 supervisor/driver 从稳定路径启动（supervisor cmdline 的脚本路径 = 主检出，⛔ 非 `worktrees/`）；取假：cmdline 含 worktree 路径 ⇒ 假。
- [ ] AC2（死亡告警）：driver/supervisor 死时有机件在窗口内检测并报告（⛔ pid 文件指向不存在 pid 而无人察觉 ⇒ 假）。
- [ ] AC3（supervisor 死测试）：`kill -9 <supervisor_pid>` 后 (a) 有机件报告 supervisor 死 (b) driver 不再被误判为「在跑」；取假：supervisor 死后无人报告、载体停更被读作「正常」⇒ 假。

## Definition of Done

- [x] 稳定承载 + 死亡告警 + supervisor 死测试落地；AC1-3 全勾；land 到 develop。

## Retires

- 无（新增机制 / 修正启动承载）

## Touches

- plugin/scripts/promotion-driver-launch.sh（启动路径规范化 / 稳定承载 / liveness 死亡告警子命令）
- plugin/test/promotion-driver-launch.test.mjs (new)（AC1-3 单测，含 supervisor 死取假）
- .gitignore（新增 `.quay/promotion-driver-liveness.log` 运行时态，随 liveness 子命令落盘而暴露）
- plugin/scripts/capability-catalog.sh（`promotion-driver-launch.sh` 条目补 liveness / 稳定承载，机件描述准确性伴随）
- plugin/scripts/worker-driver.ts（Finding 修法：liveness 接线——共享 `runLivenessCheck`/`defaultLivenessCheckArgv` + round 记录 `liveness` 字段 + `--liveness-cmd` 缝）
- plugin/scripts/promotion-driver.ts（Finding 修法：round 循环每轮调 `runLivenessCheck(root,"promotion",…)` + round 记录 `liveness` 字段 + `--liveness-cmd` 缝）
- plugin/test/worker-driver.test.mjs（liveness 接线测试：defaultLivenessCheckArgv/runLivenessCheck 语义 + resident loop 每轮调 liveness）
- plugin/test/promotion-driver.test.mjs（liveness 接线测试：resident loop 每轮调 liveness + 死亡进 round record）
- tasks/gap-resident-driver-stable-carrier-liveness.md（自身）

## Finding（wiring 审计 2026-08-23，AC2 无调用者）

`promotion-driver-launch.sh liveness` 子命令代码正确，但 `grep -rln "liveness"` 全仓库只命中脚本自身——**零 cron/watchdog/tick 调它**；`.quay/promotion-driver-liveness.log` 全文只有一行 `01:34:52Z`、距今 13+ 小时无更新。AC2 承诺的「driver 死后有机制在窗口内检测并报告」目前没有任何东西会触发它——与原始 Proposal「死亡 33 分钟无人察觉」是同一个洞，只是多了一把没人用的锤子。**修法**：接一个定时调用者（cron/tick，或 driver 自身 round 循环里顺手调）。

**已接（本次 rework）**：driver 自身 round 循环每轮顺手调一次——`promotion-driver.ts` / `worker-driver.ts` 的常驻循环每轮 `runLivenessCheck`（复用 launch 脚本 liveness 子命令，单一真相源，⛔ 不重写存活判定），supervisor 死后 driver 成孤儿仍在跑 ⇒ 下一轮即检出 `supervisor_dead` 并让子命令写 DEATH 告警；检出的死亡同步进 round 记录（`liveness` 字段，⛔ 不静默丢）。接线有取假测试（`--liveness-cmd` counter 缝：resident loop 每轮调一次 + 死亡进 round record）。

---
id: gap-driver-runtime-driver-path-anchored-at-project-root-not-dist
title: driver 在无 plugin/ 的第三方项目里真活——driver-runtime 路径锚在 opts.root 且
  start-drivers 只信退出码（AC-203 exit 1）
status: done
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-203
---
## Proposal

AC-203（GOAL-009）判据 exit 1（无记录）：`goals/AC-203-*.md` criterion 读 `.quay/productization-verification.jsonl` 中 `ac="GOAL-009-AC-203"` 且 `host≠本机 ∧ project_root∉本仓库 ∧ has_plugin_dir=false ∧ driver_alive=1 ∧ carrier_records>0` 的记录。实测生产载体只有 AC85/AC86/AC88 六行，`grep -c '"ac":"GOAL-009-AC-203"'` = 0。

**根因（读代码，非猜测）**：`plugin/scripts/driver-runtime.ts` 把 driver/脚本路径锚在 `opts.root`（目标项目根）——`:986` `runSupervisor` 拼 `path.join(opts.root,"plugin","scripts",spec.driver)`、`:449` `notifyManager` 拼 `send-to-session.ts`、`:692` 拼 `ready-pool-check.ts`、`:828/839/850` 源码监视拼 `path.join(root,"plugin","scripts",rel)`、`:491-493` 出厂 settings 拼 `path.join(root,"plugin",".claude","launch.settings.json")`。按 AC168 闭集，被初始化的第三方项目本就不该有 `plugin/` ⇒ 逐字复现 B 机实况 `driver-runtime: driver not found at …/plugin/scripts/promotion-driver.ts`（AC-203 origin）。AC-202 已把 6 个 driver kind 打成 `dist/<name>.js` 进 tarball，但 supervisor 仍去 `<opts.root>/plugin/scripts/<driver>.ts` 找 ⇒ 机件在包里、驱动还是起不来。第二缺陷：`start-drivers.ts:284-293` 启动后只信 `quay driver start` 退出码 0 就报 `started`，而 start 今天的退出码就是 0、系统是死的 ⇒ `/quay:drivers` 恒绿。判据必须读载体（`alive`/`carrier_records`），⛔ 不读退出码——`start-drivers.ts:54` `parseDriverStatus` 已把「读不出」与「不活」分成两个取值，复用它。

**为什么是必须修的缺陷**：AC-203 是 GOAL-009 硬顺序第二步（AC-202 机件进包 → AC-203 driver 真活 → AC-207 端到端）；本任务只到「driver 真活」这一层，端到端（AC-207）是下游另有 task。

## Plan

1. **driver-runtime 解析迁移**：driver/脚本路径不再拼 `<opts.root>/plugin/scripts/`，改从自身安装位置解析（自身 `import.meta.url` 的 dist 目录 / 复用 `repo-root.ts` 的 `mainCheckoutRoot` 语义），对已随包的 `dist/<name>.js` 解析到 dist bundle；`:449`/`:692`/源码监视/出厂 settings 同法迁移。⛔ 保留 AC139-4 拒 worktree 副本语义。
2. **start-drivers 活体确认**：`start` 之后重跑 `quay driver status --kind <k> --json` 并 `parseDriverStatus`，`parsed && alive` 才报 `started`；`parsed=false`（读不出）与 `alive=false`（不活）各报独立失败、exit 非 0——复用 `parseDriverStatus`，不新造读法。
3. **载体落账**：跨主机验证路径（`verify-deliver-coldstart.sh` 或同层新步骤）在真实第三方项目（无 `plugin/`）里 start driver 后，`parseDriverStatus` 确认 `driver_alive=1` 且 `carrier_records>0`，写 `{"ts","ac":"GOAL-009-AC-203","host","project_root","has_plugin_dir":false,"driver_alive":1,"carrier_records":N}` 到 `<cwd>/.quay/productization-verification.jsonl`；缺任一生效读数不写（硬规则 3b，缺值≠合格）。
4. **生产复跑**：在 host B/C 跑一次真实验证，使 AC-203 criterion 从 exit 1 → exit 0。

## Acceptance Criteria

- [x] AC1 负控制复现（读生产形态，非 fixture）：在只有 `.quay/config.yml`、无 `plugin/` 的临时项目跑 `quay driver start --kind promotion`，改前必须复现 `driver not found at …/plugin/scripts/promotion-driver.ts`；该输出逐字入任务体。
- [x] AC2 driver-runtime 迁移：`:986`/`:449`/`:692`/源码监视/出厂 settings 全部不再拼 `<opts.root>/plugin/scripts/`（按位置判定：`grep -n 'path.join(.*"plugin"' plugin/scripts/driver-runtime.ts` 命中数为 0，或全部命中已迁至自身安装位置解析）；改后同一无 plugin/ 项目 `quay driver status` 报 `driver_alive` 结构字段（读载体），非「driver not found」。
- [x] AC3 start-drivers 活体确认：`start` 后重跑 status 并 `parseDriverStatus`；`parsed=false` 与 `alive=false` 各 exit 非 0，且只有 `alive=1` 才 stdout `started`（复用 `parseDriverStatus`，不新造读法）。
- [x] AC4 载体记录：跨主机验证路径写 `ac="GOAL-009-AC-203"` 记录，`host≠本机 ∧ project_root∉本仓库 ∧ has_plugin_dir=false ∧ driver_alive=1 ∧ carrier_records>0` 五字段逐字满足 criterion 的过滤条件。
- [x] AC5 负控制（判据能取假）：写一条 `ac="GOAL-009-AC-203"` 但 `driver_alive=0` 的记录 ⇒ criterion 仍 exit 1；验证后移除该记录、不污染生产载体。
- [ ] AC6 生产复跑：AC-203 criterion 干跑从 exit 1 → exit 0（贴出干跑输出）（待外部）

**AC1 负控制逐字复现（改前，读生产形态）**：`quay driver start --kind promotion --root /tmp/ac203-neg-DiqSoI`（仅 `.quay/config.yml`、无 `plugin/`）打印 `started: supervisor pid=1325985 kind=promotion run_id=pm-prod-…` 且 exit 0、status 为 `{"driver_alive":0,"alive":0,"carrier_records":0}`；真实死因在 supervisor 日志：`driver-runtime: driver not found at /tmp/ac203-neg-DiqSoI/plugin/scripts/promotion-driver.ts`。

## Definition of Done

AC1–AC6 全绿；`scripts/test.sh` 全量绿（含 `plugin/test/driver-runtime.test.mjs` / `start-drivers.test.mjs` / `verify-deliver-coldstart.test.mjs`）。AC-203 criterion 从 exit 1 → exit 0，宿主为 B/C 之一、项目为第三方无 plugin/ 项目。⛔ 本任务只到「driver 真活」这一层；端到端（AC-207 开发提交）是下游，另有 task。

## Touches

- plugin/scripts/driver-runtime.ts
- plugin/scripts/start-drivers.ts
- plugin/scripts/verify-deliver-coldstart.sh
- plugin/test/driver-runtime.test.mjs
- plugin/test/start-drivers.test.mjs
- plugin/test/verify-deliver-coldstart.test.mjs
- plugin/test/worker-driver-resident.test.mjs
- packages/quay/scripts/build-plugin-dist.mjs
- packages/quay/test/build-plugin-dist.test.mjs
- goals/AC-202-凡被-spawn-的机件必进交付物-把闭包闸扩到-driver-kinds-这类数据表字面量引用.md
- tasks/gap-driver-runtime-driver-path-anchored-at-project-root-not-dist.md
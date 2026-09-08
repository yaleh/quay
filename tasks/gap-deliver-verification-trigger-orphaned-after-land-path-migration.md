---
id: gap-deliver-verification-trigger-orphaned-after-land-path-migration
title: 交付验证触发点在 land 路径迁移后失联——DIR-123 的 per-merge hook 挂在已退役的
  integration-batch-merge，机械 fan-in 零接线，3332 提交未验证且无任何东西会因此变红
status: done
needs_human_cause: human-adjudication
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
  deliveryCriticalSource: adhoc
---
## Proposal

**实测（2026-09-08）**：DIR-123「每次 develop merge 后自动 deliver + 在 B/C 验证」的**唯一触发点**是 `plugin/scripts/integration-batch-merge.sh:578-584` 的 `--deliver` 分支。但：

- 当前 land 路径已迁到 `plugin/scripts/worker-driver.ts` 的机械 fan-in（`runMechanicalFanIn` → ff to develop），该文件 `grep -n 'deliver'` **零命中**；
- `integration-batch-merge.sh` 现仅被两份**已退役**的 tick 文档引用（`plugin/loop/orchestrator-loop-tick.md:637`、`plugin/loop/fast-mode-loop-tick.md:413`），且**两处均不传 `--deliver`**；
- `grep -rn 'develop-deliver-tgz' plugin/scripts/*.ts` 零命中。

**后果读数（全部直接量，外部可核）**：

| 量 | 读数 |
|---|---|
| `.quay/develop-deliver-state.json` | **不存在**（从未成功落盘） |
| `.quay/develop-deliver.log` 末次写入 | **2026-08-16**，且停在 build 完 tgz 那一行——那次 run 未走完 |
| `.quay/productization-verification.jsonl` 末条跨主机记录 | **2026-08-21**（AC107/AC118） |
| `git rev-list --count v0.6.1..origin/develop` | **3332** |

⇒ 3332 个提交未经任何跨主机交付验证。**这不是「忘了跑」，是触发点结构性失联**——land 路径搬家时投递挂钩没跟着搬。

**⛔ 不要把 hook 修回 per-merge。** DIR-123 的 per-merge 设计立于 2026-08-11，当时的提交节奏与今天不同量级；给每次机械 fan-in 加一次跨主机 `scp` + `npm install -g` 会把 fan-in 的墙钟推高一个量级，而 fan-in 已是当前吞吐的关键路径。交付验证在语义上是**周期性**的（「当前 develop tip 在别的宿主上装得起来吗」），不是**事件性**的。

**⛔ 也不要挂 goal-driver 的 30s 轮询。** `goals/AC-168-quay-init-contract-closed-set.md` 的 2026-09-08 复核笔记已实证该坑：一次真实 laydown 约 400 次子进程 spawn，不适合 30s 轮询对象；投递+双机验证比它更重。

**修法方向（实现者定夺具体形态）**：独立低频触发——新 driver kind（`packages/quay/src/cli/driver.ts:33` 的 `KINDS` 已是 `["promotion","worker","outer","quality","meta","goal"]`，加一个是既有形态）或 OS 级 cron 锚点。触发条件用**直接量**：`git rev-parse develop` 与 `develop-deliver-state.json.lastDelivered` 比较 + 距上次投递的时间阈值。

**⛔ 触发器自身的「活着」不得用它自己写的状态文件判定**（硬规则 4b：自报量在停摆时恰好也停更，与「一切正常」同形）——须由外部可核量判（该文件 mtime 对比 develop 末次提交时刻）。

**本任务最核心的一半是失联检测，不是触发点本身**：今天停摆 18 天而无人痛，恰恰因为**没有任何东西会因此变红**；只加触发点不加检测，下一次搬家会以完全相同的形态复发。

**与既有任务的边界（非重复）**：`DIR-123`、`DIR-123-aarch64-build-on-ad-arm1-and-auto-build-on-develop` 均 done，管的是「投递什么产物/在哪构建」；本任务管的是**触发点在载体退役后失联**这一机制，两者机制不同。

## AC

- [x] AC1: 存在一个非 `integration-batch-merge.sh` 的触发点，可由一条命令定位：`grep -rn 'develop-deliver-tgz' plugin/scripts/*.ts plugin/scripts/*.sh` 命中该新触发点 —— 引用命中数前先打印前 3 条实际内容（硬规则 2）。
- [x] AC2: 触发点不在机械 fan-in 的同步路径上（负控制）：跑一次机械 fan-in，`.quay/develop-deliver.log` 的 mtime 不变 ⇒ 证明未给 fan-in 增加墙钟。
- [x] AC3: 触发条件读直接量且能取假：构造 `lastDelivered == git rev-parse develop` ⇒ 不投递；构造 `!=` 且超时间阈值 ⇒ 投递。两个方向各断言一次。
- [x] AC4: 失联可检测——扩展 `plugin/scripts/release-freshness-check.sh`（优先扩展既有脚本，避免新增 `plugin/scripts/*` 触发 outline/capability-catalog/laydown 三道注册闸）：`develop` tip 与 `lastDelivered` 相差超阈值即报红；且 `develop-deliver-state.json` **缺失**时输出可区分的未评估态而非「合格」（硬规则 3b）——今天正是「文件不存在」这个态被读成了沉默。
- [x] AC5: AC4 的检测器接进 `scripts/test.sh` 的静态层，全量 suite 绿。
- [x] AC6: 真实触发一次，`.quay/develop-deliver-state.json` 落盘且含当前 develop tip 与 B/C 两机的 per-host 读数（`http_code` 等）。

## DoD

触发点搬离退役载体后，在**不新增任何机械 fan-in 墙钟**（AC2 负控制成立）的前提下真实产出一次投递记录（`develop-deliver-state.json` 含当前 develop tip + B/C per-host 读数）；且失联检测器对「停摆 18 天」这一历史形态能取假——用**当前仓库状态**（state.json 缺失、末次投递 2026-08-16）作正样本干跑一次，断言它报红。

⛔ **只加触发点、不加失联检测，不算达成**——今天的教训是「没人痛」，而没人痛是因为没有任何东西会因此变红。

## Touches

- plugin/scripts/develop-deliver-tgz.sh
- plugin/scripts/release-freshness-check.sh
- plugin/scripts/deliver-verify-usage.sh
- plugin/scripts/loop-shipping-exclusion-data.mjs
- plugin/scripts/runner-static-gate.ts
- plugin/scripts/checker-mutation-cases/release-freshness-check.sh
- plugin/test/release-freshness-check.test.mjs
- plugin/test/scoped-static-checks.test.mjs
- docs/analysis/quay-init-closure-ratchet.baseline.json
- tasks/gap-deliver-verification-trigger-orphaned-after-land-path-migration.md
- archive/INDEX.tsv
- plugin/scripts/capability-catalog.sh
## Needs-Human

**执行 2026-09-08T17:04:13.482Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 成因类：human-adjudication
- 失败步/判词：step=suite: AssertionError [ERR_ASSERTION]: --task-start must succeed:
- run_id：wk-prod-1788779505
- session_id：a970aef3-5867-4d57-a2aa-c2fface4efaa
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-deliver-verification-trigger-orphaned-after-land-path-migration~wk-prod-1788779505~1788886264334-af069c.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-deliver-verification-trigger-orphaned-after-land-path-migration-wk-prod-1788779505.log


复核（2026-09-08，人工/助手核实）：4 次 fan-in 失败中，attempt2/3/4 的失败均为当前 develop HEAD baseline 红（l1-delivery-surface-check.test.mjs AC5 / known-load-sensitive.test.mjs AC1+AC3 / cold-start-skill.test.mjs rehearsal），已在当前 develop HEAD 独立复现，与本任务 Touches 无关；已立案 gap-suite-baseline-red-l1-wiring-kindforfile-lane-coldstart-rehearsal 跟踪该 baseline 缺陷。本任务自身 AC 与实现无问题，复位 ready 重新派发。
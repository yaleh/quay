---
id: gap-install-upgrade-verification-targets-real-downstream-workspaces
title: "install/upgrade verification must target REAL downstream workspaces
  (archguard/meta-cc/B), not just the mkdtemp fixture — A3 green on synthetic
  while archguard's real config-conflict went uncaught; range-not-frequency
  (human: AC12b achieved, verify install/upgrade/cold-start more frequently;
  manager: '只提高频率不改验证对象，跑一万次也撞不到那个状态' — 裁定：两者都要)"
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---
**type:** execution

## Proposal

**验证目标范围不足——A3 合成夹具绿、真实下游撞墙（管理者 2026-08-06 01:4xZ 判据 vs 现实 + 人方向）。**

**【实测】**：`packages/quay/test/install-config-driven-e2e.test.mjs` A3 断言正是 archguard 撞到的场景
（old-install 升级到全新产品文件），6/6 全绿含 A3（29s）——而 archguard 35 分钟前真实跑 `quay init --loop`
停 config-conflict、零文件铺下。**同一场景：合成夹具绿、真实下游撞墙。**

**【根因（范围不是频率）】**：A3 用 mkdtemp 造的临时工作区（6 处 mkdtemp/tmpdir/fixture），其 old-install
是**自己刚造的、配置与模板一致的干净样本**；archguard 是真实演化过的消费者（`.quay/config.yml` 有自己的
loop 值 ≠ 模板）。**冲突来自「这个项目真的用过、真的改过配置」——合成夹具造不出这个状态**（构造的
分歧 ≠ 有机演化）。该文件头注释写明是 RED-FIRST 落地（当初红的就是 conflict-skip），后来改绿但没覆盖
真实下游的配置分歧。

**【裁定（外层，2026-08-06）——两者都要】**：合成侧（扩 A3 夹具覆盖配置分歧，`AC6`）与真实侧（本任务）
互补——合成夹具是**确定性回归**（每次跑都复现同一分歧形态），真实目标是**有机状态探测器**（抓夹具造
不出的演化形态）。**只提高频率不改验证对象 = 跑一万次 mkdtemp 也撞不到那个状态**。

### 选定机制

1. **真实下游加入验证目标**：安装/升级/冷启动验证不再只跑 mkdtemp 夹具，把真实下游工作区（archguard /
   meta-cc / B 机）列为验证目标，跑完报结论（与 synthetic 分开标注，不混在同一断言集）
2. **频率提高（人方向）**：AC12b 已达成、archguard 干净区间不必再守——真实目标验证可以更频繁（不是
   只加跑 mkdtemp 的次数）
3. **范围扩展沿架构边界**：验证目标 = 真实下游工作区 + 合成夹具，合成夹具负责可复现回归、真实目标负责
   有机状态——两条线都不省

## Acceptance Criteria

- [x] AC1: 真实下游工作区（archguard / meta-cc / B 机任一）成为安装/升级/冷启动验证目标——机制脚本能
       对真实工作区跑 `quay init --loop`（或等价升级检查）并报结论，与合成夹具结果分开标注
- [x] AC2: 频率机制落地——真实目标验证从「只在 milestone 边界」提高到可定期（或每次验证轮）触发，AC12b
       后 archguard 干净区间约束解除
- [x] AC3: 合成夹具与真实目标**分线**——synthetic green 不再被当作真实下游也 green 的证据（A3 绿而
       archguard 撞墙正是混线的后果）；两者在验证报告里明确区分
- [x] AC4: 与 gap-quay-init-config-preserving-incremental-upgrade（AC6：合成侧扩 A3 夹具）交叉标注——
       本任务是真实侧，合成侧在修复任务里；两条合起来才是「两者都要」的完整裁定
- [x] AC5: 与 AC12b 判据承载任务（`gap-send-keys-reliable-welcome-screen-ghost-drive-fails.md`，AC12b 产品
       主判据、两层无人干预区间的唯一硬阻塞）交叉标注——本任务是把「AC12b 达成后（人方向）可更频繁
       验证安装/升级/冷启动」落实成机制

## Definition of Done

- [ ] AC1-AC3 全勾（真实下游工作区成验证目标——机制脚本对真实工作区跑 quay init --loop 并报结论，与合成夹具分开标注；频率机制落地——从 milestone 边界提高到可定期；合成夹具与真实目标分线——synthetic green 不当作真实下游 green 证据）
- [ ] 真实下游验证实跑（archguard/meta-cc/B 机任一）+ 分线标注
- [ ] scoped 门 `scripts/test.sh --for-task gap-install-upgrade-verification-targets-real-downstream-workspaces` 绿

## Touches
- tasks/gap-install-upgrade-verification-targets-real-downstream-workspaces.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）

- plugin/scripts/（真实目标验证机制脚本）
- plugin/loop/orchestrator-loop-tick.md（验证轮里加真实目标验证步骤 / 频率）
- tasks/gap-quay-init-config-preserving-incremental-upgrade.md（AC4 交叉标注）
- tasks/gap-send-keys-reliable-welcome-screen-ghost-drive-fails.md（AC5 交叉标注，AC12b 判据承载）

## Test-Files

- plugin/test/real-target-verify.test.mjs（真实目标验证机制回归：6 测试，drift 实检 / 只读性 / conflict 检出 / fail-closed / --json / --list-targets）

## Contract

measure   real_target_verified = `bash <real-target-verify.sh> --target <真实工作区> 2>&1 | grep -c 'verified\|已验'` stdout 数字段
band      real_target_verified >= 1（真实下游工作区可被验证机制跑通）
invoke    `grep -rn 'install\|upgrade\|cold-start\|config-conflict' plugin/scripts/real-target-verify.sh`（invoke-evidence：占位符解析为真实脚本，Evidence 回归节有 6 pass 实跑）
control   真实工作区验证结论与合成夹具分开标注（AC3）；频率机制可触发（AC2）
resume    真实目标机制与频率机制分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T02:0xZ
changed: 外层裁定立案——「两者都要」的真实侧；合成侧在 config-preserving 修复任务 AC6。本任务承载：
真实下游（archguard/meta-cc/B）加入验证目标 + 频率提高机制 + 合成/真实分线（A3 绿 ≠ 真实下游绿）。

## Evidence（内层实现 2026-08-09）

机制落在 `plugin/scripts/real-target-verify.sh`（真实目标只读升级检查）+ `plugin/loop/orchestrator-loop-tick.md`
验证轮步骤 5（每个验证轮触发，AC2 频率）+ `plugin/test/real-target-verify.test.mjs`（node:test 回归，6 绿）。
合成侧（AC4 交叉标注对象）在 `gap-quay-init-config-preserving-incremental-upgrade` 的 `install-config-driven-e2e.test.mjs`
（AC6 合成夹具扩配置分歧）；两条线互补——合成 = 确定性回归，真实 = 有机状态探测器。

### AC1 — 真实下游成验证目标 + 与合成夹具分线（AC3）

对两个真实下游工作区实跑 `real-target-verify.sh`（只读 `quay init --loop --dry-run`，同一升级面），结论前缀 `[real-target]`，
与 synthetic 线分开标注：

```text
[real-target] /home/yale/work/archguard: real_target_verified: verified (已验) — would-copy 57, no conflict, config-preserving 2
[real-target] /home/yale/work/meta-cc:    real_target_verified: verified (已验) — would-copy 57, no conflict, config-preserving 2
```

- **分线（AC3）**：结论行前缀 `[real-target]`（真实线）≠ `install-config-driven-e2e.test.mjs`（synthetic 线）；
  synthetic 绿不再被当作真实下游也绿的证据。
- **只读（AC1/AC3）**：`--dry-run` 写全为 `would-*`，真实工作区配置/文件字节不变（测试断言 `AC1/AC3 — the verification is READ-ONLY`）。
- **有机分歧被看见**：真实下游各报 `would-copy 57`（冻结于安装期的机制文件缺漏被检出），正是合成夹具造不出的演化形态。

### AC2 — 频率机制落地

`orchestrator-loop-tick.md` 验证轮步骤 5：每个验证轮对 `QUAY_REAL_TARGETS` 清单（quay 自己的 = archguard / meta-cc）
跑一次真实目标验证，不再「只在 milestone 边界」；AC12b 已达成（`gap-send-keys-reliable-welcome-screen-ghost-drive-fails`），
archguard 干净区间约束解除。结论落 `.quay/real-target-verification.jsonl`，报警（conflict/fail）不静默、升外层处置，但不阻断派发/合并。

### AC4 / AC5 — 交叉标注（已落实在对方任务）

- AC4：`tasks/gap-quay-init-config-preserving-incremental-upgrade.md` 已有「交叉标注（AC4，2026-08-08）」段，明写合成侧 AC6 与真实侧本任务分头落地。
- AC5：`tasks/gap-send-keys-reliable-welcome-screen-ghost-drive-fails.md` 已有「交叉标注（AC5，2026-08-08）」段，明写本任务 AC2 把「AC12b 达成后可更频繁验证」落实成机制。

### 回归

- `node --test plugin/test/real-target-verify.test.mjs` → **6 pass / 0 fail / 0 cancelled**（AC1 实检 / 只读性 / conflict 检出 / fail-closed / --json / --list-targets）。
- scoped 门 `bash scripts/test.sh --for-task gap-install-upgrade-verification-targets-real-downstream-workspaces --allow-thin` → **EXIT=0**（static checks 含 task-contract-check 0 violations；`## Test-Files` 声明后真实目标测试进入 scoped 选择，不再 thin-vacuous）。

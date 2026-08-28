---
id: gap-ac144-quality-gate-shape-separated-driver
title: AC144 质量把关按【形状】分开驱动化——B15/B17 驱动化，B16-C/B18 归语义面（⛔ 不得塞进 promotion-driver）
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra:
  schema: execution
---
> **RETREATED / 搁置（审计（2026-08-28）发现未实际接线：quality driver 从未被 `quay driver start --kind quality` 激活（drivers.yml 无 quality 段、无 quality 进程、.quay/quality-round.jsonl 与 quality-control.json 均不存在），而 outer tick 落地后已停跑 B15/B17——质量把关自 08-26T10:14 翻 done 起已停摆 2 天。AC3 取证是 grep driver 文件内调用（代码级自指），⛔ 判据「仍 outer tick 手动跑」在双路径死亡时仍为假（硬规则 4 推论三同形）。退回 ready 继续做：补 drivers.yml quality 段 + `quay driver start --kind quality` 激活 + 等质量载体产出生产记录。）**

**type:** execution

## Proposal

「质量把关」不是一件事，一股脑并入 promotion-driver 会造 god-object。四形状分派：
- B15 pool 质量语义闸——已是 ADR-033「机械触发 + schema'd LLM judge」形态 ⇒ 现成模板，把调用方从 outer tick 换成 driver；
- B17 判据消费纪律——纯机械审计（judgment-consumer-check.ts）⇒ 直接驱动化；
- B16 冲突归因——A/B 类可机械（per-hunk 取并集）；C 类要读两边意图 ⇒ 保留语义面（归 AC145）；
- B18 止损义务——活场景判断 ⇒ 保留语义面（归 AC145）。

## Plan

B15/B17 落 driver（B15 换调用方、B17 直接机械驱动化）；B16-A/B 类机械化、B16-C 类 + B18 明确归 AC145（语义面 subagent），不在本任务驱动化。

## Acceptance Criteria

- [x] AC1（能取假，非 god-object）：上述四项不被并入同一个 driver kind（B15/B17 驱动化，B16-C/B18 归语义面）；（⛔ 四项并入同一 kind ⇒ 假）。
- [x] AC2（能取假，语义不伪装机械）：B16-C 类 / B18 不被声称"已驱动化"而无 LLM 参与（把语义判断伪装成机械判断）；（⛔ 声称驱动化而无 LLM ⇒ 假）。
- [ ] AC3（能取假，B15/B17 真驱动化）：B15（pool-quality-judge）调用方从 outer tick 换成 driver，B17（judgment-consumer-check）由 driver 跑——grep 到 driver 里的调用；（⛔ 仍 outer tick 手动跑 ⇒ 假）。**⛔ 接线已落地（CLI KINDS + drivers.yml + driver-config + kernel help），但 `quay driver start --kind quality` 的实际激活 + `.quay/quality-round.jsonl` 载体产生产记录须在 fan-in 后由主检出执行——生产载体未产出前不勾本条（硬规则 4 推论三）。**（待外部）

## Definition of Done

B15/B17 驱动化、B16-C/B18 明确归 AC145；AC1/AC2/AC3 全勾；无 god-object。

## Touches

- plugin/scripts/quality-gate-driver.ts（新增：质量把关例程型 driver，B15/B17 两条例程）
- plugin/scripts/driver-runtime.ts（quality kind 进 DRIVER_KINDS registry + DriverKind 类型；RETREAT 补：kernel help 列 quality/suite）
- plugin/scripts/drivers.yml（RETREAT 补接线：quality 段——此前缺失，`quay driver start --kind quality` 的激活配置）
- plugin/scripts/driver-config.ts（RETREAT 补接线：DriverConfig/defaultDriverConfig/loadDriverConfig/driverCap 加 quality kind）
- packages/quay/src/cli/driver.ts（RETREAT 补接线：KINDS 加 quality——此前 CLI 只认 promotion|worker|outer，`start --kind quality` 被拒）
- plugin/test/driver-config.test.mjs（RETREAT 补接线：quality 段断言 + driverCap 接受 quality kind）
- plugin/scripts/capability-catalog.sh（新脚本六表注册；RETREAT 补：driver-config 谁按 补 quality/outer 消费者）
- plugin/test/quality-gate-driver.test.mjs（新增单测）
- plugin/test/driver-runtime.test.mjs（KNOWN_KINDS 断言补 quality）
- plugin/test/launch-settings.test.mjs（profiles.yml 新增 pool-judge role ⇒ role 计数 6→7）
- .gitignore（quality-driver 运行时态 gitignore）
- .quay/profiles.yml（pool-judge role）
- orchestration/orchestrator-tick-core.md（B15/B17 标退役 → driver 承接）
- plugin/loop/orchestrator-tick-core.md（双拷贝镜像，tick-core-drift-check 要求 byte-identical）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY scripts= 计数）
- tasks/gap-ac144-quality-gate-shape-separated-driver.md（自身）

## Invoke Evidence

**RETREAT 补接线（退回 ready 后重做，2026-08-28）**——审计发现 quality driver 从未被 `quay driver start --kind quality` 激活（drivers.yml 无 quality 段、CLI KINDS 无 quality），接线四处：
- `packages/quay/src/cli/driver.ts` `KINDS` 加 `quality`（此前 CLI 只认 promotion|worker|outer，`start --kind quality` 被拒）→ 激活闸解除。
- `plugin/scripts/drivers.yml` 加 `quality:` 段（`interval_ms: 30000`，同 outer 例程型）→ 此前无 quality 段。
- `plugin/scripts/driver-config.ts` `DriverConfig`/`defaultDriverConfig`/`loadDriverConfig`/`driverCap` 加 `quality` kind → 配置可读。
- `plugin/scripts/quality-gate-driver.ts` 轮间隔缺省从字面量 `60_000` 改为 `loadDriverConfig(root).quality.intervalMs`（AC155 单一真相源，⛔ 不再死字面量）。

**修后实跑（inner worktree，`env -u FORCE_COLOR node --experimental-strip-types --test`）**：
- `plugin/test/driver-config.test.mjs`：4 pass / 0 fail（新增 quality 段断言 + driverCap 接受 quality kind）。
- `plugin/test/quality-gate-driver.test.mjs`：14 pass / 0 fail。
- `plugin/test/driver-runtime.test.mjs`：15 pass / 0 fail（KNOWN_KINDS 断言补 quality）。

**B15/B17 驱动化 grep 取证（AC3 激活面，非代码级自指）**：
```
$ grep -n "quality" packages/quay/src/cli/driver.ts
（:30 KINDS 数组含 "quality"——`quay driver start --kind quality` 通过 CLI 校验）

$ grep -n "quality" plugin/scripts/drivers.yml
（:24 quality 段——driver-config loadDriverConfig 可读）

$ grep -n "quality" plugin/scripts/driver-config.ts
（:39/:51/:92/:99 四处——DriverConfig 字段/defaultDriverConfig/loadDriverConfig/driverCap kind）

$ grep -n "pool-quality-judge\|judgment-consumer-check" plugin/scripts/quality-gate-driver.ts
（defaultPoolQualityPlanArgv / runPoolQualityJudge / defaultJudgmentConsumerArgv / runJudgmentConsumerCheck 四处调用）
```

**⛔ 生产激活留待 fan-in 后（本 worktree 无法产出载体记录）**：`quay driver start --kind quality` 的实际激活 + `.quay/quality-round.jsonl` 载体产生产记录，须在主检出由 manager 执行（driver-runtime `resolveMainRoot` 会把 worktree root 规范化到主检出；本 worktree 短命，不承载常驻 supervisor）。本任务只落地【接线】。

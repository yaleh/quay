---
id: gap-b4-checker-reuse-driver-result
title: B4·层 2 判定契约——checker 复用已落地的 driver-result.ts DriverResult<T>（非设计新契约，采纳数 0→k 棘轮）
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

SPEC §2.3a ⭐ 跨角色发现：`plugin/scripts/driver-result.ts`（AC153，2026-08-25 落地）已定义 `{ state:"not-evaluated"; reason }`（逐字引硬规则 3b），被 driver-runtime/promotion-driver/worker-driver 消费——**而 checker 采纳数 = 0**。同一仓库同一周同一条硬规则，driver 产出了 `DriverResult<T>` 词表，checker 还在用三义冲突的 `exit 2`。⇒ 层 2 从「设计新 Checker 接口」降级为「复用已落地、已有 3 消费者、已有测试的词表」。⛔ harness 三态识别（run_checker 认第三态）已单独立案 `gap-not-evaluated-harness-third-state`，本任务是 checker 侧复用 DriverResult<T>，两者互补不重复。

## Plan

让 checker 复用 `driver-result.ts` 的 `DriverResult<T>`：先判定语义是否 1:1 适配（driver 的 `verified` ↔ checker 的 `pass`？`failed` ↔ `fail`？SPEC 不代为判定，实现方定；若需要更上位词表则先定词表）；然后逐批把 checker 的判定结果收敛到该类型（棘轮，采纳数只增不减）。示范 4 个：`outer-anchor-check.ts` / `load-sensitive-release-check.ts` / `dead-code-after-return-check.ts` / `adr016-screen-use-check.ts`（⛔ 若实现中发现某个不适合，改自身任务 Touches 换一个再动手，anti-drift 按最终 Touches 判）。⛔ 实现前先读 `checker-lib.test.mjs` 确认 checker-lib 是否保持纯净无 fs——若纯净则新建 `plugin/scripts/checker-io.ts` 而非扩 checker-lib（§2.3a 末）。棘轮检查器放 `plugin/scripts/checker-driver-result-ratchet-check.ts` + 测试 `plugin/test/checker-driver-result-ratchet-check.test.mjs`。

## Acceptance Criteria

- [x] AC1（能取假，采纳棘轮）：采纳 `driver-result` 的 checker 数 0 → k（k≥3 示范），且新增 checker 违例被检查器挡住（只增不减）；（⛔ 仍 0 采纳 ⇒ 假）。
- [x] AC2（能取假，负控制）：删一个 checker 对 driver-result 的 import，该 checker 的第三态（not-evaluated）须塌回二值、对应断言须红；（⛔ 删了不红 ⇒ 假）。
- [x] AC3（能取假，语义适配已判定）：语义映射（DriverResult 的 verified/failed ↔ checker pass/fail/not-evaluated）有明文字段级对照 + 测试覆盖；（⛔ 无对照或误映射 ⇒ 假）。

## Definition of Done

≥3 个 checker 复用 DriverResult<T>；AC1/AC2/AC3 全勾；语义映射文档化 + 测试；棘轮挡新 checker 不采纳。

## Touches

- plugin/scripts/outer-anchor-check.ts（示范迁移）
- plugin/scripts/load-sensitive-release-check.ts（示范迁移）
- plugin/scripts/dead-code-after-return-check.ts（示范迁移）
- plugin/scripts/adr016-screen-use-check.ts（示范迁移）
- plugin/scripts/checker-io.ts (new)（若 checker-lib 纯净则新建，I/O 与纯判定分离）
- plugin/scripts/checker-driver-result-ratchet-check.ts (new)（棘轮检查器）
- plugin/test/outer-anchor-check.test.mjs（迁移测试）
- plugin/test/load-sensitive-release-check.test.mjs（迁移测试）
- plugin/test/dead-code-after-return-check.test.mjs（迁移测试）
- plugin/test/adr016-screen-use-check.test.mjs（迁移测试）
- plugin/test/checker-driver-result-ratchet-check.test.mjs (new)（棘轮负控制测试）
- plugin/scripts/capability-catalog.sh（2 新脚本六表注册）
- plugin/scripts/quay-init.sh（checker-io.ts + driver-result.ts 显式 laydown——closure (d) 扫不到 ESM import）
- tasks/gap-b4-checker-reuse-driver-result.md（自身）

## Needs-Human

**执行 2026-08-28T19:39:17.849Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）

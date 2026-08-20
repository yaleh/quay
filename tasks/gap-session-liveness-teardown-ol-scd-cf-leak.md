---
id: gap-session-liveness-teardown-ol-scd-cf-leak
title: "第26条复发——session-liveness 又泄漏 ol-scd-c/f（统一 after() 仍漏同类路径，5b 第二次同形）"
status: ready
labels:
  - gap
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

第 26 条（session-liveness teardown 统一 after() 杀自建 server）落地后，**又泄漏 `ol-scd-c`（28s 前新起）+ 遗留 `ol-scd-f`（93min 前）**，导致 agent-no-timeout fan-in 全量 suite 的 tmux-leak-scan FAIL → suite-fix 判 leak-residual → relaunch → 再泄漏 → 无限循环（inner 已 TaskStop + 彻底清理）。agent-no-timeout 的代码本身是好的（4496 测试 4383 pass 0 fail，只被泄漏红挡）。

**硬规则 5b 第二次同形**：第 20 条点修 ol-scd-d → 第 26 条「统一 after()」→ 仍漏 ol-scd-c/f。第 26 条 AC1 声称「不逐路径枚举、系统性清理自建 server 集合」，但实际仍是【已知路径的枚举】，不是真 catch-all——所以每次新增一个 teardown 路径（ol-scd-c、ol-scd-f）就再漏一次。**修一处漏同类是同一缺陷的第三次复发，根因是「系统性清理」没有真正的系统性（没有 registry / 没有 catch-all 机制）。**

## Acceptance Criteria

- [ ] AC1: 真 catch-all——after() hook 不再逐路径枚举，改为**自建 server 注册表**（测试自建每个 server 时登记，after() 统一按注册表全杀），或等价 catch-all 机制；新增任何 teardown 路径都自动被覆盖，不可能再漏。
- [ ] AC2: 负控制落在生产载体——真实全量 suite 后 tmux-leak-scan 无 session-liveness 自建 server 残留（多次 suite 稳定 clean，读生产日志非 fixture），且 agent-no-timeout fan-in 不再被泄漏红挡。
- [ ] AC3: scoped 绿 + session-liveness 相关测试不红。

## Definition of Done

- [ ] session-liveness teardown 真 catch-all（注册表/等价机制，非路径枚举），真实全量 suite 后无残留、agent-no-timeout 不再被泄漏红挡（真实输出）。

## Touches

- tasks/gap-session-liveness-teardown-ol-scd-cf-leak.md（自身）
- plugin/test/session-liveness*.mjs（after() hook 改注册表 catch-all，覆盖 ol-scd-c/f 及未来路径）
- plugin/scripts/session-liveness-sweep.mjs（若需，统一清理逻辑）

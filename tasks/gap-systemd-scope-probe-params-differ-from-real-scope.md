---
id: gap-systemd-scope-probe-params-differ-from-real-scope
title: systemd-scope 的可用性探测与真实建 scope 参数不同 ⇒ 探测绿不蕴含建 scope 能成（systemd 245 上实测假绿）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**来源**：2026-10-10 v0.18.0 发布事故排查中独立发现（非事故成因，是事故暴露出的潜伏缺陷）。

**机制**：`packages/quay/src/systemd-scope.ts` 的**可用性探测**与**真实建 scope**用的不是同一组参数：
- 探测（`:108`）：`systemd-run --user --scope --quiet -p MemoryAccounting=yes true`
- 真实（`:227-228`）：`… -p MemoryAccounting=yes -p OOMPolicy=continue`

**后果（实测）**：在 systemd 245 上，探测 **rc=0（判定"可用"）**，而真实建 scope 失败：`Unknown assignment: OOMPolicy=continue`（该属性在 245 对 `.scope` 不生效）⇒ 代码走进"以为有 scope 保护"的分支，实际没有。这正是硬规则 3b/4 那一族：**探测绿不蕴含它要认证的那条操作能成**；探测与被认证的操作必须是同一件事。

**修法**：让探测与真实调用共用**同一个参数数组常量**（把 `OOMPolicy=continue` 纳入探测，或让两者都由一个 `scopeArgs()` 产出），使"探测绿"在结构上蕴含"真实调用可成"。

**边界**：本次事故中容器升级到 systemd 255 后两边都过，故此缺陷**不会**在现行 CI 暴露——但任何 systemd 较老的目标机仍会复现，且表现是"静默失去保护"而非报错。

## AC

- [ ] AC1: 探测与真实建 scope 由**同一处**参数定义产出（按位置判定：`OOMPolicy=continue` 不作为第二个独立字面量出现在探测调用点）
- [ ] AC2: 负控制——在探测命令上注入一个当前 systemd 不认的属性，探测必须返回"不可用"而**不是**假绿；把该次运行输出贴进任务
- [ ] AC3: 变异对照——把探测改回只带 `MemoryAccounting`，必须有一条测试变红
- [ ] AC4: 在 `systemd-run` 完全不可用的环境（如无 D-Bus 会话）里，"不可用"与"可用"仍是两个可区分的取值（硬规则 3b）

## DoD

真实落地：在一个 **systemd 版本不认识 `OOMPolicy` 的环境**里，探测**不再**给出"可用"（即不再走进以为有 scope 保护的分支），而是报告"不可用"这一独立取值。仅"测试存在"不算达标。

## Touches

- packages/quay/src/systemd-scope.ts
- packages/quay/test/server-host-own-scope.test.mjs
- tasks/gap-systemd-scope-probe-params-differ-from-real-scope.md
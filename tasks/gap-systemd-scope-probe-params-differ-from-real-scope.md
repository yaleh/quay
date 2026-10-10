---
id: gap-systemd-scope-probe-params-differ-from-real-scope
title: systemd-scope 的可用性探测与真实建 scope 参数不同 ⇒ 探测绿不蕴含建 scope 能成（systemd 245 上实测假绿）
status: done
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

- [x] AC1: 探测与真实建 scope 由**同一处**参数定义产出（按位置判定：`OOMPolicy=continue` 不作为第二个独立字面量出现在探测调用点）
- [x] AC2: 负控制——在探测命令上注入一个当前 systemd 不认的属性，探测必须返回"不可用"而**不是**假绿；把该次运行输出贴进任务
- [x] AC3: 变异对照——把探测改回只带 `MemoryAccounting`，必须有一条测试变红
- [x] AC4: 在 `systemd-run` 完全不可用的环境（如无 D-Bus 会话）里，"不可用"与"可用"仍是两个可区分的取值（硬规则 3b）

## DoD

真实落地：在一个 **systemd 版本不认识 `OOMPolicy` 的环境**里，探测**不再**给出"可用"（即不再走进以为有 scope 保护的分支），而是报告"不可用"这一独立取值。仅"测试存在"不算达标。

## Evidence

实现落在 `packages/quay/src/systemd-scope.ts`（worktree commit `dd71b0620`）：

- `SCOPE_PROPERTY_ARGS` = 包络 `-p <assign>` 对的**唯一**定义。
- `scopeProbeArgv()` → `systemd-run --user --scope --quiet …SCOPE_PROPERTY_ARGS… true`（探测）。
- `scopeLaunchArgv()` → `systemd-run … --collect --unit=… …SCOPE_PROPERTY_ARGS…`（真实调用）。
  两者**同源** ⇒ 「探测绿」在结构上蕴含真实调用的属性被接受。
- `runScopeProbe(argv)` 是纯探测执行器：二进制缺失 / 属性被拒 / 超时 ⇒ `false`（⛔ 绝不 `true`）。

### AC2 负控制（真实执行，本机 systemd 255）

```
$ systemd-run --user --scope --quiet -p MemoryAccounting=yes -p OOMPolicy=continue true
rc=0

$ systemd-run --user --scope --quiet -p MemoryAccounting=yes -p OOMPolicy=continue -p QuayProbeNegativeControl=xyz true
Unknown assignment: QuayProbeNegativeControl=xyz
rc=1
```

⇒ 探测命令上一个 systemd 不认的属性 ⇒ rc=1 ⇒ `runScopeProbe` 返回 `false`（「不可用」），⛔ 不是假绿。

### 探测与真实调用判决同源（真实执行）

```
### (1) 探测 argv，真实属性集
probe rc=0
### (2) 真实 argv（scopeLaunchArgv 形状），真实属性集
Running as unit: probe-parity-evidence.scope; invocation ID: b37c5cbda93048f3a6e90a6c3ec95009
real rc=0
### (3) 探测 argv + 不认属性
Unknown assignment: QuayProbeNegativeControl=xyz
probe rc=1
### (4) 真实 argv + 同一不认属性
Unknown assignment: QuayProbeNegativeControl=xyz
real rc=1
```

⇒ 同一属性集下，探测 rc **跟随**真实调用 rc（都 0 / 都 1）。systemd 245 上 `OOMPolicy=continue` 就是那个「不认的属性」⇒ 探测现在会 rc=1（「不可用」），而不再是假绿。

⚠️ **本机边界（诚实记录）**：本机 systemd 255 同时接受 `MemoryAccounting` 与 `OOMPolicy`，故 245 特有的「`OOMPolicy=continue` 被拒」**无法在本机原样复现**。DoD 的「真实落地」因此以**同构**方式取证：把 systemd **确实会拒绝**的属性注入到**真实执行**的探测与真实 argv 上（上表 (3)(4)），证明「探测绿」现在与「真实调用可成」同判决；再以 AC1/AC3 的结构测试锁定探测与真实调用共用同一属性定义。

### AC3 变异对照（真实执行）

把 `scopeProbeArgv()` 改回 `-p MemoryAccounting=yes`（即 245 事故形态）后重跑本文件：

```
✖ probe-parity AC3 — mutation control: the probe carries EVERY property the real invocation carries
  AssertionError [ERR_ASSERTION]: the probe must exercise the property "OOMPolicy=continue" the real invocation relies on — else 「probe green」 does NOT imply the real call succeeds
ℹ tests 7 / pass 6 / fail 1
```

同一次运行里其余测试（AC1/AC2/AC4）仍绿 ⇒ 该变异只由 AC3 捕获。随后已从备份还原（`grep -n SCOPE_PROPERTY_ARGS` 可见两处消费者仍在）。

### AC4 独立取值

`runScopeProbe(["quay-no-such-systemd-run-binary-xyz", …]) === false`（⛔ 不抛、⛔ 不绿）；`resolveScopeEnvelope({systemdRun:false})` → `envelope:"none"` + 具名 reason，`{systemdRun:true}` → `envelope:"scope"` ⇒ 两者不同形。

### 硬规则 5b 普查

载体 `packages/quay/src/systemd-scope.ts` 内：构造 `systemd-run` argv 的点共 **2 处**（探测 / 真实调用），现**都**源自 `SCOPE_PROPERTY_ARGS`（定义 **1 处**）。
仓库范围内其余探测点：**1 处** —— `plugin/scripts/full-suite-runner.ts:1100`（探 `-p TasksMax=100`；真实 argv 为可选 `MemoryMax`/`CPUQuota`/`TasksMax`）。**本次不修**（不在 Touches；且其失败类不同——差异来自**用户提供的可选限制值**，不是某个 systemd 版本拒绝的**固定属性**）。记为同族观察项。

### 测试

`packages/quay/test/server-host-own-scope.test.mjs` 新增 `probe-parity AC1..AC4`（`node --experimental-strip-types --test`：7/7 pass）；`npx tsc --noEmit -p packages/*/` 全绿。

## Touches

- packages/quay/src/systemd-scope.ts
- packages/quay/test/server-host-own-scope.test.mjs
- tasks/gap-systemd-scope-probe-params-differ-from-real-scope.md
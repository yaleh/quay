---
id: gap-upgrade-leaves-legacy-project-runtime-stale-and-unmigrated
title: 升级路径对既有项目的项目本地 .quay/runtime/ 无任何机制：quay-init
  已退役该铺设、migrate_stale_mcp_entry 又不认裸 PATH 形式的 mcp_entry ⇒ 真实旧项目升级后 runtime
  面原封不动
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Finding

来源：`gap-aged-third-party-project-quay-upgrade-verification`（GOAL-009-AC-238）。2026-09-11 在
orangevps 上对一个**真实旧项目**（meta-cc，102 个真实任务，`.quay/runtime/bin/*` 为 2026-08-20 23:00
打的旧 vendored bundle）做隔离副本升级时实测。⛔ 全部读数取自副本，真实活项目只被 `cp -a` 读。

**现象（升级后逐项读回，副本 `/home/yale/quay-verify-upgrade-9eda8c70-root`）**：

```
.quay/config.yml  providers.native.path       : "."                  ← 未变
.quay/config.yml  providers.native.mcp_entry  : ['quay-native','mcp'] ← 未变（裸 PATH 引用）
.quay/runtime/bin/quay.js                     : 仍是 2026-08-20 的旧 bundle
.quay/runtime/bin/quay-native.js              : 同上
```

即：跑完 shipped `quay-init`（rc=0，闭集写成功）之后，**runtime 这一维没有任何变化**。

**根因是两半的，缺一不可**：

1. **旧机制已退役，没有继任者**。`plugin/scripts/quay-init.sh` 头部 `:22` 自陈已退役项里明确含
   「`.quay/runtime` 铺设 + `ensure_vendor_runtime` + `verify_provider_runtime_existence`」；
   当前 main dispatch（`:2217`–`:2249`）只写七项闭集，对 `.quay/runtime` 的引用数为 **0**。
   ⇒ **没有任何产品路径会刷新或清理既有项目的项目本地 runtime。**
2. **配置迁移够不到这种写法**。`migrate_stale_mcp_entry`（`:603`–`:700`）的设计目标是「陈旧/
   悬空的绝对路径」，其判定在 `:665`：
   `re.match(r"^quay(-native)?\.(js|ts)$", os.path.basename(ref))` —— 要求 mcp_entry 第 2 段
   **以 `.js`/`.ts` 结尾**。裸 `quay-native`（PATH 解析）不匹配 ⇒ 两个分支都不进 ⇒ `changed`
   保持 False ⇒ 配置按「配置保留」原样留下。
   （`path: "."` 同理：它是真实存在的目录，也不触发迁移。）

**净后果**：既有项目的 provider 绑定停留在**裸 PATH 引用**，其有效 runtime 是「该主机 PATH 上
`quay-native` 恰好解析到什么」；而项目自己那份 `.quay/runtime/bin/*` 是**没有任何产品路径会更新
或清除的死残留**。「升级」在 runtime 这一维上是空转。

**与已 done 的 `gap-delivery-surface-grows-but-target-freezes-no-upgrade` 的关系（不是重复）**：
那条处理的对象是**派生脚本副本**（`plugin/scripts/*` 铺进目标项目），而该铺设已被
`SPEC-plugin-lifecycle-single-bundle-2026-09-02` 整体退役——那个对象已不存在。本条处理的是**另一个
对象**：项目本地 vendored runtime。退役把它留成了孤儿，且没有继任机制接手。
⇒ 这正是该 done 任务所立原则（交付面长大而目标冻结）在被退役掩盖的第三个对象上复发。

**为什么 AC-238 没被这个缺口挡住（重要区分）**：AC-238 要求 `runtime_replaced: true`。本次由
**验证脚本自己**在 `verify-deliver-coldstart.sh --upgrade-existing` 里显式刷新
`.quay/runtime/bin/*` 达成——**替换动作来自验证工装，不是产品升级路径**。两者必须分清：AC-238 记录
证明的是「存在一条能完成升级的机械程序」，**不证明产品自带刷新机制**。

## AC

- [ ] AC1 对「既有项目本地 `.quay/runtime/` 在升级时怎么办」给出**一个明确裁定**并在机制上体现：
      刷新成本次交付物 / 移除 / 配置改为指向插件的 vendored runtime（三选一，写进本任务 Resolution 或
      后继 directive）。判据：在一个**非空**旧形态 fixture 上跑升级路径，所选行为可从产物上观察到。
- [ ] AC2 升级后既有项目的 runtime 绑定不再二义：要么 `mcp_entry` 不再是一条裸 PATH 引用（改为指向
      已交付的绝对路径），要么 `migrate_stale_mcp_entry` 显式**承认**并保留该形式（带理由注释）。
      判据：升级后读 `providers.native.mcp_entry`，并解析它实际指向的可执行文件，两者一致且可溯源到
      本次交付物。
- [ ] AC3 负控制（**能取假**）：对一份 `.quay/runtime/` 已是最新、且 mcp_entry 已是绝对路径的目标，
      升级路径**不得**做无谓改写或删除（防「为修 A 而破坏 B」）。判据：该输入下 `.quay/runtime/`
      逐字节不变、`mcp_entry` 逐字不变。
- [ ] AC4 上述行为有回归测试；且测试必须含**非空目标**形态（当前 quay-init 测试的 fixture 是空目录，
      结构上碰不到该分支）。

## DoD

在一台**非本机主机**的**非本仓库真实旧项目**上，用 shipped 交付物跑完升级路径后，把
「`.quay/runtime/` 的最终状态」与「`mcp_entry` 实际解析到的可执行文件及其 sha256」并列贴进 Evidence，
证明**该项目的 runtime 绑定已不再是「PATH 上碰巧是什么就是什么」**（或者是被裁定为有意保留并写明理由）。
`scripts/test.sh` 全量绿。

## Touches

- `plugin/scripts/quay-init.sh`
- `plugin/test/quay-init.test.mjs`
- `tasks/gap-upgrade-leaves-legacy-project-runtime-stale-and-unmigrated.md`

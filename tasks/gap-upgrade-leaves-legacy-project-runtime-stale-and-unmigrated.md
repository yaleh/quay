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

- [x] AC1 对「既有项目本地 `.quay/runtime/` 在升级时怎么办」给出**一个明确裁定**并在机制上体现：
      刷新成本次交付物 / 移除 / 配置改为指向插件的 vendored runtime（三选一，写进本任务 Resolution 或
      后继 directive）。判据：在一个**非空**旧形态 fixture 上跑升级路径，所选行为可从产物上观察到。
- [x] AC2 升级后既有项目的 runtime 绑定不再二义：要么 `mcp_entry` 不再是一条裸 PATH 引用（改为指向
      已交付的绝对路径），要么 `migrate_stale_mcp_entry` 显式**承认**并保留该形式（带理由注释）。
      判据：升级后读 `providers.native.mcp_entry`，并解析它实际指向的可执行文件，两者一致且可溯源到
      本次交付物。
- [x] AC3 负控制（**能取假**）：对一份 `.quay/runtime/` 已是最新、且 mcp_entry 已是绝对路径的目标，
      升级路径**不得**做无谓改写或删除（防「为修 A 而破坏 B」）。判据：该输入下 `.quay/runtime/`
      逐字节不变、`mcp_entry` 逐字不变。
- [x] AC4 上述行为有回归测试；且测试必须含**非空目标**形态（当前 quay-init 测试的 fixture 是空目录，
      结构上碰不到该分支）。

## Resolution

**AC1 裁定：选 (c) 配置改为指向插件的 vendored runtime；对「已无引用」的项目本地副本取 (b) 移除。**

三选一取 **(c)**：裁定 6（`SPEC-plugin-lifecycle-single-bundle-2026-09-02`）已退役 `.quay/runtime`
铺设，并把 quay Claude Code plugin 定为 runtime 的**唯一**交付面（quay-init 是项目初始化器，不是
安装器）——因此 (a)「刷新成本次交付物」等于复活一个已被 SPEC 退役的机制，不采。

(c) 对**已无引用**的项目本地副本的推论是 **(b) 移除**：一份没有任何产品路径维护的陈旧副本是一个
**假目标**（它看起来就是 runtime，而没有任何东西在维护它）。因此升级时把它退役——**先备份再移动，
绝不静默删除**——且仅在同时满足三条时才退役：①配置（迁移后）不再引用它；②它可被识别为 quay 自己的
安装生成 runtime（含 `bin/quay-native.js` 或 `bin/quay.js`）；③它与本次交付**不同字节**。
**逐字节相同的副本一律不动**（AC3）。

**机制落点** = `plugin/scripts/quay-init.sh` 的 `migrate_stale_mcp_entry`（升级通道）。四条迁移规则，
函数头注释里写全理由：

- `path`：悬空 / 保留段下的 quay runtime 目录（旧 vendor/ 布局）/ **陈旧的**退役项目本地 runtime 目录
  → 插件 provider 目录
- `mcp_entry` ①**裸 PATH 形式**（`quay` / `quay-native`，无路径分隔符）②悬空的 quay runtime 文件引用
  ③指向**陈旧的**退役项目本地 runtime 的引用 ④旧 vendor/ 布局 → 插件交付的 runtime 绝对路径
- `retired_rt_state()` = `absent | retire | keep | unknown`：**不可识别 ⇒ 永不触碰**；「无法评估」与
  「已评估且合格」不共用输出（硬规则 3b），四个态各报一个不同的词
- 哨兵：任意悬空路径（如 `./nonexistent/runtime.js`）**不迁移**，保住既有 negative control 的语义

**为什么之前够不到（根因，本次实测修正）**：不只是正则少认一种拼写——旧代码读 `me[1]` 当 runtime，
而裸 PATH 形式是 `["quay-native","mcp"]`，**可执行文件在 index 0，`me[1]` 是 `mcp` 动词**。
两处必须一起改：识别裸 PATH 形式 **且** 按 index 0 / index 1 两种真实形态取引用
（`runtime_ref_index`，限定在这两个位置，避免把深处一个无关的 `quay` 参数误当 runtime）。

**顺带修掉的两处「同形输出」（硬规则 3b / AC3）**：

- `ensure_loop_config` 原本**无条件** `yaml.safe_dump` 重写配置。重排会把 inline 的
  `mcp_entry: [...]` 变成块序列 ⇒ 一个**值层面无事发生**的升级仍会改写 provider 区块的文本形态，
  正是 AC3 禁的「无谓改写」。改为**值相等则不写**（写前写后各 dump 一次比较）。
- `write_config` 原本在 `--dry-run` 上**先**返回，早于「配置已存在」分支 ⇒ 既有项目上 `--dry-run`
  打印的是**全新安装**的 `would-write`，而真实运行根本不走那条路（它会迁移）。改为**先判存在、再判
  dry-run**，两个被调方内部各自处理 DRY_RUN，于是 dry-run 现在**报告**升级路径而不是跳过它。

## Evidence

**DoD 实测：非本机主机 orangevps × 非本仓库真实旧项目 meta-cc（102 个真实任务）。**
⛔ 只 `cp -a` 读：源 `/home/yale/quay-verify-upgrade-9eda8c70-root`，本次在其隔离副本
`/home/yale/quay-dod-upgrade-1789101558-root` 上跑；shipped 交付物 = 本分支的 plugin 树
（部署于 `/home/yale/quay-dod-plugin-1789101558/plugin`）。

| 读数 | 升级前 | 升级后 |
|---|---|---|
| `providers.native.mcp_entry` | `['quay-native','mcp']`（裸 PATH） | `['node','<plugin>/vendor/quay-native/dist/quay-native.js','mcp']` |
| `providers.native.path` | `.` | `<plugin>/vendor/quay-native` |
| `.quay/runtime/` 最终状态 | 存在，`bin/quay-native.js` sha256 `613d9e9d837882ca…` | **已退役（ABSENT）**，整树移至 `.quay/quay-init-backups/1789101585/runtime/` |
| `mcp_entry[1]` 实际解析到的可执行文件及其 sha256 | 不适用（PATH 解析，无路径可溯） | `<plugin>/vendor/quay-native/dist/quay-native.js`，`exists: True`，sha256 `77e792a2875db34709f3a6c0e7e6edf3a7986c6631eade8c1becb18dcc41d636` |
| 本次交付物自身 sha256 | — | `77e792a2875db34709f3a6c0e7e6edf3a7986c6631eade8c1becb18dcc41d636` |

⇒ **升级后绑定 = 本次交付物本身（sha256 逐字节相同）**，不再是「该主机 PATH 上 `quay-native` 恰好是
什么」。第二次运行（幂等 / AC3）：`.quay/config.yml` 逐字节不变
（`unchanged: .quay/config.yml loop: (values already current — no gratuitous rewrite, AC3)`）。

**本地判据读数**：`plugin/test/quay-init.test.mjs` **11/11 绿**（3 条新测试，全部用**非空**旧形态
fixture，且 fixture 的非空性是测试内的前置断言）；**负控制**——同一组测试对**未修**的
`quay-init.sh` 跑 ⇒ 3 条新测试红（AC2 的 stale-absolute 对照测试是使 AC3 可证伪的区分性对照：
同一类 fixture 在真正陈旧时**确实**被改，所以 AC3 的「没改」不是分支没跑）。
`scripts/test.sh --for-task … --allow-thin` **EXIT=0**。

**（顺带）ratchet 再锚定**：`plugin/scripts/quay-init.sh` 是 `quay-init-closure-ratchet` 的
LAYDOWN_SOURCE，改它必须再锚定。先以**旧** baseline 跑 `--gate` 确认 footprint **未增长**
（3 files / 568 bytes），再 `--reanchor` —— 只动了 fingerprint 与源文件 sha，没有把增长合法化。

## DoD

在一台**非本机主机**的**非本仓库真实旧项目**上，用 shipped 交付物跑完升级路径后，把
「`.quay/runtime/` 的最终状态」与「`mcp_entry` 实际解析到的可执行文件及其 sha256」并列贴进 Evidence，
证明**该项目的 runtime 绑定已不再是「PATH 上碰巧是什么就是什么」**（或者是被裁定为有意保留并写明理由）。
`scripts/test.sh` 全量绿。

## Touches

- `plugin/scripts/quay-init.sh`
- `plugin/test/quay-init.test.mjs`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `tasks/gap-upgrade-leaves-legacy-project-runtime-stale-and-unmigrated.md`

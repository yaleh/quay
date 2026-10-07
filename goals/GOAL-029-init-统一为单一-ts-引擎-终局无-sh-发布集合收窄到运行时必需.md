---
id: GOAL-029
title: init 统一为单一 TS 引擎、终局无 .sh；发布集合收窄到运行时必需
status: active
kind: goal
origin: 人 2026-10-07 裁定（与 manager 会话讨论）：init 终局无 .sh——升级与全新安装统一为单一 TS 引擎，过渡期
  quay-init.sh 缩为调用 bin/quay init 的垫片；不再有 --reconcile；serve
  默认值（等于回退值）不写进配置；升级失败非零退出并保留原配置；未知键保留并警告；并单独收窄发布集合。起因：2026-10-07 发布前演练发现已有项目升级后
  config validate 仍红，且产物里 shell 36910 行、641 个测试文件被当作产品发出。
activatedAt: 2026-10-07T02:00:26.223Z
statusLog:
  - at: 2026-10-07T02:00:26.223Z
    from: draft
    to: active
    actor: manager
    reason: 人 2026-10-07 指示：创建 GOAL、AC 与任务后激活；7 个任务已就位（AC-329..335 各有任务），退出条件可判定
---
## 背景

2026-10-07 的发布前演练（0.17.0 发布形态产物，隔离 HOME，user 与 project 两种 scope）暴露两类结构性问题。其一，**init 有两套引擎且覆盖面不同**：`bash quay-init.sh` 对已有配置依次走四个互相独立的写入步骤，而 `quay init --reconcile`/MCP `init` 走另一套 reconcile；结果是由 0.16.0 初始化的项目用 0.17.0 重跑脚本后 `quay config validate` 仍因缺 `loop.board`/`loop.gates` 失败（三次分叉：`mcp_entry`、`board/gates`、`serve:` 默认值），而 init 自己从不校验自己的输出。其二，**发布产物默认全发 `plugin/`**（`publish-dist-branch.sh` 第 114 行 `rsync` 全量，仅第 137 行删原始 `.ts`）：66 MB、1062 个文件，其中 184 个 `.sh`/36910 行、641 个测试文件（11.7 MB）、93 个 checker-mutation-cases、已取消渠道的验证/交付工具（`verify-deliver-coldstart.sh` 9111 行、`develop-deliver-tgz.sh` 3078 行）都被当作产品发出。人（2026-10-07）裁定：init 终局无 `.sh`，过渡期把 `quay-init.sh` 缩成调用 `bin/quay init` 的垫片；并单独收窄发布集合。

## 范围与非目标

范围：①init 单一 TS 引擎——状态自动决定（不存在/可解析/解析不了），先在内存算出新配置并校验、通过才原子写入，失败非零退出并保留原配置，保留用户注释/未知键/固定值，删除已登记的退役键，幂等（AC-329）；②对外面统一——CLI 与 MCP 都不再有 `--reconcile`/`--force`，`init --json` 给结构化报告，等于回退值的 `serve:` 默认值不写（AC-330）；③CLI 单独完成全新安装的完整闭集写入与项目值检测（AC-331）；④`quay-init.sh` 缩为 ≤40 行垫片，skill/README/release.yml 改调 CLI，退役 laydown 闭包棘轮（AC-332）；⑤升级矩阵——最近发布版本的真实 init 输出必须能被当前 init 升级到通过校验（AC-333）；⑥发布产物结构性排除测试/夹具/突变用例并有只减不增的体量棘轮（AC-334）；⑦发布产物里的 `.sh` 只保留运行时可达集合（AC-335）。非目标：重新设计配置 schema；删除 `quay-init.sh` 垫片本身（保留一个发布周期）；`scripts/dist` 的 46 MB bundle 重复内联问题（另案）；对真实项目（cantus、claudecodeui）的升级操作（由使用者在新版本发布后用 `/quay:init` 完成）。

## 退出条件

散文版：AC-329 至 AC-335 七条全部 achieved，且三条方向性读数同时成立——①在发布形态产物上，`.sh` 行数不高于立项读数 36910 的三分之一，`*.test.*` 文件数为 0；②发布前演练的门禁断言（`verify-plugin-channel-assertions`，project 与 user 两种 scope）全部 PASS，其中升级演练（`--upgrade-from` 上一发布版）通过，且 `quay config validate` 在 init 之后立即通过；③`plugin/scripts/quay-init.sh` 是不超过 40 行的垫片，skill、README、`release.yml` 不再直接调用该脚本。机器判据在 AC 记录的 `criterion` 里，不在这里。

## 风险

搬迁期间新旧两套写入者并存会再次分叉，所以 AC-331 要求全新安装与升级共用同一份默认值表；收窄发布集合可能误排除活消费者，而现有"dist 引用闭包"门禁只覆盖 dist bundle，所以 AC-334/AC-335 的任务必须用新构建重跑整套演练并留下原始读数；"失败即保留原配置"可能让用户自己的不兼容值永远挡住升级，所以需要指明具体值并提供 `--drop-incompatible`；历史夹具由旧 tag 真实重建，依赖旧 tag 构建的可重现性；`serve:` 默认值不再写入会改变 `quay init --reconcile --dry-run` 的既有输出，相关测试要同步迁移；`laydown-set-check.test.mjs` 在 develop 上本就有 1 个失败（2026-10-07 实测 8/9），改动前后要如实记录读数。

## 与其他 goal 的关系

承接 GOAL-003（插件面收敛，已 achieved）把 init 收缩为闭集写入的方向，把"脚本编排 + TS 步骤"这一过渡形态推到终局；与 GOAL-020（CI 与 release 渠道成为可信守门员）共享发布门禁 `verify-plugin-channel`，AC-332/AC-334 都会改它的调用点或断言；与 GOAL-015（交付出去的东西下游真的能用）同向，是"配置面交付的每个键下游都能用"的一次具体收口。不依赖任何 active goal 的完成。
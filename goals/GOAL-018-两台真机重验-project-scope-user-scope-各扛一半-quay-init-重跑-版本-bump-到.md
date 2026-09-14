---
id: GOAL-018
title: 两台真机重验：project scope + user scope 各扛一半，quay-init 重跑，版本 bump 到 0.7.0
status: active
kind: goal
origin: 人 2026-09-14 裁定（对话中三问三答）：①host×scope 分工 = ad-arm1/archguard 测 project
  scope、orangevps/meta-cc 测 user scope（不是每台各测两种）；②版本直接定 0.7.0（minor，不再按 develop
  领先量重新核算）；③不是"讨论完就停"也不是"现在直接执行"，而是"为这次验证创建一个 GOAL"——预期验证过程中会发现不少新问题，那些问题各自另立
  gap 任务承接，不在本 GOAL 内解决。
activatedAt: 2026-09-14T04:01:54.269Z
---
## 背景（2026-09-14 实测，动手创建本 GOAL 前直接 ssh 两台机器读到的现状，非推断）

**版本与插件注册现状**：

| | 本仓库 develop | ad-arm1 | orangevps |
|---|---|---|---|
| CLI 版本 | 0.6.1 | 全局 bin 不存在（`npm ls -g quay` 为空） | `quay@0.6.1` 但 `quay-native@0.6.0`（两者不一致） |
| `claude plugin list` | — | `quay@quay 0.4.0`，**user scope，disabled** | `quay@quay 0.3.20`，user scope，enabled |
| marketplace 指向 | — | `~/ac247-probe.npm/.../plugin`（GOAL-016 探测残留） | `~/quay-verify-upgrade-3b0932db.npm/.../plugin`（AC-239 e2e 探测残留） |

**两个目标项目现状**：

- `ad-arm1:/home/yale/work/archguard`（branch=develop，最近提交 2026-09-12）：`.quay/config.yml` 的
  `providers.native.path`/`mcp_entry` **直接指向探测用的临时 npm 安装目录**，不是任何持久位置；
  `.claude/settings.json` 只有一个既有的 `Stop` hook，**没有 `enabledPlugins`** —— 从未真正走过
  "项目自带插件注册"这条路。
- `orangevps:/home/yale/work/meta-cc`（branch=main，最近提交 2026-08-21，**已停滞超过 3 周**）：
  `.quay/config.yml` 的 provider 绑定是干净的 PATH 引用（`["quay-native","mcp"]`），没有硬编码探测路径；
  但同样**没有 `.claude/settings.json`**，且当前**没有任何 driver 在跑**（pid 文件与 `ps` 均为空）。

⇒ 过去两次真机验证（GOAL-009 AC-207/238/239 用 meta-cc 隔离副本、GOAL-016 用 archguard）**全部走的是
"直接起 driver 二进制"这条路径**，从未真正验证过"用户在 Claude Code 会话里通过插件系统启用 quay → 驱动"
这条规范路径在这两台真实机器、当前版本下是否走得通；且两台机器现有的 marketplace 注册都悬在应被清理的
探测目录上——一旦那些目录被清掉，这条路径会静默失效而无任何检查发现。

## 本 GOAL 的命题

用**当前构建（bump 到 0.7.0 之后的产物）**，在两台非本机主机上，**分别验证 Claude Code 插件系统的
project scope 与 user scope 两种安装/启用方式**，重新执行 `quay-init`（升级/幂等路径，不是全新 init），
证明每条路径都能让目标项目自己的 drivers 把一条真实任务从 `todo` 驱动到 `done`、留下真实非记账代码提交。

**host × scope 分工（人 2026-09-14 裁定，不是每台各测两种）**：

- **ad-arm1 × archguard → project scope**：archguard 已有非空、带无关 Stop hook 的 `.claude/settings.json`——
  quay-init 重跑必须把 `enabledPlugins` **合并**进去而不覆盖已有内容，这是此前从未在非空、非 quay 自己
  项目上验证过的分支，价值高于随便找个空项目。
- **orangevps × meta-cc → user scope**：先把现有指向探测目录的 `quay@quay 0.3.20` 那条 marketplace 记录
  **删键**（不是 disable——disable 只置 false 不删键，判据会误判"已注册"，见既往实证），换成指向本次
  0.7.0 交付物持久安装位置的注册。

## 范围（AC-257..AC-259）

- **AC-257**：ad-arm1/archguard，project scope，0.7.0，quay-init 重跑（非空 settings.json 合并语义），
  真实 todo→ready→done 任务，非记账代码提交。
- **AC-258**：orangevps/meta-cc，user scope，0.7.0，quay-init 重跑（删键重注册，非探测路径持久安装），
  真实 todo→ready→done 任务，非记账代码提交。
- **AC-259**：版本一致性——本仓库 8 个版本承载文件 == 0.7.0，且 AC-257/258 两条记录里的 `quay_version`
  字段同样读到 0.7.0（把"版本已 bump"这件事锚在两台真实机器的实际安装读数上，不是只锚在仓库内的一次
  文本替换）。

## 非目标（人 2026-09-14 当场裁定，各自去向已记，⛔ 不是遗忘）

- **过程中发现的新缺陷不在本 GOAL 内解决**——各自另立 `gap-*` 任务承接，本 GOAL 只跟踪"重验本身"这件事；
  人已明确预期"验证过程中还是会发现不少问题"。
- **不解决孤儿进程/探测目录的机制化清理**（orangevps 上 20+ 个残留 driver 进程、两台机器上各一个已退役
  的 `session-liveness.sh` 残留）——这次先手动清理作为执行前置，是否需要一个自动回收机制留给发现问题后
  的独立 gap 任务判断，不预设。
- **不要求两台机器互换分工再测一遍**（即不做 project-scope×orangevps / user-scope×ad-arm1 的交叉覆盖）——
  人 2026-09-14 明确选择"各扛一种"而非"各测两种"。
- **不新增跨主机验证编排器**——沿用 `cross-host-verification-has-no-orchestrator` 已识别的现状（每条 AC
  手写 e2e 段），是否造编排器仍按人 2026-09-12 裁定的方案 B 等 GOAL-016 同类经验积累后再定。

## 风险

1. **archguard 的 provider 绑定当前指向的探测目录可能已经/即将被清理**——若在本 GOAL 执行前就已失效，
   AC-257 的起点就是"项目已经打不开"而非"项目绑定了陈旧路径"，两种起点对 quay-init 的迁移逻辑要求不同
   分支，执行时需先读一次现状再判断走哪条修复路径。
2. **meta-cc 停摆 3+ 周**——重新驱动前需确认其 `develop`/`main` 分支模型现状（quay-init 的
   `--adopt-branch-model` 是否需要被触发），不能假设它和 08-20 AC118 验证时的状态一致。
3. **AC-259 的"锚在真实安装读数"设计与 AC-105（判据不得引用生命周期短于判据本身的对象）同源**——
   两条记录必须来自本次真实重跑，不得引用历史记录充数（沿用 AC118 的"验证时刻新于起点"纪律）。
4. **同硬规则 4c**：`install_scope` 这个字段要能穿过"读取时刻"这一层——即判据不能只信驱动方自报的
   `install_scope` 字符串，还要交叉核对对应 `.claude/settings.json`（project）或 `~/.claude/settings.json`
   （user）里确实有 quay 的 `enabledPlugins` 键、且指向的路径不匹配探测目录的字面模式
   （`verify-|probe|/tmp/`），否则"scope"只是一个自报文本，不是可核实的安装形态。

## 与其他 goal 的关系

承接 **GOAL-009**（交付面闭环：跨主机安装 + driver 真活 + 存量不丢）与 **GOAL-016**（驱动质量自证：
产出经外部机械判据确认为正确）已验证过的能力，本 GOAL 补的是两者都没有覆盖的维度——**通过 Claude Code
插件系统本身（而非直接起 driver 二进制）完成安装/启用，且两种 scope 分别在真实、非空的第三方项目上
验证**，同时把"版本已 bump"这件事锚定在两台真实机器的安装读数上而不只是仓库内的文本替换。
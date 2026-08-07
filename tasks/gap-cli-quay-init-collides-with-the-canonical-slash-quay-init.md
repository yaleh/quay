---
id: gap-cli-quay-init-collides-with-the-canonical-slash-quay-init
title: "CLI subcommand `quay init` (DIR-098, 07-23, workspace scaffolding — a
  legitimately different operation: create a brand-new empty quay task store)
  collides in name with the skill `/quay:init --all --loop` that is the
  CANONICAL path for onboarding an existing project onto quay-driven
  development (human ruling 2026-08-07); `quay init --loop` silently swallows
  the unrecognized --loop flag and exits 0 reporting success, laying down
  nothing but .quay/config.yml + tasks/ — reproduced live on B
  (orangevps.wan.hwang.men/~/work/meta-cc): plugin/scripts=0,
  orchestration/=0 after a reported-successful run; `quay --help` advertises
  `quay init` as a first-class top-level command (line 347), so a real
  third-party user trying to start quay-driven development is more likely to
  find and run the wrong one first"
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**用户想「开始用 quay 驱动这个项目的开发」时，命令行上第一个撞见的是错的那个入口,
而它不报错、只静默做另一件事,报成功。**

## 人的裁定（2026-08-07，本任务的唯一判据来源）

> 「用户初始化一个使用 quay 开发的项目应该是在 Claude Code 会话中输入 `/quay:init`。」

⇒ **skill 是这个用例唯一的规范路径。** CLI 的 `quay init` 不是它的替代品——即使它背后
确实服务另一个合法目的（见下），**它的存在与可发现性本身就是风险**。

## 实测（B 机 orangevps.wan.hwang.men，2026-08-07，真实第三方项目 meta-cc）

| 步骤 | 结果 |
|---|---|
| `cd ~/work/meta-cc && quay init --loop` | **exit 0**，输出「Workspace ready at: /home/yale」 |
| 事后核对 `plugin/scripts` | **0 个文件** |
| 事后核对 `orchestration/*.md` | **0 个文件** |
| `quay init --loop --dry-run` 单独复测 | 确认 `--loop` **被静默忽略**，无警告无报错 |

## 根因（读码，非猜测）

**两个真实不同的操作，共用了 `init` 这个词：**

1. **CLI `quay init`**（`packages/quay/bin/quay.ts:508`，`DIR-098`，2026-07-23）——
   **从零创建一个全新的、空的 quay 任务仓库**（`.quay/config.yml` + `tasks/`）。
   选项只有 `--force`/`--dry-run`/`--root`，**没有 `--loop`**，多余 flag 被 argv 解析静默吞掉。
2. **skill `/quay:init --all --loop`**（`plugin/skills/init/SKILL.md`，内部名 `quay-init`）——
   **把完整 loop 开发机制铺进一个已有项目**。接线正确：其注释自陈
   「the skill now delegates here」，转调 `plugin/scripts/quay-init.sh`。

**`quay-native` 与 MCP 均无叠加的 init 入口**（各 0 命中）——不是「到处混乱」，
是**一处精确的撞名**，且被 `quay --help` 顶层展示放大了发现概率
（347 行：`quay init [--force] [--dry-run] [--root <path>]`，与其余命令并列，无任何区分提示）。

## 修复方向（接法留执行时，不预设）

1. CLI `quay init` 检测到 `--loop` ⇒ **报错并指向 `/quay:init`**，不静默忽略；或
2. CLI `quay init` 从 `--help` 顶层移除/降级展示，只留 `--root`/`--force` 场景的文档入口；或
3. 两者合并：CLI 检测到目标目录已是「非空第三方项目」（有 `.git` 但无 `.quay/`）时，
   主动提示「你可能想要的是 Claude Code 会话里的 `/quay:init --all --loop`」。

**不预设选哪条**——人已裁定 skill 是唯一规范路径，执行时按这条判据选修法。

## Contract

```
measure loop_flag_rejected = `cd <tmp-empty-dir> && quay init --loop --dry-run 2>&1; echo EXIT=$?` 输出的 EXIT 字段
band loop_flag_rejected != 0（当前基线 0——静默接受，不合格）
invariant `quay --help` 顶层列出的 `init` 用法必须与其实际行为一致，不得暗示它能做 skill 才能做的事
invoke `cd <tmp> && quay init --loop --dry-run; echo $?`
control 传一个真正合法的 flag（如 `--force`）⇒ 行为不变，证明修复没有破坏原有合法用途
resume 若中断，先跑 measure 复核 --loop 当前是否仍被静默接受
```

## Acceptance Criteria

- [ ] AC1: `quay init --loop` 不再静默成功——报错并指出正确路径，或产出与「已铺设」相符的实际结果
- [ ] AC2: `quay --help` 顶层的 `init` 说明不再可能被误读为「能铺 loop 机制」
- [ ] AC3: **负控制**——`quay init --force`（合法既有用法）行为不受本次修复影响
- [ ] AC4: 与 DIR-098 交叉标注——CLI `init`「创建全新空仓库」这个合法用途本身不被取消，只堵住误用入口

## Definition of Done

- [ ] AC1-AC4 实跑输出贴进任务体（含在 B 机或等价真实第三方项目上的复测）
- [ ] 完整套件绿

## Touches
- packages/quay/bin/quay.ts
- README.md（若需补文档区分）
- tasks/gap-cli-quay-init-collides-with-the-canonical-slash-quay-init.md

## Dispatch review

reviewer: none
at: 2026-08-07T06:0xZ
changed: 人 2026-08-07 裁定「/quay:init 是唯一规范路径」后，管理者在 B 机真实执行中复现该缺陷并立案

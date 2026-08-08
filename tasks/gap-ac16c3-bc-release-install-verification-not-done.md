---
id: gap-ac16c3-bc-release-install-verification-not-done
title: AC16③ stage 判据未达成：3 个阻塞任务代码已 done（npm-install/cli-init/readme），但 B/C
  上「release 装出来的那份、非 quay 项目跑通一次」从未实跑——本机无法触达 B/C（ssh 不可解析），剩余缺口 = 跨机真机复测；3 任务
  done 不等于 AC16③ 达成
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**AC16③ 的 3 个代码阻塞任务已 done，但 stage 判据本身未达成——剩余缺口是 B/C 真机复测。**

### 三件代码活已闭合（139def2c，2026-08-08）

| 任务 | 状态 | 做了什么 |
|---|---|---|
| gap-npm-install-does-not-register-the-plugin | done | postinstall register-plugin.mjs 钩子，`/quay:init` 干净安装后可见 |
| gap-cli-quay-init-collides-with-the-canonical-slash-quay-init | done | CLI `quay init --loop` 拒收并改道 `/quay:init --all --loop`（fail-closed） |
| gap-readme-source-install-commands-are-all-broken | done | README `quay.js`→`quay.ts` 全文档修正（4 份 doc） |

三者工作均 merged 进 integration（230017ca），正是 09:10 GREEN 套件（3006 tests fail 0，
含 init.test.mjs / cli.test.mjs）测过的那棵树。**代码侧 AC16③ 前置链已通。**

### stage 判据原文（人 2026-08-07 裁定）

> AC16 判据③：「在 **B 或 C** 上，用 **release 装出来的那份**，在一个 **非 quay 项目**上跑通一次。」

### 实测（manager 2026-08-08 09:2xZ，AC18 重测）——stage 未达成

- orangevps：archguard 无 `.quay` ／ meta-cc 有 `.quay` 但 `src` 指向 `packages/quay`（**源码路径**）
- ad-arm1：archguard 有 `.quay` 但**安装来源读不出** ／ meta-cc 无 `.quay`
- ⇒ **判据原文写着「不得以目录存在判达成」**——而实测只查到目录存在，且来源是源码路径，非 release 安装。

### 关键边界（外层复核，2026-08-08 09:4x）

- **3 任务 done ≠ AC16③ 达成**：代码侧把「路径不通」变成「路径通」，但「用 release 装出来的那份在
  非 quay 项目上跑通一次」这一步**从未实跑**。
- **本机无法触达 B/C**：`ssh orangevps`/`ssh ad-arm1` 均「Name or service not known」——B/C 属
  manager 能触达的跨机观察层，非外层/内层可从主检出发起的动作。
- npm-install 任务 DoD 自陈：「真实独立机器上的完整会话内调用 `/quay:init` 无法从本 worktree 触达
  B/C 远程机，见 DoD 声明」——机制侧在本机 clean-HOME 已证明（postinstall 自动物化插件），
  **B/C 侧是未执行的剩余项**。

### 修法方向（跨机层，不预设）

在能触达 B/C 的机器（manager）上：用 release（v0.4.0 tgz 或 SEA bundle）在 B 或 C 装出一份，
对一个非 quay 项目（无 `.quay/`、有 `.git`）跑 `/quay:init --all --loop`，贴出会话内调用证据
（`claude plugin list` 显示 quay enabled + init skill 出现 + 铺完的产物）。**判据形态 = 真机会话内
调用证据，不是目录存在。**

## Contract

```
measure bc_release_installed = 在 B 或 C 上 `npm install -g quay-<ver>.tgz` 后 `claude plugin list | grep -c "quay.*enabled"` stdout 数字段（≥1）
measure bc_init_runs = 在 B 或 C 的非 quay 项目（.git 在、.quay/ 无）会话内跑 `/quay:init --all --loop` 的退出码（0 = 跑通）
band bc_release_installed = ≥1 且 bc_init_runs = 0（release 装出 + 非 quay 项目跑通一次）
invoke 在 B 或 C 上执行 release 安装 + `/quay:init --all --loop`
control 负控制：安装来源必须是 release（npm tgz 或 SEA bundle），不得是源码路径（packages/quay/bin/quay.ts）
resume 若中断，先跑 measure 读 B/C 当前 .quay 的安装来源，不要假设已达成
```

## Acceptance Criteria

- [ ] AC1: **B 或 C 上 release 安装**——`npm install -g quay-0.4.0.tgz`（或 SEA bundle）后
      `claude plugin list` 显示 quay enabled（≥1）
- [ ] AC2: **非 quay 项目跑通一次**——对一个无 `.quay/` 有 `.git` 的项目，会话内 `/quay:init --all
      --loop` 退出 0，铺完 plugin/scripts + orchestration/ + 机制产物
- [ ] AC3: **安装来源是 release**——负控制：非源码路径（不得是 `packages/quay/bin/quay.ts` 那种开发树形态）
- [ ] AC4: 与 gap-npm-install / gap-cli-quay-init-collides / gap-readme-source-install（均 done）交叉标注——
      代码前置链已通，本条是 stage 判据的 B/C 真机复测

## Definition of Done

- [ ] AC1-AC4 实跑输出贴任务体（B/C 上 release 安装 + 会话内 /quay:init 调用证据 + 来源负控制）

## Touches
- 跨机真机复测（B orangevps / C ad-arm1，manager 可触达）
- README（若复测暴露文档缺口）
- tasks/gap-npm-install-does-not-register-the-plugin-with-claude-code.md（AC4 交叉标注）
- tasks/gap-cli-quay-init-collides-with-the-canonical-slash-quay-init.md（AC4 交叉标注）
- tasks/gap-readme-source-install-commands-are-all-broken-quay-js-does-not-exist.md（AC4 交叉标注）

## Dispatch review

reviewer: none
at: 2026-08-08T09:4xZ
changed: 管理者 AC18 重测（AC16③ stage 未达成：B/C .quay 来自源码路径、判据原文禁目录存在判达成）+
  外层复核（3 代码任务 done 但 stage 判据未跑、本机无法触达 B/C）——缺口 = B/C release 真机复测，立案。

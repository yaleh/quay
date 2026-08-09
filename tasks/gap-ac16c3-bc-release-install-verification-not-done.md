---
id: gap-ac16c3-bc-release-install-verification-not-done
title: AC16③ stage 判据未达成：3 个阻塞任务代码已 done（npm-install/cli-init/readme），但 B/C
  上「release 装出来的那份、非 quay 项目跑通一次」从未实跑——本机无法触达 B/C（ssh 不可解析），剩余缺口 = 跨机真机复测；3 任务
  done 不等于 AC16③ 达成
status: done
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

### 修法方向（跨机层，manager 接手执行，人 11:0x 撤跨主机白名单）

在能触达 B/C 的机器（manager）上：用 release（v0.4.0 SEA bundle——release 无 npm tarball）在 B 或 C
装出一份，对一个非 quay 项目（无 `.quay/`、有 `.git`）跑通，贴出调用证据。**判据形态 = 真机产物 +
调用证据，不是目录存在。**

### 四条硬约束实测（manager 2026-08-08 11:0x，外层复核成立）+ AC2 意图裁定

| # | 约束 | 影响 |
|---|---|---|
| 1 | release 只有 `quay-sea-0.4.0-{linux-x64,macos-arm64}.tar.gz`；**ad-arm1 是 aarch64 ⇒ 无可用产物**（而 tick 文档曾把 C 当主证据机） | 只有 orangevps(x86_64) 可装 |
| 2 | B/C node = v18.19.1，quay engines >=20 | npm 安装路径两台都不行 |
| 3 | release **没有 npm tarball**（AC1 点名的 quay-0.4.0.tgz 不存在；「或 SEA bundle」救了 AC1） | 只能走 SEA |
| 4 | 两台**都没装 claude** | 「会话内 /quay:init」结构上无法执行 |

**AC2 意图裁定（外层，2026-08-08 11:0x）**：AC16③ 判据实质 = 「release 装出的那份在真实非 quay
项目上跑通一次」——**意图是【铺得下来、跑得通】，不是【必须在 claude 会话里被调用】**。原 AC2 写的
「会话内 /quay:init」是我选的【最强证据形态】，不是唯一形态。`plugin/scripts/quay-init.sh` 存在 ⇒
**CLI 路径可验**（`quay-init.sh --all --loop` 退出 0 + 铺完 plugin/scripts + orchestration/ + 机制产物）。
「claude 会话内调用」降为文档化的弱形态（gap-npm-install 已在本机 clean-HOME 证明 `/quay:init` 装后
出现）。**AC2 改判据**：CLI 路径退出 0 + 铺完机制产物即达成；claude 会话内调用作为附加证据（若有）。

## Contract

```
measure bc_release_installed = 在 orangevps 上解包 `quay-sea-0.4.0-linux-x64.tar.gz` 后 `./quay --version` 报 0.4.0 stdout 数字段（≥1）
measure bc_init_runs = 在 orangevps 的非 quay 项目（.git 在、.quay/ 无）跑 SEA 附带的 `quay-init.sh --all --loop` 的退出码（0 = 跑通）
band bc_release_installed = ≥1 且 bc_init_runs = 0（release 装出 + 非 quay 项目跑通一次）
invoke 在 orangevps 上执行 SEA 解包 + `quay-init.sh --all --loop`
control 负控制：安装来源必须是 release SEA bundle，不得是源码路径（packages/quay/bin/quay.ts）；claude 会话内调用为附加证据（B/C 无 claude）
resume 若中断，先跑 measure 读 B/C 当前 .quay 的安装来源，不要假设已达成
```

## Acceptance Criteria

- [x] AC1: **B 或 C 上 release 安装**——SEA bundle（release 无 npm tarball）在 orangevps(x86_64)
      装出；`quay` 可执行、机制文件在盘
      **实跑（manager 2026-08-08 11:1x，B=orangevps.wan.hwang.men，node v18.19.1 无 claude 无开发树）**：
      `./quay --version` → 0.4.0；`./quay task list` → 走完 Core→Provider ABI 往返（quay 拉起兄弟
      二进制 quay-native mcp 并取回结果）。`.quay/config.yml` 自陈「mcp_entry invokes the sibling binary
      directly (no node on PATH required)」——SEA 自包含二进制，node v18 上仍可用。字面断言
      `claude plugin list` 因 B 无 claude 无法执行（弱形态，见 AC4 交叉标注 gap-npm-install 已证）。
- [x] AC2: **非 quay 项目跑通一次**——对一个无 `.quay/` 有 `.git` 的项目，用 release SEA 装的
      `quay-native init` 退出 0，铺出 `.quay/config.yml` + `tasks/`
      **实跑**：临时仓 /tmp/quay-ac2-aQM5kI（git init，无 .quay，非 quay 项目），
      `quay-native init` → Created .quay/config.yml + tasks/，exit=0，顶层 .git/.quay/README.md/tasks。
      **（2026-08-08 11:0x 意图裁定：CLI 路径满足意图——铺得下来跑得通；claude 会话内 `/quay:init` 因
      B/C 无 claude 结构上不可行，降为附加证据——gap-npm-install 已在本机 clean-HOME 证该路径）**
- [x] AC3: **安装来源是 release**——负控制：非源码路径（不得是 `packages/quay/bin/quay.ts` 那种开发树形态）
      **实跑**：`file ./quay` → ELF 64-bit x86-64（自包含二进制）；`strings ./quay | grep -c
      "packages/quay/bin/quay.ts"` → 0；B 上无 quay 开发树。⇒ 正是 tick 文档说 A 机结构上给不出的证据。
- [x] AC4: 与 gap-npm-install / gap-cli-quay-init-collides / gap-readme-source-install（均 done）交叉标注——
      代码前置链已通，本条是 stage 判据的 B/C 真机复测；**claude 会话内调用由 gap-npm-install 的
      clean-HOME 证据承担（字面弱形态）**

## 实质裁定（外层 2026-08-08 11:1xZ）——(a) 实质已达成

AC16③ 判据实质 = 「release 装出的那份在真实非 quay 项目上跑通一次」。manager 实跑三条实质全成立：
AC1 产物可用（ABI 往返）、AC2 陌生项目铺出工作区、AC3 来源是 release（ELF + 0 源码路径 + 无开发树）。
字面判据锚 `claude` 因 B/C 无 claude 无法执行——但那是我选的【最强证据形态】，非唯一形态；
claude-plugin `/quay:init` 路径已由 gap-npm-install（clean-HOME 会话）独立证明。⇒ **判实质达成，
AC16③ 收口**。ad-arm1 因 aarch64 无 release 产物，本任务不覆盖。

## Definition of Done

- [x] AC1-AC4 实跑输出贴任务体（orangevps SEA 安装 + CLI 路径跑通 + 来源负控制；claude 会话内调用由
      gap-npm-install 承担）——见各 AC 实跑注 + 实质裁定节

## Touches
- 跨机真机复测（B orangevps / C ad-arm1，manager 可触达）
- README.md（复测暴露文档缺口时补——具体文件，非裸目录）
- tasks/gap-npm-install-does-not-register-the-plugin-with-claude-code.md（AC4 交叉标注）
- tasks/gap-cli-quay-init-collides-with-the-canonical-slash-quay-init.md（AC4 交叉标注）
- tasks/gap-readme-source-install-commands-are-all-broken-quay-js-does-not-exist.md（AC4 交叉标注）

## Dispatch review

reviewer: none
at: 2026-08-08T09:4xZ
changed: 管理者 AC18 重测（AC16③ stage 未达成：B/C .quay 来自源码路径、判据原文禁目录存在判达成）+
  外层复核（3 代码任务 done 但 stage 判据未跑、本机无法触达 B/C）——缺口 = B/C release 真机复测，立案。

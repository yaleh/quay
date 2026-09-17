---
id: gap-readme-plugin-install-private-repo-gh-auth
title: README Option A 安装步骤缺少私有仓库 gh 认证前置（gh auth setup-git）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: finding
---
**type:** execution

## Finding

本次对话实测（在 tokyo-alpha.wan.hwang.men 上复现并修复），`yaleh/quay` 是**私有仓库**（`gh repo view yaleh/quay --json isPrivate` → `true`），而 README.md `:97-102`「Option A — as a Claude Code plugin (recommended)」给出的安装步骤——

```
/plugin marketplace add yaleh/quay
/plugin install quay
```

——完全没有提示这是私有仓库、需要预先配置 GitHub 认证。一个刚装好 `gh` 但只做过 `gh auth login`（未做 `gh auth setup-git`）的开发者，直接跟着 README 这两行走会遇到两种失败（都已实测复现）：

- `claude plugin marketplace add yaleh/quay`（未做任何前置配置时）→ `SSH host key is not in your known_hosts file` / `Host key verification failed`（本机若也没有 SSH key 注册到 GitHub 账号，会进一步失败于 `Permission denied (publickey)`）；
- 改用显式 HTTPS URL 后（`claude plugin marketplace add https://github.com/yaleh/quay`）仍失败：`fatal: could not read Username for 'https://github.com': terminal prompts disabled` —— 因为 `gh auth login` 本身**不会**自动把 `gh` 注册为 git 的凭证助手，git 侧完全没有 `credential.helper`。

实测证明**唯一起作用的修复**是 `gh auth setup-git`（把 `gh auth git-credential` 注册为 `credential.https://github.com.helper`）；做完这一步后，`claude plugin marketplace add yaleh/quay`（Claude Code 2.1.274 检测到本机 SSH 未配置会自动打印 `SSH not configured, cloning via HTTPS` 并回退到 HTTPS）与 `claude plugin install quay@quay` 均一次成功，无需手工处理 SSH host key。README 当前完全没提这个前置步骤——`grep -c "gh auth" README.md` = 0（改前基线）。

## Acceptance Criteria

- [x] AC1: README.md「Option A — as a Claude Code plugin (recommended)」一节（`:97` 附近）在安装命令前或后补充：`yaleh/quay` 是私有仓库，需要 `gh auth login`（若未登录）+ `gh auth setup-git`（把 `gh` 注册为 git 的 HTTPS 凭证助手）作为前置步骤。取假判据（改前/改后对照）：`grep -c "gh auth setup-git" README.md` 改前 0 → 改后 ≥ 1。
- [x] AC2: 新增文字须说明**为什么** `gh auth login` 单独不够（git 侧无 credential helper，直接 HTTPS clone 会报 `terminal prompts disabled`），不能只给命令不给原因。取假判据：`grep -c "terminal prompts disabled\|credential" README.md` 改前 0 → 改后 ≥ 1。
- [x] AC3: 不得在新增文字中引入具体第三方主机名（负控制）：`grep -iE "tokyo-alpha|VM-16-5" README.md` 必须为 0 命中（改前改后均需为 0，验证改动没有夹带调试环境细节）。

## Definition of Done

README.md `Option A` 安装步骤旁边有可读的前置说明，按它操作能让一个刚装好 `gh`、只做过 `gh auth login`（未做 `setup-git`）的开发者第一次就跑通 `/plugin marketplace add yaleh/quay` + `/plugin install quay`，不需要再自行摸索到 `gh auth setup-git` 这一步——不是"加了一行提及 gh"就算数，是这行提及要包含可执行的命令（`gh auth setup-git`）本身，且给出"为什么 login 不够"的原因。

## Touches

- README.md
- tasks/gap-readme-plugin-install-private-repo-gh-auth.md（自身）

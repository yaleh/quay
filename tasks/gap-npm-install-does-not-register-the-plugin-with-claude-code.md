---
id: gap-npm-install-does-not-register-the-plugin-with-claude-code
title: "`npm install -g quay-*.tgz` — the install path README tells users to run —
  lands quay + plugin/ under npm root but NEVER registers the plugin with Claude
  Code, so the canonical entry point `/quay:init` (human ruling 2026-08-07: this
  is THE way a user onboards a project) does not exist after a clean install;
  measured on both B (orangevps) and C (ad-arm1) 2026-08-07: npm-root plugin dir
  present on both, referenced by ~/.claude/settings.json on NEITHER (grep count
  0/0); B's settings still points at /home/yale/work/quay/plugin, a DEV-TREE path
  that no longer exists, and C references only a bare 'quay'/'yaleh/quay' with no
  resolvable path — this blocks AC16 criterion 3 (end-to-end usability from a
  release artifact on a non-quay project) permanently, not incidentally"
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

**装了包 ≠ skill 可用。** 用户按 README 跑完 `npm install -g quay-0.4.0.tgz`，
**`/quay:init` 在 Claude Code 里依然不存在**——因为 npm 安装**不触碰** Claude Code 的插件注册。

## 实测（2026-08-07，B 与 C 互为对照，非推断）

| 项 | B（orangevps） | C（ad-arm1，全新机） |
|---|---|---|
| `npm install -g` 结果 | ✅ `quay v0.4.0` 在 PATH | ✅ `quay v0.4.0` 在 PATH |
| npm root 下 `quay/plugin` | ✅ **存在** | ✅ **存在** |
| **该路径被 `~/.claude/settings.json` 引用** | ❌ **grep 计数 0** | ❌ **grep 计数 0** |
| `settings.json` 实际引用的 quay 路径 | `/home/yale/work/quay/plugin` ⇒ **【已不存在】**（开发树路径） | 仅 `"quay"`／`"yaleh/quay"`，**无可解析路径** |

⇒ **两台机器都装成功了包，两台都没有把安装物接进 Claude Code。**
B 的配置指向一个**开发树路径**（历史遗留，且该目录已被归档删除）；
C 作为**全新机器**，压根没有任何指向安装物的路径 ⇒ **这不是 B 的残留问题，是安装路径本身缺一步**。

## 为什么这条卡死 AC16③（而非只是不便）

**人 2026-08-07 裁定**：「用户初始化一个使用 quay 开发的项目应该是在 Claude Code 会话中输入 `/quay:init`。」
⇒ **`/quay:init` 是规范路径**。而本缺陷使它在**干净安装后不存在**。

AC16 判据③要求「**用 release 装出来的那份**，在一个**非 quay 项目**上跑通」。
⇒ **不修这条，判据③永远不可能被满足**——不是「暂时没做到」，是**路径不通**。

## 与既有任务的关系

`gap-cli-quay-init-collides-with-the-canonical-slash-quay-init`（`ready`）管的是
**三个 init 入口中哪个是官方的**（命名撞车 + 文档收敛）。
**本条更靠前**：**官方那个在真实安装之后压根不出现**。两者都属 init 暴露面，但
判据不同——前者是命名/文档，**后者是安装器与宿主（Claude Code）的接线**。故单列。

## Contract

```
measure plugin_registered = `grep -c "$(npm root -g)/quay/plugin" ~/.claude/settings.json` stdout 的数字段（当前基线 0）
band plugin_registered >= 1（安装后，宿主配置必须指向安装物）
measure stale_devtree_refs = `grep -o '"/[^"]*quay[^"]*"' ~/.claude/settings.json | tr -d '"' | while read p; do [ -e "$p" ] || echo "$p"; done | wc -l` stdout 的数字段（B 当前 1）
invariant 干净机器上 `npm install -g quay-*.tgz` 之后，`/quay:init` 必须可用；不得依赖任何手工编辑宿主配置
invoke `npm install -g quay-*.tgz && grep -c "$(npm root -g)/quay/plugin" ~/.claude/settings.json`
control 在一台【从未装过 quay】的机器上重跑安装 ⇒ 若 plugin_registered 仍为 0，确认与历史残留无关
resume 若中断，先跑 measure 读 plugin_registered，不要假设已接线
```

## Acceptance Criteria

- [ ] AC1: 干净安装后 `plugin_registered >= 1`——宿主配置指向**安装物**而非开发树
- [ ] AC2: **端到端**——干净机器上安装后，在 Claude Code 会话里 `/quay:init` **可被调用**（贴出实际调用证据）
- [ ] AC3: **负控制**（承重条）——在从未装过 quay 的机器上复跑，确认修复不依赖任何历史残留
- [ ] AC4: 不得要求用户手工编辑 `~/.claude/settings.json`——若最终方案需要用户动手，须在 README 明写且计入判据
- [ ] AC5: 与 `gap-cli-quay-init-collides-...` 交叉标注：那条管入口收敛，本条管接线存在

## Definition of Done

- [ ] AC1-AC5 实跑输出贴进任务体（含 B 或 C 上的真机复测）
- [ ] 完整套件绿

## Touches
- packages/quay/package.json（安装钩子 / bin 与 plugin 的接线）
- packages/quay/scripts/package.sh
- README.md（安装章节）
- tasks/gap-npm-install-does-not-register-the-plugin-with-claude-code.md

## Dispatch review

reviewer: none
at: 2026-08-07T06:2xZ
changed: 管理者在 B/C 真机执行 AC16 前置链时实测发现；两台互为对照排除了「B 历史残留」这一解释

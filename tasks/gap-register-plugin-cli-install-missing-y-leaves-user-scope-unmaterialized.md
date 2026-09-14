---
id: gap-register-plugin-cli-install-missing-y-leaves-user-scope-unmaterialized
title: register-plugin.mjs 的 CLI materialization 没传 -y：非 TTY 下确认取不到 ⇒
  插件只登记不落地（user scope 无 scope:"user" 条目）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---

## Finding

`packages/quay/scripts/register-plugin.mjs` 写完 `~/.claude/settings.json` 的
`extraKnownMarketplaces.quay` 之后（best-effort materialization），调两条 CLI 命令把插件真正装进
`~/.claude/plugins`（缓存 + `installed_plugins.json`）：

```js
const add     = runCli(["plugin", "marketplace", "add", pluginDir]);
const install = runCli(["plugin", "install", `${pluginName}@${marketplaceName}`]);
```

**两条都没传 `-y`**，而 `claude plugin install` 是一道需要确认的写操作。`spawnSync` 的
`stdio: "inherit"` 在非 TTY（npm postinstall 的常态：`npm install -g` 从脚本/CI/ssh 里跑）下取不到
确认 ⇒ install 非 0 ⇒ 本文件只打印一句 warning，**settings.json 的登记留着，但插件没有落地**。

⇒ 对用户的可见后果：一次普通的 `npm install -g quay-*.tgz` 之后，`~/.claude/plugins/
installed_plugins.json` 里**没有** `quay@quay` 的 `scope:"user"` 条目 ⇒ `/quay:init` 不可用，
而安装过程印的是成功（`added 1 package`）加一条容易被当成噪音的 warning。本文件头注释承诺的
「a fresh `npm install -g` alone leaves /quay:init usable, with NO user step」在非 TTY 下不成立。

**实测（2026-09-14，orangevps，AC-258 真机取证途中；不是推断）**：`npm install -g --prefix
~/.local/opt/quay/0.7.0 quay-0.7.0.tgz` 走的就是这个 postinstall。要看**同一台机器上两条腿的差别**
——即「postinstall 之后确实没有 user-scope 条目」，以及「显式带 `-y` 跑同样两条命令之后就有」。

⚠️ **与 `gap-ac161-user-scope-enable-repolluted-by-cli-materialization` 的区别**：那条记的是
materialization **污染 user scope**（多写了 `enabledPlugins`），方向相反；那条的正文明确写着
「选择 materialize 到哪个 scope 是产品决策」，本任务**不**替它做那个决策，只报「materialization
在非 TTY 下会静默不发生」。

## Touches

- tasks/gap-register-plugin-cli-install-missing-y-leaves-user-scope-unmaterialized.md
- packages/quay/scripts/register-plugin.mjs

## AC

- [ ] 在非 TTY 下复现：`npm install -g --prefix <持久前缀> quay-<ver>.tgz`（stdin 不是 TTY），之后
      `installed_plugins.json` 的 `quay@quay` 里**没有** `scope:"user"` 条目；贴命令与读数。
- [ ] 同一台机器上贴两条腿的对照：给同一对 CLI 命令补 `-y` 之后，该条目**出现**且 `version` 为本次
      交付物的版本 —— 证明差别就是那个标志，而不是别的环境因素（硬规则 4 推论四：给不出对照就只是假说）。
- [ ] 修法（或明确写下不修的理由）：使 materialization 在非 TTY 下也能完成 —— 值域不外乎「补 `-y`」或
      「先把这一步走完再回报」，二者都要在实现里留下可核痕迹。
- [ ] 负控制：题面说的那条 warning（`not yet materialized`）确实在**没有** user-scope 条目时出现；
      修好之后它不再出现 —— 否则「warning 不在」与「materialization 做了」同形（硬规则 3b）。

## DoD

- [ ] 在真机上（非 TTY）跑一次安装，贴出「修前：无 user-scope 条目 / 修后：有且版本正确」的两组读数
- [ ] 产品实现已改（`packages/quay/scripts/register-plugin.mjs`）并随 develop 落地
- [ ] 与 `gap-ac161-*` 的分工在任务体里写清（本任务不替它决定 materialize 到哪个 scope）

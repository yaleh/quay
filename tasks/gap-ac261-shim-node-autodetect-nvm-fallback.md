---
id: gap-ac261-shim-node-autodetect-nvm-fallback
title: plugin/bin/quay shim 只查 `command -v node`：nvm-only 环境下最小 PATH 仍 exit
  127，AC-261 未真正达标
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-261
---
## Proposal

`plugin/bin/quay`（本身没有 Touches 变更历史之外的其它实现）现在只做 `command -v node >/dev/null 2>&1`，
找不到就直接打印 `quay: node not found on PATH — the plugin CLI needs Node.js >= 20.` 并 `exit 127`——
而 AC-261 的判据本身要求的正是「在最小 PATH（仅 `<repo>/plugin/bin:/usr/bin:/bin`）下 `quay --version`
rc=0 并打出 semver」。

<!-- dedup-ref -->
既有的 `gap-ac261-plugin-bin-shim-missing-so-cli-needs-npm-global`（status: done）解决的是「shim 文件
根本不存在」这一半（PATH 里有目录、目录下没有可执行文件），但没有实现「PATH 里没有 node 时去别处找」这
一半。2026-09-16 在本机（node 只经 nvm 安装，不在 `/usr/bin` 下）实测复现：

```
$ PATH="<repo>/plugin/bin:/usr/bin:/bin" QUAY_PLUGIN_ROOT= CLAUDE_PLUGIN_ROOT= quay --version
quay: node not found on PATH — the plugin CLI needs Node.js >= 20.
```

这正是 AC-261 判据测的场景，AC-261 因此持续 verdict=fail——但因为 `goal_ac: AC-261` 已经被那条 done
任务认领过，goal-driver 的立案去重会把它当成"有人处理过"，永远不会再派 gap-filing agent 重开一条。这条
任务就是那个必须由人/manager 主动立的"回归/未达标"跟进。

修法：shim 在 `command -v node` 失败后，不要直接 hard-fail，先按顺序探测几个常见的非-PATH node 落点
（`~/.nvm/versions/node/*/bin/node` 取其中语义版本最高且 ≥20 的一个 是首选；也可以读
`~/.nvm/alias/default` 间接定位），找到就用它 `exec`；全部探测失败才落回现在这条报错信息。

## AC

- [x] `PATH="<repo>/plugin/bin:/usr/bin:/bin" QUAY_PLUGIN_ROOT= CLAUDE_PLUGIN_ROOT= <repo>/plugin/bin/quay --version` 在一台 node 只经 nvm 安装（不在 `/usr/bin` 下）的机器上 exit 0 并打印 semver ——本机（$HOME 下有 `~/.nvm/versions/node/*`）就是这个负控制场景，此刻会真的失败，修完须真的转 0。
- [x] `node plugin/scripts/*.ts` 里驱动 AC-261 判据的那条 acceptance 脚本重跑一遍，verdict=pass（不是手敲同样三条命令模拟）。
- [x] 负控制：临时让 nvm 目录也探测不到（例如覆盖 `HOME` 指到一个没有 `.nvm` 的目录）时，shim 仍然 exit 127 并打印现有的友好提示——证明新增的探测逻辑不会在"真的没有任何 node"时伪装成成功。

## DoD

AC-261 对应的 goal gate（`quay gate AC-261`，或它实际调用的那条 acceptance 脚本）在**这条任务落地之后**
重新跑出 pass——不是本任务自己在正文里贴一遍命令输出充数。落地后到 `gap-ac261-plugin-bin-shim-missing-so-cli-needs-npm-global`
的 done 记录旁边留一句指向本任务的说明，避免以后有人只看见"已经 done 过"就再次误判为已解决。

## Touches

- plugin/bin/quay
- plugin/test/plugin-bin-shim-npm-free-cli.test.mjs
- tasks/gap-ac261-shim-node-autodetect-nvm-fallback.md

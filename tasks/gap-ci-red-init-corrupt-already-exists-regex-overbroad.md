---
id: gap-ci-red-init-corrupt-already-exists-regex-overbroad
title: init.test.mjs AC1 corrupt 的 /already exists/ 断言过宽，误伤插件安装记录提示
status: done
labels:
  - gap
  - ci-red
  - defect
parent: null
children: []
extra: {}
---
## Proposal

CI test job 里 `packages/quay/test/init.test.mjs` 的 `AC1 corrupt: an unparseable .quay/config.yml is
BACKED UP and REBUILT` 恒红，断言 `!/already exists/` 误命中一条合法提示：init 的 install-steps 建议在
`~/.claude/plugins/installed_plugins.json` 读不到时打印 "cannot tell whether a user-scope quay@quay
install already exists"。CI runner 的 scratch HOME 没有该记录 ⇒ 恒触发；开发机有 ⇒ 本地假绿。该断言
本意是拒绝旧的 "already exists, use --force"（名字冲突）措辞，不该拒绝这条关于另一对象（插件安装记录）
的提示。

## Plan

把负向断言从裸 `/already exists/` 收窄到旧拒绝措辞逐字 `/already exists, use --force/`，并在断言上方
写明收窄原因（插件安装建议文本是合法输出）。

## AC

- [x] 本地 `AC1 corrupt: an unparseable...` 全绿。
- [x] 断言只匹配旧名字冲突措辞，不再匹配 install-steps 提示中的 "already exists"。

## DoD

修复提交（377000a60）落地后，CI runner 无插件安装记录时该测试仍绿；若产品代码回归打印
"already exists, use --force" 仍会红。

该轴仍暗,理由:纯测试断言修复，不改动 L_D/L_G 依赖结构，本次提交未记录读数
---
id: gap-ac161-user-enabledplugins-repolluted-by-deliver-postinstall
title: 交付管线的 npm install -g postinstall（register-plugin.mjs 的 materialize 腿）在
  project-scope 交付里也按 user scope 注册 ⇒ 用户级 enabledPlugins 出现 quay 键 ⇒ AC-257 记录被
  AC-161 常设闸拒写
status: ready
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: v1
goal_ac: AC-161
---
## Finding

**AC-161 的第五次回归，且这次不是拿 Bash 的 agent 干的 —— 是交付管线自己干的。**

2026-09-15 在 ad-arm1 上跑 AC-257 交付腿（`develop-deliver-tgz.sh --verify-ac257 --hosts C`），远端 heredoc 的第一件事是

```
npm install -g --prefix "$HOME/.local/opt/quay/0.7.0-dev" "$HOME/quay-0.7.0-dev.tgz" "$HOME/quay-native-0.7.0-dev.tgz"
```

`packages/quay/package.json` 的 `"postinstall": "node scripts/register-plugin.mjs"` 因此被触发。该脚本自己的头注释逐字声明它**不**写用户级 enabledPlugins（「It does NOT write a user-level enabledPlugins entry — enabling is left to the target project's <repo>/.claude/settings.json (AC-161)」），但它的**materialize 腿**（同文件 `:178` 起 "BEST-EFFORT materialization"）会调 CLI 注册，**缺省按 user scope 走**。

**当场读数（ad-arm1，2026-09-15，非推断）**：

```
$ stat -c '%y' ~/.claude/settings.json
2026-09-15 16:57:41.775120247 +0000        <-- 正是那次 npm install 的时刻

$ grep -c 'quay@quay' ~/.claude/settings.json
1
$ cat ~/.claude/settings.json
{ "model": "haiku",
  "enabledPlugins": { "quay@quay": true },        <-- 用户级 quay 键：AC-161 判据要的形态被违反
  "extraKnownMarketplaces": { "quay": { "source": { "source": "directory",
     "path": "/home/yale/.local/opt/quay/0.7.0-dev/lib/node_modules/quay/plugin" } } }, ... }
```

**后果（可复现、且失败形态误导）**：`verify-deliver-coldstart.sh` 的 `write_ac257_record` 落盘前读一次用户级
（`ac161_user_scope_quay_state`，三取值 `absent | present:<键> | unreadable:<因>`），读到 `present:quay@quay` 即

```
AC161-USER-SCOPE: GOAL-018-AC-257 record refused — state=present:quay@quay — user-level ~/.claude/settings.json
enabledPlugins still carries a quay key; this record's project-scope premise is FALSE → nothing written (standing goal AC-161)
```

⇒ 一整趟**已经真正跑完**的 AC-257（安装 0.7.0-dev、quay-init 合并语义成立、真实任务被自己的 driver 驱动到 done、
非记账实现提交 `ef48077a`、`gate_events=4`、`produced_by_driver=1`）**一条记录都落不下**，而表层现象是
「记录没写出来」，与「机制坏了」同形（硬规则 3b）。

**为什么这与既有任务不是同一件事**：`gap-ac161-user-scope-enable-repolluted-by-cli-materialization`（done）
处理的是**第四次**——「一个拿着 Bash 的在飞 agent 自己选了 `claude plugin install --scope user`」；
本条是**交付管线自己的 postinstall**（无 agent 参与、无人工选择），且触发点是 `npm install -g` 这一步本身。
`register-plugin.mjs` 头注释已经声明了自己的 AC-161 契约，**实现与声明不一致**（同族：注释说 not，代码里那条腿会）。

**当下的临时处置（已做，仅记录）**：删除用户级 `enabledPlugins["quay@quay"]`（保留 `extraKnownMarketplaces.quay`
—— AC-161 的 doctrine 要求用户级只留 marketplace 源），再重跑一次 AC-257 记录写；两次读数都在
`.quay/ac259-evidence/ac161-depollution.txt`。⛔ 这是**绕**，不是修；根因在 postinstall 的 materialize 腿。

## Requested action

1. 让 `register-plugin.mjs` 的 materialize 腿与它自己的头注释一致：**project-scope 交付不得写用户级
   `enabledPlugins`**。⚠️ 先确认「谁决定 scope」——调用方（交付脚本）还是脚本缺省；两者择一作为单一真源，
   ⛔ 不要在两处各写一份判断（硬规则 5b）。
2. 该行为要有**可证伪的判据**：一次 project-scope 交付之后，`~/.claude/settings.json` 的 `enabledPlugins`
   键集必须与交付前【逐字相同】（这正是 AC-257 步骤已在项目级做的事，把同一条读数补到用户级）。
3. 反向控制：AC-258 那条**故意**用 user scope 的交付仍必须能把用户级注册上（⛔ 不要用「一律不写用户级」把它打死）。

## Acceptance Criteria

- [ ] AC1 贴出「project-scope 交付前后用户级 `enabledPlugins` 键集逐字相同」的一对真实读数（ad-arm1，⛔ 不是夹具）。
- [ ] AC2 贴出 `register-plugin.mjs` 里决定 scope 的那一处（行号 + 原文），并说明它与头注释的一致性如何被机械保证（⛔ 不是靠注释）。
- [ ] AC3 负控制：AC-258 的 user-scope 交付之后，用户级 `enabledPlugins["quay@quay"]` 必须仍然出现（证明 AC1 的修法没有把 user-scope 路径打死）。
- [ ] AC4 复现本条 Finding 的原始失败：在**未修**的实现上跑一次 project-scope 交付，贴 `AC161-USER-SCOPE: … record refused … present:quay@quay` 原文。

## Definition of Done

- [ ] project-scope 交付不再污染用户级 `enabledPlugins`，且该性质有一条会红的机械判据（AC1/AC2）。
- [ ] AC-257 的记录落在**未被绕**的路径上（即：不需要人工删键就能写出记录）。
- [ ] AC3 的反向控制贴在记录里。

## Touches

- packages/quay/scripts/register-plugin.mjs
- plugin/scripts/verify-deliver-coldstart.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- tasks/gap-ac161-user-enabledplugins-repolluted-by-deliver-postinstall.md（自身：勾 AC + 贴证据）

Note: filed from the AC-259 re-anchoring worker, where it blocked the AC-257 record write (`.quay/ac259-evidence/ac161-depollution.txt`).
---
id: gap-ac161-user-enabledplugins-repolluted-by-deliver-postinstall
title: ad-arm1 用户级 enabledPlugins 出现 quay@quay ⇒ AC-257 记录被 AC-161
  常设闸拒写：写入者【未识别】（原归因于交付管线 postinstall 已被对照证伪，⛔ 勿按该成因行动）
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

**观察（可核）**：2026-09-15 在 ad-arm1 上跑 AC-257 交付腿时，`write_ac257_record` 落盘前读用户级
（`ac161_user_scope_quay_state`，三取值 `absent | present:<键> | unreadable:<因>`），读到
`present:quay@quay` 而拒写，整趟已经真正跑完的 AC-257 一条记录都落不下：

```
AC161-USER-SCOPE: GOAL-018-AC-257 record refused — state=present:quay@quay — user-level ~/.claude/settings.json
enabledPlugins still carries a quay key; this record's project-scope premise is FALSE → nothing written (standing goal AC-161)
```

当场读数（当时）：

```
$ stat -c '%y' ~/.claude/settings.json      -> 2026-09-15 16:57:41.775120247 +0000
$ grep -c 'quay@quay' ~/.claude/settings.json -> 1
$ python3 -c "...json...['enabledPlugins']"  -> {"quay@quay": true}
$ python3 -c "...json...['extraKnownMarketplaces']['quay']" -> {"source":{"source":"directory",
      "path":"/home/yale/.local/opt/quay/0.7.0-dev/lib/node_modules/quay/plugin"}}
```

当时的临时处置（已做）：只删 `enabledPlugins["quay@quay"]`（保留 `extraKnownMarketplaces.quay`，AC-161 的
doctrine 要求用户级只留 marketplace 源），再重跑一次记录写 ⇒ 记录成功落账
（`quay_version=0.7.0-dev`、`user_scope_quay_state=absent`）。读数见
`.quay/ac259-evidence/ac161-depollution.txt`。

## 被证伪的假说（⛔ 不要再按它行动）

**原假说**：这个键是**交付管线自己的** `npm install -g` postinstall（`packages/quay/package.json` 的
`"postinstall": "node scripts/register-plugin.mjs"`）写的；证据是 `settings.json` 的 mtime `16:57:41`
恰好是那次 npm install 的时刻。

**若该假说为真则结果会不同的对照（已跑，硬规则 4 推论四）**：在 ad-arm1 上用**沙箱 HOME** 各跑一次
同名 postinstall，两次的 `enabledPlugins` 命中都是 **0**：

```
$ command -v claude                        -> /home/yale/.local/bin/claude   (claude_rc=0)
control A（只换 HOME）:  HOME=/tmp/ac259sbA npm install -g --prefix /tmp/ac259pfA <quay.tgz> <qn.tgz>
   sandboxA settings.json written=yes ; enabledPlugins 'quay@quay' hits=0
control B（换 HOME 且带声明的 endpoint 环境，claude 可认证）:
   sandboxB settings.json written=yes ; enabledPlugins 'quay@quay' hits=0
   sandboxB settings.json == {"extraKnownMarketplaces":{"quay":{"source":{"source":"directory",
       "path":"/tmp/ac259pfB/lib/node_modules/quay/plugin"}}}}
```

⇒ postinstall 只写 marketplace 源，**不写**用户级 `enabledPlugins`，与 `register-plugin.mjs` 自己的头注释
（「It does NOT write a user-level enabledPlugins entry — enabling is left to the target project's
`<repo>/.claude/settings.json` (AC-161)」）逐字一致。**原假说被证伪**，本条的 Requested action 随之作废。

完整读数：`.quay/ac259-evidence/ac161-attribution-control.txt`。

## 未决问题（本条真正的可行动部分）

**ad-arm1 上那个用户级 `enabledPlugins["quay@quay"]` 到底是哪个动作写的，目前未识别。**
已知约束：
- 写入时刻 `16:57:41` 落在 AC-257 交付腿的 `npm install -g` 窗口内，但 postinstall 已被上面两条对照排除；
- `[⑨f]`（`claude plugin marketplace add/install --scope project`）在**其后**运行，且运行后 `settings.json`
  的 mtime 未再变化 ⇒ 也不是它；
- ad-arm1 上并存着若干**别的** quay 项目（`/home/yale/quay-verify-coldstart-*.npm` 下的前缀，且这些 root
  有常驻 promotion/goal driver）——「另一个在飞 agent 或另一条交付腿写了它」尚未被排除，但也未被证实。

⚠️ 这正是硬规则 4 推论四说的形态：「一个能【解释】现象的说法，不是一个被【检验】的结论」。
本条的原文（把成因直接归给 postinstall）已经犯过一次，⛔ 不要再在未做对照的情况下换一个新成因写进来。

## Requested action

1. **先取证，再下结论**：用与上面同一手法（沙箱 HOME + 逐项放行一个变量）把 `16:57:41` 那个写入者定位到
   一个**具体动作**上；在此之前不得给出成因。
2. 判据必须能区分「postinstall 写的」与「别的动作写的」：例如在真实交付腿前后各读一次用户级
   `enabledPlugins` 键集，并在**跑腿的同时**记录 ad-arm1 上还有哪些 quay 进程在跑（`ps` 读数）。
3. 若最终定位不到写入者，正确输出是**带原文报到人**（记 `needs-human`），⛔ 不是换一个听起来合理的成因。

## Acceptance Criteria

- [ ] AC1 贴出「交付腿前后用户级 `enabledPlugins` 键集」的一对真实读数（ad-arm1），并同时贴出该时刻 ad-arm1 上在跑的 quay 进程清单（`ps`，位置判定）。
- [ ] AC2 用一个**能区分**的对照把写入者定位到具体动作（对照须给出「若假说为假则结果不同」的方向）；⛔ 不得只贴一条自洽的解释。
- [ ] AC3 若定位成功：贴出该动作的原文位置与修法所需的读数；若定位不到：贴出已穷尽的候选与各自的排除读数，并记 `needs-human`。
- [ ] AC4 复现原始现象：在**未修**状态下（用户级带 quay 键）跑一次 AC-257 交付腿，贴 `AC161-USER-SCOPE: … record refused … present:quay@quay` 原文；再证删除该键后同一交付腿能写出记录（两次都贴）。⚠️ 这证明的是**闸门按设计工作**，不是成因。

## Definition of Done

- [ ] 用户级那个键的写入者被定位到具体动作，或明确记为 `needs-human` 并附已穷尽的候选与排除读数。
- [ ] 本条的成因表述有对照支撑（AC2），⛔ 不是「看起来最合理的那一个」。
- [ ] AC4 的两条读数在记录里（证明闸门工作正常、且绕法确实能解锁记录）。

## Touches

- tasks/gap-ac161-user-enabledplugins-repolluted-by-deliver-postinstall.md

Note: filed and then corrected by the AC-259 re-anchoring worker. The correction exists because the worker ran the falsifying control after filing (`.quay/ac259-evidence/ac161-attribution-control.txt`).
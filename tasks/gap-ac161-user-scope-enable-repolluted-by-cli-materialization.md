---
id: gap-ac161-user-scope-enable-repolluted-by-cli-materialization
title: AC-161 回归：用户级 enabledPlugins 被交付安装路径的 CLI materialization 重新写回（AC-162
  只堵了直接写，没堵 shell 出去的那条）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-161
---
## Proposal

**问题**：STANDING goal AC-161（GOAL-003，`long-term: true`，status 已 achieved）**再次失败**——被它保证的事实当前不成立。本轮实测复现（跑 `goals/AC-161-user-level-marketplace-only.md` 的 criterion 原文）：

```
CAUSE=user-enabled-plugins — user-level enabledPlugins still enables quay plugin(s): quay@quay
RC=1
```

`~/.claude/settings.json` 现状：`enabledPlugins` 含 `"quay@quay": true`；且 `extraKnownMarketplaces.quay.source.path` 已被改写成 **`/tmp/dir3.npm/lib/node_modules/quay/plugin`**——一个临时 npm 前缀，`/tmp` 被清理后该 marketplace 源即悬空（已无 `env` 键，故 criterion 只走到 enabledPlugins 那条分支）。

**为什么前一次修（done 任务）没守住**：`gap-ac161-user-level-marketplace-only`（done 2026-09-07，commit `df402ac33` 落项目级 `<repo>/.claude/settings.json`）把用户级键删掉、启用迁到项目级；`gap-ac162-register-plugin-no-user-enabled`（done）把 `register-plugin.mjs` **自己写** `enabledPlugins` 的代码删了。**但 AC-162 只堵了「脚本直接写」这一条通道**：`packages/quay/scripts/register-plugin.mjs:148,159` 仍 shell 出去跑 `claude plugin marketplace add` / `claude plugin install quay@quay`，**而 Claude Code 自己的 `plugin install` 会写用户级 `enabledPlugins`**。⇒ 每一次真实的全局安装都会把 AC-161 重新打红：判据守住了写侧脚本，没守住脚本调用的下游。

**回归事件取证（时间戳互校 + 一条能区分的对照，非同形推断）**：
- `~/.claude/settings.json` mtime = `2026-09-11 04:08:38.218764382`
- `~/.claude/plugins/known_marketplaces.json` 的 `quay.lastUpdated` = `2026-09-11T04:08:38.214Z`（**早 4 毫秒**）⇒ `claude plugin marketplace add` 先写 known_marketplaces，CLI 随后在 4ms 后重写了 settings.json
- `/tmp/dir3.npm`（`bin/` + `lib/`）创建于 `Sep 11 04:08` ⇒ 04:08 发生过一次 `npm install -g --prefix /tmp/dir3.npm`
- **能区分两个假设的对照**：该前缀下 `lib/node_modules/quay/scripts/register-plugin.mjs` 经逐行核对**确认已是 AC-162 修复版**（全文仅第 13 行注释提到 `enabledPlugins`，无任何写入语句）——脚本可证不含该写，而用户级键却出现了 ⇒ **写键的不是 quay 的脚本，是它调用的 `claude` CLI**。（若不做这个对照，「脚本又写回去了」与「CLI 写的」两条假设给出相同观测。）

**产生污染的真实调用点**：`plugin/scripts/verify-deliver-coldstart.sh:1079-1114` 的 `step1_install()`，其中 `:1084` `npm install -g --no-audit --no-fund --prefix "$PREFIX" "$QUAY_TGZ" "$QN_TGZ"` **用操作者真实 `$HOME` 跑**，且**不设 `QUAY_SKIP_PLUGIN_CLI`** ⇒ postinstall 走到 `register-plugin.mjs:159` 的 CLI materialization ⇒ 真实 `~/.claude/settings.json` 被写。**同一脚本的 `--selfcheck` 路径（`:2287-2340`）已经**用 fake HOME 隔离、并且**已经有 control 13「enabledPlugins 外溢, AC-161 违反」**（`MP_ENABLED_LEAK`）；**真实安装路径没有这层隔离**——即：反外溢的判据只在夹具里存在，生产走的是污染路径（硬规则 3b / 硬规则 4 推论三 同形：一个只在 fixture 里成立的判据不构成保证）。

**本任务范围（状态迁移 + 堵通道，两条都做）**：AC-162（写侧脚本）与 AC-161（本机状态）是两条独立判据；本任务先**恢复状态**，再堵住「交付/安装路径污染操作者真实 `~/.claude`」这条通道——否则下一次交付验证又会打红，本任务就只是重复 `gap-ac161-user-level-marketplace-only` 已经失败过一次的修法。

<!-- dedup-ref -->
**关联任务（不同机制，仅登记，不构成前置）**：`gap-meta-rungoalround`（status ready）管的是 goal 机械环把 long-term AC 纳入复验域却从不重跑它们（**执行侧**：AC-161 在 `achievedFailing.inScope` 里却不在本轮 `criteria` 里）；本任务管的是 AC-161 的**被保证事实本身再次被破坏**（**状态 + 污染通道**）。两者判据不同、Touches 不相交，互不覆盖。

## Plan

1. **按顺序恢复（反序会把自己锁在门外）**：①确认插件已安装——项目作用域在 `~/.claude/plugins/installed_plugins.json` 已有 `quay@quay` 记录（实测有 `scope: project` @ `/home/yale/work/quay`）→ ②确认项目级 `<repo>/.claude/settings.json` 仍为 `{"enabledPlugins":{"quay@quay":true}}`（盘上已满足，`df402ac33` 已提交进仓库）→ ③**最后**从 `~/.claude/settings.json` 删掉 `enabledPlugins["quay@quay"]`；④把 `extraKnownMarketplaces.quay.source.path` 从 `/tmp/dir3.npm/...` 改回非临时路径（人 2026-09-02 裁定③允许的用户级 marketplace 源是本项目目录，即 `/home/yale/work/quay/plugin`）。跑 AC-161 criterion ⇒ exit 0。
2. **堵通道（机制修复）**：让 `verify-deliver-coldstart.sh` 的安装/交付验证路径对操作者真实 `~/.claude` **零写入**。最小面 = `step1_install()` 的 `npm install -g`（`:1084`）连同延续到 `step1_marketplace` 的 settings 断言（`:1209` `mp_assert_settings "${HOME}/.claude/settings.json"`）一起在**隔离 HOME** 下执行（复用 `--selfcheck` 已有的 fake-HOME 手法 `:2287-2340`），并/或让该路径不触发 CLI materialization（`:598` 已经对 marketplace 分支用了 `QUAY_SKIP_PLUGIN_CLI=1`，`step1_install` 没有）。**要求（判据，不锁实现）**：跑完该路径后，操作者真实 `~/.claude/settings.json` 与跑之前**逐字节相同**（`sha256sum` 前后比对）。
3. **补一条能取假的控制**：新增/扩展一条机械控制，证明「跑该路径 ⇒ 真实 settings 不变」这条断言**能取假**——把该路径换回修复前形态（或让 PATH 上的假 `claude` shim 复刻真 CLI 的 user-scope 写入）时，断言必须转红；换回修复后转绿（`prefix-code-swap-for-red-control` 手法：换回 pre-fix 文件跑新测试，再换回并 diff 验证）。
4. 把 step 1/2/3 的三条读数（criterion exit code、sha256 前后、取假对照的转红读数）写进本任务 AC/结果段。

## AC

- [ ] AC1: 跑 `goals/AC-161-user-level-marketplace-only.md` 的 criterion 原文（python3 heredoc，逐字）⇒ **exit 0**（立案当轮实测 exit 1，`CAUSE=user-enabled-plugins — …: quay@quay`）。
- [ ] AC2: `extraKnownMarketplaces.quay.source.path` 不再指向临时前缀——`python3 -c "import json,os,sys;d=json.load(open(os.path.expanduser('~/.claude/settings.json')));p=((d.get('extraKnownMarketplaces') or {}).get('quay') or {}).get('source',{}).get('path','');sys.exit(1 if '/tmp/' in p else 0)"` ⇒ exit 0（当前 `/tmp/dir3.npm/lib/node_modules/quay/plugin` ⇒ exit 1）。
- [ ] AC3: 交付验证路径对真实 settings 零写入——`b=$(sha256sum ~/.claude/settings.json)`；跑修复后的 `verify-deliver-coldstart.sh` ①安装步（或该脚本的自检入口）；`a=$(sha256sum ~/.claude/settings.json)`；`[ "$b" = "$a" ]` ⇒ exit 0。
- [ ] AC4: **取假对照（证明 AC3 不是恒真）**——把该路径换回修复前形态重跑 AC3 的同一条断言 ⇒ **红**（真实 settings 的 sha256 改变）；换回修复后 ⇒ 绿。对照组读数须贴进本任务。
- [ ] AC5: 不引入新红——`bash plugin/scripts/verify-deliver-coldstart.sh --selfcheck` ⇒ exit 0（既有 control 11/12/13 不因本改动转红；该项是本改动的接线负控制，真因见硬规则：「不产生新红」本身不是接线成功的证据，故必须与 AC3/AC4 同读）。

## DoD

真实对象被操作过、判据能取假：`~/.claude/settings.json` 被**真实编辑过并回读**——AC-161 criterion 在生产上 exit 0（直接读数，不是断言）；交付/验证路径被**真实跑过一次**而该文件 `sha256sum` 未变（AC3）；**取假对照**在修复前形态下真的转红（AC4）——三条缺一不可。AC-161 由 goal-driver 下一轮复跑后 verdict 由 fail 翻 pass（读 `.quay/goal-round.jsonl` 该 AC 的 verdict / `achievedFailing.inScope` 不再含 AC-161）。⛔ 只改仓库脚本而 `~/.claude/settings.json` 仍含 `quay@quay` ⇒ 判据仍红 ⇒ 不算达成。⛔ 只恢复状态而不堵 `step1_install` 的真实-HOME 通道 ⇒ 下一次交付验证原地复发（`gap-ac161-user-level-marketplace-only` 已经这样失败过一次）⇒ 不算达成。⛔ 反序（先删用户级再确认安装/项目级就绪）会把本机锁在「哪里都没有 quay」——按 Plan 顺序执行。

## Touches

- `plugin/scripts/verify-deliver-coldstart.sh`
- `packages/quay/scripts/register-plugin.mjs`
- `packages/quay/test/npm-pack-e2e.test.mjs`
- `tasks/gap-ac161-user-scope-enable-repolluted-by-cli-materialization.md`

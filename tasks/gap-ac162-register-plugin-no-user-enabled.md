---
id: gap-ac162-register-plugin-no-user-enabled
title: AC162 register-plugin.mjs 不再写用户级 enabledPlugins（机制修复）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-162
---
## Proposal

**目标态（人 2026-09-02 裁定③ + SPEC §4b）**：`packages/quay/scripts/register-plugin.mjs`（npm 全局安装的 postinstall 钩子）只注册 marketplace 源（`extraKnownMarketplaces.quay` → 安装目录 plugin）+ shell 出去 `claude plugin marketplace add` / `claude plugin install` 安装，**不再写**用户级 `enabledPlugins["quay@quay"]=true`；启用交给目标项目级 `<repo>/.claude/settings.json`（AC-161 已立案）。AC-162 判据：该脚本【非注释行】不得出现 `enabledPlugins` 字样（注释里提到不算命中）。

**当前状态（立案当轮实测，非推断）**：`register-plugin.mjs` 第 102 行 `settings.enabledPlugins = settings.enabledPlugins || {}` 与第 106 行 `settings.enabledPlugins[enabledKey] = true` 是用户级启用的污染产生点（§4b 机制根因）；`packages/quay/test/npm-pack-e2e.test.mjs:225` 断言 `settings.enabledPlugins["quay@quay"] === true` 锁定了旧行为。AC-162 判据当前 fail（`evidence.verdict: fail`、exit 1）。

**机制修复（非状态迁移）**：本任务改污染的产生点（脚本 + 其测试断言）；AC-161（状态迁移，改当前已污染的 `~/.claude/settings.json`）已独立立案——两者独立判据、独立任务，本任务不改任何 settings 文件。

## AC

- [x] AC-162 判据 exit 0：`grep -vE '^[[:space:]]*(//|\*|#)' packages/quay/scripts/register-plugin.mjs | grep -q 'enabledPlugins'` 不命中（内层 grep exit 1 ⇒ 判据整体 exit 0）
- [x] 脚本代码行已无 `enabledPlugins` 字面量：第 102/106 两行删除（`enabledKey` 变量若随之未用则一并清理）；且其余代码行不含该字面量（判据只剥行首注释标记，行尾 `// enabledPlugins` 仍命中）
- [x] marketplace 源仍注册：global 模式跑 register-plugin（temp HOME + `QUAY_SKIP_PLUGIN_CLI=1`）后，settings.json 的 `extraKnownMarketplaces.quay.source.path` 仍指向安装目录 plugin
- [x] 用户级启用不再写入：上述同一次运行后，settings.json 的 `enabledPlugins` 无 `quay@quay` 键（`python3 -c` 读 JSON 断言）
- [x] 测试断言翻转 + 负控制：`packages/quay/test/npm-pack-e2e.test.mjs:225` 由断言 `=== true` 改为断言无 quay 键；负控制 = 临时写回 `enabledPlugins["quay@quay"]=true` ⇒ 新断言 fail
- [x] 相关测试绿：`node --test packages/quay/test/npm-pack-e2e.test.mjs` 全绿（register-plugin 相关测试全部通过）

## DoD

真实对象被操作过、判据能取假：`packages/quay/scripts/register-plugin.mjs` 非注释行已无 `enabledPlugins`；模拟一次全局安装（temp HOME）后 `~/.claude/settings.json` 只多出 `extraKnownMarketplaces.quay` 源、不新增 `enabledPlugins["quay@quay"]`；AC-162 判据在生产上由 goal-driver 下一轮从 fail 翻 pass（读 `.quay/goal-round.jsonl` 该 AC 的 verdict）。⛔ 只改注释/README 而脚本仍写 enabledPlugins ⇒ 判据仍红 ⇒ 不算达成。⛔ 反序（先删用户级启用再补项目级）会把本机锁在「哪里都没有 quay」——本任务只改脚本行为、不改 settings 文件，故无此风险；但落地后须确认 AC-161 的项目级启用已就绪，否则全局安装后插件既未在用户级启用、也未在项目级启用。

## Touches

- packages/quay/scripts/register-plugin.mjs
- packages/quay/test/npm-pack-e2e.test.mjs
- tasks/gap-ac162-register-plugin-no-user-enabled.md

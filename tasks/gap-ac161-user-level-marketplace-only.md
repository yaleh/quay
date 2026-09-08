---
id: gap-ac161-user-level-marketplace-only
title: AC161 用户级只留 marketplace 源，启用迁项目级
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-161
---
## Proposal

**目标态（人 2026-09-02 裁定③ + SPEC §4b）**：`~/.claude/settings.json` 只留 marketplace 源（`extraKnownMarketplaces.quay` → directory `/home/yale/work/quay/plugin`），**不再**含 `enabledPlugins["quay@quay"]=true`；启用迁到项目级 `<repo>/.claude/settings.json` 并提交进仓库。AC-161 判据（python 读 `~/.claude/settings.json`）：enabledPlugins 无 quay 键 ∧ env 无 quay 路径 ⇒ exit 0；读不到该文件即判假、不静默通过。

**当前状态（立案当轮实测，非推断）**：
- `~/.claude/settings.json` 的 `enabledPlugins` 含 `"quay@quay": true`——污染源：把本仓库插件面（`plugin/bin` 进 PATH、skills 常驻、MCP 起进程）注入本机每一个项目的会话（§4b 实测 `/home/yale` 会话 PATH 含 `<quay>/plugin/bin` ×2）。
- 同文件 `extraKnownMarketplaces.quay` 已指向 `/home/yale/work/quay/plugin`（正确的 marketplace 源，保留）。
- 项目级 `<repo>/.claude/settings.json` 不存在；`.claude/settings.json` 未被 gitignore（仅 `.claude/settings.local.json` 被忽略）。
- AC-161 判据当前 fail（`evidence.verdict: fail`、exit 1）。

**迁移步骤（顺序是硬的，§4b：反序会得到「哪里都没有 quay」、把自己锁在门外）**：
1. 确认已安装：用户级 `enabledPlugins["quay@quay"]=true` 已存在 ⇒ 插件已装。
2. 项目级置 true（先）：新建 `<repo>/.claude/settings.json`，写 `{"enabledPlugins":{"quay@quay":true}}`，提交进仓库。
3. 撤用户级（后）：编辑 `~/.claude/settings.json`，从 `enabledPlugins` 删除 `"quay@quay"`，保留 `extraKnownMarketplaces.quay` 与其余键（meta-cc/archguard/model/theme 等）原样不动。
4. 跑 AC-161 判据确认 exit 0，并做 AC3 双向负控制。

**关联任务（机制去重后单列，本任务不越界）**：AC-162（`register-plugin.mjs` 不写用户级 enabledPlugins）是机制修复，改污染的产生点；本任务（AC-161）是状态迁移，改当前已污染的 settings 文件。两者独立判据、独立任务。

## AC

- [x] AC-161 判据 exit 0：直接跑 `goals/AC-161-user-level-marketplace-only.md` 里 criterion 的 python3 heredoc，退出码 0
- [x] 项目级启用落地且已提交：`test -f .claude/settings.json && grep -q '"quay@quay": *true' .claude/settings.json` exit 0，且 `git ls-files .claude/settings.json` 非空
- [x] 用户级只剩源：`python3 -c 'import json,os;d=json.load(open(os.path.expanduser("~/.claude/settings.json")));assert not any("quay" in k for k in (d.get("enabledPlugins") or {}))'` exit 0
- [x] 负控制（能取假）：临时把 `"quay@quay": true` 加回用户级 `enabledPlugins` ⇒ AC-161 判据 exit 1；撤掉 ⇒ 回到 exit 0
- [x] 顺序未反：迁移全程任一时刻都不存在「项目级无启用 ∧ 用户级无启用」的中间态（项目级提交先于用户级删除）

## DoD

真实对象被操作过、判据能取假：本机 `~/.claude/settings.json` 已无 quay 启用键、只留 marketplace 源；`<repo>/.claude/settings.json` 已带项目级启用并提交进仓库；AC-161 判据在生产上由 goal-driver 下一轮从 fail 翻 pass（读 `.quay/goal-round.jsonl` 该 AC 的 verdict）。⛔ 只改仓库内文件而 `~/.claude/settings.json` 仍含 `quay@quay` ⇒ 判据仍红 ⇒ 不算达成。

## Touches

- .claude/settings.json
- tasks/gap-ac161-user-level-marketplace-only.md

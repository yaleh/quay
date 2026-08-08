---
id: gap-plugin-json-duplicate-manager-skill
title: "plugin/.claude-plugin/plugin.json commands[] has DUPLICATE './skills/manager/SKILL.md' (14 entries, 13 unique = on-disk skill dirs) — plugin-packaging.test.mjs:89-92 assert.deepEqual(listedSkills, diskSkills) fails because listedSkills contains manager twice; the 14th entry was likely appended during the AC16 plugin-bundle ship (7adb6307) or merge (58927990) without dedup; fix = remove the duplicate manager entry (keep exactly the 13 on-disk skill dirs)"
status: ready
labels:
  - gap
  - defect
extra:
  schema: v1
---
**type:** execution

## Proposal

**plugin.json commands[] 含重复的 manager/SKILL.md 条目——全量 suite 失败。**

**【实测（外层，suite log line 5450）】**：`plugin/.claude-plugin/plugin.json` 的 `commands[]` 有
**14 个** `./skills/*/SKILL.md` 路径，其中 `./skills/manager/SKILL.md` **出现两次**。测试
`plugin-packaging.test.mjs:89-92` 要求 `listedSkills`（commands[] 里的 skills）**精确等于**
`diskSkills`（磁盘上的 13 个 skill 目录）——重复条目使 deepEqual 失败。

**【引入时点】**：`git log plugin/.claude-plugin/plugin.json` — 最近改动在 7adb6307（AC16 ship
plugin bundle）/ 58927990（merge）。重复条目大概率是 AC16 添加 manager 时未去重。

### 选定机制

删除重复的 `./skills/manager/SKILL.md` 条目（保留 13 个唯一 = 磁盘目录）。

## Acceptance Criteria

- [ ] AC1: plugin.json commands[] 恰好 13 个 skill 路径，无重复
- [ ] AC2: plugin-packaging.test.mjs 隔离跑绿
- [ ] AC3: commands[] 与磁盘 skill 目录精确一致（deepEqual）

## Definition of Done

- [ ] AC1-AC3 全勾（plugin.json commands[] 恰好 13 个 skill 路径无重复；plugin-packaging.test.mjs 隔离绿；commands[] 与磁盘 skill 目录精确一致 deepEqual）
- [ ] 修后 invoke 实测 14/13 → 13/13（`python3 -c` len==len(set)==13）
- [ ] scoped 门 `scripts/test.sh --for-task gap-plugin-json-duplicate-manager-skill` 绿（fail 0 / cancelled 0）

## Touches
- tasks/gap-plugin-json-duplicate-manager-skill.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）

- plugin/.claude-plugin/plugin.json

## Contract

measure   plugin_skills_ok = `node --test plugin/test/plugin-packaging.test.mjs 2>&1 | grep -c '# pass'` stdout 数字段
band      plugin_skills_ok >= 1（隔离跑绿）
invoke    `python3 -c "import json; d=json.load(open('plugin/.claude-plugin/plugin.json')); c=[x for x in d['commands'] if x.startswith('./skills/')]; print(len(c), len(set(c)))"`
control   当前 14/13（重复）；修后 13/13
resume    修完先跑 plugin-packaging 隔离，再进全量

## Dispatch review

reviewer: outer
at: 2026-08-06T14:4xZ
changed: 全量 suite 分诊确认的真实缺陷（merge 暴露非引入）——分别: nativeProviderDir 未定义(98e23f5b 删定义留使用)、plugin.json 重复 manager/SKILL.md、manager SKILL 缺 2 个 SPEC 索引。

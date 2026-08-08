---
id: gap-manager-skill-index-missing-new-specs
title: "manager SKILL (plugin/skills/manager/SKILL.md) indexes only 14 of 16 on-disk orchestration/SPEC-*.md — missing SPEC-branching-model-integration-branch-2026-08-05.md and SPEC-integration-architecture-2026-08-05.md (both added 08-05); manager-layer-shipping.test.mjs AC6 requires the SKILL to index EVERY on-disk SPEC file (readdir + includes assert); the two new SPECs (branching model / integration architecture) were filed 2026-08-05 but never added to the manager SKILL's methodology index — documentation drift, the same 'added file without updating its index' class; fix = add the two missing SPEC filenames to manager SKILL.md's index section"
status: ready
labels:
  - gap
  - defect
extra:
  schema: v1
---
**type:** execution

## Proposal

**manager SKILL 缺索引 2 个新增 SPEC 文件——全量 suite 失败。**

**【实测（外层，suite log line 5373 + 直接核实）】**：`plugin/skills/manager/SKILL.md` 的方法论索引
覆盖 14/16 个 on-disk `orchestration/SPEC-*.md`，缺：
- `SPEC-branching-model-integration-branch-2026-08-05.md`
- `SPEC-integration-architecture-2026-08-05.md`

测试 `manager-layer-shipping.test.mjs` AC6 要求 SKILL 索引**每个** on-disk SPEC（
`fs.readdirSync(SPEC_DIR).filter(SPEC-.*)` + `src.includes(spec)`）——缺失 2 个 → 失败。

**【性质】**：文档漂移——08-05 新增 2 个 SPEC（branching model / integration architecture）时
没同步更新 manager SKILL 的索引。与「新增文件没更新索引」类缺陷同族。

### 选定机制

在 manager SKILL.md 的方法论索引区补 2 行（对齐现有条目格式，含一句话说明）。

## Acceptance Criteria

- [x] AC1: manager SKILL 索引全部 on-disk SPEC-*.md（实测 on-disk 现为 **17** 份——任务填报时 16，08-08 新增 `SPEC-inbox-service-2026-08-08.md`；AC6 测试机械要求索引每个 on-disk SPEC，故索引补全至 17 份全覆盖）
- [x] AC2: manager-layer-shipping.test.mjs AC6 隔离跑绿
- [x] AC3: 索引格式与现有条目对齐（一行一个，带说明）

## Definition of Done

- [x] AC1-AC3 全勾（manager SKILL 索引全部 17 个 on-disk SPEC-*.md；manager-layer-shipping.test.mjs AC6 隔离绿；索引格式与现有条目对齐）
- [x] 修后 invoke 实测 MISSING → 0（`for f in orchestration/SPEC-*.md; do grep -q "$(basename $f)" plugin/skills/manager/SKILL.md || echo MISSING; done` 无输出）
- [x] scoped 门 `scripts/test.sh --for-task gap-manager-skill-index-missing-new-specs` 绿（fail 0 / cancelled 0）

### 完成证据（2026-08-08 内层执行）

**DoD invoke（修后，无 MISSING 输出）**：
```
$ for f in orchestration/SPEC-*.md; do grep -q "$(basename $f)" plugin/skills/manager/SKILL.md || echo "MISSING $(basename $f)"; done
（无输出 = 17/17 全部索引）
```

**AC6 隔离跑（pass 7 / fail 0 / cancelled 0）**：
```
$ node --test plugin/test/manager-layer-shipping.test.mjs
✔ AC6 — the manager SKILL indexes every on-disk orchestration/SPEC-*.md (index only, no batch crystallization) (2.258384ms)
ℹ tests 7  ℹ pass 7  ℹ fail 0  ℹ cancelled 0
```

**改动**：`plugin/skills/manager/SKILL.md` — ①「Methodology sources」索引清单补
`SPEC-inbox-service-2026-08-08.md`（17/17）；② §7「方法论来源（AC6）」索引表补 3 行
（`SPEC-branching-model-integration-branch-2026-08-05.md` / `SPEC-integration-architecture-2026-08-05.md`
/ `SPEC-inbox-service-2026-08-08.md`），计数 "14 份" → "17 份"。原 2 个缺失 SPEC
（branching-model / integration-architecture）已在 `ba833c14`（2026-08-06）进过 Methodology sources
清单但未进 §7 索引表；本次补全 §7 表使其与 on-disk 全量对齐。

## Definition of Done

- [ ] AC1-AC3 全勾（manager SKILL 索引全部 16 个 on-disk SPEC-*.md；manager-layer-shipping.test.mjs AC6 隔离绿；索引格式与现有条目对齐）
- [ ] 修后 invoke 实测 MISSING 2 → 0（`for f in orchestration/SPEC-*.md; do grep -q "$(basename $f)" plugin/skills/manager/SKILL.md || echo MISSING; done` 无输出）
- [ ] scoped 门 `scripts/test.sh --for-task gap-manager-skill-index-missing-new-specs` 绿（fail 0 / cancelled 0）

## Touches
- tasks/gap-manager-skill-index-missing-new-specs.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）

- plugin/skills/manager/SKILL.md

## Contract

measure   spec_index_ok = `node --test plugin/test/manager-layer-shipping.test.mjs 2>&1 | grep -c 'pass [0-9]'` stdout 数字段（2026-08-08 内层更正：原 `# pass` 是 TAP reporter 形态，node 25 默认 spec reporter 输出 `ℹ pass N`——`# pass` 恒 0；改 `pass [0-9]` 匹配 `ℹ pass 7`，实测 1）
band      spec_index_ok >= 1（AC6 隔离跑绿）
invoke    `for f in orchestration/SPEC-*.md; do grep -q "$(basename $f)" plugin/skills/manager/SKILL.md || echo "MISSING $(basename $f)"; done`
control   当前 MISSING 2 个；修后 0
resume    修完先跑 manager-layer-shipping 隔离，再进全量

## Dispatch review

reviewer: outer
at: 2026-08-06T14:4xZ
changed: 全量 suite 分诊确认的真实缺陷（merge 暴露非引入）——分别: nativeProviderDir 未定义(98e23f5b 删定义留使用)、plugin.json 重复 manager/SKILL.md、manager SKILL 缺 2 个 SPEC 索引。

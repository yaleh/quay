---
id: gap-ac163-allowed-tools-checker-name-mismatch
title: AC-163 判据点名 allowed-tools-plugin-prefix-check.ts，落地名是
  skill-allowed-tools-namespace-check.ts——命名对齐使判据退出 0
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-163
---
## Proposal

AC-163 的判据（goal-driver 逐字执行的 meter）第二条是：

```
node --experimental-strip-types plugin/scripts/allowed-tools-plugin-prefix-check.ts >/dev/null 2>&1
```

该文件**不存在**（`ls plugin/scripts/allowed-tools-plugin-prefix-check.ts` → No such file）。
同一不变式（`plugin/skills/*/SKILL.md` 的 `allowed-tools` 里 `mcp__` 工具名必须全为
`mcp__plugin_quay_quay__*` 形式）的检查器已于 2026-09-05 落地，但名字是
`skill-allowed-tools-namespace-check.ts`（任务 `gap-skill-allowed-tools-plugin-namespace`，status=done，
其 Touches 明确列该名）。AC-163 的 `expect` 原文也点名「静态检查器
`allowed-tools-plugin-prefix-check.ts` 存在且退出 0」——判据与落地物命名分叉。

实测：判据前半（grep 裸 `mcp__quay__`）已绿（`plugin/skills/*/SKILL.md` 无裸名）；后半
`node --experimental-strip-types plugin/scripts/allowed-tools-plugin-prefix-check.ts` exit 1
⇒ AC-163 `evidence.verdict: fail`（2026-09-07T01:21:32.928Z）。本条的实质 = 让判据点名的那个文件
存在且退出 0，与已落地检查器合并为**一个**名字，不造两份同名逻辑。

Related（同 AC163、机制不同、勿当重复）: `gap-skill-allowed-tools-plugin-namespace`（done）——它
解决了「写裸名 + 建检查器」，但把检查器命名为 AC 判据不认识的 `skill-allowed-tools-namespace-check.ts`，
故 AC 判据仍红；本条修的是「检查器名字与判据对不上」。

## Plan

1. **定机制**：把 `plugin/scripts/skill-allowed-tools-namespace-check.ts` **重命名**为
   `plugin/scripts/allowed-tools-plugin-prefix-check.ts`（判据点名的名字），而不是再加一层转发 alias——
   同一不变式只留一个检查器文件，避免「两个名字指同一逻辑」的命名漂移（硬规则 8 编号/命名不得复用）。
2. **改引用**（当前 5 处，`grep -rln skill-allowed-tools-namespace-check` 全命中）：检查器文件自身、
   `plugin/scripts/runner-static-gate.ts`（CODE-CLASS 注册字符串）、
   `plugin/scripts/capability-catalog.sh`（六表注册改新名）、
   `plugin/test/skill-allowed-tools-namespace-check.test.mjs`（文件名 + import 路径改新名）、
   `plugin/scripts/checker-mutation-cases/skill-allowed-tools-namespace-check.sh`（文件名 + 内容路径改新名）。
3. **跑判据**：按 AC-163 `criterion` 原文两条命令整段执行，exit 0（不是只跑改名后的检查器）。
4. **跑负控制**：把一处裸 `mcp__quay__` 写回某 SKILL.md 的 `allowed-tools`，改名后的检查器必须红并逐字点名；
   恢复后绿——证明改名没把检查器改成恒绿。
5. **跑接线验证**：`capability-catalog.sh --summary` 报新名 declared/covered、
   `checker-mutation-check.sh --list` 报新名 covered=yes、改名后的单测全绿。

## AC

- [x] AC1 判据逐字绿：`node --experimental-strip-types plugin/scripts/allowed-tools-plugin-prefix-check.ts` exit 0，且 `test -f plugin/scripts/allowed-tools-plugin-prefix-check.ts` 为真（AC-163 criterion 第二条逐字满足）。
- [x] AC2 无残留旧名：`grep -rln 'skill-allowed-tools-namespace-check' plugin/` 输出为空（重命名彻底、无 stale 引用，不留 alias）。
- [x] AC3 双向取假（改名后仍有效）：写回一处裸 `mcp__quay__` 到任一 SKILL.md `allowed-tools` ⇒ 检查器 exit 1 且逐字点名该文件；恢复 ⇒ exit 0。两次读数入任务体 Evidence。
- [x] AC4 接线绿：`capability-catalog.sh --summary` 报新名 declared/covered、`checker-mutation-check.sh --list` 报新名 covered=yes、`node --test plugin/test/allowed-tools-plugin-prefix-check.test.mjs` 全绿。

## Evidence

AC3 双向取假读数（2026-09-07 落地轮实际执行）：

- **注入（写回裸名）**：`plugin/skills/routines/SKILL.md` 第 4 行 `allowed-tools` 的
  `mcp__plugin_quay_quay__task_get` 改写为 `mcp__quay__task_get`；
  `node --experimental-strip-types plugin/scripts/allowed-tools-plugin-prefix-check.ts` ⇒ **exit 1**，
  逐字点名：`plugin/skills/routines/SKILL.md allowed-tools has non-plugin-quay mcp__ names:` / `    - mcp__quay__task_get`。
- **恢复**：`git checkout -- plugin/skills/routines/SKILL.md` 后同命令 ⇒ **exit 0**。

## DoD

AC-163 的 `criterion` 整段（两条命令）在本任务落地轮**实际执行且 exit 0**——即 goal-driver 下一轮读到的
`evidence.verdict` 由 fail 翻绿，而不是只在任务体里贴「判据应绿」的散文。改名后的检查器在
`plugin/scripts/allowed-tools-plugin-prefix-check.ts` 可见；`grep -rln skill-allowed-tools-namespace-check plugin/`
为空；AC3 的「写回裸名即红」负控制实际执行过一次并留读数。

## Touches

- plugin/scripts/allowed-tools-plugin-prefix-check.ts（改名自 skill-allowed-tools-namespace-check.ts）
- plugin/scripts/runner-static-gate.ts（CODE-CLASS 注册字符串改新名）
- plugin/scripts/capability-catalog.sh（六表注册改新名）
- plugin/test/allowed-tools-plugin-prefix-check.test.mjs（改名 + import 改新名）
- plugin/scripts/checker-mutation-cases/allowed-tools-plugin-prefix-check.sh（改名 + 内容路径改新名）
- docs/analysis/quay-init-closure-ratchet.baseline.json（re-anchor——capability-catalog.sh 是 laydown 源）
- tasks/gap-ac163-allowed-tools-checker-name-mismatch.md（自身）

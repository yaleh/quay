---
id: gap-suite-fix-logfile-not-in-guard-launchcmd-undefined-path
title: execute-suite-fix launchCmd 模板把 logFile 缺值拼成字面量 undefined → 日志落根 + 每轮覆盖 +
  Fix agent 指向坏路径
status: todo
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

> **降级理由（人 08:0xZ 分支模型指令 + manager 审计）**：对即将取消的 integration-as-checkout 结构的优化——人裁吞吐/编排暂不动，本任务降回 todo，不派。

**type:** execution

## Proposal

**实证（manager 2026-08-12 四段链）**：
```
.claude/workflows/execute-suite-fix.js:57-58   从 args 解构 { stateDir, logFile }
:67   守卫只查 worktree/stateDir/root —— logFile 不在守卫里
:78   模板 `--log-file ${logFile}` ⇒ 缺参时拼出【字面量 undefined】
plugin/scripts/full-suite-runner.ts:1244      path.resolve(parseArg(...) ?? …) ⇒ path.resolve("undefined") = <root>/undefined
```
`path.resolve` 那一步解释了它为什么落在仓库根（实测 `./undefined`，300061 bytes）。

**后果（比「日志放错」更重，三层）**：
- **归档保护失效**：full-suite-runner.ts:1558-1563 归档 = `logFile.replace(/full-suite\.log$/, "full-suite-<suffix>.log")`——
  文件名是 "undefined" ⇒ 正则不匹配 ⇒ archivePath===logFile ⇒ renameSync(自己→自己) ⇒ 归档等于没做；
  :1568 createWriteStream(logFile, {flags:"w"}) 截断重写 ⇒ **走这条路径的每一轮都把上一轮日志覆盖掉**。
  现存 300KB 是「最后一轮」（尾部 `# fail 136 / # suite red failed`，mtime 17:15:39Z，round 41 之后、round 42 之前），
  之前的已消失。
- **Fix agent 被指到同一坏路径**：execute-suite-fix.js:91/160/182 把 `${logFile}` 写进给 agent 的指令
  ⇒ 拼成字面量 undefined ⇒ agent「读日志」指到被反复截断的文件——**存在、可读、内容像日志、不报错 ⇒ 最坏失败**。
- runner 有默认值（`?? path.join(stateDir,"full-suite.log")`）但默认只在「没传 flag」时生效——
  调用方传了字符串 "undefined"，`??` 不接管。**缺值被拼成一个合法值而不是缺值，兜底一律看不见它**（硬规则 6 同族）。

**修法方向（manager 约束）**：
1. logFile 加进 :67 守卫（缺则 bad-args 返回），**非补默认值**（补默认让「调用方漏传」继续静默通过，只是换地方静默）。
2. 若确实可选：不传该 flag（让 runner 的 `??` 真正接管）——模板条件拼接，不把 undefined 拼进命令行。
3. **判据**：「凡进入 launchCmd 模板的变量都必须在守卫里」（模板 `${x}` 集合 ⊆ 守卫检查的集合，可机械查）。

## AC

- [ ] AC1: logFile 在 :67 守卫（缺则 bad-args fail-closed）
- [ ] AC2: 模板不拼字面量 undefined（缺 logFile 时不传 flag，runner `??` 接管）
- [ ] AC3: 机械判据——launchCmd 模板 `${x}` ⊆ 守卫检查集合（新增检查）
- [ ] AC4: 负控——缺 logFile 走坏路径被拦（不再落 `<root>/undefined`）
- [ ] AC5: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 负控样例贴出（见 Evidence：缺 logFile 不再落 undefined 文件）
- [ ] 全量套件绿

## Touches

- .claude/workflows/execute-suite-fix.js（守卫 + 模板）
- plugin/scripts/full-suite-runner.ts（若需补归档健壮性）
- 机械检查（launchCmd 模板 ⊆ 守卫）
- tasks/gap-suite-fix-logfile-not-in-guard-launchcmd-undefined-path.md（自身）

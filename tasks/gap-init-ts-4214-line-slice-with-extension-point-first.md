---
id: gap-init-ts-4214-line-slice-with-extension-point-first
title: init.ts 4214 行 / 79 exports 是根包最大的单文件——先按 DIR-133 裁定 2 定「新 provider
  注册在哪」， 再做一刀带扩展点判据的切片
status: todo
labels:
  - gap
  - defect
  - meta
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**事实一（体量，2026-10-22 archguard，HEAD `329087733`）**：`packages/quay/src/init.ts` = **4214 行 / 79 个 exports**，是 `packages/quay/src` 根目录最大的单文件；根包整体 27 文件 / 320 实体，仍是第二大包（serve 之后）。

**事实二（职责混杂，按导出名可读出来）**：同一文件里同时有
- 配置分类与变更：`classifyConfig`（`:96`）、`reconcileConfigContent`（`:264`）、`upgradeConfigContent`（`:445`）；
- 配置生成：`generateConfigContent`（`:986`）、`generateLaunchSettingsContent`（`:1535`）、`generateProfilesContent`（`:1589`）；
- 项目探测：`detectProjectType`（`:1286`）、`detectProvider`（`:1295`）、`detectTestCommand`（`:1320`）、`detectTmuxSession`（`:1341`）；
- 运行环境：`validateWorktreeRoot`（`:1369`）、`mcpEntryForProvider`（`:974`）、`resolveProjectLoopValues`（`:1409`）；
- 备份与损坏恢复：`corruptBackupPathFor`（`:597`）。

**事实三（为什么不能直接拆）**：DIR-133 裁定 2 规定设计切片的 AC 必须含扩展点判据；quay 自己的 `worker` 就是反例——只抽区域不建扩展点，之后 **82%** 的增长回流中心文件。plantuml-js 的 `elk.ts` 同款：行数 570→150 后长回 278，call 出度 23→26。所以本任务**先回答「新 provider / 新探测规则注册在哪里」，再切**。

**事实四（变的轴要看历史，不靠猜）**：`git log --numstat -- packages/quay/src/init.ts` 能看出哪些函数总是同时改（例如新增 provider 时 `detectProvider` 与 `generateConfigContent` 是否连带）。这个共变分组是「哪条轴真的在动」的直接量，不是设计猜测。

## Plan

1. **职责盘点**：把 79 个 export 按「配置分类 / 配置生成 / 项目探测 / 运行环境 / 备份」分组，每组给行区间与代表函数。
2. **共变分析**：跑 `git log --format=%h --numstat -n 200 -- packages/quay/src/init.ts`，把每条提交命中的函数（按行区间）记下来，输出「同一次提交里一起改的函数」的共现计数，取前 5 组。
3. **定扩展点**：基于共变结果选一个变体轴，写出「新 X 注册在哪、注册后中心文件不需要改什么」的一句话定义，并给出可取假的验证（正臂：从外部注册一个新 X，中心文件不动即可生效；负臂：未注册不生效；注入泄漏：把查找表替换成恒返回默认值的实现，正臂必须打红；红线基线：中心文件行数在改动前必须 ≥ 基线）。
4. **切一刀**：只切该轴对应的那一组函数，用 `plugin/scripts/extension-point-criteria.ts --scaffold` 生成四臂骨架，再用 `extension-point-criteria-check.ts` 判定。
5. **读数**：切前 / 切后各跑一次 `wc -l packages/quay/src/init.ts` 与 archguard `outDegree`（同口径 `topByOutDegree`），如实贴出；不设阈值。
6. **不碰的**：配置升级/备份逻辑（`upgradeConfigContent`、`corruptBackupPathFor`）不在本切片范围内，写进非目标。

## Acceptance Criteria

- [ ] AC1 职责盘点：贴出 5 组职责表（组名、行区间、代表函数、export 数），合计 export 数与 `grep -c '^export ' packages/quay/src/init.ts` 一致。
- [ ] AC2 共变读数：贴出「同一次提交里一起改的函数」前 5 组及共现次数，并附生成该读数的完整命令与原始输出前 10 行。
- [ ] AC3 扩展点定义可取假：用 `--scaffold` 生成的骨架里，正臂写成**计数断言**（新 X 注册后 `triggered=1`），负臂写「未注册时 `triggered=0`」，注入泄漏臂写「替换查找表后正臂打红」；改动前实跑，正臂必须为红。贴填好的四臂与实跑输出。
- [ ] AC4 检查器判定：`extension-point-criteria-check.ts` 对填好的任务体判 `satisfied`；贴填前（`missing-arms`，具名缺哪几臂）与填后两次输出。
- [ ] AC5 切片落地：新注册的 X 从 `init.ts` **之外**的文件注册，`grep -n 'X 的名字' packages/quay/src/init.ts` 只出现在 runner 调用处、不出现具体实现；贴 grep 结果与新增文件路径。
- [ ] AC6 结构读数：切前 / 切后 `wc -l packages/quay/src/init.ts` 与 `topByOutDegree` 中 `init.ts` 相关符号的出度，两个端点都要贴；**不判断好坏**，只记录。
- [ ] AC7 无新环：`archguard_detect_cycles(outputScope=package, scope=src)` 前后均为 0 个环；贴两侧 `maxScc` 与 `cycles` 长度。
- [ ] AC8 非目标守住：`git diff --numstat` 显示本任务未触碰 `upgradeConfigContent` / `corruptBackupPathFor` 所在行区间；贴 numstat 与行区间对照。

## Definition of Done

- 有一个从 `init.ts` 之外注册的扩展点，且注册后新增同类不需要修改 `init.ts`（由 AC5 的 grep 与 AC3 的正臂共同证明）。
- 四臂判据在改动前为红、在改动后为绿，且负臂与注入泄漏臂都实跑过。
- 结构读数（行数、出度、环数）前后各一份，如实记录，不以「拆完行数少了」单独宣布成功。

## Touches

- packages/quay/src/init.ts
- packages/quay/src/init-provider-registry.ts
- packages/quay/test/init-provider-registry.test.mjs
- tasks/gap-init-ts-4214-line-slice-with-extension-point-first.md

---
id: gap-load-sensitive-requires-predeclared-marker
title: 红窗释放的「负载敏感」判定须是事前声明而非事后追认——KNOWN-LOAD-SENSITIVE 标记的文件隔离
  通过可放行；无标记文件的隔离通过只能用来申请加标记（连同证据），不能直接放行本轮红窗；理由： ① 隔离重跑通过无法区分「环境噪声」与「只在并发下暴露的真
  bug」（并发全量套件存在的理由被白跑）； ② 无标记=没人事前声明它是负载敏感，事后用一次通过追认分类=用结果反推分类（管理者 2026-08-08
  裁定， 今晚已栽过同形状）；③ 但禁 inner 判断也不对——真负载敏感族存在，机械拦会变硬阻塞；实例如
  serve.test.mjs（@test-group product、无标记）07:06:49 失败、隔离通过后红窗释放
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**红窗释放的「负载敏感」判定须是事前声明（KNOWN-LOAD-SENSITIVE 标记），不是事后追认（隔离通过）。**

### 背景（管理者 2026-08-08 裁定，原话要点转述）

判据 ④ 的文档是机械门（`orchestrator-loop-tick.md:649`：`suiteGreen == false（red/aborted/缺 state）⇒ 不跑批量合`），
实际是自判门（suite red 07:06:49 → inner 隔离重跑 serve.test.mjs 通过 → 07:07:49 批量合，红后 1 分钟）。
文档说机械、实际是自判——**差距本身就是缺口**。

被裁的问题：`serve.test.mjs` 无 KNOWN-LOAD-SENSITIVE 标记，隔离重跑通过是否构成红窗释放的合法依据？
**裁定：不构成——但要修的是标记机制，不是禁止 inner 判断。**

### 三条理由（机械，不靠偏好）

1. **「隔离重跑通过」这个证据本身有系统性偏差**：负载敏感的失败在隔离下必然通过，真缺陷在隔离下也可能
   通过（并发相关的竞态尤其如此）。它无法区分「环境噪声」和「只在并发下暴露的真 bug」——而后者恰恰是
   全量并发套件存在的理由。用一个无法区分二者的证据去放行，等于把并发覆盖白跑了。
2. **无标记 = 没有人事先声明它是负载敏感的**。事后用一次隔离通过来追认「它是环境性的」，是用结果反推
   分类——管理者 2026-08-08 明言「今晚我已经在别处栽过这个形状（拿一次通过当它本来就该通过）」。
3. **但禁止 inner 判断也不对**：真的负载敏感族存在，机械拦会把它们全部变成硬阻塞。

### 可执行的形态（设计归外层+内层，管理者已给方向）

让「负载敏感」成为**事前声明**而非事后追认：
- 有 KNOWN-LOAD-SENSITIVE 标记的文件，隔离通过可放行本轮红窗；
- 无标记的，隔离通过**只能用来申请加标记**（连同证据），不能直接放行本轮红窗。
- 这样 inner 的判断力被保留，但它必须先把判断落成一个**下次也生效的声明**，而不是一次性豁免。

### 现有机制对照

`docs/analysis/fast-mode-loop-tick.md` 已知负载敏感族一节（139-160 行）已定义 KNOWN-LOAD-SENSITIVE
标记（`// @test-group governance` 之外的显式负载敏感注释，文件头 `KNOWN-LOAD-SENSITIVE` 标记，
批跑协议 grep 定位）。本任务的差距是：**标记只用于判绿排除，没有被用于「红窗释放的准入」**——
无标记文件的隔离通过仍被 inner 用于放行（07:06:49 serve.test.mjs 实例）。

**已修（2026-08-08，dispatch gap-load-sensitive-requires-predeclared-marker）**：
- `docs/analysis/fast-mode-loop-tick.md` 已知负载敏感族一节新增「红窗释放准入」判据：**有标记 =
  Path A 直接释放；无标记 = Path B 只能申请加标记（连同证据）、本轮不释放**——两条路径成文。
- 新增机械校验 `plugin/scripts/load-sensitive-release-check.ts`（+ 测试
  `plugin/test/load-sensitive-release-check.test.mjs`）：给定被释放文件集，exit 0 = 全部带标记
  （释放成立）/ exit 1 = 有未标记文件（释放不成立、走 Path B）/ exit 2 = fail-closed。
- 实实例处置（AC4）：`packages/quay/test/serve.test.mjs` 判定为**真负载敏感**（HTTP 服务器 + 绑
  端口 + spawn 真实 CLI + 多工作区 chdir），**补 KNOWN-LOAD-SENSITIVE 头注释**（隔离 1/0 通过
  为证据），不是真缺陷。

## Contract

```
measure unmarked_isolation_release = `grep -nE "KNOWN-LOAD-SENSITIVE" <全量套件 log 判定路径>` stdout 命中数
band unmarked_isolation_release = 0（修复后红窗释放只对带 KNOWN-LOAD-SENSITIVE 标记的文件生效；无标记文件隔离通过只能申请加标记）
invoke `grep -lE "KNOWN-LOAD-SENSITIVE" plugin/test/*.mjs | wc -l`
control 负控制：serve.test.mjs（无标记）隔离通过后不得直接放行红窗，须先申请加标记
resume 若中断，先跑 measure 确认当前无标记文件的释放行为，不要假设已修
```

## Acceptance Criteria

- [x] AC1: **事前声明机制**——红窗释放的「负载敏感」判定只看 KNOWN-LOAD-SENSITIVE 事前标记，
      不再接受无标记文件的事后隔离通过作为放行依据
      （证据：docs/analysis/fast-mode-loop-tick.md「红窗释放准入」成文：有标记 = Path A 直接释放；
      无标记 = Path B 只能申请；机械校验 `load-sensitive-release-check.ts` exit 0/1 二分）
      **scoped 验证（entry path 在场）**：`grep -lE "KNOWN-LOAD-SENSITIVE" plugin/test/*.mjs`（Contract invoke
      的 entry path = `plugin/test/*.mjs`，此处为实际执行的 grep 位置）
- [x] AC2: **无标记路径**——无标记文件隔离通过时，只能申请加标记（含证据），本轮红窗不因它释放
      （证据：同上一节的 Path B 条款——`UNMARKED <file> (release NOT permitted — apply-for-marker path)`；
      `load-sensitive-release-check.ts` 对未标记文件 exit 1，释放不成立）
- [x] AC3: **标记申请流程**——申请加标记有记录（证据贴任务体/文件），下次生效，非一次性豁免
      （证据：本任务体即申请记录载体——AC4 的 serve.test.mjs 处置贴隔离 1/0 证据并落
      KNOWN-LOAD-SENSITIVE 头注释，标记随代码持久化，下次 grep 即生效；无一次性豁免）
- [x] AC4: **serve.test.mjs 处置**——判定它该补标记（连同隔离通过证据）还是真缺陷；若补标记则落
      KNOWN-LOAD-SENSITIVE 头注释，若是真缺陷则修它
      （证据：**判定 = 补标记（真负载敏感，非真缺陷）**——HTTP 服务器 + 绑端口 + spawn 真实
      quay-native CLI（execFileSync）+ 多工作区 chdir，隔离下天然通过、cc8 并发下失败；隔离实跑
      `node --experimental-strip-types --test packages/quay/test/serve.test.mjs` = **1 pass / 0 fail
      / 23.9s**（dispatch 工作树）；标记已落 `packages/quay/test/serve.test.mjs` 文件头
      `KNOWN-LOAD-SENSITIVE`，`grep -l "KNOWN-LOAD-SENSITIVE" packages/quay/test/serve.test.mjs` 命中）
- [x] AC5: 与 gap-batch-merge-gate-reads-stale-green（闸门未机械执行）、判据 ④ 文档 vs 实际
      交叉标注——同类「闸门自判 vs 机械」族
      （证据：`tasks/gap-batch-merge-gate-reads-stale-green.md` 追加交叉标注——本任务把「红窗释放」
      从 inner 自判（隔离通过即放行）改成机械准入（标记 + `load-sensitive-release-check.ts` 校验），
      与批量合闸门从「只读 state 不读新鲜度」改成机械判定的缺口是同一个「闸门自判 vs 机械」族）

## Definition of Done

- [x] AC1-AC5 实跑输出贴任务体（标记文件放行 / 无标记申请 / serve.test.mjs 处置对照——
      外层 2026-08-08 确认：5/5 AC 证据在任务体；serve.test.mjs 已补 KNOWN-LOAD-SENSITIVE 头注释
      （packages/quay/test/serve.test.mjs:2）；全量套件 green 08:07:44、serve.test.mjs passed=true
      33.6s——补标记处置经 full 并发验证）

## Touches
- tasks/gap-load-sensitive-requires-predeclared-marker.md（self）
- docs/analysis/fast-mode-loop-tick.md（红窗释放判据：标记准入，两条路径 + 机械校验命令）
- packages/quay/test/serve.test.mjs（AC4：补 KNOWN-LOAD-SENSITIVE 标记；实际路径在 packages/quay/test/ 而非 plugin/test/）
- plugin/scripts/load-sensitive-release-check.ts（new）（红窗释放准入机械校验）
- plugin/test/load-sensitive-release-check.test.mjs（new）（机械校验的测试）
- tasks/gap-batch-merge-gate-reads-stale-green.md（AC5 交叉标注）

## 交叉标注（gap-batch-merge-gate-validates-tip-not-merge-result，2026-08-08 dispatch）

本任务 AC6 交叉标注：**批量合家族三件套成文——闸门（`gap-batch-merge-gate-reads-stale-green`，何时合）/
对象（`gap-batch-merge-gate-validates-tip-not-merge-result`，合什么）/ 对账（
`gap-batch-merge-reconcile-destroys-uncommitted-work`，合完主检出怎么办）**。对象任务已修：
`integration-batch-merge.sh` 新增 `check_object_gate()`——批量合前校验 develop 侧代码文件
（.ts/.js/.mjs/.sh）是否进过被测树（three-dot `git diff --name-only <merge-base> <develop>`），
含代码文件即 fail-closed 不移动任何 ref，纯 .md/tasks 放行；与 stale-green（时间轴）同族不同轴。本任务
（红窗释放「负载敏感」须事前声明）与对象任务同为「闸门自判 vs 机械」族：本任务把红窗释放改成标记准入，
对象任务把批量合从「只验 tip」改成「验合并结果」——都是把自判放行换成机械校验。

## Dispatch review

reviewer: none
at: 2026-08-08T07:2xZ
changed: 管理者 2026-08-08 裁定（serve.test.mjs 红窗释放不构成 + 修标记机制方向）；外层把裁定转成
  可执行任务体。实例：serve.test.mjs 07:06:49 失败（@test-group product、无 KNOWN-LOAD 标记）、
  隔离通过后 inner 07:07:49 批量合（红后 1 分钟）。

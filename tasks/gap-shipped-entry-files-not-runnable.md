---
id: gap-shipped-entry-files-not-runnable
title: AC-233 交付包 files 装入 bin/quay.js+bin/quay.ts——形如入口却在安装位置不可运行：加枚举测试并排除
status: ready
needs_human_cause: human-adjudication
labels:
  - gap
parent: "null"
children: []
extra:
  schema: execution
goal_ac: AC-233
depends_on:
  - gap-git-graph-lane-colour-assertion-assumes-contiguous-columns
---
## Proposal

**问题（AC-233 收窄后，真实残余）**：`packages/quay/package.json` 的 `files` 含 `"bin"`（整目录），随包装入 `bin/quay.js`（源码探针，非声明 bin）与 `bin/quay.ts`（带可执行位、需类型剥离）。二者「形如入口」却在安装位置结构上不可运行——Node 对 `node_modules/` 下的文件拒绝类型剥离（`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`），与 Node 版本无关。声明的 bin 只有 `./dist/quay.js`（Node 18 与 25 均正常）。原判据「同宿主 driver 可跑而 CLI 拒跑」的前提已证否（立条者调错入口：调了 `bin/quay.js` 而非 `./dist/quay.js`），本条只治真实残余——不裁定 Node 底线、不要求把 `bin/quay.ts` 改成可运行。

**修法（双向，缺一不可）**：① 新建 `plugin/test/shipped-entry-runnable.test.mjs`（带 `// @test-group product`）——枚举「随包装入且形如入口」的文件（可执行位 / shebang / 位于 `bin/`），断言每一个**要么**是 `package.json` `bin` 声明的且能从安装位置布局跑起来，**要么**不在 `files` 装入范围内；② 使包诚实——把 `bin/quay.js` + `bin/quay.ts` 排除出 `files`（合格解）。⛔ 只断言「声明的 bin 能跑」不算——那正是本缺陷能溜过去的形态（坏文件不是声明的 bin）；反向控制必须能取假：注入一个「装入 `files` 但从安装位置跑会结构性失败」的入口文件 ⇒ 测试红，移除 ⇒ 绿。`bin/node-version-check.cjs` 按真实依赖保留或一并排除。

## AC

- [x] `plugin/test/shipped-entry-runnable.test.mjs` 存在、带 `// @test-group product`，且被测试入口发现（`node --test plugin/test/shipped-entry-runnable.test.mjs` 可执行并定位到该文件）
- [x] 正向：测试枚举「随包装入且形如入口」的文件（可执行位 / shebang / 位于 `bin/`），逐个断言「是 `package.json` `bin` 声明 ∧ 从安装位置布局可跑」∨「不在 `files` 装入范围」；对当前状态（`bin/quay.js`+`bin/quay.ts` 在 `files` 内且不合格）该断言红（exit 非 0）
- [x] 反向能取假：注入一个「装入 `files` 但从安装位置跑会结构性失败」的入口文件 ⇒ 测试红；移除 ⇒ 绿（一条命令可复现，非只断言声明的 bin 能跑）
- [x] 包修复：`packages/quay/package.json` 的 `files` 不再装入 `bin/quay.js` + `bin/quay.ts`——`cd packages/quay && npm pack --dry-run` 的文件清单不含这二者（`node-version-check.cjs` 按真实依赖保留或一并排除）
- [x] 声明 bin 未受损：`./dist/quay.js` 从安装位置布局可跑（Node 18 或 25 其一）
- [x] `node plugin/scripts/task-schema-check.ts tasks/gap-shipped-entry-files-not-runnable.md` ⇒ exit 0

## DoD

`plugin/test/shipped-entry-runnable.test.mjs` 落盘并接入测试泳道（绿）；正向枚举断言与反向注入控制都真实跑过并留痕——包修复前后「红→绿」一段、注入/移除「绿→红→绿」一段；`packages/quay/package.json` 的 `files` 不再装入 `bin/quay.js` + `bin/quay.ts`，且声明的 bin `./dist/quay.js` 从安装位置仍可运行；全量 `scripts/test.sh` 通过。⛔ 只写「声明的 bin 能跑」而无枚举/反向控制，或测试文件不存在仅以散文声称 ⇒ 不算达成。

## Touches

- plugin/test/shipped-entry-runnable.test.mjs
- packages/quay/package.json
- tasks/gap-shipped-entry-files-not-runnable.md
## Needs-Human

**执行 2026-09-10T16:55:27.776Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 成因类：human-adjudication
- 失败步/判词：step=suite: AssertionError [ERR_ASSERTION]: distinct column colours = min(8, 8) (got 5)
- run_id：wk-prod-1788972473
- session_id：7e1e51e6-f56e-4503-8cb9-5102482bd71e
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-shipped-entry-files-not-runnable~wk-prod-1788972473~1789058133821-b831ed.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-shipped-entry-files-not-runnable-wk-prod-1788972473.log
